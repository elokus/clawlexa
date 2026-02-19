# Voice Runtime Package

`@voiceclaw/voice-runtime` is the provider-agnostic runtime used by `pi-agent` for realtime voice sessions.

It gives one stable session API while allowing multiple provider adapters (`openai-sdk`, `ultravox-ws`, `gemini-live`, `decomposed`, `pipecat-rtvi`) behind the same contract.

## What It Owns

- Provider adapter lifecycle (`connect`, `disconnect`, `interrupt`, tool callbacks).
- Audio boundary normalization and resampling.
- Client transport attach/detach (`local-pcm`, `ws-pcm`, `webrtc`).
- Normalized stream events for transcripts, tool calls, latency, usage, and state.
- Framework-level interruption resolution (spoken text vs full generated text).

## What It Does Not Own

- Wake-word handling.
- Session-tree persistence and DB repositories.
- App-level websocket/API broadcasting.
- Profile orchestration and handoff packet policy.

## Core Runtime Objects

- `VoiceRuntimeImpl`: provider registry and session factory.
- `VoiceSessionImpl`: one active provider session with transport integration.
- `ProviderAdapter`: provider boundary contract.
- `ClientTransport`: app-provided media transport boundary.

## Agnostic Contract Replay Tests

- Test file: `packages/voice-runtime/tests/provider-contract-replay.test.ts`
- Runner: `packages/voice-runtime/tests/contracts/provider-contract-runner.ts`
- Fixtures: `packages/voice-runtime/tests/contracts/fixtures/*.jsonl`

The suite replays timestamped normalized events and validates:

- turn lifecycle consistency
- tool-call lifecycle ordering
- streaming transcript ordering (`assistantItemCreated` before deltas/finals)
- benchmark gates for duplicates/out-of-order regressions

Run:

```bash
bun test packages/voice-runtime/tests/provider-contract-replay.test.ts
```
- `VoiceBenchmarkRecorder`: benchmark metrics for latency/cadence/ordering/interruption gates.

## Read Next

1. `docs/voice-runtime/ARCHITECTURE.md`
2. `docs/voice-runtime/PROVIDERS.md`
3. `docs/voice-runtime/INTERRUPTION_TRACKING.md`
4. `docs/voice-runtime/INTEGRATION.md`
