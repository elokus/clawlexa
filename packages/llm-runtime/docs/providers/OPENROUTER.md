# OpenRouter Provider

Implementation details:
- Model IDs are vendor-prefixed (for example `openai/gpt-5`).
- Option mapping and fail-fast validation are centralized in:
  - `packages/ai-core/src/llm/dialects.ts`
- Runtime adapter:
  - `packages/llm-runtime/src/adapters/openrouter.ts`
- Event normalization:
  - `packages/llm-runtime/src/adapters/openrouter-event-mapper.ts`
- Contract replay fixture:
  - `packages/llm-runtime/tests/contracts/fixtures/openrouter-contract.basic.json`
