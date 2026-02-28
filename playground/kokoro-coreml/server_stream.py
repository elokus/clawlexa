"""
Kokoro TTS server comparing ONNX-CPU vs CoreML/ANE backends.

Downloads model files on first run (~310MB + ~27MB).
Uses kokoro-onnx for tokenization/inference, optionally replacing
the ONNX session with CoreML execution provider for ANE acceleration.

Usage:
    uv run python server_stream.py                          # auto-detect best backend
    uv run python server_stream.py --engine onnx-cpu        # force CPU-only ONNX
    uv run python server_stream.py --engine coreml           # force CoreML/ANE
    uv run python server_stream.py --voice af_bella --port 8084

Endpoints:
    WS   /ws/tts    -> streams PCM16 chunks (binary) + JSON metadata (text)
    GET  /health    -> model info + backend + available voices
"""

import argparse
import json
import time
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from kokoro_onnx import Kokoro

SAMPLE_RATE = 24000

# ── globals ──────────────────────────────────────────────────────────────────

MODEL: Kokoro | None = None
ENGINE = ""
AVAILABLE_VOICES: list[str] = []

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"


def download_if_missing(url: str, dest: Path):
    if dest.exists():
        return
    print(f"[download] {dest.name} ...")
    urllib.request.urlretrieve(url, dest)
    print(f"[download] {dest.name} done ({dest.stat().st_size / 1e6:.1f} MB)")


def detect_engine() -> str:
    """Pick best available ONNX execution provider."""
    providers = ort.get_available_providers()
    if "CoreMLExecutionProvider" in providers:
        return "coreml"
    return "onnx-cpu"


def create_session(model_path: str, engine: str) -> ort.InferenceSession:
    """Create ONNX InferenceSession with the requested backend."""
    if engine == "coreml":
        providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    else:
        providers = ["CPUExecutionProvider"]

    print(f"[session] Creating session with providers: {providers}")
    session = ort.InferenceSession(model_path, providers=providers)
    actual = session.get_providers()
    print(f"[session] Active providers: {actual}")
    return session


def warmup(model: Kokoro, voice: str):
    print("[warmup] Running warm-up generation ...")
    t0 = time.perf_counter()
    _ = model.create("Hello.", voice=voice, speed=1.0, lang="en-us")
    print(f"[warmup] Done in {time.perf_counter() - t0:.2f}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, ENGINE, AVAILABLE_VOICES
    args = app.state.args

    model_dir = Path(__file__).parent
    model_path = model_dir / args.model
    voices_path = model_dir / args.voices

    # download if needed
    download_if_missing(MODEL_URL, model_path)
    download_if_missing(VOICES_URL, voices_path)

    # pick engine
    ENGINE = args.engine if args.engine != "auto" else detect_engine()
    print(f"[startup] Engine: {ENGINE}")
    print(f"[startup] Available ONNX providers: {ort.get_available_providers()}")

    # load model with specified backend
    print(f"[startup] Loading {model_path.name}")
    t0 = time.perf_counter()
    session = create_session(str(model_path), ENGINE)
    MODEL = Kokoro.from_session(session, str(voices_path))
    AVAILABLE_VOICES = MODEL.get_voices()

    print(
        f"[startup] Loaded in {time.perf_counter() - t0:.2f}s  "
        f"(voices={len(AVAILABLE_VOICES)}, sample_rate={SAMPLE_RATE})"
    )

    warmup(MODEL, args.default_voice)

    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/health")
def health():
    providers = MODEL.sess.get_providers() if MODEL else []
    return {
        "model": "kokoro-v1.0",
        "engine": ENGINE,
        "onnx_providers": providers,
        "sample_rate": SAMPLE_RATE,
        "streaming": True,
        "voices": AVAILABLE_VOICES,
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
                await ws.send_text(
                    json.dumps({"type": "error", "message": "empty text"})
                )
                continue

            voice = req.get("voice", app.state.args.default_voice)
            speed = float(req.get("speed", 1.0))
            lang = req.get("lang", req.get("lang_code", "en-us"))

            await ws.send_text(
                json.dumps(
                    {
                        "type": "meta",
                        "sample_rate": SAMPLE_RATE,
                        "engine": ENGINE,
                        "onnx_providers": MODEL.sess.get_providers(),
                        "streaming": True,
                        "voice": voice,
                        "lang": lang,
                    }
                )
            )

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

            await ws.send_text(
                json.dumps(
                    {
                        "type": "done",
                        "engine": ENGINE,
                        "ttfab_ms": round((t_first_chunk or t_total) * 1000),
                        "total_ms": round(t_total * 1000),
                        "audio_duration_ms": round(audio_duration_ms),
                        "chunks": chunk_count,
                        "rtf": round(t_total / (audio_duration_ms / 1000), 3)
                        if audio_duration_ms > 0
                        else None,
                    }
                )
            )

    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--engine",
        default="auto",
        choices=["auto", "onnx-cpu", "coreml"],
        help="Backend: auto (detect CoreML), onnx-cpu, coreml",
    )
    parser.add_argument("--model", default="kokoro-v1.0.onnx")
    parser.add_argument("--voices", default="voices-v1.0.bin")
    parser.add_argument("--default-voice", default="af_heart")
    parser.add_argument("--port", type=int, default=8084)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    app.state.args = args
    uvicorn.run(app, host=args.host, port=args.port, workers=1)
