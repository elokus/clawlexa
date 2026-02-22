# OpenRouter Mapping Notes

Status: implemented (v1)

## Runtime model identity
- `provider`: `openrouter`
- `model`: exact OpenRouter model id (vendor-prefixed), e.g. `openai/gpt-5`, `x-ai/grok-4-fast-reasoning`.
- `model` is provider-native id. We intentionally do not expose a separate `modelId` / `providerModelId` split.

## Current supported options
- `apiKey` -> adapter client API key (fallback env: `OPEN_ROUTER_API_KEY` / `OPENROUTER_API_KEY`)
- `temperature` -> AI SDK `temperature`
- `maxOutputTokens` -> AI SDK `maxOutputTokens`
- `providerOverrides` -> AI SDK `providerOptions.openrouter`
- `reasoning.enabled` / `reasoning.effort` / `reasoning.maxTokens`
  -> normalized and merged into `providerOptions.openrouter.reasoning`
  -> `maxTokens` maps to `reasoning.max_tokens`
- validation/mapping source of truth:
  - `packages/ai-core/src/llm/dialects.ts`
- shared tool contracts:
  - `context.tools` + `toolHandler` mapped via `packages/llm-runtime/src/adapters/tool-bridge.ts`

## Unsupported / pending
- structured output mode normalization
- usage token normalization on finish events

## Event mapping
- text stream -> `text-delta`
- reasoning stream -> `reasoning-delta`
- tool stream parts -> `tool-call` / `tool-result`
- completion end -> `finish`
- runtime/provider errors -> `error`

## Test Coverage
- replay fixture assertions:
  - `packages/llm-runtime/tests/provider-contract-replay.test.ts`
- fixture:
  - `packages/llm-runtime/tests/contracts/fixtures/openrouter-contract.basic.json`
- live opt-in integration:
  - `packages/llm-runtime/tests/integration/live-provider-contract.integration.test.ts`

## pi-ai references used
- model + compat patterns:
  - `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/types.ts`
  - `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/openai-completions.ts`
- cross-provider/tool normalization patterns:
  - `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/transform-messages.ts`
