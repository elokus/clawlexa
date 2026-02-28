from __future__ import annotations

from .types import TtsGenerationPlan


def build_plan(*, text: str, voice: str | None) -> TtsGenerationPlan:
    kwargs: dict[str, object] = {
        "text": text,
        "lang_code": "a",
    }
    if voice:
        kwargs["voice"] = voice
    return {"method": "generate", "kwargs": kwargs}
