from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from ..stt.base import SttBackend
from ..stt.streaming import StreamSession

router = APIRouter()
logger = logging.getLogger("local_inference.stt")

TARGET_STT_STREAM_SAMPLE_RATE = 16_000


def _normalize_model(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


async def _swap_stt_model_if_needed(
    request: Request,
    stt: SttBackend,
    requested_model: str | None,
) -> None:
    if not requested_model or requested_model == stt.loaded_model:
        return

    def do_swap() -> None:
        lock = request.app.state.stt_lock
        with lock:
            if requested_model == stt.loaded_model:
                return
            logger.info(
                "STT model swap: %s -> %s",
                stt.loaded_model,
                requested_model,
            )
            stt.load(requested_model)
            stt.warmup()

    await run_in_threadpool(do_swap)


async def _extract_transcription_payload(
    request: Request,
    model_query: str | None,
) -> tuple[bytes, str | None]:
    content_type = (request.headers.get("content-type") or "").lower()

    if "multipart/form-data" in content_type:
        form = await request.form()
        file_part = form.get("file")
        model_form = form.get("model")
        requested_model = _normalize_model(model_query)
        if requested_model is None and isinstance(model_form, str):
            requested_model = _normalize_model(model_form)

        if isinstance(file_part, UploadFile):
            body = await file_part.read()
        elif isinstance(file_part, (bytes, bytearray)):
            body = bytes(file_part)
        else:
            raise HTTPException(
                status_code=400,
                detail="Multipart requests must include a 'file' part",
            )
        return body, requested_model

    return await request.body(), _normalize_model(model_query)


@router.post("/v1/audio/transcriptions")
async def transcribe_audio(
    request: Request,
    model: str | None = Query(default=None),
) -> dict[str, str]:
    stt: SttBackend = request.app.state.stt
    wav_bytes, requested_model = await _extract_transcription_payload(request, model)

    if not wav_bytes:
        raise HTTPException(status_code=400, detail="Request body is empty")

    await _swap_stt_model_if_needed(request, stt, requested_model)
    text = await run_in_threadpool(stt.transcribe, wav_bytes)
    return {"text": text.strip()}


@router.websocket("/v1/audio/stream")
async def stream_transcriptions(websocket: WebSocket) -> None:
    await websocket.accept()

    request = websocket
    stt: SttBackend = request.app.state.stt
    requested_model = _normalize_model(websocket.query_params.get("model"))

    if requested_model and requested_model != stt.loaded_model:
        lock = request.app.state.stt_lock

        def do_swap() -> None:
            with lock:
                if requested_model == stt.loaded_model:
                    return
                logger.info(
                    "STT model swap (streaming): %s -> %s",
                    stt.loaded_model,
                    requested_model,
                )
                stt.load(requested_model)
                stt.warmup()

        await run_in_threadpool(do_swap)

    if not stt.supports_streaming():
        await websocket.close(code=1011, reason="Selected STT backend does not support streaming")
        return

    session: StreamSession | None = stt.create_stream_session()
    if session is None:
        await websocket.close(code=1011, reason="Unable to create STT stream session")
        return

    try:
        while True:
            message: dict[str, Any] = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            chunk = message.get("bytes")
            if not isinstance(chunk, (bytes, bytearray)):
                continue

            update = await run_in_threadpool(
                session.add_pcm16,
                bytes(chunk),
                TARGET_STT_STREAM_SAMPLE_RATE,
            )
            await websocket.send_json(asdict(update))
    except WebSocketDisconnect:
        pass
    finally:
        await run_in_threadpool(session.close)
