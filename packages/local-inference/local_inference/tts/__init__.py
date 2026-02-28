from __future__ import annotations

from .base import TtsBackend


def get_tts_backend(
    name: str,
    *,
    default_voice: str = "af_heart",
    qwen_language: str = "German",
    qwen_seed: int = 42,
    qwen_temperature: float = 0.8,
    qwen_ref_audio: str | None = None,
    qwen_ref_text: str = "",
    qwen_voice_design_instruct: str = "",
) -> TtsBackend:
    if name == "mlx":
        from .mlx_audio import MlxAudioBackend

        return MlxAudioBackend(
            default_voice=default_voice,
            qwen_language=qwen_language,
            qwen_seed=qwen_seed,
            qwen_temperature=qwen_temperature,
            qwen_ref_audio=qwen_ref_audio,
            qwen_ref_text=qwen_ref_text,
            qwen_voice_design_instruct=qwen_voice_design_instruct,
        )

    raise ValueError(
        f"Unknown TTS backend: {name}. Install local-inference[{name}] and retry."
    )


__all__ = ["TtsBackend", "get_tts_backend"]
