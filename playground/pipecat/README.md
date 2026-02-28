# Voice Playground

Compare Pipecat voice implementations against our voice-runtime.

## Setup

```bash
# System dependency (macOS)
brew install portaudio

# Python environment
cd playground
uv sync
```

## Scripts

### Ultravox Realtime (Speech-to-Speech)

```bash
# Basic usage — speak and get voice responses with live transcripts
uv run python ultravox_realtime.py

# Custom system prompt
uv run python ultravox_realtime.py --system-prompt "You are a pirate captain"

# List audio devices (find your mic/speaker indices)
uv run python ultravox_realtime.py --list-devices

# Select specific devices
uv run python ultravox_realtime.py --input-device 2 --output-device 4

# Debug mode (verbose pipecat logging)
uv run python ultravox_realtime.py --debug
```

### What to compare

| Metric | Voice-Runtime | Pipecat |
|--------|---------------|---------|
| TTFT (time to first token) | TUI inspector shows this | Shown in transcript output |
| Audio quality | Depends on provider | Ultravox native 48kHz |
| Interruption handling | `audio_interrupted` event | Pipecat frame-based |
| Turn detection | Provider-dependent | SileroVAD or provider |

## Adding more scripts

Copy the pattern from `ultravox_realtime.py`. Ideas:
- `decomposed_realtime.py` — Deepgram STT + OpenAI LLM + TTS (compare decomposed pipeline)
- `openai_realtime.py` — OpenAI Realtime API via Pipecat (compare with our OpenAI adapter)
