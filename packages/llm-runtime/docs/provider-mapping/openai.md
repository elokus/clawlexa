# OpenAI Mapping Notes

Status: implemented (v1)

## Runtime model identity
- `provider`: `openai`
- `model`: exact OpenAI model id, for example `gpt-4.1`, `gpt-4.1-mini`.

## Current supported options
- `apiKey` -> adapter client API key (fallback env: `OPENAI_API_KEY`)
- `temperature` -> AI SDK `temperature`
- `maxOutputTokens` -> AI SDK `maxOutputTokens`
- `providerOverrides` -> AI SDK `providerOptions.openai`
- `reasoningEffort` / `reasoning.effort|enabled` -> `providerOptions.openai.reasoningEffort`
- `reasoningSummary` / `reasoning.summary` -> `providerOptions.openai.reasoningSummary`
- `maxCompletionTokens` / `reasoning.maxOutputTokens` -> `providerOptions.openai.maxCompletionTokens`
- `serviceTier` -> `providerOptions.openai.serviceTier`
- `strictJsonSchema` -> `providerOptions.openai.strictJsonSchema`

## Event mapping
- same normalized event mapper as OpenRouter adapter
- text stream -> `text-delta`
- reasoning stream -> `reasoning-delta`
- tool stream parts -> `tool-call` / `tool-result`
- completion end -> `finish`

## pi-ai references used
- `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/openai-completions.ts`
- `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/openai-responses.ts`
- `/tmp/pi-mono-voiceclaw-plan/packages/ai/src/providers/transform-messages.ts`
