# pi-agent Integration

This project integrates the package runtime through a thin compatibility layer.

## Integration Files

- `pi-agent/src/voice/factory.ts`
- `pi-agent/src/voice/package-backed-runtime.ts`
- `pi-agent/src/voice/transport-bridge.ts`
- `pi-agent/src/voice/benchmark-recorder.ts`
- `pi-agent/src/agent/voice-agent.ts`

## Integration Flow

1. `factory.ts` resolves runtime config and tools from profile/context.
2. It builds a package runtime host with registered adapters.
3. It creates `SessionInput` (provider id, instructions, model, voice, tool handler, provider config).
4. `PackageBackedVoiceRuntime` wraps package session and maps events to existing `VoiceRuntime` contract.
5. `LegacyAudioTransportBridge` adapts existing `IAudioTransport` to package `ClientTransport`.
6. `VoiceAgent` consumes the wrapper and keeps existing orchestration/session-tree behavior.
7. Optional benchmark capture records session metrics and writes PASS/FAIL JSON reports.

## Why This Layer Exists

- Keeps `VoiceAgent` API stable while migrating provider logic into the package.
- Preserves current transport stack and websocket event flow.
- Avoids a flag-day refactor across voice, web, and process subsystems.

## Migration Notes

- Legacy provider runtime classes still exist for targeted regression tests and fallback analysis.
- Active provider selection now resolves to package provider ids in `factory.ts`.
- Latency and transcript events are normalized before `VoiceAgent` forwarding.
- Benchmark reports can be enabled with `VOICE_BENCHMARK_ENABLED=true` and inspected with `bun run scratch:benchmark`.
