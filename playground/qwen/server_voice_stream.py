"""
Qwen3-TTS VoiceDesign streaming server via mlx-audio.

Uses the VoiceDesign model — voice defined by natural language description (instruct).

Usage:
    uv run python server_voice_stream.py
    uv run python server_voice_stream.py --instruct "A warm German male voice with calm tone."
    uv run python server_voice_stream.py --lang German --seed 123

Endpoints:
    WS   /ws/tts    → streams PCM16 chunks (binary) + JSON metadata (text)
    POST /tts       → full WAV response
    GET  /health    → model info
"""

import argparse
import io
import json
import time
from contextlib import asynccontextmanager
from typing import Optional

import mlx.core as mx
import numpy as np
import soundfile as sf
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from mlx_audio.tts.utils import load_model


MODEL_PRESETS = {
    "qwen3-1.7b-vd": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
}

DEFAULT_INSTRUCT = (
    "A native German male speaker with a warm, calm baritone voice. "
    "Natural German pronunciation with moderate pace."
)

MODEL = None
MODEL_ID = ""
SAMPLE_RATE = 24000
SEED: int = 42
LANG: str = "German"
INSTRUCT: str = DEFAULT_INSTRUCT


class TTSRequest(BaseModel):
    text: str
    instruct: Optional[str] = None
    language: Optional[str] = None
    temperature: float = 0.5
    streaming_interval: float = 2.0
    seed: Optional[int] = None


def warmup(model):
    print("[warmup] Running warm-up generation ...")
    t0 = time.perf_counter()
    mx.random.seed(SEED)
    for _ in model.generate_voice_design(
        text="Hallo.",
        instruct=INSTRUCT,
        language=LANG,
    ):
        pass
    print(f"[warmup] Done in {time.perf_counter() - t0:.2f}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, MODEL_ID, SAMPLE_RATE, SEED, LANG, INSTRUCT
    args = app.state.args

    MODEL_ID = MODEL_PRESETS.get(args.model, args.model)
    SEED = args.seed
    LANG = args.lang
    INSTRUCT = args.instruct

    print(f"[startup] Loading {MODEL_ID}")
    print(f"[startup] Seed: {SEED}")
    print(f"[startup] Instruct: {INSTRUCT[:80]}...")
    t0 = time.perf_counter()
    MODEL = load_model(MODEL_ID)
    SAMPLE_RATE = getattr(MODEL, "sample_rate", 24000)
    print(f"[startup] Loaded in {time.perf_counter() - t0:.2f}s  (sample_rate={SAMPLE_RATE})")

    warmup(MODEL)

    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {
        "model": MODEL_ID,
        "engine": "mlx-audio (Qwen3-TTS VoiceDesign)",
        "sample_rate": SAMPLE_RATE,
        "streaming": True,
        "seed": SEED,
        "default_instruct": INSTRUCT,
        "status": "ready" if MODEL is not None else "loading",
    }


@app.websocket("/ws/tts")
async def ws_tts(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            req = json.loads(raw)

            text = req.get("text", "")
            if not text:
                await ws.send_text(json.dumps({"type": "error", "message": "empty text"}))
                continue

            instruct = req.get("instruct", INSTRUCT)
            if not instruct:
                await ws.send_text(json.dumps({"type": "error", "message": "instruct required for VoiceDesign"}))
                continue

            seed = req.get("seed", SEED)

            await ws.send_text(json.dumps({
                "type": "meta",
                "sample_rate": SAMPLE_RATE,
                "engine": "mlx-audio (Qwen3-TTS VoiceDesign)",
                "streaming": True,
                "seed": seed,
                "instruct": instruct[:80],
            }))

            mx.random.seed(seed)

            gen_kwargs = dict(
                text=text,
                instruct=instruct,
                language=req.get("language", LANG),
                temperature=req.get("temperature", 0.5),
                stream=True,
                streaming_interval=req.get("streaming_interval", 2.0),
            )

            t_start = time.perf_counter()
            t_first_chunk = None
            total_samples = 0
            chunk_count = 0

            for result in MODEL.generate_voice_design(**gen_kwargs):
                if t_first_chunk is None:
                    t_first_chunk = time.perf_counter() - t_start

                audio = np.array(result.audio, dtype=np.float32)
                if audio.ndim > 1:
                    audio = audio.squeeze()

                pcm16 = (audio * 32767).astype(np.int16)
                await ws.send_bytes(pcm16.tobytes())

                total_samples += len(pcm16)
                chunk_count += 1

            t_total = time.perf_counter() - t_start
            audio_duration_ms = (total_samples / SAMPLE_RATE) * 1000

            await ws.send_text(json.dumps({
                "type": "done",
                "ttfab_ms": round((t_first_chunk or t_total) * 1000),
                "total_ms": round(t_total * 1000),
                "audio_duration_ms": round(audio_duration_ms),
                "chunks": chunk_count,
                "rtf": round(t_total / (audio_duration_ms / 1000), 3) if audio_duration_ms > 0 else None,
            }))

    except WebSocketDisconnect:
        pass


@app.post("/tts")
def tts(req: TTSRequest):
    seed = req.seed if req.seed is not None else SEED
    instruct = req.instruct or INSTRUCT
    mx.random.seed(seed)

    gen_kwargs = dict(
        text=req.text,
        instruct=instruct,
        language=req.language or LANG,
        temperature=req.temperature,
    )

    t_start = time.perf_counter()
    t_first_byte = None
    chunks: list[np.ndarray] = []

    for result in MODEL.generate_voice_design(**gen_kwargs):
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
            "X-TTFAB-Ms": f"{(t_first_byte or t_total) * 1000:.0f}",
            "X-Gen-Time-Ms": f"{t_total * 1000:.0f}",
            "X-Audio-Duration-Ms": f"{duration_s * 1000:.0f}",
            "X-RTF": f"{t_total / duration_s:.3f}" if duration_s > 0 else "inf",
        },
    )


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="qwen3-1.7b-vd",
                        help="Preset: qwen3-1.7b-vd (default), or a HF model ID")
    parser.add_argument("--lang", default="German",
                        help="Language (default: German)")
    parser.add_argument("--instruct", default=DEFAULT_INSTRUCT,
                        help="Default voice design instruction")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for consistent voice (default: 42)")
    parser.add_argument("--port", type=int, default=8084)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    app.state.args = args
    uvicorn.run(app, host=args.host, port=args.port, workers=1)
