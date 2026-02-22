# Google Mapping Notes

Status: implemented (v1)

## Runtime model identity
- `provider`: `google`
- `model`: exact Gemini model id, e.g. `gemini-2.5-flash`.

## Current supported options
- `apiKey` -> adapter API key (fallback env: `GOOGLE_API_KEY` or `GEMINI_API_KEY`)
- `temperature` -> AI SDK `temperature`
- `maxOutputTokens` -> AI SDK `maxOutputTokens`
- `thinking.enabled=true` + optional `thinking.level|thinking.budgetTokens|thinking.includeThoughts`
  -> `providerOptions.google.thinkingConfig`
  - `thinking.level` -> `thinkingLevel`
  - `thinking.budgetTokens` -> `thinkingBudget`
  - `thinking.includeThoughts` -> `includeThoughts` (default `true`)
- `thinking.enabled=false` -> omit `thinkingConfig` (disabled path)
- `providerOverrides` -> merged into `providerOptions.google`

## Validation rules
- `thinking.budgetTokens` must be non-negative.
- `thinking.level` and `thinking.budgetTokens` are mutually exclusive.
- `thinking.enabled=false` cannot be combined with `thinking.budgetTokens` or `thinking.includeThoughts=true`.

## Event mapping
- same normalized UI-message mapper used by OpenRouter/OpenAI/Anthropic adapters
- text stream -> `text-delta`
- reasoning stream -> `reasoning-delta`
- tool stream parts -> `tool-call` / `tool-result`
- completion end -> `finish`

## pi-mono references used
- `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/google.ts`
- `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/google-shared.ts`
