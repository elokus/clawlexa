"""
Ultravox Realtime Voice Playground via Pipecat
===============================================

Minimal CLI voice agent using Pipecat + Ultravox speech-to-speech.
Uses local mic/speaker (PyAudio/PortAudio) — no web server needed.

Prerequisites:
    brew install portaudio
    cd playground && uv sync

Usage:
    uv run python ultravox_realtime.py
    uv run python ultravox_realtime.py --system-prompt "You are a pirate"
    uv run python ultravox_realtime.py --list-devices
"""

import argparse
import asyncio
import datetime
import os
import sys
import time

from dotenv import load_dotenv
from loguru import logger

from pipecat.frames.frames import (
    Frame,
    MetricsFrame,
    TranscriptionFrame,
    InterimTranscriptionFrame,
    TextFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    LLMFullResponseStartFrame,
    LLMFullResponseEndFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.ultravox.llm import OneShotInputParams, UltravoxRealtimeLLMService
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams

load_dotenv(override=True)

# ─── ANSI colors ───────────────────────────────────────────────────────

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
BLUE = "\033[34m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"
RED = "\033[31m"
GRAY = "\033[90m"

# ─── Transcript display ───────────────────────────────────────────────


class TranscriptProcessor(FrameProcessor):
    """Intercepts frames to display live transcripts and metrics in the terminal.

    Mimics the voice-agent TUI inspector pattern:
    - [U] blue for user transcripts
    - [A] green for assistant text
    - Latency/metrics in dim gray
    """

    def __init__(self):
        super().__init__()
        self._assistant_text = ""
        self._assistant_streaming = False
        self._user_speaking = False
        self._turn_start: float | None = None
        self._first_token_time: float | None = None
        self._perf: dict[str, float] = {}

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        # ── User transcription (final) ──
        if isinstance(frame, TranscriptionFrame):
            self._clear_line()
            ts = self._timestamp()
            print(f"{ts} {BLUE}{BOLD}[U]{RESET} {frame.text}")
            self._turn_start = time.monotonic()
            self._first_token_time = None

        # ── User transcription (interim / partial) ──
        elif isinstance(frame, InterimTranscriptionFrame):
            self._clear_line()
            ts = self._timestamp()
            sys.stdout.write(f"\r{ts} {BLUE}{DIM}[U] {frame.text}...{RESET}")
            sys.stdout.flush()

        # ── User speaking indicators ──
        elif isinstance(frame, UserStartedSpeakingFrame):
            self._user_speaking = True
            # If assistant was streaming, finalize it (barge-in)
            if self._assistant_streaming:
                self._finalize_assistant(" [interrupted]")

        elif isinstance(frame, UserStoppedSpeakingFrame):
            self._user_speaking = False

        # ── Assistant text deltas ──
        elif isinstance(frame, TextFrame):
            if not self._assistant_streaming:
                self._assistant_streaming = True
                self._assistant_text = ""
                ts = self._timestamp()
                sys.stdout.write(f"\n{ts} {GREEN}{BOLD}[A]{RESET} ")
                # Measure time-to-first-token
                if self._turn_start and not self._first_token_time:
                    self._first_token_time = time.monotonic()
                    ttft = (self._first_token_time - self._turn_start) * 1000
                    self._perf["ttft_ms"] = ttft

            self._assistant_text += frame.text
            sys.stdout.write(frame.text)
            sys.stdout.flush()

        # ── TTS lifecycle ──
        elif isinstance(frame, TTSStartedFrame):
            pass  # Audio playback starting

        elif isinstance(frame, TTSStoppedFrame):
            if self._assistant_streaming:
                self._finalize_assistant()

        # ── LLM response boundaries ──
        elif isinstance(frame, LLMFullResponseStartFrame):
            if self._turn_start and not self._first_token_time:
                self._first_token_time = time.monotonic()

        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._assistant_streaming:
                self._finalize_assistant()

        # ── Metrics ──
        elif isinstance(frame, MetricsFrame):
            for metric in frame.data:
                name = getattr(metric, "name", None) or getattr(metric, "model", "metric")
                value = getattr(metric, "value", None) or getattr(metric, "time", None)
                if value is not None:
                    self._perf[str(name)] = float(value)

        await self.push_frame(frame, direction)

    def _finalize_assistant(self, suffix: str = ""):
        """End the current assistant turn and print metrics."""
        self._assistant_streaming = False
        if suffix:
            sys.stdout.write(f"{RED}{suffix}{RESET}")
        sys.stdout.write("\n")

        # Print latency metrics if available
        if self._perf:
            parts = []
            if "ttft_ms" in self._perf:
                parts.append(f"TTFT={self._perf['ttft_ms']:.0f}ms")
            for k, v in self._perf.items():
                if k != "ttft_ms":
                    parts.append(f"{k}={v:.0f}ms" if "time" in k.lower() or "latency" in k.lower() else f"{k}={v:.2f}")
            if parts:
                print(f"    {GRAY}{DIM}{' | '.join(parts)}{RESET}")
            self._perf.clear()

        sys.stdout.flush()

    def _clear_line(self):
        sys.stdout.write("\r\033[K")

    def _timestamp(self) -> str:
        now = datetime.datetime.now().strftime("%H:%M:%S")
        return f"{GRAY}{now}{RESET}"


# ─── Device listing ───────────────────────────────────────────────────


def list_audio_devices():
    """List available PyAudio input/output devices."""
    try:
        import pyaudio
    except ImportError:
        print("pyaudio not installed. Run: uv sync")
        return

    p = pyaudio.PyAudio()
    print(f"\n{BOLD}Audio Devices:{RESET}\n")
    for i in range(p.get_device_count()):
        info = p.get_device_info_by_index(i)
        direction = []
        if info["maxInputChannels"] > 0:
            direction.append(f"{BLUE}IN{RESET}")
        if info["maxOutputChannels"] > 0:
            direction.append(f"{GREEN}OUT{RESET}")
        marker = " ".join(direction)
        default = ""
        if i == p.get_default_input_device_info()["index"]:
            default += f" {YELLOW}(default input){RESET}"
        if i == p.get_default_output_device_info()["index"]:
            default += f" {YELLOW}(default output){RESET}"
        print(f"  [{i}] {info['name']} [{marker}]{default}")
    p.terminate()
    print()


# ─── Main ─────────────────────────────────────────────────────────────


DEFAULT_SYSTEM_PROMPT = """You are a helpful voice assistant. Keep your responses concise and conversational.
You are being used as a test for voice latency and quality comparison, so respond quickly and naturally.
Use short sentences. Don't use lists or markdown formatting — this is a voice conversation."""


async def run_agent(args):
    api_key = os.getenv("ULTRAVOX_API_KEY")
    if not api_key:
        print(f"{RED}Error: ULTRAVOX_API_KEY not set in .env{RESET}")
        sys.exit(1)

    # ── Transport: local mic/speaker ──
    transport_params = LocalAudioTransportParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
    )
    if args.input_device is not None:
        transport_params.input_device_index = args.input_device
    if args.output_device is not None:
        transport_params.output_device_index = args.output_device

    transport = LocalAudioTransport(transport_params)

    # ── LLM: Ultravox speech-to-speech ──
    # NOTE: one_shot_selected_tools=ToolsSchema(standard_tools=[]) is required
    # even with no tools — Pipecat bug: _selected_tools attribute is only set
    # when one_shot_selected_tools is provided, but _start_one_shot_call
    # references it unconditionally.
    llm = UltravoxRealtimeLLMService(
        params=OneShotInputParams(
            api_key=api_key,
            system_prompt=args.system_prompt,
            temperature=0.3,
            max_duration=datetime.timedelta(minutes=args.duration),
        ),
        one_shot_selected_tools=ToolsSchema(standard_tools=[]),
    )

    # ── Context aggregator (required for S2S pipeline) ──
    context = LLMContext([])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    # ── Transcript display ──
    transcript_processor = TranscriptProcessor()

    # ── Pipeline ──
    pipeline = Pipeline(
        [
            transport.input(),
            user_aggregator,
            llm,
            transcript_processor,
            transport.output(),
            assistant_aggregator,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    # ── Header (print before pipeline starts) ──
    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  Ultravox Realtime Voice Playground (Pipecat){RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")
    print(f"  {CYAN}Provider:{RESET}  Ultravox (speech-to-speech)")
    print(f"  {CYAN}Transport:{RESET} Local audio (PyAudio/PortAudio)")
    print(f"  {CYAN}Duration:{RESET}  {args.duration} minutes max")
    print(f"  {CYAN}Prompt:{RESET}    {args.system_prompt[:60]}...")
    print(f"{BOLD}{'─' * 60}{RESET}")
    print(f"  {DIM}Speak into your microphone. Press Ctrl+C to stop.{RESET}")
    print(f"{BOLD}{'─' * 60}{RESET}\n")
    sys.stdout.flush()

    # ── Run ──
    runner = PipelineRunner()
    await runner.run(task)


def main_entry():
    parser = argparse.ArgumentParser(description="Ultravox Realtime Voice Playground")
    parser.add_argument(
        "--system-prompt",
        default=DEFAULT_SYSTEM_PROMPT,
        help="System prompt for the voice agent",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=10,
        help="Max session duration in minutes (default: 10)",
    )
    parser.add_argument(
        "--input-device",
        type=int,
        default=None,
        help="PyAudio input device index (use --list-devices to see)",
    )
    parser.add_argument(
        "--output-device",
        type=int,
        default=None,
        help="PyAudio output device index (use --list-devices to see)",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio devices and exit",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args()

    if args.list_devices:
        list_audio_devices()
        sys.exit(0)

    # Configure logging
    logger.remove()
    if args.debug:
        logger.add(sys.stderr, level="DEBUG")
    else:
        logger.add(sys.stderr, level="WARNING")

    asyncio.run(run_agent(args))


if __name__ == "__main__":
    main_entry()
