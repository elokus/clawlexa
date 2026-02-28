from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from ..model_control import (
    canonicalize_model_id,
    directory_size_bytes,
    download_snapshot,
    entry_to_payload,
    get_catalog_for_kind,
    is_model_installed,
)
from ..stt.base import SttBackend
from ..tts.base import TtsBackend

router = APIRouter()


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _round_or_none(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def _normalize_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _supports_tts_streaming(tts: TtsBackend, model_id: str) -> bool:
    supports_streaming_fn = getattr(tts, "supports_streaming", None)
    return bool(callable(supports_streaming_fn) and supports_streaming_fn(model_id))


def _find_quant_recommendation(model_id: str, rtf: float | None) -> str | None:
    if rtf is None:
        return None

    normalized = model_id.lower()

    if rtf > 1.2:
        if "0.6b-base-bf16" in normalized:
            return "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"
        if "0.6b-base-8bit" in normalized:
            return "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"
        if "1.7b" in normalized:
            return "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"
        if "kokoro-82m-bf16" in normalized:
            return "mlx-community/Kokoro-82M-8bit"
    elif rtf > 1.0:
        if "0.6b-base-bf16" in normalized:
            return "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"
        if "1.7b-base-bf16" in normalized:
            return "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"
        if "kokoro-82m-bf16" in normalized:
            return "mlx-community/Kokoro-82M-8bit"
    elif rtf < 0.45:
        if "0.6b-base-4bit" in normalized:
            return "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"

    return None


def _recommend_streaming_interval(
    current_interval: float | None,
    rtf: float | None,
    ttfb_ms: float | None,
) -> float | None:
    if rtf is None:
        return None

    interval = current_interval if current_interval and current_interval > 0 else 1.0

    if rtf > 1.25:
        return round(min(2.5, max(1.2, interval + 0.4)), 2)
    if rtf > 1.05:
        return round(min(2.0, max(1.0, interval + 0.2)), 2)
    if rtf < 0.6 and ttfb_ms is not None and ttfb_ms > 700:
        return round(max(0.4, interval - 0.2), 2)
    if rtf < 0.8 and ttfb_ms is not None and ttfb_ms > 600:
        return round(max(0.5, interval - 0.1), 2)

    return round(interval, 2)


def _build_guidance(
    *,
    model_id: str,
    stream_active: bool,
    streaming_interval: float | None,
    avg_rtf: float | None,
    avg_ttfb_ms: float | None,
) -> dict[str, object]:
    tips: list[str] = []

    if avg_rtf is None:
        return {
            "summary": "Benchmark did not produce valid timing metrics.",
            "recommended_streaming_interval": streaming_interval,
            "recommended_quant_model": None,
            "tips": tips,
        }

    if avg_rtf <= 0.9:
        tips.append("This model is faster than realtime on your machine.")
    elif avg_rtf <= 1.05:
        tips.append("This model is close to realtime and should be usable for live turns.")
    else:
        tips.append("This model is slower than realtime and may underrun in long responses.")

    if avg_ttfb_ms is not None:
        if avg_ttfb_ms < 400:
            tips.append("First audio is fast; you can keep chunk intervals conservative.")
        elif avg_ttfb_ms > 1000:
            tips.append("First audio latency is high; reducing interval or model size can help.")

    quant_suggestion = _find_quant_recommendation(model_id, avg_rtf)
    if quant_suggestion:
        tips.append(f"Consider switching quant/model to {quant_suggestion}.")

    interval_suggestion: float | None = None
    if stream_active:
        interval_suggestion = _recommend_streaming_interval(
            streaming_interval,
            avg_rtf,
            avg_ttfb_ms,
        )
        if interval_suggestion is not None and streaming_interval is not None:
            if interval_suggestion > streaming_interval:
                tips.append(
                    "Use a slightly larger streaming interval to reduce generation pressure."
                )
            elif interval_suggestion < streaming_interval:
                tips.append(
                    "You can reduce the streaming interval for faster first audio."
                )

    summary = (
        f"RTF={avg_rtf:.2f}. "
        + (
            "Lower values are better (below 1.0 is realtime or faster)."
            if avg_rtf > 0
            else "RTF unavailable."
        )
    )

    return {
        "summary": summary,
        "recommended_streaming_interval": interval_suggestion,
        "recommended_quant_model": quant_suggestion,
        "tips": tips,
    }


@dataclass
class BenchmarkRunMetrics:
    run: int
    ttfb_ms: float | None
    total_ms: float
    audio_ms: float
    rtf: float | None
    chunk_count: int
    pcm_bytes: int

    def to_payload(self) -> dict[str, object]:
        return {
            "run": self.run,
            "ttfb_ms": _round_or_none(self.ttfb_ms, 2),
            "total_ms": round(self.total_ms, 2),
            "audio_ms": round(self.audio_ms, 2),
            "rtf": _round_or_none(self.rtf, 3),
            "chunk_count": self.chunk_count,
            "pcm_bytes": self.pcm_bytes,
        }


class ModelDownloadRequest(BaseModel):
    kind: Literal["stt", "tts"]
    model: str
    revision: str | None = None
    force: bool = False
    preload: bool = False


class ModelLoadRequest(BaseModel):
    kind: Literal["stt", "tts"]
    model: str
    warmup: bool = True


class TtsBenchmarkRequest(BaseModel):
    model: str | None = None
    text: str = Field(
        default="The quick brown fox jumps over the lazy dog.",
        min_length=1,
        max_length=1200,
    )
    voice: str | None = None
    language: str | None = None
    temperature: float | None = None
    seed: int | None = None
    instruct: str | None = None
    stream: bool | None = None
    streaming_interval: float | None = Field(default=1.0, ge=0.2, le=4.0)
    runs: int = Field(default=1, ge=1, le=5)


def _build_catalog_state(request: Request) -> dict[str, object]:
    stt: SttBackend = request.app.state.stt
    tts: TtsBackend = request.app.state.tts
    config = request.app.state.config

    stt_loaded = canonicalize_model_id("stt", stt.loaded_model or "")
    tts_loaded = canonicalize_model_id("tts", tts.loaded_model or "")

    def build_kind(kind: Literal["stt", "tts"]) -> list[dict[str, object]]:
        payloads: list[dict[str, object]] = []
        for entry in get_catalog_for_kind(kind):
            payload = entry_to_payload(entry)
            canonical_id = str(payload["canonical_model_id"])
            payload["installed"] = is_model_installed(canonical_id)
            payload["loaded"] = canonical_id == (stt_loaded if kind == "stt" else tts_loaded)
            payloads.append(payload)
        return payloads

    return {
        "stt": build_kind("stt"),
        "tts": build_kind("tts"),
        "loaded": {
            "stt": stt.loaded_model,
            "tts": tts.loaded_model,
        },
        "defaults": {
            "stt": config.stt_model,
            "tts": config.tts_model,
        },
    }


@router.get("/v1/models/catalog")
async def get_models_catalog(request: Request) -> dict[str, object]:
    return await run_in_threadpool(_build_catalog_state, request)


@router.get("/v1/models/state")
async def get_models_state(request: Request) -> dict[str, object]:
    catalog_state = await run_in_threadpool(_build_catalog_state, request)
    installed: dict[str, bool] = {}

    for entry in catalog_state["stt"] + catalog_state["tts"]:  # type: ignore[operator]
        model_id = str(entry["canonical_model_id"])
        installed[model_id] = bool(entry["installed"])

    return {
        "loaded": catalog_state["loaded"],
        "installed": installed,
        "updated_at": int(time.time()),
    }


@router.post("/v1/models/download")
async def download_model(request: Request, payload: ModelDownloadRequest) -> dict[str, object]:
    canonical_id = canonicalize_model_id(payload.kind, payload.model)
    if not canonical_id:
        raise HTTPException(status_code=400, detail="model is required")

    def do_download() -> dict[str, object]:
        started = time.perf_counter()
        snapshot_path = download_snapshot(
            canonical_id,
            revision=_normalize_str(payload.revision),
            force_download=payload.force,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0

        result: dict[str, object] = {
            "kind": payload.kind,
            "model_id": payload.model,
            "canonical_model_id": canonical_id,
            "snapshot_path": str(snapshot_path),
            "size_bytes": directory_size_bytes(snapshot_path),
            "elapsed_ms": round(elapsed_ms, 2),
            "installed": is_model_installed(canonical_id),
        }
        return result

    try:
        result = await run_in_threadpool(do_download)
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to download model: {error}",
        ) from error

    if payload.preload:
        load_result = await load_model(
            request,
            ModelLoadRequest(kind=payload.kind, model=canonical_id, warmup=True),
        )
        result["preloaded"] = True
        result["loaded"] = load_result.get("loaded")
    else:
        result["preloaded"] = False

    return result


@router.post("/v1/models/load")
async def load_model(request: Request, payload: ModelLoadRequest) -> dict[str, object]:
    canonical_id = canonicalize_model_id(payload.kind, payload.model)
    if not canonical_id:
        raise HTTPException(status_code=400, detail="model is required")

    stt: SttBackend = request.app.state.stt
    tts: TtsBackend = request.app.state.tts

    def do_load() -> dict[str, object]:
        if payload.kind == "stt":
            lock = request.app.state.stt_lock
            with lock:
                stt.load(canonical_id)
                if payload.warmup:
                    stt.warmup()
            return {
                "kind": payload.kind,
                "model_id": payload.model,
                "canonical_model_id": canonical_id,
                "loaded": stt.loaded_model,
            }

        lock = request.app.state.tts_lock
        with lock:
            tts.load(canonical_id)
            if payload.warmup:
                tts.warmup()
        return {
            "kind": payload.kind,
            "model_id": payload.model,
            "canonical_model_id": canonical_id,
            "loaded": tts.loaded_model,
            "sample_rate": tts.sample_rate,
        }

    try:
        return await run_in_threadpool(do_load)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to load model: {error}") from error


@router.post("/v1/playground/tts/benchmark")
async def benchmark_tts(request: Request, payload: TtsBenchmarkRequest) -> dict[str, object]:
    tts: TtsBackend = request.app.state.tts
    selected_model = canonicalize_model_id("tts", payload.model or (tts.loaded_model or ""))
    if not selected_model:
        raise HTTPException(status_code=400, detail="No TTS model selected")

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    requested_voice = _normalize_str(payload.voice)
    requested_language = _normalize_str(payload.language)
    requested_instruct = _normalize_str(payload.instruct)

    def do_benchmark() -> dict[str, object]:
        lock = request.app.state.tts_lock
        with lock:
            if canonicalize_model_id("tts", tts.loaded_model or "") != selected_model:
                tts.load(selected_model)
                tts.warmup()

            stream_requested = payload.stream
            supports_streaming = _supports_tts_streaming(tts, selected_model)
            stream_active = (
                stream_requested if stream_requested is not None else supports_streaming
            ) and supports_streaming
            interval = (
                payload.streaming_interval
                if payload.streaming_interval is not None and payload.streaming_interval > 0
                else 1.0
            )

            run_results: list[BenchmarkRunMetrics] = []
            stream_fn = getattr(tts, "stream_pcm16", None)

            for run_index in range(1, payload.runs + 1):
                started = time.perf_counter()
                first_chunk_ms: float | None = None
                chunk_count = 0
                pcm_bytes = 0

                if stream_active and callable(stream_fn):
                    for chunk in stream_fn(
                        text,
                        requested_voice,
                        language=requested_language,
                        temperature=payload.temperature,
                        seed=payload.seed,
                        instruct=requested_instruct,
                        streaming_interval=interval,
                    ):
                        chunk_count += 1
                        pcm_bytes += len(chunk)
                        if first_chunk_ms is None:
                            first_chunk_ms = (time.perf_counter() - started) * 1000.0
                else:
                    pcm = tts.generate_pcm16(
                        text,
                        requested_voice,
                        language=requested_language,
                        temperature=payload.temperature,
                        seed=payload.seed,
                        instruct=requested_instruct,
                    )
                    pcm_bytes = len(pcm)
                    chunk_count = 1 if pcm_bytes > 0 else 0

                finished = time.perf_counter()
                total_ms = (finished - started) * 1000.0
                if first_chunk_ms is None:
                    first_chunk_ms = total_ms

                sample_rate = max(1, int(tts.sample_rate))
                audio_ms = (pcm_bytes / float(sample_rate * 2)) * 1000.0
                rtf = total_ms / audio_ms if audio_ms > 0 else None

                run_results.append(
                    BenchmarkRunMetrics(
                        run=run_index,
                        ttfb_ms=first_chunk_ms,
                        total_ms=total_ms,
                        audio_ms=audio_ms,
                        rtf=rtf,
                        chunk_count=chunk_count,
                        pcm_bytes=pcm_bytes,
                    )
                )

            avg_ttfb = _average(
                [value for value in (m.ttfb_ms for m in run_results) if value is not None]
            )
            avg_total = _average([m.total_ms for m in run_results]) or 0.0
            avg_audio = _average([m.audio_ms for m in run_results]) or 0.0
            avg_rtf = _average([value for value in (m.rtf for m in run_results) if value is not None])
            avg_chunk_count = _average([float(m.chunk_count) for m in run_results]) or 0.0
            max_chunk_count = max((m.chunk_count for m in run_results), default=0)

            guidance = _build_guidance(
                model_id=selected_model,
                stream_active=stream_active,
                streaming_interval=interval if stream_active else None,
                avg_rtf=avg_rtf,
                avg_ttfb_ms=avg_ttfb,
            )

            return {
                "model": tts.loaded_model,
                "canonical_model_id": selected_model,
                "sample_rate": tts.sample_rate,
                "streaming": {
                    "requested": bool(stream_requested),
                    "active": stream_active,
                    "supported": supports_streaming,
                    "interval": interval if stream_active else None,
                    "average_chunk_count": round(avg_chunk_count, 2),
                    "max_chunk_count": max_chunk_count,
                },
                "runs": [result.to_payload() for result in run_results],
                "aggregate": {
                    "ttfb_ms": _round_or_none(avg_ttfb, 2),
                    "total_ms": round(avg_total, 2),
                    "audio_ms": round(avg_audio, 2),
                    "rtf": _round_or_none(avg_rtf, 3),
                    "chars_per_second": round(len(text) / max(avg_total / 1000.0, 0.001), 2),
                    "tokens_per_second_estimate": round(
                        max(1.0, math.ceil(len(text) / 4)) / max(avg_total / 1000.0, 0.001),
                        2,
                    ),
                },
                "guidance": guidance,
            }

    try:
        return await run_in_threadpool(do_benchmark)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"TTS benchmark failed: {error}") from error


@router.get("/v1/models/suggestions")
async def model_suggestions() -> dict[str, object]:
    suggestions: list[dict[str, object]] = []
    for entry in get_catalog_for_kind("tts"):
        payload = entry_to_payload(entry)
        payload["installed"] = is_model_installed(str(payload["canonical_model_id"]))
        suggestions.append(payload)

    return {"tts": suggestions, "stt": [entry_to_payload(entry) for entry in get_catalog_for_kind("stt")]}
