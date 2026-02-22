# OpenAI Provider

Implementation details:
- Adapter: `packages/llm-runtime/src/adapters/openai.ts`
- Uses `@ai-sdk/openai` internally.
- Runtime model identity remains `{ provider: 'openai', model: '<openai-model-id>' }`.
- Supports shared tool contracts via `context.tools` + `toolHandler`.
- Accepts caller-provided API key via `options.apiKey` (fallback: `OPENAI_API_KEY`).
