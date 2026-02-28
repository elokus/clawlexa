from __future__ import annotations

from fastapi import APIRouter, Request

from ..tts.mlx import QWEN_SYNTHETIC_WORD_MS_PER_WORD

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict[str, object]:
    stt = request.app.state.stt
    tts = request.app.state.tts
    config = request.app.state.config

    payload: dict[str, object] = {
        "status": "ready",
        "stt_backend": config.stt_backend,
        "tts_backend": config.tts_backend,
        "stt_model": stt.loaded_model,
        "tts_model": tts.loaded_model,
        "sample_rate": tts.sample_rate,
        "qwen_language": config.qwen_language,
        "qwen_seed": config.qwen_seed,
    }
    tts_model = str(tts.loaded_model or "").lower()
    if "qwen3" in tts_model:
        payload["qwen_synthetic_word_ms_per_word"] = QWEN_SYNTHETIC_WORD_MS_PER_WORD
    return payload
