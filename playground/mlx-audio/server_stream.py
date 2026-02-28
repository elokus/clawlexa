"""
Streaming TTS server with multi-model support.

Default: Qwen3-TTS Base with cloned German voice (consistent identity + streaming).

Usage:
    .venv/bin/python server_stream.py                              # Qwen3 Base + cloned voice (default)
    .venv/bin/python server_stream.py --model chatterbox-turbo     # Chatterbox Turbo
    .venv/bin/python server_stream.py --model qwen3-custom         # Qwen3 CustomVoice (aiden)
    .venv/bin/python server_stream.py --model spark                # Spark TTS
    .venv/bin/python server_stream.py --ref-voice voices/ref_male_deep.wav  # different cloned voice

Endpoints:
    WS   /ws/tts    → streams PCM16 chunks (binary frames) + JSON metadata (text frames)
    POST /tts       → full WAV response (for comparison)
    GET  /health    → model info + capabilities
"""

import argparse
import io
import json
import os
import time
from contextlib import asynccontextmanager
from enum import Enum
from pathlib import Path
from typing import Optional

import mlx.core as mx
import numpy as np
import soundfile as sf
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from mlx_audio.tts.utils import load_model


# ── model presets ────────────────────────────────────────────────────────────

MODEL_PRESETS = {
    "qwen3-clone": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "qwen3-custom": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16",
    "qwen3-design": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
    "chatterbox-turbo": "mlx-community/chatterbox-turbo-fp16",
    "spark": "mlx-community/Spark-TTS-0.5B-bf16",
}

# Default reference voice for cloning
SCRIPT_DIR = Path(__file__).parent
DEFAULT_REF_VOICE = SCRIPT_DIR / "voices" / "ref_male_warm.wav"
DEFAULT_REF_TEXT = (
    "Willkommen bei unserem Service. Mein Name ist Jarvis und ich bin hier, "
    "um Ihnen bei allen Fragen weiterzuhelfen. Fragen Sie mich einfach."
)

# Default voice description for VoiceDesign model
DEFAULT_VOICE_DESIGN = (
    "A native German male voice assistant. Professional, clear articulation, "
    "natural German accent. Medium pitch, moderate speaking speed."
)


class ModelFamily(str, Enum):
    QWEN3_CLONE = "qwen3-clone"
    QWEN3_VOICE_DESIGN = "qwen3-design"
    QWEN3_CUSTOM_VOICE = "qwen3-custom"
    CHATTERBOX_TURBO = "chatterbox-turbo"
    SPARK = "spark"


def detect_family(model_id: str, preset_key: str = "") -> ModelFamily:
    if preset_key == "qwen3-clone":
        return ModelFamily.QWEN3_CLONE
    lower = model_id.lower()
    if "voicedesign" in lower or "voice-design" in lower:
        return ModelFamily.QWEN3_VOICE_DESIGN
    if "customvoice" in lower or "custom-voice" in lower:
        return ModelFamily.QWEN3_CUSTOM_VOICE
    if "qwen3" in lower and "base" in lower:
        return ModelFamily.QWEN3_CLONE
    if "qwen3" in lower:
        return ModelFamily.QWEN3_CUSTOM_VOICE
    if "chatterbox-turbo" in lower or "chatterbox_turbo" in lower:
        return ModelFamily.CHATTERBOX_TURBO
    if "spark" in lower:
        return ModelFamily.SPARK
    return ModelFamily.CHATTERBOX_TURBO


STREAMING_FAMILIES = {
    ModelFamily.QWEN3_CLONE,
    ModelFamily.QWEN3_VOICE_DESIGN,
    ModelFamily.QWEN3_CUSTOM_VOICE,
    ModelFamily.CHATTERBOX_TURBO,
}

# ── globals filled at startup ────────────────────────────────────────────────
MODEL = None
MODEL_ID = ""
MODEL_FAMILY: ModelFamily = ModelFamily.QWEN3_CLONE
SAMPLE_RATE = 24000
CAN_STREAM = True
REF_VOICE_PATH: Optional[str] = None
REF_VOICE_TEXT: str = DEFAULT_REF_TEXT


class TTSRequest(BaseModel):
    text: str
    # qwen3 voice-design
    instruct: Optional[str] = None
    # qwen3 custom-voice
    voice: Optional[str] = None
    lang_code: Optional[str] = None
    # spark-specific
    gender: Optional[str] = None
    pitch: Optional[float] = None
    speed: Optional[float] = None
    # common
    temperature: float = 0.8
    streaming_interval: float = 1.0


# ── model-specific helpers ───────────────────────────────────────────────────

def build_generate_kwargs(
    family: ModelFamily,
    text: str,
    *,
    instruct: Optional[str] = None,
    voice: Optional[str] = None,
    lang_code: Optional[str] = None,
    gender: Optional[str] = None,
    pitch: Optional[float] = None,
    speed: Optional[float] = None,
    temperature: float = 0.8,
    stream: bool = False,
    streaming_interval: float = 1.0,
) -> dict:
    """Build the correct kwargs for model.generate() based on model family."""

    if family == ModelFamily.QWEN3_CLONE:
        return dict(
            text=text,
            ref_audio=REF_VOICE_PATH,
            ref_text=REF_VOICE_TEXT,
            lang_code=lang_code or "German",
            temperature=temperature,
            stream=stream,
            streaming_interval=streaming_interval,
        )

    if family == ModelFamily.QWEN3_VOICE_DESIGN:
        return dict(
            text=text,
            instruct=instruct or DEFAULT_VOICE_DESIGN,
            lang_code=lang_code or "German",
            temperature=temperature,
            stream=stream,
            streaming_interval=streaming_interval,
        )

    if family == ModelFamily.QWEN3_CUSTOM_VOICE:
        return dict(
            text=text,
            voice=voice or "aiden",
            lang_code=lang_code or "de",
            temperature=temperature,
            stream=stream,
            streaming_interval=streaming_interval,
        )

    if family == ModelFamily.CHATTERBOX_TURBO:
        kwargs = dict(
            text=text,
            temperature=temperature,
        )
        if stream:
            kwargs["stream"] = True
            kwargs["streaming_interval"] = streaming_interval
        return kwargs

    if family == ModelFamily.SPARK:
        kwargs = dict(
            text=text,
            gender=gender or "male",
            temperature=temperature,
        )
        if pitch is not None:
            kwargs["pitch"] = pitch
        if speed is not None:
            kwargs["speed"] = speed
        return kwargs

    return dict(text=text)


def build_warmup_kwargs(family: ModelFamily) -> dict:
    """Minimal kwargs for warmup generation."""
    if family == ModelFamily.QWEN3_CLONE:
        return dict(
            text="Hallo.",
            ref_audio=REF_VOICE_PATH,
            ref_text=REF_VOICE_TEXT,
            lang_code="German",
        )
    if family == ModelFamily.QWEN3_VOICE_DESIGN:
        return dict(text="Hi.", instruct="A male voice.", lang_code="German")
    if family == ModelFamily.QWEN3_CUSTOM_VOICE:
        return dict(text="Hi.", voice="aiden", lang_code="de")
    if family == ModelFamily.CHATTERBOX_TURBO:
        return dict(text="Hi.")
    if family == ModelFamily.SPARK:
        return dict(text="Hi.", gender="male")
    return dict(text="Hi.")


def warmup(model, family: ModelFamily):
    print("[warmup] Running warm-up generation ...")
    t0 = time.perf_counter()
    kwargs = build_warmup_kwargs(family)
    for _ in model.generate(**kwargs):
        pass
    print(f"[warmup] Done in {time.perf_counter() - t0:.2f}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, MODEL_ID, MODEL_FAMILY, SAMPLE_RATE, CAN_STREAM
    global REF_VOICE_PATH, REF_VOICE_TEXT
    args = app.state.args

    preset_key = args.model
    MODEL_ID = MODEL_PRESETS.get(preset_key, preset_key)
    MODEL_FAMILY = detect_family(MODEL_ID, preset_key)
    CAN_STREAM = MODEL_FAMILY in STREAMING_FAMILIES

    # resolve reference voice
    if MODEL_FAMILY == ModelFamily.QWEN3_CLONE:
        ref_path = Path(args.ref_voice) if args.ref_voice else DEFAULT_REF_VOICE
        if not ref_path.exists():
            raise FileNotFoundError(
                f"Reference voice not found: {ref_path}\n"
                f"Generate one first: python test_voice_design.py --play"
            )
        REF_VOICE_PATH = str(ref_path)
        REF_VOICE_TEXT = args.ref_text or DEFAULT_REF_TEXT
        print(f"[startup] Reference voice: {REF_VOICE_PATH}")

    print(f"[startup] Loading {MODEL_ID}  (family={MODEL_FAMILY.value}, stream={CAN_STREAM})")
    t0 = time.perf_counter()
    MODEL = load_model(MODEL_ID)
    SAMPLE_RATE = getattr(MODEL, "sample_rate", 24000)
    print(f"[startup] Loaded in {time.perf_counter() - t0:.2f}s  (sample_rate={SAMPLE_RATE})")

    warmup(MODEL, MODEL_FAMILY)

    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {
        "model": MODEL_ID,
        "family": MODEL_FAMILY.value,
        "sample_rate": SAMPLE_RATE,
        "streaming": CAN_STREAM,
        "ref_voice": REF_VOICE_PATH,
        "status": "ready" if MODEL is not None else "loading",
    }


# ── WebSocket streaming endpoint ────────────────────────────────────────────
#
# Protocol:
#   Client sends JSON text frame:
#     {"text": "..."}                                              — uses server defaults
#     {"text": "...", "lang_code": "German"}                       — qwen3 clone (default)
#     {"text": "...", "voice": "aiden", "lang_code": "de"}         — qwen3 custom voice
#     {"text": "...", "gender": "male", "pitch": 1.0}             — spark
#
#   Server responds with interleaved frames:
#     TEXT  {"type": "meta", "sample_rate": 24000, "family": "...", "streaming": true}
#     BIN   <PCM16 LE audio chunk>   (may repeat N times if streaming)
#     TEXT  {"type": "done", "ttfab_ms": ..., "total_ms": ..., "audio_duration_ms": ..., "chunks": N}
#

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

            # send metadata
            await ws.send_text(json.dumps({
                "type": "meta",
                "sample_rate": SAMPLE_RATE,
                "family": MODEL_FAMILY.value,
                "streaming": CAN_STREAM,
            }))

            gen_kwargs = build_generate_kwargs(
                MODEL_FAMILY,
                text,
                instruct=req.get("instruct"),
                voice=req.get("voice"),
                lang_code=req.get("lang_code"),
                gender=req.get("gender"),
                pitch=req.get("pitch"),
                speed=req.get("speed"),
                temperature=req.get("temperature", 0.8),
                stream=CAN_STREAM,
                streaming_interval=req.get("streaming_interval", 1.0),
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

                # soft clip (preserves relative levels across chunks)
                audio = np.tanh(audio)

                # PCM16 LE binary transport
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


# ── HTTP fallback ────────────────────────────────────────────────────────────

@app.post("/tts")
def tts(req: TTSRequest):
    gen_kwargs = build_generate_kwargs(
        MODEL_FAMILY,
        req.text,
        instruct=req.instruct,
        voice=req.voice,
        lang_code=req.lang_code,
        gender=req.gender,
        pitch=req.pitch,
        speed=req.speed,
        temperature=req.temperature,
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
    parser.add_argument("--model", default="qwen3-clone",
                        help="Preset: qwen3-clone (default), qwen3-custom, qwen3-design, chatterbox-turbo, spark")
    parser.add_argument("--ref-voice", default=None,
                        help="Path to reference voice WAV (for qwen3-clone)")
    parser.add_argument("--ref-text", default=None,
                        help="Transcript of the reference voice")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    app.state.args = args
    uvicorn.run(app, host=args.host, port=args.port, workers=1)
