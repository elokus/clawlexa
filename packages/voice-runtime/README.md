# @voiceclaw/voice-runtime

Provider-agnostic realtime voice runtime package for voice agent applications.

## Package Scope

- Unified session API across providers.
- Adapter boundary for provider-specific protocols/SDKs.
- Transport boundary for client audio I/O.
- Framework-level interruption resolution.
- Benchmark recording and evaluation.

## Boundary Contract

- `voice-runtime` is the only layer that may understand provider-specific protocol details.
- Adapters must normalize provider quirks into unified `VoiceSessionEvents`.
- Consumers (`voice-agent`, `web-ui`, TUI) must rely only on runtime contract fields and must not parse provider-native IDs/messages.
- When behavior diverges by provider, fix adapter/runtime normalization instead of adding consumer-side provider branches.

## Implemented Adapters

| Adapter | Transport | Use Case |
|---------|-----------|----------|
| `openai-sdk` | SDK (WS/WebRTC) | OpenAI Realtime voice-to-voice |
| `ultravox-ws` | WebSocket | Ultravox voice-to-voice |
| `gemini-live` | WebSocket | Google Gemini Live voice-to-voice |
| `decomposed` | HTTP + WebSocket | STT + LLM + TTS pipeline |
| `pipecat-rtvi` | WebSocket | Pipecat RTVI protocol |

## Main Exports

- `createVoiceRuntime`, `VoiceRuntimeImpl`
- `VoiceSessionImpl`
- `InterruptionTracker`
- Provider config parsers (`parseProviderConfig`, `parseOpenAIProviderConfig`, etc.)
- Provider adapters (`OpenAISdkAdapter`, `UltravoxWsAdapter`, `GeminiLiveAdapter`, `DecomposedAdapter`, `PipecatRtviAdapter`)
- Benchmark helpers (`VoiceBenchmarkRecorder`, `evaluateVoiceBenchmark`)

## Tests

```bash
bunx tsc -p packages/voice-runtime/tsconfig.json --noEmit
bun test packages/voice-runtime/tests/*.test.ts
bun test packages/voice-runtime/tests/provider-contract-replay.test.ts
# Opt-in live audio/provider test (not part of default test runs)
VOICE_RUNTIME_LIVE_PROVIDERS=openai-sdk bun run --cwd packages/voice-runtime test:live-ordering
```

`test:live-ordering` loads environment values from repo root `../../.env`.

## Documentation

All docs live in [`docs/`](docs/):

| Document | Description |
|----------|-------------|
| [`docs/README.md`](docs/README.md) | Overview and reading order |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Three-plane model (control/media/provider) |
| [`docs/PROVIDERS.md`](docs/PROVIDERS.md) | Adapter catalog and capability matrix |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | App-level config and control APIs |
| [`docs/INTERRUPTION_TRACKING.md`](docs/INTERRUPTION_TRACKING.md) | Spoken text vs full text alignment |
| [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) | Metrics, thresholds, report workflow |

### Provider Deep Dives

| Provider | Document |
|----------|----------|
| Deepgram | [`docs/providers/DEEPGRAM.md`](docs/providers/DEEPGRAM.md) |
| OpenAI | [`docs/providers/OPENAI.md`](docs/providers/OPENAI.md) |
| Ultravox | [`docs/providers/ULTRAVOX.md`](docs/providers/ULTRAVOX.md) |
| Gemini | [`docs/providers/GEMINI.md`](docs/providers/GEMINI.md) |
| Decomposed | [`docs/providers/DECOMPOSED.md`](docs/providers/DECOMPOSED.md) |
| Pipecat | [`docs/providers/PIPECAT.md`](docs/providers/PIPECAT.md) |
