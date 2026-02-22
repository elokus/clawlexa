# Provider Integration Guide

Required for each LLM provider integration:

1. Implement provider adapter and option mapping.
2. Document supported/unsupported options and reasoning behavior.
3. Add replay contract fixtures and assertions.
4. Add opt-in live tests for stream + complete parity.

## Required Test Pipeline

1. Add a deterministic replay fixture in `tests/fixtures/`:
   - Include provider UI parts/messages as captured from one real run.
   - Include expected normalized `LlmEvent[]`.
   - Include expected final text.
2. Assert replay in `tests/provider-contract-replay.test.ts`:
   - provider stream parts -> normalized event sequence
   - tool call/tool result ordering
   - text reconstruction from `text-delta`
3. Add live integration test coverage in `tests/integration/*.integration.test.ts`:
   - opt-in only (`LLM_RUNTIME_LIVE_PROVIDER_TESTS=true`)
   - run both `runtime.stream(...)` and `runtime.complete(...)`
   - verify both include finish events and deterministic token output
4. Add reasoning config checks for providers/models that support it:
   - toggle `reasoning.enabled` off/on
   - include effort/budget options where supported
   - verify unsupported combinations fail fast with typed errors

## Live Test Environment Variables

- `LLM_RUNTIME_LIVE_PROVIDERS=openrouter` (or `openrouter,openai,anthropic,google`)
- `OPEN_ROUTER_API_KEY` or `OPENROUTER_API_KEY`
- `OPENAI_API_KEY` (when `openai` is in `LLM_RUNTIME_LIVE_PROVIDERS`)
- `ANTHROPIC_API_KEY` (when `anthropic` is in `LLM_RUNTIME_LIVE_PROVIDERS`)
- `GOOGLE_API_KEY` or `GEMINI_API_KEY` (when `google` is in `LLM_RUNTIME_LIVE_PROVIDERS`)
- `LLM_RUNTIME_LIVE_MODEL` (optional, default: `openai/gpt-4o-mini`)
- `LLM_RUNTIME_LIVE_REASONING_TESTS=true` (optional)
- `LLM_RUNTIME_LIVE_REASONING_MODEL` (optional)

## Commands

```bash
cd packages/llm-runtime
bun run scratch:provider openrouter openai/gpt-4o-mini
bun run test:contract
bun run test:live
```
