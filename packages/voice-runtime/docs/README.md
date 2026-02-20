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
- Control-plane helpers: runtime-owned provider/session/config helpers for app delegates (`resolveRuntimeConfigFromDocuments`, `resolveRuntimeSessionInput`, `fetchRuntimeProviderCatalog`, `fetchRuntimeProviderCatalogFromAuthProfiles`, `resolveRuntimeAuthKeySet`, `runtimeAuthKeySetToProviderMap`, `getDefaultRuntimeBenchmarkThresholds`, `testRuntimeProviderCredentials`, `getRuntimeConfigManifest`).

## Universal Session Contract

`voice-runtime` is responsible for provider normalization. Consumers should see one contract regardless of provider.

- Runtime emits provider-agnostic stream events for placeholders, transcripts, tool lifecycle, state, and latency.
- Runtime emits normalized ordering metadata (`order`) on conversation events.
- `voice-agent`, web UI, and TUI must not parse provider-native IDs or provider-specific transcript quirks.
- Semantic variability is allowed (different model wording), but lifecycle and ordering invariants must stay stable.

### Enforcement Rule

- If a provider breaks ordering/tool/transcript expectations, fix adapter/runtime normalization.
- Do not add provider-specific patches in `voice-agent`, `web-ui`, or TUI to compensate.
- Keep shared contract/live tests provider-agnostic; provider-specific behavior checks belong in adapter-focused tests.

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

Replay tests validate normalization logic deterministically (offline). They are contract tests, not live provider verification.

## Live Audio Integration Test (Opt-In)

- Test file: `packages/voice-runtime/tests/integration/live-audio-ordering.integration.ts`
- Uses real `packages/voice-runtime/data/test/turn-*.raw` audio as session input.
- Opens real provider sessions and validates semantic ordering:
  - user transcript for Stehlampe request
  - `toggle_light` tool start/end
  - assistant confirmation after tool completion
- This test is intentionally **not** in default test runs.

Live tests validate real provider behavior against the same runtime contract. If a live test fails, fix adapter/runtime normalization first; do not add provider-specific UI workarounds.

Run:

```bash
VOICE_RUNTIME_LIVE_PROVIDERS=openai-sdk \
bun run --cwd packages/voice-runtime test:live-ordering
```

Provider credentials are required via environment variables (for example `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ULTRAVOX_API_KEY`).
The package script loads env values from repository root `../../.env`.

### Build Fixture From Real Session

Record a real multi-turn call, then convert the session log into a contract fixture using your application's fixture generation tooling. The output fixture should be placed in:

- `packages/voice-runtime/tests/contracts/fixtures/*.jsonl`

The fixture generator should produce a `contract-cases.ts` stub with expected turn/tool/final counts from the live run.

## Read Next

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) — Three-plane model
2. [`PROVIDERS.md`](PROVIDERS.md) — Adapter catalog and capabilities
3. [`INTERRUPTION_TRACKING.md`](INTERRUPTION_TRACKING.md) — Spoken text alignment
4. [`PROVIDER_INTEGRATION_GUIDE.md`](PROVIDER_INTEGRATION_GUIDE.md) — **Start here** when adding a new provider, mode, or setup. Research pipeline, test scenarios, and integration checklist.
5. Consumer integration — see your application's docs
6. [`providers/`](providers/) — Provider-specific deep dives (Deepgram, OpenAI, etc.)
