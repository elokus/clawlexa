# Configuration

Voice agent configuration uses a layered system: JSON config files, environment variables, and per-profile overrides.

## Config Resolution Hierarchy

Priority (highest to lowest):

1. **Environment variables** (`VOICE_MODE`, `VOICE_PROVIDER`, etc.)
2. **Profile overrides** (per-profile settings in `voice.config.json`)
3. **Global JSON config** (`.voiceclaw/voice.config.json`)
4. **Inline defaults** (hardcoded in `src/voice/settings.ts`)

Resolution logic in `src/voice/config.ts`:

```typescript
// Env var overrides always win
const mode = process.env.VOICE_MODE
  ? normalizeMode(process.env.VOICE_MODE)
  : override.mode ?? voiceDoc.voice.mode;
```

## JSON Config Files

Stored in `.voiceclaw/` at the repository root. Created automatically with defaults on first run.

### voice.config.json

Controls voice mode, provider, model, and turn detection settings.

```json
{
  "voice": {
    "mode": "voice-to-voice",
    "language": "de",
    "profileOverrides": {
      "marvin": { "voice": "ash", "provider": "openai-realtime" }
    },
    "voiceToVoice": {
      "provider": "openai-realtime",
      "model": "gpt-realtime-mini-2025-10-06",
      "voice": "echo",
      "authProfile": "openai-main",
      "ultravoxModel": "fixie-ai/ultravox-70B",
      "geminiModel": "gemini-2.5-flash-native-audio-preview",
      "geminiVoice": "Puck",
      "pipecatServerUrl": "ws://localhost:7860",
      "pipecatTransport": "websocket"
    },
    "decomposed": {
      "stt": { "provider": "deepgram", "model": "nova-3", "language": "de" },
      "llm": { "provider": "openai", "model": "gpt-4.1" },
      "tts": { "provider": "deepgram", "model": "aura-2-thalia-en", "voice": "aura-2-thalia-en" }
    },
    "turn": {
      "strategy": "layered",
      "silenceMs": 700,
      "minSpeechMs": 350,
      "minRms": 0.015,
      "bargeInEnabled": true,
      "speechStartDebounceMs": 140,
      "vadEngine": "webrtc-vad",
      "neuralFilterEnabled": true,
      "rnnoiseSpeechThreshold": 0.62,
      "rnnoiseEchoSpeechThresholdBoost": 0.12,
      "webrtcVadMode": 3,
      "webrtcVadSpeechRatioThreshold": 0.7,
      "webrtcVadEchoSpeechRatioBoost": 0.15,
      "assistantOutputMinRms": 0.008,
      "assistantOutputSilenceMs": 350,
      "llmCompletion": {
        "enabled": false,
        "shortTimeoutMs": 5000,
        "longTimeoutMs": 10000,
        "shortReprompt": "...",
        "longReprompt": "..."
      }
    }
  }
}
```

**Voice modes**: `voice-to-voice` (single model handles audio I/O) or `decomposed` (separate STT + LLM + TTS).

**Voice-to-voice providers**: `openai-realtime`, `gemini-live`, `ultravox-realtime`, `pipecat-rtvi`.

**Decomposed providers**: STT (`deepgram`, `openai`), LLM (`openai`, `openrouter`), TTS (`deepgram`, `openai`).

**Turn detection strategies**: `provider-native` (provider handles turn detection) or `layered` (custom silence/RMS detection).

### auth-profiles.json

API credential management. Each profile maps to a provider with an API key or OAuth config.

```json
{
  "profiles": {
    "openai-main": {
      "provider": "openai",
      "type": "api-key",
      "enabled": true,
      "apiKey": "sk-..."
    },
    "google-live": {
      "provider": "google",
      "type": "oauth",
      "enabled": false,
      "oauth": {
        "clientId": "...",
        "clientSecret": "...",
        "refreshToken": "...",
        "scopes": ["https://www.googleapis.com/auth/generative-language.realtime"]
      }
    }
  },
  "defaults": {
    "openai": "openai-main",
    "deepgram": "deepgram-main"
  }
}
```

Auth profiles are referenced by ID in `voice.config.json` (e.g., `"authProfile": "openai-main"`). The `defaults` map sets which profile to use when no explicit `authProfile` is specified.

Key resolution (`resolveApiKey()`): auth profile API key > env var fallback.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (realtime, STT, TTS) |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word detection (required for local mode) |

### Optional - Provider Keys

| Variable | Description |
|----------|-------------|
| `OPEN_ROUTER_API_KEY` | OpenRouter API key (subagent LLM, Grok) |
| `DEEPGRAM_API_KEY` | Deepgram API key (decomposed STT/TTS) |
| `ULTRAVOX_API_KEY` | Ultravox API key (voice-to-voice) |
| `GOOGLE_API_KEY` | Google API key (Gemini Live) |
| `GOVEE_API_KEY` | Govee smart home API |

### Optional - Voice Overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `VOICE_MODE` | `voice-to-voice` | `voice-to-voice` or `decomposed` |
| `VOICE_PROVIDER` | `openai-realtime` | Voice-to-voice provider |
| `VOICE_LANGUAGE` | `de` | Language code |
| `VOICE_REALTIME_MODEL` | `gpt-realtime-mini-2025-10-06` | OpenAI realtime model |
| `ULTRAVOX_MODEL` | `fixie-ai/ultravox-70B` | Ultravox model |
| `GEMINI_LIVE_MODEL` | `gemini-2.5-flash-native-audio-preview` | Gemini Live model |
| `GEMINI_VOICE` | `Puck` | Gemini voice name |

### Optional - Decomposed Pipeline

| Variable | Default | Description |
|----------|---------|-------------|
| `DECOMPOSED_STT_MODEL` | `nova-3` | STT model |
| `DECOMPOSED_LLM_MODEL` | `gpt-4.1` | LLM model |
| `DECOMPOSED_TTS_MODEL` | `aura-2-thalia-en` | TTS model |
| `DECOMPOSED_TTS_VOICE` | `aura-2-thalia-en` | TTS voice ID |

### Optional - Turn Detection

| Variable | Default | Description |
|----------|---------|-------------|
| `VOICE_TURN_SILENCE_MS` | `700` | Silence threshold (ms) |
| `VOICE_TURN_MIN_SPEECH_MS` | `350` | Minimum speech duration (ms) |
| `VOICE_TURN_MIN_RMS` | `0.015` | Minimum RMS amplitude |
| `VOICE_BARGE_IN_ENABLED` | `true` | Enable interruption while assistant is speaking (`false` = mic ignored during speaking) |
| `VOICE_SPEECH_START_DEBOUNCE_MS` | `140` | Continuous VAD-positive time required before opening a new mic turn |
| `VOICE_TURN_VAD_ENGINE` | `webrtc-vad` | `webrtc-vad` (proper speech classifier), `rnnoise`, or `rms` |
| `VOICE_NEURAL_FILTER_ENABLED` | `true` | Enable RNNoise denoiser before VAD/STT buffering |
| `VOICE_RNNOISE_SPEECH_THRESHOLD` | `0.62` | RNNoise speech probability threshold |
| `VOICE_RNNOISE_ECHO_THRESHOLD_BOOST` | `0.12` | Extra RNNoise threshold while assistant is speaking |
| `VOICE_WEBRTC_VAD_MODE` | `3` | WebRTC VAD aggressiveness (0-3, higher = stricter) |
| `VOICE_WEBRTC_VAD_SPEECH_RATIO_THRESHOLD` | `0.7` | Minimum voiced-frame ratio to classify chunk as speech |
| `VOICE_WEBRTC_VAD_ECHO_RATIO_BOOST` | `0.15` | Extra voiced-ratio required while assistant is speaking |
| `VOICE_ASSISTANT_OUTPUT_MIN_RMS` | `0.008` | Output RMS threshold for assistant-output activity detection |
| `VOICE_ASSISTANT_OUTPUT_SILENCE_MS` | `350` | Hold time after last voiced output chunk before disabling echo-sensitive phase |
| `VOICE_LLM_COMPLETION_ENABLED` | `false` | Enable LLM completion detection |

### Optional - Infrastructure

| Variable | Default | Description |
|----------|---------|-------------|
| `MAC_DAEMON_URL` | - | Mac daemon URL for CLI sessions |
| `TRANSPORT_MODE` | `web` | `web` (browser audio) or `local` (device audio) |
| `LOCAL_AUDIO_INPUT_DEVICE` | `default` | Local transport input device/source name (`pactl list short sources`) |
| `LOCAL_AUDIO_OUTPUT_DEVICE` | `default` | Local transport output device/sink name (`pactl list short sinks`) |
| `LOCAL_PREFER_ECHO_CANCEL_SOURCE` | `true` | In local Linux mode, auto-select echo-cancel source when input device is `default` |
| `SKIP_STATIC_SERVER` | - | Skip static file server (use in dev with Bun dev server) |
| `SHUTDOWN_TIMEOUT_MS` | `8000` | Graceful shutdown timeout |
| `VOICE_CONFIG_DIR` | `.voiceclaw/` | Config directory path |
| `VOICE_CONFIG_PATH` | `.voiceclaw/voice.config.json` | Voice config file path |
| `AUTH_PROFILES_PATH` | `.voiceclaw/auth-profiles.json` | Auth profiles file path |

### Local Linux Echo-Cancel Runbook (PipeWire)

Use this when running `TRANSPORT_MODE=local` with speaker + mic on the same hardware (for example Jabra speakerphone).

1. Inspect current devices:

```bash
pactl list short sources
pactl list short sinks
pactl info | rg "Default Source|Default Sink"
```

2. Create/enable an echo-cancel source (module name can vary by distro):

```bash
pactl load-module module-echo-cancel source_name=echo_cancel_source sink_name=echo_cancel_sink aec_method=webrtc
```

3. Verify that an echo-cancel source exists (name usually contains `echo`, `aec`, or `webrtc`):

```bash
pactl list short sources | rg -i "echo|aec|webrtc"
```

4. Run the agent in local mode. Keep `LOCAL_PREFER_ECHO_CANCEL_SOURCE=true` (default), or pin explicit source/sink:

```bash
TRANSPORT_MODE=local \
LOCAL_AUDIO_INPUT_DEVICE=echo_cancel_source \
LOCAL_AUDIO_OUTPUT_DEVICE=echo_cancel_sink \
bun run dev
```

At startup, the backend logs local routing and warns when input/output likely share hardware without echo-cancel.

### Web Environment (web/.env)

The web dashboard uses `PUBLIC_*` prefix with `process.env.PUBLIC_*` (Bun convention, not Vite's `import.meta.env`).

| Variable | Description |
|----------|-------------|
| `PUBLIC_DEMO_MODE` | `true` enables mock data mode |
| `PUBLIC_WS_URL` | WebSocket URL (only for Pi deployment, e.g. `ws://marlon.local:3001`) |
| `PUBLIC_API_URL` | API URL (only for Pi deployment, e.g. `http://marlon.local:3000`) |

## Profile Configuration

Agent profiles are defined in `src/agent/profiles.ts`. Each profile configures:

| Field | Description |
|-------|-------------|
| `name` | Display name (e.g. "Jarvis", "Marvin") |
| `wakeWord` | Wake word trigger (e.g. "hey_jarvis", "computer") |
| `instructions` | System prompt (inline or loaded from `prompts/` directory) |
| `voice` | Provider voice ID (e.g. "echo", "ash") |
| `tools` | List of enabled tool names |
| `greetingTrigger` | Message sent after wake word activation |

Current profiles:

| Profile | Wake Word | Voice | Tools |
|---------|-----------|-------|-------|
| Jarvis | "hey_jarvis" | echo | web_search, todo, light, timer |
| Marvin | "computer" | ash | developer_session, check/stop/feedback, deep_thinking, todo |

## API Endpoints

Config management endpoints on the webhook server (default port 3000):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config/voice` | Read current voice config |
| `PUT` | `/api/config/voice` | Update voice config (validates with Zod) |
| `GET` | `/api/config/voice/catalog` | Provider-native model/voice catalogs |
| `GET` | `/api/config/voice/effective?profile=jarvis` | Resolved runtime config for a profile |
| `GET` | `/api/config/auth-profiles` | Read auth profiles (API keys redacted) |
| `PUT` | `/api/config/auth-profiles` | Update auth profiles |
| `POST` | `/api/config/auth-profiles/test` | Test an auth profile connection |

The web dashboard uses the catalog and effective endpoints to populate the Voice Runtime settings panel.
