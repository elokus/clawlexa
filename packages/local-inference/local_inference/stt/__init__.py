from __future__ import annotations

from .base import SttBackend


def get_stt_backend(
    name: str,
    *,
    streaming_context: tuple[int, int] = (256, 256),
    streaming_depth: int = 1,
) -> SttBackend:
    if name == "mlx":
        from .mlx_parakeet import MlxParakeetBackend

        return MlxParakeetBackend(
            streaming_context=streaming_context,
            streaming_depth=streaming_depth,
        )

    raise ValueError(
        f"Unknown STT backend: {name}. Install local-inference[{name}] and retry."
    )


__all__ = ["SttBackend", "get_stt_backend"]
