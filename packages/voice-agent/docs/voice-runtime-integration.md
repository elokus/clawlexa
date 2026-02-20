# voice-agent Integration

This project integrates the package runtime through a thin compatibility layer.

## Integration Files

- `packages/voice-agent/src/voice/factory.ts`
- `packages/voice-agent/src/voice/package-backed-runtime.ts`
- `packages/voice-agent/src/voice/transport-bridge.ts`
- `packages/voice-agent/src/voice/benchmark-recorder.ts`
- `packages/voice-agent/src/agent/voice-agent.ts`

## Integration Flow

1. `voice/config.ts` delegates profile+document resolution to `resolveRuntimeConfigFromDocuments(...)` from runtime.
2. `factory.ts` builds tools, then delegates `SessionInput` construction to `resolveRuntimeSessionInput(...)`.
3. `factory.ts` builds the runtime host via `getBuiltInProviderRegistry()` and `createVoiceRuntime(...)`.
4. `PackageBackedVoiceRuntime` wraps package session and maps events to existing `VoiceRuntime` contract.
5. `LegacyAudioTransportBridge` adapts existing `IAudioTransport` to package `ClientTransport`.
6. `VoiceAgent` consumes the wrapper and keeps orchestration/session-tree behavior.
7. Webhook config endpoints delegate provider catalog/auth checks to runtime control-plane functions.
8. Optional benchmark capture records session metrics and writes PASS/FAIL JSON reports.

## Boundary Contract (Important)

- Provider-specific protocol handling, transcript normalization, and ordering normalization belong to `@voiceclaw/voice-runtime`.
- `voice-agent` should only orchestrate profiles, tools, session lifecycle, persistence, and transport wiring.
- `voice-agent` and downstream UIs should consume normalized runtime events and must not parse provider-native IDs or provider-specific transcript quirks.
- If provider behavior differs, the fix should be in runtime adapters/session normalization, not in `voice-agent` or UI layers.

## Why This Layer Exists

- Keeps `VoiceAgent` API stable while migrating provider logic into the package.
- Preserves current transport stack and websocket event flow.
- Avoids a flag-day refactor across voice, web, and process subsystems.

## Migration Notes

- Legacy OpenAI-only realtime session wrapper has been removed; runtime-backed voice path is the active integration.
- Active provider selection and provider `SessionInput` shaping now happen in runtime control-plane helpers.
- Latency and transcript events are normalized before `VoiceAgent` forwarding.
- Benchmark provider threshold presets are sourced from runtime control-plane helpers.
- Benchmark reports can be enabled with `VOICE_BENCHMARK_ENABLED=true` and inspected with `bun run scratch:benchmark`.

### Testing Policy

- Replay contract tests are used for deterministic regression checks.
- Live audio tests are used for real provider verification with actual audio/tool execution.
- Passing replay tests alone is not evidence of live provider correctness.
