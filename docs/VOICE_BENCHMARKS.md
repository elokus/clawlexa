# Voice Benchmarking

This project includes runtime benchmark instrumentation to detect integration regressions quickly.

## 1. What Is Measured

Metrics are produced by `VoiceBenchmarkRecorder` and evaluated with threshold gates:

- first-audio latency
- chunk cadence (median/p95/max gap + jitter)
- realtime factor (audio duration / wall time)
- duplicate assistant finals
- out-of-order assistant items
- interruption stop latency (median/p95/max)

Core implementation:

- metric engine: `packages/voice-runtime/src/benchmarks/voice-benchmark.ts`
- session capture integration: `pi-agent/src/voice/benchmark-recorder.ts`

## 2. Enabling Benchmarks

Set:

```bash
VOICE_BENCHMARK_ENABLED=true
```

Optional output dir:

```bash
VOICE_BENCH_OUTPUT_DIR=.benchmarks/voice
```

Optional threshold overrides:

- `VOICE_BENCH_MAX_FIRST_AUDIO_MS`
- `VOICE_BENCH_MAX_P95_CHUNK_GAP_MS`
- `VOICE_BENCH_MAX_CHUNK_GAP_MS`
- `VOICE_BENCH_MIN_RTF`
- `VOICE_BENCH_MAX_RTF`
- `VOICE_BENCH_MAX_DUP_ASSISTANT_FINALS`
- `VOICE_BENCH_MAX_OUT_OF_ORDER_ITEMS`
- `VOICE_BENCH_MAX_INTERRUPT_P95_MS`

Provider-specific defaults are applied first, then env overrides.

## 3. Output

Each finished session writes one JSON report containing:

- session metadata (`sessionId`, `profile`, `provider`, `reason`)
- thresholds used
- raw benchmark input
- evaluated report with `pass` and `violations`

Default location:

- `.benchmarks/voice/`

## 4. Inspecting Reports

From `pi-agent/`:

```bash
bun run scratch:benchmark list
bun run scratch:benchmark latest
bun run scratch:benchmark <path-to-report.json>
```

## 5. Agnostic Contract Replay (Deterministic)

For provider-handling correctness (turns, tools, streaming ordering), run:

```bash
bun test packages/voice-runtime/tests/provider-contract-replay.test.ts
```

This suite uses timestamped fixture replay (`packages/voice-runtime/tests/contracts/fixtures/*.jsonl`) to simulate livestream-style event sequences without hitting live APIs.

## 6. Recommended Release Gate

1. Enable benchmarks in staging.
2. Run provider smoke sessions (`openai`, `ultravox`, `gemini`, `pipecat`, `decomposed` as used).
3. Reject rollout if report contains violations on:
   - duplicates
   - out-of-order items
   - interruption p95
   - severe chunk gap/latency regressions
