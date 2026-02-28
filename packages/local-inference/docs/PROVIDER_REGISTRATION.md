# Provider Registration Guide

This document explains how to add a new provider/backend to `packages/local-inference`.

## Overview

`local-inference` uses two backend interfaces:

- STT: `local_inference/stt/base.py`
- TTS: `local_inference/tts/base.py`

At startup, the server resolves backend names from CLI/config:

- STT factory: `local_inference/stt/__init__.py::get_stt_backend()`
- TTS factory: `local_inference/tts/__init__.py::get_tts_backend()`

The server keeps one loaded STT model and one loaded TTS model in memory. Routes can trigger model swaps when a request specifies a different `model`.

## Add a New STT Backend

1. Implement the STT protocol:
   - File: `local_inference/stt/<your_backend>.py`
   - Required methods:
     - `loaded_model`
     - `load(model_id)`
     - `warmup()`
     - `transcribe(wav_bytes)`
     - `supports_streaming()`
     - `create_stream_session()`

2. If streaming is supported, return a session implementing `StreamSession` from `local_inference/stt/streaming.py`.

3. Register backend name in factory:
   - Edit `local_inference/stt/__init__.py`
   - Add branch in `get_stt_backend(name, ...)`.

4. Add optional dependency in `pyproject.toml`:
   - Under `[project.optional-dependencies]`, add e.g. `onnx = [...]`.

## Add a New TTS Backend

1. Implement the TTS protocol:
   - File: `local_inference/tts/<your_backend>.py`
   - Required methods:
     - `loaded_model`
     - `load(model_id)`
     - `warmup()`
     - `generate_pcm16(text, voice, *, language, temperature, seed, instruct)`
     - `sample_rate`

2. Register backend name in factory:
   - Edit `local_inference/tts/__init__.py`
   - Add branch in `get_tts_backend(name, ...)`.

3. Add optional dependency in `pyproject.toml` under `[project.optional-dependencies]`.

## Add a New MLX TTS Provider Family

If the backend is `mlx`, provider-family routing lives in:

- `local_inference/tts/registry.py`

Provider-specific logic should be placed in dedicated scripts under:

- `local_inference/tts/mlx/`

Current examples:

- `local_inference/tts/mlx/kokoro.py`
- `local_inference/tts/mlx/chatterbox.py`
- `local_inference/tts/mlx/qwen.py`

### Steps

1. Create `local_inference/tts/mlx/<provider>.py` with a `build_plan(...)` function returning:
   - `method`: `generate` or `generate_voice_design`
   - `kwargs`: model-specific arguments passed to MLX model methods

2. Update `local_inference/tts/registry.py`:
   - Extend `ModelFamily`
   - Update `detect_model_family()`
   - Dispatch to your new `mlx/<provider>.py` plan builder in `build_generation_plan()`

3. If you need model aliases/presets, add a resolver in your provider module and call it from `resolve_model_id()`.

## Route Behavior (No Additional Registration Needed)

Routes are backend-agnostic once factories are wired:

- STT HTTP: `POST /v1/audio/transcriptions`
- STT streaming WS: `WS /v1/audio/stream`
- TTS HTTP: `POST /v1/audio/speech`

Model swapping is handled in routes by comparing requested `model` vs currently loaded model.

## Validation Checklist

1. `python3 -m compileall packages/local-inference`
2. Start server and verify health:
   - `uv run local-inference`
   - `curl http://localhost:1060/health`
3. Exercise endpoints:
   - STT: `POST /v1/audio/transcriptions`
   - TTS: `POST /v1/audio/speech`
4. Confirm model swap logs appear when request `model` changes.
