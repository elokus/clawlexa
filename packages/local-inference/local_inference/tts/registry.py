from __future__ import annotations

from enum import StrEnum

from .mlx import chatterbox as mlx_chatterbox
from .mlx import kokoro as mlx_kokoro
from .mlx import qwen as mlx_qwen
from .mlx.types import TtsGenerationPlan


class ModelFamily(StrEnum):
    KOKORO = "kokoro"
    CHATTERBOX = "chatterbox"
    QWEN3_BASE = "qwen3-base"
    QWEN3_VOICE_DESIGN = "qwen3-voice-design"
    UNKNOWN = "unknown"


def detect_model_family(model_id: str) -> ModelFamily:
    value = model_id.lower()
    if "kokoro" in value:
        return ModelFamily.KOKORO
    if "chatterbox" in value:
        return ModelFamily.CHATTERBOX
    if "qwen3" in value:
        if mlx_qwen.is_voice_design_model(value):
            return ModelFamily.QWEN3_VOICE_DESIGN
        return ModelFamily.QWEN3_BASE
    return ModelFamily.UNKNOWN


def resolve_model_id(model_id: str) -> str:
    value = model_id.strip().lower()
    if value.startswith("qwen3"):
        return mlx_qwen.resolve_qwen_model_id(model_id)
    return model_id


def build_generation_plan(
    *,
    model_id: str,
    text: str,
    voice: str | None,
    language: str | None,
    temperature: float | None,
    instruct: str | None,
    qwen_ref_audio: str | None,
    qwen_ref_text: str,
    qwen_voice_design_instruct: str,
) -> TtsGenerationPlan:
    family = detect_model_family(model_id)

    if family == ModelFamily.KOKORO:
        return mlx_kokoro.build_plan(text=text, voice=voice)

    if family == ModelFamily.CHATTERBOX:
        return mlx_chatterbox.build_plan(
            text=text,
            voice=voice,
            temperature=temperature,
        )

    if family in (ModelFamily.QWEN3_BASE, ModelFamily.QWEN3_VOICE_DESIGN):
        return mlx_qwen.build_plan(
            model_id=model_id,
            text=text,
            voice=voice,
            language=language or "German",
            temperature=0.8 if temperature is None else temperature,
            instruct=instruct,
            qwen_ref_audio=qwen_ref_audio,
            qwen_ref_text=qwen_ref_text,
            qwen_voice_design_instruct=qwen_voice_design_instruct,
        )

    kwargs: dict[str, object] = {
        "text": text,
    }
    if voice:
        kwargs["voice"] = voice

    return {
        "method": "generate",
        "kwargs": kwargs,
    }
