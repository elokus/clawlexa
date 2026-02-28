from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from typing import Sequence

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import ServerConfig, parse_server_config
from .routes.health import router as health_router
from .routes.stt import router as stt_router
from .routes.tts import router as tts_router
from .stt import get_stt_backend
from .tts import get_tts_backend

logger = logging.getLogger("local_inference")


def create_app(config: ServerConfig | None = None) -> FastAPI:
    resolved_config = config or ServerConfig()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.config = resolved_config

        stt = get_stt_backend(
            resolved_config.stt_backend,
            streaming_context=resolved_config.stt_streaming_context,
            streaming_depth=resolved_config.stt_streaming_depth,
        )
        logger.info(
            "Loading STT model backend=%s model=%s",
            resolved_config.stt_backend,
            resolved_config.stt_model,
        )
        stt.load(resolved_config.stt_model)
        stt.warmup()

        tts = get_tts_backend(
            resolved_config.tts_backend,
            default_voice=resolved_config.tts_voice,
            qwen_language=resolved_config.qwen_language,
            qwen_seed=resolved_config.qwen_seed,
            qwen_temperature=resolved_config.qwen_temperature,
            qwen_ref_audio=resolved_config.qwen_ref_audio,
            qwen_ref_text=resolved_config.qwen_ref_text,
            qwen_voice_design_instruct=resolved_config.qwen_voice_design_instruct,
        )
        logger.info(
            "Loading TTS model backend=%s model=%s",
            resolved_config.tts_backend,
            resolved_config.tts_model,
        )
        tts.load(resolved_config.tts_model)
        tts.warmup()

        app.state.stt = stt
        app.state.tts = tts
        app.state.stt_lock = threading.RLock()
        app.state.tts_lock = threading.RLock()

        yield

    app = FastAPI(title="local-inference", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(stt_router)
    app.include_router(tts_router)

    return app


def main(argv: Sequence[str] | None = None) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    config = parse_server_config(argv)
    app = create_app(config)
    uvicorn.run(app, host=config.host, port=config.port, workers=1)


app = create_app()
