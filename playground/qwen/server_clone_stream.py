"""
Qwen3-TTS voice clone streaming server via mlx-audio (4-bit quant).

Uses the Base model with ref_audio + ref_text for ICL voice cloning.
Generate a reference voice first with create_voice.py.

Usage:
    uv run python server_clone_stream.py --ref-audio ref_voice.wav --ref-text "The reference text spoken in the WAV."
    uv run python server_clone_stream.py --model qwen3-0.6b-4bit --ref-audio ref_voice.wav
    uv run python server_clone_stream.py --model qwen3-1.7b-4bit --ref-audio ref_voice.wav --lang English

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
    "qwen3-0.6b-4bit": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    "qwen3-1.7b-4bit": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit",
    "qwen3-0.6b": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "qwen3-1.7b": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
}

MODEL = None
MODEL_ID = ""
SAMPLE_RATE = 24000
SEED: int = 42
LANG: str = "English"
REF_AUDIO_PATH: str = ""
REF_TEXT: str = ""


class TTSRequest(BaseModel):
    text: str
    lang_code: Optional[str] = None
    temperature: float = 0.8
    streaming_interval: float = 2.0
    seed: Optional[int] = None


def warmup(model):
    """Warm-up with a short clone generation to prime the model."""
    print("[warmup] Running warm-up generation with clone voice ...")
    t0 = time.perf_counter()
    mx.random.seed(SEED)
    for _ in model.generate(
        text="Hello.",
        ref_audio=REF_AUDIO_PATH,
        ref_text=REF_TEXT,
        lang_code=LANG,
        split_pattern="",
    ):
        pass
    print(f"[warmup] Done in {time.perf_counter() - t0:.2f}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, MODEL_ID, SAMPLE_RATE, SEED, LANG, REF_AUDIO_PATH, REF_TEXT
    args = app.state.args

    MODEL_ID = MODEL_PRESETS.get(args.model, args.model)
    SEED = args.seed
    LANG = args.lang
    REF_AUDIO_PATH = args.ref_audio
    REF_TEXT = args.ref_text

    print(f"[startup] Loading {MODEL_ID}")
    print(f"[startup] Seed: {SEED}")
    print(f"[startup] Ref audio: {REF_AUDIO_PATH}")
    print(f"[startup] Ref text: {REF_TEXT[:80]}...")
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
        "engine": "mlx-audio (Qwen3-TTS Base, voice clone)",
        "sample_rate": SAMPLE_RATE,
        "streaming": True,
        "seed": SEED,
        "ref_audio": REF_AUDIO_PATH,
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

            seed = req.get("seed", SEED)

            await ws.send_text(json.dumps({
                "type": "meta",
                "sample_rate": SAMPLE_RATE,
                "engine": "mlx-audio (Qwen3-TTS Base, voice clone 4bit)",
                "streaming": True,
                "seed": seed,
            }))

            mx.random.seed(seed)

            gen_kwargs = dict(
                text=text,
                ref_audio=REF_AUDIO_PATH,
                ref_text=REF_TEXT,
                lang_code=req.get("lang_code", LANG),
                temperature=req.get("temperature", 0.8),
                split_pattern="",
                stream=True,
                streaming_interval=req.get("streaming_interval", 2.0),
            )

            t_start = time.perf_counter()
            t_first_chunk = None
            total_samples = 0
            chunk_count = 0

            for result in MODEL.generate(**gen_kwargs):
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
    mx.random.seed(seed)

    gen_kwargs = dict(
        text=req.text,
        ref_audio=REF_AUDIO_PATH,
        ref_text=REF_TEXT,
        lang_code=req.lang_code or LANG,
        temperature=req.temperature,
        split_pattern="",
    )

    t_start = time.perf_counter()
    t_first_byte = None
    chunks: list[np.ndarray] = []

    for result in MODEL.generate(**gen_kwargs):
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
    parser.add_argument("--model", default="qwen3-0.6b-4bit",
                        help="Preset: qwen3-0.6b-4bit (default), qwen3-1.7b-4bit, or a HF model ID")
    parser.add_argument("--ref-audio", required=True,
                        help="Path to reference audio WAV (from create_voice.py)")
    parser.add_argument("--ref-text", default=None,
                        help="Transcript of the reference audio")
    parser.add_argument("--lang", default="English",
                        help="Language (default: English)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed (default: 42)")
    parser.add_argument("--port", type=int, default=8085)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    # Default ref_text if not provided
    if args.ref_text is None:
        args.ref_text = (
            "Oh wow, this is so exciting! I can't believe how amazing this turned out. "
            "Every single detail is just perfect, and I'm absolutely thrilled to share "
            "this with you today!"
        )
        print(f"[info] No --ref-text provided, using default. "
              f"For best results, provide the exact transcript of your ref audio.")

    app.state.args = args
    uvicorn.run(app, host=args.host, port=args.port, workers=1)
