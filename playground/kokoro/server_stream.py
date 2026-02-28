"""
Streaming TTS server using kokoro-onnx.

Benchmarks kokoro-onnx against mlx-audio models using the same
WebSocket protocol as playground/mlx-audio/server_stream.py.

Setup (first run downloads model files ~310MB + ~27MB):
    cd playground/kokoro
    uv sync
    wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

Usage:
    uv run python server_stream.py
    uv run python server_stream.py --voice af_bella --port 8082
    uv run python server_stream.py --model kokoro-v1.0.int8.onnx  # quantized

Endpoints:
    WS   /ws/tts    -> streams PCM16 chunks (binary) + JSON metadata (text)
    GET  /health    -> model info + available voices
"""

import argparse
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from kokoro_onnx import Kokoro, SAMPLE_RATE

# ── globals ──────────────────────────────────────────────────────────────────

MODEL: Kokoro | None = None
MODEL_PATH = ""
VOICES_PATH = ""
AVAILABLE_VOICES: list[str] = []


def warmup(model: Kokoro, voice: str):
    print("[warmup] Running warm-up generation ...")
    t0 = time.perf_counter()
    _ = model.create("Hello.", voice=voice, speed=1.0, lang="en-us")
    print(f"[warmup] Done in {time.perf_counter() - t0:.2f}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, MODEL_PATH, VOICES_PATH, AVAILABLE_VOICES
    args = app.state.args

    MODEL_PATH = args.model
    VOICES_PATH = args.voices

    if not Path(MODEL_PATH).exists():
        raise FileNotFoundError(
            f"Model file not found: {MODEL_PATH}\n"
            f"Download it:\n"
            f"  wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx\n"
            f"  wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
        )

    print(f"[startup] Loading {MODEL_PATH}")
    t0 = time.perf_counter()
    MODEL = Kokoro(MODEL_PATH, VOICES_PATH)
    AVAILABLE_VOICES = MODEL.get_voices()
    print(f"[startup] Loaded in {time.perf_counter() - t0:.2f}s  "
          f"(voices={len(AVAILABLE_VOICES)}, sample_rate={SAMPLE_RATE})")

    warmup(MODEL, args.default_voice)

    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {
        "model": MODEL_PATH,
        "engine": "kokoro-onnx",
        "sample_rate": SAMPLE_RATE,
        "streaming": True,
        "voices": AVAILABLE_VOICES,
        "status": "ready" if MODEL is not None else "loading",
    }


# ── WebSocket streaming endpoint ────────────────────────────────────────────
#
# Protocol (same as mlx-audio server):
#   Client sends JSON text frame:
#     {"text": "...", "voice": "af_heart", "speed": 1.0, "lang": "en-us"}
#
#   Server responds with interleaved frames:
#     TEXT  {"type": "meta", "sample_rate": 24000, "engine": "kokoro-onnx", "streaming": true}
#     BIN   <PCM16 LE audio chunk>   (repeats per sentence/clause)
#     TEXT  {"type": "done", "ttfab_ms": ..., "total_ms": ..., "audio_duration_ms": ..., "chunks": N}


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

            voice = req.get("voice", app.state.args.default_voice)
            speed = float(req.get("speed", 1.0))
            lang = req.get("lang", req.get("lang_code", "en-us"))

            # send metadata
            await ws.send_text(json.dumps({
                "type": "meta",
                "sample_rate": SAMPLE_RATE,
                "engine": "kokoro-onnx",
                "streaming": True,
                "voice": voice,
                "lang": lang,
            }))

            t_start = time.perf_counter()
            t_first_chunk = None
            total_samples = 0
            chunk_count = 0

            stream = MODEL.create_stream(text, voice=voice, speed=speed, lang=lang)
            async for samples, _sr in stream:
                if t_first_chunk is None:
                    t_first_chunk = time.perf_counter() - t_start

                audio = np.array(samples, dtype=np.float32)
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


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="kokoro-v1.0.onnx",
                        help="Path to ONNX model file")
    parser.add_argument("--voices", default="voices-v1.0.bin",
                        help="Path to voices binary file")
    parser.add_argument("--default-voice", default="af_heart",
                        help="Default voice (use /health to list all)")
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    app.state.args = args
    uvicorn.run(app, host=args.host, port=args.port, workers=1)
