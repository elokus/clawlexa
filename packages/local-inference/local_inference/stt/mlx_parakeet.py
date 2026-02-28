from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from .base import SttBackend
from .streaming import StreamSession, StreamUpdate


TARGET_SAMPLE_RATE = 16_000


def _resample_linear(audio: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    if src_rate == dst_rate:
        return audio.astype(np.float32, copy=False)
    if audio.size == 0:
        return np.zeros(0, dtype=np.float32)
    if audio.size == 1:
        return np.repeat(audio.astype(np.float32), max(1, int(dst_rate / max(src_rate, 1))))

    src_positions = np.linspace(0.0, audio.size - 1, num=audio.size, dtype=np.float64)
    dst_length = max(1, int(round(audio.size * (dst_rate / src_rate))))
    dst_positions = np.linspace(0.0, audio.size - 1, num=dst_length, dtype=np.float64)
    return np.interp(dst_positions, src_positions, audio).astype(np.float32)


def _to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio.astype(np.float32, copy=False)
    return np.mean(audio, axis=1).astype(np.float32)


def _extract_text(result: Any) -> str:
    if hasattr(result, "text"):
        return str(result.text).strip()
    if isinstance(result, dict):
        value = result.get("text")
        return str(value).strip() if value is not None else ""
    return str(result).strip()


class MlxParakeetStreamSession(StreamSession):
    def __init__(
        self,
        model: Any,
        *,
        context_size: tuple[int, int],
        depth: int,
    ) -> None:
        self._model = model
        self._manager = model.transcribe_stream(context_size=context_size, depth=depth)
        self._stream = self._manager.__enter__()

    def add_pcm16(self, pcm_bytes: bytes, sample_rate: int = TARGET_SAMPLE_RATE) -> StreamUpdate:
        if not pcm_bytes:
            return StreamUpdate(text="", is_final=False, finalized_tokens=0, draft_tokens=0)

        audio = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0
        if sample_rate != TARGET_SAMPLE_RATE:
            audio = _resample_linear(audio, sample_rate, TARGET_SAMPLE_RATE)

        import mlx.core as mx  # Imported lazily for optional dependency support.

        self._stream.add_audio(mx.array(audio))
        result = self._stream.result
        text = _extract_text(result)
        finalized = len(getattr(self._stream, "finalized_tokens", []) or [])
        draft = len(getattr(self._stream, "draft_tokens", []) or [])
        is_final = draft == 0 and finalized > 0
        return StreamUpdate(
            text=text,
            is_final=is_final,
            finalized_tokens=finalized,
            draft_tokens=draft,
        )

    def close(self) -> None:
        if self._manager is None:
            return
        self._manager.__exit__(None, None, None)
        self._manager = None
        self._stream = None


class MlxParakeetBackend(SttBackend):
    def __init__(
        self,
        *,
        streaming_context: tuple[int, int] = (256, 256),
        streaming_depth: int = 1,
    ) -> None:
        self._model: Any | None = None
        self._loaded_model: str | None = None
        self._streaming_context = streaming_context
        self._streaming_depth = streaming_depth

    @property
    def loaded_model(self) -> str | None:
        return self._loaded_model

    def load(self, model_id: str) -> None:
        from parakeet_mlx import from_pretrained

        self._model = from_pretrained(model_id)
        self._loaded_model = model_id

    def warmup(self) -> None:
        if self._model is None:
            raise RuntimeError("STT model is not loaded")

        silence = np.zeros(TARGET_SAMPLE_RATE // 4, dtype=np.float32)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp:
            temp_path = Path(temp.name)
        try:
            sf.write(
                temp_path,
                silence,
                TARGET_SAMPLE_RATE,
                format="WAV",
                subtype="PCM_16",
            )
            self._model.transcribe(str(temp_path))
        finally:
            temp_path.unlink(missing_ok=True)

    def transcribe(self, wav_bytes: bytes) -> str:
        if self._model is None:
            raise RuntimeError("STT model is not loaded")

        audio, sample_rate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
        mono = _to_mono(audio)
        if sample_rate != TARGET_SAMPLE_RATE:
            mono = _resample_linear(mono, int(sample_rate), TARGET_SAMPLE_RATE)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp:
            temp_path = Path(temp.name)
        try:
            sf.write(
                temp_path,
                mono,
                TARGET_SAMPLE_RATE,
                format="WAV",
                subtype="PCM_16",
            )
            result = self._model.transcribe(str(temp_path))
            return _extract_text(result)
        finally:
            temp_path.unlink(missing_ok=True)

    def supports_streaming(self) -> bool:
        return True

    def create_stream_session(self) -> StreamSession | None:
        if self._model is None:
            return None
        return MlxParakeetStreamSession(
            self._model,
            context_size=self._streaming_context,
            depth=self._streaming_depth,
        )
