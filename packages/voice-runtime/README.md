# @voiceclaw/voice-runtime

Provider-agnostic realtime voice runtime package used by `pi-agent`.

## Package Scope

- Unified session API across providers.
- Adapter boundary for provider-specific protocols/SDKs.
- Transport boundary for client audio I/O.
- Framework-level interruption resolution.

## Implemented Adapters

- `openai-sdk`
- `ultravox-ws`
- `gemini-live`
- `decomposed`
- `pipecat-rtvi`

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
```

## Full Documentation

- `docs/voice-runtime/README.md`
- `docs/voice-runtime/ARCHITECTURE.md`
- `docs/voice-runtime/PROVIDERS.md`
- `docs/voice-runtime/INTERRUPTION_TRACKING.md`
- `docs/voice-runtime/INTEGRATION.md`
