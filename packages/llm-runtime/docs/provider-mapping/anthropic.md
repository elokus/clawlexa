# Anthropic Mapping Notes

Status: implemented (v1)

## Runtime model identity
- `provider`: `anthropic`
- `model`: exact Anthropic model id, e.g. `claude-sonnet-4-5`.

## Current supported options
- `apiKey` -> adapter API key (fallback env: `ANTHROPIC_API_KEY`)
- `temperature` -> AI SDK `temperature`
- `maxOutputTokens` -> AI SDK `maxOutputTokens`
- `thinking.enabled` / `thinkingEnabled`
  - `true` -> `providerOptions.anthropic.thinking`
  - `false` -> `providerOptions.anthropic.thinking = { type: 'disabled' }`
- `thinking.budgetTokens` / `thinkingBudgetTokens`
  - budget thinking -> `providerOptions.anthropic.thinking = { type: 'enabled', budgetTokens }`
- `thinking.effort` / `effort`
  - adaptive thinking -> `providerOptions.anthropic.thinking = { type: 'adaptive' }`
  - effort mapped to `providerOptions.anthropic.effort`
- `providerOverrides` -> merged into `providerOptions.anthropic`

## Validation rules
- `thinking.budgetTokens` must be non-negative.
- `effort` and `budgetTokens` are mutually exclusive.
- `thinking.enabled=false` cannot be combined with `budgetTokens` or `effort`.

## Event mapping
- same normalized UI-message mapper used by OpenRouter/OpenAI adapters
- text stream -> `text-delta`
- reasoning stream -> `reasoning-delta`
- tool stream parts -> `tool-call` / `tool-result`
- completion end -> `finish`

## pi-mono references used
- `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/anthropic.ts`
- `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/transform-messages.ts`
