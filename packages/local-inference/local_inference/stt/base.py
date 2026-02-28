from __future__ import annotations

from typing import Protocol, runtime_checkable

from .streaming import StreamSession


@runtime_checkable
class SttBackend(Protocol):
    @property
    def loaded_model(self) -> str | None:
        ...

    def load(self, model_id: str) -> None:
        ...

    def warmup(self) -> None:
        ...

    def transcribe(self, wav_bytes: bytes) -> str:
        ...

    def supports_streaming(self) -> bool:
        ...

    def create_stream_session(self) -> StreamSession | None:
        ...
