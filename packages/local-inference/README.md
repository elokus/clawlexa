# local-inference

Local FastAPI server for speech-to-text (STT) and text-to-speech (TTS) inference.

The server keeps one STT model and one TTS model resident in memory and can swap either model at request time via the `model` field.

## Extending Providers

For adding/registering STT/TTS backends and MLX provider-family scripts, see:

- [docs/PROVIDER_REGISTRATION.md](docs/PROVIDER_REGISTRATION.md)

## Install

```bash
cd packages/local-inference
uv sync
uv pip install -e '.[mlx]'
```

## Run

```bash
uv run local-inference
# or
uv run local-inference --host 0.0.0.0 --port 1060

# Qwen German defaults (base model)
uv run local-inference \
  --tts-model mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16 \
  --qwen-language German \
  --qwen-seed 42
```

## Endpoints

- `GET /health`
- `GET /v1/models/catalog`
- `GET /v1/models/state`
- `POST /v1/models/download`
- `POST /v1/models/load`
- `POST /v1/playground/tts/benchmark`
- `POST /v1/audio/transcriptions`
- `WS /v1/audio/stream`
- `POST /v1/audio/speech`

## Examples

```bash
curl http://localhost:1060/health

curl -X POST 'http://localhost:1060/v1/audio/transcriptions?model=mlx-community/parakeet-tdt-0.6b-v3' \
  -H 'Content-Type: audio/wav' \
  --data-binary @../voice-runtime/data/test/turn-1.wav

curl -X POST http://localhost:1060/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"mlx-community/Kokoro-82M-bf16","voice":"af_heart","input":"Hallo Welt","response_format":"pcm"}' \
  -o test.pcm

curl -X POST http://localhost:1060/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16","input":"Hallo Welt","language":"German","seed":42,"response_format":"pcm"}' \
  -o test-qwen.pcm
```
