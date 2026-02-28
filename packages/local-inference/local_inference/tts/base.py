from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class TtsBackend(Protocol):
    @property
    def loaded_model(self) -> str | None:
        ...

    def load(self, model_id: str) -> None:
        ...

    def warmup(self) -> None:
        ...

    def generate_pcm16(
        self,
        text: str,
        voice: str | None = None,
        *,
        language: str | None = None,
        temperature: float | None = None,
        seed: int | None = None,
        instruct: str | None = None,
    ) -> bytes:
        ...

    @property
    def sample_rate(self) -> int:
        ...
