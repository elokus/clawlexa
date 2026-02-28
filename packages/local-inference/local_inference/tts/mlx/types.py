from __future__ import annotations

from typing import Any, Literal, TypedDict


class TtsGenerationPlan(TypedDict):
    method: Literal["generate", "generate_voice_design"]
    kwargs: dict[str, Any]
