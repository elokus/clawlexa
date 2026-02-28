from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
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
    response_format: str = "pcm"

    def resolved_text(self) -> str:
        return (self.input or self.text or "").strip()


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
    pcm = await run_in_threadpool(
        tts.generate_pcm16,
        text,
        requested_voice,
        language=requested_language,
        temperature=payload.temperature,
        seed=payload.seed,
        instruct=requested_instruct,
    )

    chunk_size = max(1, int((tts.sample_rate * 2) / 10))
    headers = {
        "x-audio-format": "pcm16-le",
        "x-audio-sample-rate": str(tts.sample_rate),
    }

    return StreamingResponse(
        _iter_pcm_chunks(pcm, chunk_size),
        media_type="application/octet-stream",
        headers=headers,
    )
