from __future__ import annotations

from .types import TtsGenerationPlan


def build_plan(
    *,
    text: str,
    voice: str | None,
    temperature: float | None,
) -> TtsGenerationPlan:
    kwargs: dict[str, object] = {
        "text": text,
        "lang_code": "de",
    }
    if temperature is not None:
        kwargs["temperature"] = temperature
    if voice:
        kwargs["voice"] = voice
    return {"method": "generate", "kwargs": kwargs}
