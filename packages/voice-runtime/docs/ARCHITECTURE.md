# Voice Runtime Architecture

## Design Goal

Expose one stable API for voice sessions while keeping provider specifics internal to adapters.

## Three-Plane Model

1. Control plane:
- Stable session API (`createSession`, `connect`, `sendAudio`, `sendText`, `interrupt`).
- Capability-first feature gating (`ProviderCapabilities`).

2. Media plane:
- Client transport abstraction (`ClientTransport`).
- Runtime-level audio resampling when client and provider sample rates differ.
- Playback-position access for interruption accuracy.

3. Provider plane:
- Provider-specific protocol/SDK handling inside adapters.
- No provider SDK types leaked into `voice-agent`.

## Runtime Flow

1. `VoiceRuntimeImpl` resolves provider registration and creates an adapter-backed session.
2. `VoiceSessionImpl.connect()` calls adapter `connect()` and receives `AudioNegotiation`.
3. Optional `attachClientTransport()` wires mic input and speaker output via the transport boundary.
4. Adapter events are normalized and re-emitted through `VoiceSessionEvents`.
5. `interrupt()` runs framework interruption resolution before adapter-level interruption.

## Important Contracts

- `SessionInput`: normalized provider-independent input (instructions, model, tools, VAD).
- `ProviderAdapter`: required adapter methods and optional advanced controls.
- `VoiceSessionEvents`: unified event stream used by higher layers.
- `ProviderCapabilities`: explicit feature matrix for safe runtime behavior.
- `provider-config` parsers: canonical provider config validation/normalization shared by app and adapters.

## Boundary Enforcement

- Provider-specific behavior is allowed only in the provider plane (adapters + runtime internals).
- Control/media plane consumers must remain provider-agnostic and consume only normalized runtime contracts.
- Cross-provider consistency is validated via shared contract/live tests; provider-specific tests are limited to adapter-level coverage.

## Provider Config Source Of Truth

- `packages/voice-runtime/src/provider-config.ts` owns provider config schemas and runtime validation.
- Adapters parse `SessionInput.providerConfig` through these helpers before use.
- App integrations (e.g. `voice-agent`) should also parse through the same helpers before creating sessions.
- Lightweight imports are available via `@voiceclaw/voice-runtime/provider-config`.

## File Map

- `packages/voice-runtime/src/runtime/voice-runtime.ts`
- `packages/voice-runtime/src/runtime/voice-session.ts`
- `packages/voice-runtime/src/types.ts`
- `packages/voice-runtime/src/provider-config.ts`
- `packages/voice-runtime/src/media/resample-pcm16.ts`
- `packages/voice-runtime/src/runtime/interruption-tracker.ts`
