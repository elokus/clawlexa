# LLM Dialects

Defines per-provider and per-model option mapping and capability validation.

Implemented rules:
- Keep `provider` and `model` as the only public identity fields.
- `model` is always provider-native identifier. No `modelId` vs `providerModelId` split.
- For OpenRouter, use vendor-prefixed model ids (for example `openai/gpt-5`).
- Unsupported provider/model option combinations fail fast with `LlmDialectValidationError`.
- OpenAI/OpenRouter/Anthropic/Google wire-option mapping is centralized in dialect builders.
- OpenAI maps to AI SDK option keys like `reasoningEffort`, `reasoningSummary`, and `maxCompletionTokens`.
- Anthropic maps thinking to adaptive/budget/disabled modes (`providerOptions.anthropic.thinking`) plus `effort`.
- Google maps thinking to `providerOptions.google.thinkingConfig`.

Code entry points:
- types: `packages/ai-core/src/llm/types.ts`
- dialect profiles + validation + mapping: `packages/ai-core/src/llm/dialects.ts`
- shared tool contracts: `packages/ai-core/src/tools/types.ts`
- voice/runtime auth-catalog-probe: `packages/ai-core/src/voice/auth-catalog.ts`
