from __future__ import annotations

from typing import Any

import numpy as np

from .base import TtsBackend
from .registry import (
    ModelFamily,
    build_generation_plan,
    detect_model_family,
    resolve_model_id,
)


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
        self._model = load_model(resolved_model_id)
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

        chunks: list[np.ndarray] = []
        for result in generator(**plan["kwargs"]):
            chunk = _extract_audio_chunk(result)
            if chunk is not None and chunk.size > 0:
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
