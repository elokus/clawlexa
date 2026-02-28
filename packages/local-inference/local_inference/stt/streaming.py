from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(slots=True)
class StreamUpdate:
    text: str
    is_final: bool
    finalized_tokens: int
    draft_tokens: int


class StreamSession(Protocol):
    def add_pcm16(self, pcm_bytes: bytes, sample_rate: int = 16_000) -> StreamUpdate:
        ...

    def close(self) -> None:
        ...
