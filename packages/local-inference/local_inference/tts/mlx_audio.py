from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import numpy as np

from .base import TtsBackend
from .registry import (
    ModelFamily,
    build_generation_plan,
    detect_model_family,
    resolve_model_id,
)
from ..model_control import resolve_model_source_path


def _extract_audio_chunk(result: Any) -> np.ndarray | None:
    chunk = getattr(result, "audio", None)
    if chunk is None and isinstance(result, dict):
        chunk = result.get("audio")
    if chunk is None:
        return None

    audio = np.asarray(chunk, dtype=np.float32)
    if audio.ndim > 1:
        audio = np.squeeze(audio)
    return audio.reshape(-1)


class MlxAudioBackend(TtsBackend):
    def __init__(
        self,
        *,
        default_voice: str = "af_heart",
        qwen_language: str = "German",
        qwen_seed: int = 42,
        qwen_temperature: float = 0.8,
        qwen_ref_audio: str | None = None,
        qwen_ref_text: str = "",
        qwen_voice_design_instruct: str = "",
    ) -> None:
        self._model: Any | None = None
        self._loaded_model: str | None = None
        self._sample_rate: int = 24_000
        self._default_voice = default_voice
        self._qwen_language = qwen_language
        self._qwen_seed = qwen_seed
        self._qwen_temperature = qwen_temperature
        self._qwen_ref_audio = qwen_ref_audio
        self._qwen_ref_text = qwen_ref_text
        self._qwen_voice_design_instruct = qwen_voice_design_instruct

    @property
    def loaded_model(self) -> str | None:
        return self._loaded_model

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def normalize_model_id(self, model_id: str) -> str:
        return resolve_model_id(model_id)

    def load(self, model_id: str) -> None:
        from mlx_audio.tts.utils import load_model

        resolved_model_id = self.normalize_model_id(model_id)
        model_source = resolve_model_source_path(resolved_model_id)
        self._model = load_model(model_source)
        self._loaded_model = resolved_model_id
        self._sample_rate = int(getattr(self._model, "sample_rate", 24_000))

    def warmup(self) -> None:
        if self._model is None:
            raise RuntimeError("TTS model is not loaded")
        family = detect_model_family(self._loaded_model or "")
        warmup_instruct = (
            self._qwen_voice_design_instruct
            if family == ModelFamily.QWEN3_VOICE_DESIGN
            else None
        )
        self.generate_pcm16(
            "Hallo Welt.",
            voice=self._default_voice,
            language=self._qwen_language,
            temperature=self._qwen_temperature,
            seed=self._qwen_seed,
            instruct=warmup_instruct,
        )

    def supports_streaming(self, model_id: str | None = None) -> bool:
        resolved_model_id = (
            self.normalize_model_id(model_id)
            if model_id is not None
            else self._loaded_model
        )
        if not resolved_model_id:
            return False
        return detect_model_family(resolved_model_id) == ModelFamily.QWEN3_BASE

    def _iter_audio_chunks(
        self,
        text: str,
        voice: str | None = None,
        *,
        language: str | None = None,
        temperature: float | None = None,
        seed: int | None = None,
        instruct: str | None = None,
        stream: bool = False,
        streaming_interval: float | None = None,
        ref_audio: str | None = None,
        ref_text: str | None = None,
    ) -> Iterator[np.ndarray]:
        if self._model is None or self._loaded_model is None:
            raise RuntimeError("TTS model is not loaded")

        requested_voice = voice or self._default_voice
        requested_temperature = (
            self._qwen_temperature if temperature is None else temperature
        )
        plan = build_generation_plan(
            model_id=self._loaded_model,
            text=text,
            voice=requested_voice,
            language=language or self._qwen_language,
            temperature=requested_temperature,
            instruct=instruct,
            qwen_ref_audio=self._qwen_ref_audio,
            qwen_ref_text=self._qwen_ref_text,
            qwen_voice_design_instruct=self._qwen_voice_design_instruct,
            ref_audio_override=ref_audio,
            ref_text_override=ref_text,
        )

        family = detect_model_family(self._loaded_model)
        if family in (ModelFamily.QWEN3_BASE, ModelFamily.QWEN3_VOICE_DESIGN):
            import mlx.core as mx  # Imported lazily for optional dependency support.

            mx.random.seed(self._qwen_seed if seed is None else seed)

        generator = (
            self._model.generate_voice_design
            if plan["method"] == "generate_voice_design"
            else self._model.generate
        )

        kwargs = dict(plan["kwargs"])
        if (
            stream
            and family == ModelFamily.QWEN3_BASE
            and plan["method"] == "generate"
        ):
            kwargs["stream"] = True
            if streaming_interval is not None:
                kwargs["streaming_interval"] = streaming_interval

        for result in generator(**kwargs):
            chunk = _extract_audio_chunk(result)
            if chunk is not None and chunk.size > 0:
                yield chunk

    def stream_pcm16(
        self,
        text: str,
        voice: str | None = None,
        *,
        language: str | None = None,
        temperature: float | None = None,
        seed: int | None = None,
        instruct: str | None = None,
        streaming_interval: float | None = None,
        ref_audio: str | None = None,
        ref_text: str | None = None,
    ) -> Iterator[bytes]:
        emitted = 0
        for audio in self._iter_audio_chunks(
            text,
            voice,
            language=language,
            temperature=temperature,
            seed=seed,
            instruct=instruct,
            stream=True,
            streaming_interval=streaming_interval,
            ref_audio=ref_audio,
            ref_text=ref_text,
        ):
            audio = np.clip(audio, -1.0, 1.0)
            pcm = (audio * 32767.0).astype(np.int16)
            if pcm.size > 0:
                emitted += 1
                yield pcm.tobytes()

        if emitted == 0:
            raise RuntimeError("TTS generation produced no audio")

    def generate_pcm16(
        self,
        text: str,
        voice: str | None = None,
        *,
        language: str | None = None,
        temperature: float | None = None,
        seed: int | None = None,
        instruct: str | None = None,
        ref_audio: str | None = None,
        ref_text: str | None = None,
    ) -> bytes:
        chunks: list[np.ndarray] = []
        for chunk in self._iter_audio_chunks(
            text,
            voice,
            language=language,
            temperature=temperature,
            seed=seed,
            instruct=instruct,
            stream=False,
            ref_audio=ref_audio,
            ref_text=ref_text,
        ):
            chunks.append(chunk)

        if not chunks:
            raise RuntimeError("TTS generation produced no audio")

        audio = np.concatenate(chunks).astype(np.float32)
        peak = float(np.max(np.abs(audio))) if audio.size > 0 else 0.0
        if peak > 0.0:
            audio = (audio / peak) * 0.9

        audio = np.clip(audio, -1.0, 1.0)
        pcm = (audio * 32767.0).astype(np.int16)
        return pcm.tobytes()
