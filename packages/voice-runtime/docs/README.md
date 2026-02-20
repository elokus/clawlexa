# Voice Runtime Package

`@voiceclaw/voice-runtime` is the provider-agnostic runtime used by voice agent applications for realtime voice sessions.

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

### Build Fixture From Real Session

Record a real multi-turn call, then convert the session log into a contract fixture using your application's fixture generation tooling. The output fixture should be placed in:

- `packages/voice-runtime/tests/contracts/fixtures/*.jsonl`

The fixture generator should produce a `contract-cases.ts` stub with expected turn/tool/final counts from the live run.

## Read Next

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) — Three-plane model
2. [`PROVIDERS.md`](PROVIDERS.md) — Adapter catalog and capabilities
3. [`INTERRUPTION_TRACKING.md`](INTERRUPTION_TRACKING.md) — Spoken text alignment
4. Consumer integration — see your application's docs
5. [`providers/`](providers/) — Provider-specific deep dives (Deepgram, OpenAI, etc.)
