# Voice Provider Integration Guide

This is the app-level integration guide for provider config, control APIs, and operational commands.

Runtime internals live in `docs/voice-runtime/*` and are the canonical source for adapter architecture.

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

## 4. Runtime Integration Files

- `pi-agent/src/voice/factory.ts`
- `pi-agent/src/voice/package-backed-runtime.ts`
- `pi-agent/src/voice/transport-bridge.ts`
- `pi-agent/src/agent/voice-agent.ts`

## 5. Operational Commands

From `pi-agent/`:

- `bun run scratch:voice [auth|ultravox|deepgram|decomposed|all]`
- `bun run scratch:provider <openai|openrouter|google|deepgram|ultravox>`
- `bun run scratch:benchmark [list|latest|<report.json>]`

## 6. Benchmark Gate

Enable runtime benchmark capture:

```bash
VOICE_BENCHMARK_ENABLED=true
```

Reports are written to `.benchmarks/voice/` by default.  
See `docs/VOICE_BENCHMARKS.md` for thresholds and PASS/FAIL policy.

## 7. Canonical Deep-Dive Docs

- Runtime architecture: `docs/voice-runtime/ARCHITECTURE.md`
- Provider adapters/capabilities: `docs/voice-runtime/PROVIDERS.md`
- Interruption tracking: `docs/voice-runtime/INTERRUPTION_TRACKING.md`
- pi-agent bridge integration: `docs/voice-runtime/INTEGRATION.md`
- Pipecat operations: `docs/PIPECAT_RTVI_PROVIDER.md`
- Benchmark workflow: `docs/VOICE_BENCHMARKS.md`
