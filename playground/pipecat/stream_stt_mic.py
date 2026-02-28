"""
Stream microphone input to Parakeet STT — no VAD, pure chunked inference.

Sends audio chunks (configurable interval) directly to StreamingParakeet.
Shows live transcription as you speak.

Usage:
    cd playground/pipecat
    uv run python stream_stt_mic.py
    uv run python stream_stt_mic.py --chunk-ms 200
    uv run python stream_stt_mic.py --chunk-ms 500 --context 512 512
"""

import argparse
import sys
import time
import threading

import mlx.core as mx
import numpy as np
import sounddevice as sd
from parakeet_mlx import from_pretrained

# ─── ANSI ─────────────────────────────────────────────────────────────
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
RED = "\033[31m"
GRAY = "\033[90m"
CLEAR_LINE = "\033[2K\r"

DEFAULT_MODEL = "mlx-community/parakeet-tdt-0.6b-v3"


def run_streaming(model_id: str, chunk_ms: int, context_size: tuple[int, int], depth: int):
    print(f"\n{BOLD}{'=' * 60}{RESET}")
    print(f"{BOLD}  Streaming STT: parakeet-mlx (no VAD){RESET}")
    print(f"{BOLD}{'=' * 60}{RESET}")
    print(f"  {CYAN}Model:{RESET}        {model_id}")
    print(f"  {CYAN}Chunk size:{RESET}   {chunk_ms}ms")
    print(f"  {CYAN}Context:{RESET}      L={context_size[0]}, R={context_size[1]}")
    print(f"  {CYAN}Depth:{RESET}        {depth}")
    print(f"{BOLD}{'─' * 60}{RESET}")

    # ── Load model ──
    print(f"\n  Loading model...", end="", flush=True)
    t0 = time.perf_counter()
    model = from_pretrained(model_id)
    print(f" done ({time.perf_counter() - t0:.1f}s)")

    sample_rate = model.preprocessor_config.sample_rate  # 16000
    chunk_samples = int(sample_rate * chunk_ms / 1000)

    print(f"  Sample rate:    {sample_rate} Hz")
    print(f"  Chunk samples:  {chunk_samples} ({chunk_ms}ms)")

    # ── Warm-up ──
    print(f"  Warming up JIT...", end="", flush=True)
    t0 = time.perf_counter()
    with model.transcribe_stream(context_size=context_size, depth=depth) as ts:
        # Feed 1s of silence to warm up
        silence = mx.zeros((sample_rate,))
        ts.add_audio(silence)
    print(f" done ({time.perf_counter() - t0:.1f}s)")

    print(f"\n{BOLD}{'─' * 60}{RESET}")
    print(f"  {GREEN}Speak into your microphone. Press Ctrl+C to stop.{RESET}")
    print(f"{BOLD}{'─' * 60}{RESET}\n")

    # ── Audio buffer (thread-safe) ──
    audio_lock = threading.Lock()
    audio_queue: list[np.ndarray] = []
    prev_text = ""
    latencies: list[float] = []

    def audio_callback(indata: np.ndarray, frames: int, time_info, status):
        if status:
            print(f"{RED}  Audio status: {status}{RESET}", file=sys.stderr)
        # indata is (frames, channels) float32
        mono = indata[:, 0].copy()
        with audio_lock:
            audio_queue.append(mono)

    # ── Start mic stream ──
    stream = sd.InputStream(
        samplerate=sample_rate,
        channels=1,
        dtype="float32",
        blocksize=chunk_samples,
        callback=audio_callback,
    )

    try:
        with stream, model.transcribe_stream(context_size=context_size, depth=depth) as transcriber:
            while True:
                # Grab all queued chunks
                with audio_lock:
                    chunks = audio_queue.copy()
                    audio_queue.clear()

                if not chunks:
                    time.sleep(0.01)
                    continue

                # Feed each chunk
                for chunk in chunks:
                    audio_mx = mx.array(chunk)
                    t_start = time.perf_counter()
                    transcriber.add_audio(audio_mx)
                    t_elapsed = time.perf_counter() - t_start
                    latencies.append(t_elapsed)

                # Get current result
                result = transcriber.result
                current_text = result.text.strip()

                if current_text != prev_text:
                    # Show finalized vs draft
                    n_finalized = len(transcriber.finalized_tokens)
                    n_draft = len(transcriber.draft_tokens)
                    lat_ms = latencies[-1] * 1000 if latencies else 0

                    sys.stdout.write(CLEAR_LINE)
                    sys.stdout.write(
                        f"  {GREEN}{current_text}{RESET} "
                        f"{GRAY}[{n_finalized}F+{n_draft}D | {lat_ms:.0f}ms]{RESET}"
                    )
                    sys.stdout.flush()
                    prev_text = current_text

    except KeyboardInterrupt:
        pass

    # ── Summary ──
    final_text = prev_text
    print(f"\n\n{BOLD}{'─' * 60}{RESET}")
    print(f"{BOLD}  Session Summary{RESET}")
    print(f"{BOLD}{'─' * 60}{RESET}")
    print(f"  Final transcript: {final_text}")
    if latencies:
        avg_lat = sum(latencies) / len(latencies) * 1000
        p50 = sorted(latencies)[len(latencies) // 2] * 1000
        p99 = sorted(latencies)[int(len(latencies) * 0.99)] * 1000
        print(f"  Chunks processed: {len(latencies)}")
        print(f"  Avg chunk latency: {avg_lat:.1f}ms")
        print(f"  P50 chunk latency: {p50:.1f}ms")
        print(f"  P99 chunk latency: {p99:.1f}ms")
    print(f"{BOLD}{'=' * 60}{RESET}\n")


def main():
    parser = argparse.ArgumentParser(description="Stream mic to Parakeet STT (no VAD)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model ID")
    parser.add_argument("--chunk-ms", type=int, default=100, help="Chunk size in ms (default: 100)")
    parser.add_argument("--context", type=int, nargs=2, default=[256, 256],
                        help="Context size (left right) frames (default: 256 256)")
    parser.add_argument("--depth", type=int, default=1, help="Encoder cache depth (default: 1)")
    args = parser.parse_args()

    run_streaming(args.model, args.chunk_ms, tuple(args.context), args.depth)


if __name__ == "__main__":
    main()
