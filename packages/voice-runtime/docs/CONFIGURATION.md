# Voice Provider Integration Guide

This is the app-level integration guide for provider config, control APIs, and operational commands.

Runtime internals live in this `docs/` directory and are the canonical source for adapter architecture.

## 1. Provider Surface (Current)

Voice-to-voice modes:

- `openai-realtime`
- `ultravox-realtime`
- `gemini-live`
- `pipecat-rtvi`

Decomposed mode:

- `decomposed` (`stt + llm + tts`)

## 2. Runtime Config Files

- `.voiceclaw/voice.config.json`
- `.voiceclaw/auth-profiles.json`

Templates:

- `.voiceclaw/voice.config.example.json`
- `.voiceclaw/auth-profiles.example.json`

`voice.config.json` controls mode/provider/model/turn settings.  
`auth-profiles.json` controls credential profiles and provider defaults.

## 3. UI + API Control Plane

The dashboard `Voice Runtime` panel writes/reads config through:

- `GET /api/config/voice`
- `GET /api/config/voice/effective?profile=jarvis|marvin`
- `GET /api/config/voice/catalog`
- `PUT /api/config/voice`
- `GET /api/config/auth-profiles`
- `PUT /api/config/auth-profiles`
- `POST /api/config/auth-profiles/test`

## 4. Consumer Integration

Consumers integrate via the public `SessionInput` API and `parseProviderConfig()` helper. See consumer-specific documentation for integration file details and operational commands.

## 5. Benchmark Gate

Enable runtime benchmark capture:

```bash
VOICE_BENCHMARK_ENABLED=true
```

Reports are written to `.benchmarks/voice/` by default.  
See [`BENCHMARKS.md`](BENCHMARKS.md) for thresholds and PASS/FAIL policy.

## 6. Canonical Deep-Dive Docs

- Runtime architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Provider adapters/capabilities: [`PROVIDERS.md`](PROVIDERS.md)
- Interruption tracking: [`INTERRUPTION_TRACKING.md`](INTERRUPTION_TRACKING.md)
- Consumer integration guide: see your application's docs
- Pipecat operations: [`providers/PIPECAT.md`](providers/PIPECAT.md)
- Benchmark workflow: [`BENCHMARKS.md`](BENCHMARKS.md)
- Provider deep dives: [`providers/`](providers/)
