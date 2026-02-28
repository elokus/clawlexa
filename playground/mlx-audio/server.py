"""
Fast TTS inference server with pre-loaded model.

Pre-loads model into GPU at startup. Measures only generation TTFAB per request.

Usage:
    .venv/bin/python server.py                                              # default: Chatterbox German
    .venv/bin/python server.py --model mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16 --lang de
    .venv/bin/python server.py --port 8080

Endpoints:
    POST /tts  {text, lang_code?, exaggeration?, temperature?}  → audio/wav
    GET  /health                                                 → model info
"""

import argparse
import io
import time
from contextlib import asynccontextmanager
from typing import Optional

import mlx.core as mx
import numpy as np
import soundfile as sf
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from mlx_audio.tts.utils import load_model


# ── globals filled at startup ────────────────────────────────────────────────
MODEL = None
MODEL_ID = ""
SAMPLE_RATE = 24000
DEFAULT_LANG = "de"


class TTSRequest(BaseModel):
    text: str
    lang_code: Optional[str] = None  # ISO 639-1: de, en, fr, es, ...
    exaggeration: float = 0.1        # emotion exaggeration (0-1)
    cfg_weight: float = 0.5          # classifier-free guidance weight
    temperature: float = 0.8
    repetition_penalty: float = 1.2


def warmup(model, lang_code: str):
    """Run a short generation to prime MLX caches and JIT compilation."""
    print("[warmup] Running warm-up generation ...")
    t0 = time.perf_counter()
    for _ in model.generate(text="Hallo Welt.", lang_code=lang_code):
        pass
    print(f"[warmup] Done in {time.perf_counter() - t0:.2f}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, MODEL_ID, SAMPLE_RATE, DEFAULT_LANG
    args = app.state.args

    MODEL_ID = args.model
    DEFAULT_LANG = args.lang
    print(f"[startup] Loading {MODEL_ID} ...")
    t0 = time.perf_counter()
    MODEL = load_model(MODEL_ID)
    SAMPLE_RATE = getattr(MODEL, "sample_rate", 24000)
    print(f"[startup] Loaded in {time.perf_counter() - t0:.2f}s  (sample_rate={SAMPLE_RATE})")

    warmup(MODEL, lang_code=DEFAULT_LANG)

    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {
        "model": MODEL_ID,
        "sample_rate": SAMPLE_RATE,
        "default_lang": DEFAULT_LANG,
        "status": "ready" if MODEL is not None else "loading",
    }


@app.post("/tts")
def tts(req: TTSRequest):
    lang_code = req.lang_code or DEFAULT_LANG

    t_start = time.perf_counter()
    t_first_byte = None
    chunks: list[np.ndarray] = []

    for result in MODEL.generate(
        text=req.text,
        lang_code=lang_code,
        exaggeration=req.exaggeration,
        cfg_weight=req.cfg_weight,
        temperature=req.temperature,
        repetition_penalty=req.repetition_penalty,
    ):
        if t_first_byte is None:
            t_first_byte = time.perf_counter() - t_start

        chunk = np.array(result.audio, dtype=np.float32)
        if chunk.ndim > 1:
            chunk = chunk.squeeze()
        chunks.append(chunk)

    t_total = time.perf_counter() - t_start

    if not chunks:
        return Response(status_code=500, content="No audio generated")

    audio = np.concatenate(chunks)
    duration_s = len(audio) / SAMPLE_RATE

    # normalize
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.9

    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV")
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="audio/wav",
        headers={
            "X-TTFAB-Ms": f"{t_first_byte * 1000:.0f}",
            "X-Gen-Time-Ms": f"{t_total * 1000:.0f}",
            "X-Audio-Duration-Ms": f"{duration_s * 1000:.0f}",
            "X-RTF": f"{t_total / duration_s:.3f}" if duration_s > 0 else "inf",
        },
    )


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="mlx-community/chatterbox-fp16")
    parser.add_argument("--lang", default="de")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    app.state.args = args
    # Single worker — model stays resident in one process
    uvicorn.run(app, host=args.host, port=args.port, workers=1)
