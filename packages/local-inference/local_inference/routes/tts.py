from __future__ import annotations

import io
import logging

import numpy as np
import soundfile as sf
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict

from ..tts.base import TtsBackend

router = APIRouter()
logger = logging.getLogger("local_inference.tts")


def _normalize_value(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _canonical_model_id(tts: TtsBackend, model_id: str | None) -> str | None:
    if model_id is None:
        return None
    normalizer = getattr(tts, "normalize_model_id", None)
    if callable(normalizer):
        return str(normalizer(model_id))
    return model_id


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str | None = None
    voice: str | None = None
    input: str | None = None
    text: str | None = None
    language: str | None = None
    lang_code: str | None = None
    temperature: float | None = None
    seed: int | None = None
    instruct: str | None = None
    stream: bool | None = None
    streaming_interval: float | None = None
    response_format: str = "pcm"
    ref_audio: str | None = None
    ref_text: str | None = None

    def resolved_text(self) -> str:
        return (self.input or self.text or "").strip()


class VoiceDesignRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    instruct: str
    text: str
    language: str = "English"
    seed: int = 42
    temperature: float = 0.7
    model: str | None = None


async def _swap_tts_model_if_needed(
    request: Request,
    tts: TtsBackend,
    requested_model: str | None,
) -> None:
    canonical_requested_model = _canonical_model_id(tts, requested_model)
    canonical_loaded_model = _canonical_model_id(tts, tts.loaded_model)
    if (
        not requested_model
        or canonical_requested_model is None
        or canonical_requested_model == canonical_loaded_model
    ):
        return

    def do_swap() -> None:
        lock = request.app.state.tts_lock
        with lock:
            if canonical_requested_model == _canonical_model_id(tts, tts.loaded_model):
                return
            logger.info(
                "TTS model swap: %s -> %s",
                tts.loaded_model,
                canonical_requested_model,
            )
            tts.load(canonical_requested_model)
            tts.warmup()

    await run_in_threadpool(do_swap)


def _iter_pcm_chunks(pcm: bytes, chunk_size: int):
    for offset in range(0, len(pcm), chunk_size):
        yield pcm[offset : offset + chunk_size]


@router.post("/v1/audio/speech")
async def synthesize_audio(
    request: Request,
    payload: SpeechRequest,
) -> StreamingResponse:
    tts: TtsBackend = request.app.state.tts

    text = payload.resolved_text()
    if not text:
        raise HTTPException(status_code=400, detail="'input' is required")

    response_format = payload.response_format.lower().strip()
    if response_format not in {"pcm", "pcm16", "raw"}:
        raise HTTPException(status_code=400, detail="Only PCM output is supported")

    requested_model = _normalize_value(payload.model)
    await _swap_tts_model_if_needed(request, tts, requested_model)

    requested_voice = _normalize_value(payload.voice)
    requested_language = _normalize_value(payload.language) or _normalize_value(
        payload.lang_code
    )
    requested_instruct = _normalize_value(payload.instruct)

    supports_streaming_fn = getattr(tts, "supports_streaming", None)
    supports_streaming = bool(
        callable(supports_streaming_fn)
        and supports_streaming_fn(requested_model or tts.loaded_model)
    )
    stream_pcm16_fn = getattr(tts, "stream_pcm16", None)
    stream_requested = payload.stream if payload.stream is not None else supports_streaming

    headers = {
        "x-audio-format": "pcm16-le",
        "x-audio-sample-rate": str(tts.sample_rate),
    }

    requested_ref_audio = _normalize_value(payload.ref_audio)
    requested_ref_text = _normalize_value(payload.ref_text)

    if stream_requested and supports_streaming and callable(stream_pcm16_fn):
        interval = payload.streaming_interval
        if interval is None or interval <= 0:
            interval = 1.0

        def stream_pcm_chunks():
            lock = request.app.state.tts_lock
            with lock:
                for chunk in stream_pcm16_fn(
                    text,
                    requested_voice,
                    language=requested_language,
                    temperature=payload.temperature,
                    seed=payload.seed,
                    instruct=requested_instruct,
                    streaming_interval=interval,
                    ref_audio=requested_ref_audio,
                    ref_text=requested_ref_text,
                ):
                    yield chunk

        return StreamingResponse(
            stream_pcm_chunks(),
            media_type="application/octet-stream",
            headers=headers,
        )

    def generate_pcm_with_lock() -> bytes:
        lock = request.app.state.tts_lock
        with lock:
            return tts.generate_pcm16(
                text,
                requested_voice,
                language=requested_language,
                temperature=payload.temperature,
                seed=payload.seed,
                instruct=requested_instruct,
                ref_audio=requested_ref_audio,
                ref_text=requested_ref_text,
            )

    pcm = await run_in_threadpool(generate_pcm_with_lock)

    chunk_size = max(1, int((tts.sample_rate * 2) / 10))

    return StreamingResponse(
        _iter_pcm_chunks(pcm, chunk_size),
        media_type="application/octet-stream",
        headers=headers,
    )


@router.post("/v1/voice/design")
async def design_voice(
    request: Request,
    payload: VoiceDesignRequest,
) -> Response:
    """Generate a voice via VoiceDesign model and return as WAV.

    Swaps to a VoiceDesign model if needed, generates audio from the instruct
    description, and returns a 24kHz WAV file suitable for use as a clone
    reference.
    """
    tts: TtsBackend = request.app.state.tts

    vd_model = payload.model or "qwen3-1.7b-vd-4bit"
    await _swap_tts_model_if_needed(request, tts, vd_model)

    def generate_wav() -> tuple[bytes, int]:
        lock = request.app.state.tts_lock
        with lock:
            pcm = tts.generate_pcm16(
                payload.text,
                voice=None,
                language=payload.language,
                temperature=payload.temperature,
                seed=payload.seed,
                instruct=payload.instruct,
            )
        sample_rate = tts.sample_rate
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32767.0
        buf = io.BytesIO()
        sf.write(buf, audio, sample_rate, format="WAV")
        buf.seek(0)
        return buf.getvalue(), sample_rate

    wav_bytes, sample_rate = await run_in_threadpool(generate_wav)

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "x-audio-sample-rate": str(sample_rate),
        },
    )
