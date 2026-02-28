from __future__ import annotations

import argparse
from typing import Sequence

from pydantic import BaseModel, ConfigDict

DEFAULT_QWEN_VOICE_DESIGN_INSTRUCT = (
    "A native German male speaker with a warm, calm baritone voice. "
    "Natural German pronunciation with moderate pace."
)
DEFAULT_QWEN_REF_TEXT = (
    "Willkommen bei unserem Service. Mein Name ist Jarvis und ich bin hier, "
    "um Ihnen bei allen Fragen weiterzuhelfen. Fragen Sie mich einfach."
)


class ServerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host: str = "0.0.0.0"
    port: int = 1060

    stt_backend: str = "mlx"
    stt_model: str = "mlx-community/parakeet-tdt-0.6b-v3"

    tts_backend: str = "mlx"
    tts_model: str = "mlx-community/Kokoro-82M-bf16"
    tts_voice: str = "af_heart"
    sample_rate: int = 24000
    qwen_language: str = "German"
    qwen_seed: int = 42
    qwen_temperature: float = 0.8
    qwen_ref_audio: str | None = None
    qwen_ref_text: str = DEFAULT_QWEN_REF_TEXT
    qwen_voice_design_instruct: str = DEFAULT_QWEN_VOICE_DESIGN_INSTRUCT

    stt_streaming_context: tuple[int, int] = (256, 256)
    stt_streaming_depth: int = 1


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local STT + TTS inference server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=1060)

    parser.add_argument("--stt-backend", default="mlx")
    parser.add_argument("--stt-model", default="mlx-community/parakeet-tdt-0.6b-v3")

    parser.add_argument("--tts-backend", default="mlx")
    parser.add_argument("--tts-model", default="mlx-community/Kokoro-82M-bf16")
    parser.add_argument("--tts-voice", default="af_heart")
    parser.add_argument("--sample-rate", type=int, default=24000)
    parser.add_argument(
        "--qwen-language",
        default="German",
        help="Default Qwen language/locale setting",
    )
    parser.add_argument(
        "--qwen-seed",
        type=int,
        default=42,
        help="Default Qwen generation seed",
    )
    parser.add_argument(
        "--qwen-temperature",
        type=float,
        default=0.8,
        help="Default Qwen generation temperature",
    )
    parser.add_argument(
        "--qwen-ref-audio",
        default=None,
        help="Optional reference audio path for Qwen base voice cloning",
    )
    parser.add_argument(
        "--qwen-ref-text",
        default=DEFAULT_QWEN_REF_TEXT,
        help="Reference transcript used with --qwen-ref-audio",
    )
    parser.add_argument(
        "--qwen-voice-design-instruct",
        default=DEFAULT_QWEN_VOICE_DESIGN_INSTRUCT,
        help="Default VoiceDesign prompt for Qwen VoiceDesign models",
    )

    parser.add_argument(
        "--stt-streaming-context",
        type=int,
        nargs=2,
        metavar=("LEFT", "RIGHT"),
        default=(256, 256),
        help="Parakeet streaming context size (left right)",
    )
    parser.add_argument(
        "--stt-streaming-depth",
        type=int,
        default=1,
        help="Parakeet streaming encoder cache depth",
    )

    return parser


def parse_server_config(argv: Sequence[str] | None = None) -> ServerConfig:
    args = build_arg_parser().parse_args(argv)
    context = tuple(int(value) for value in args.stt_streaming_context)
    return ServerConfig(
        host=args.host,
        port=args.port,
        stt_backend=args.stt_backend,
        stt_model=args.stt_model,
        tts_backend=args.tts_backend,
        tts_model=args.tts_model,
        tts_voice=args.tts_voice,
        sample_rate=args.sample_rate,
        qwen_language=args.qwen_language,
        qwen_seed=args.qwen_seed,
        qwen_temperature=args.qwen_temperature,
        qwen_ref_audio=args.qwen_ref_audio,
        qwen_ref_text=args.qwen_ref_text,
        qwen_voice_design_instruct=args.qwen_voice_design_instruct,
        stt_streaming_context=(context[0], context[1]),
        stt_streaming_depth=args.stt_streaming_depth,
    )
