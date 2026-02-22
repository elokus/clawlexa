import type {
  LlmCompleteResult,
  LlmEvent,
  LlmProviderId,
  LlmRuntimeRequest,
  LlmRuntime,
} from './types.js';
import {
  completeAnthropic,
  streamAnthropic,
  type AnthropicStreamInput,
} from './adapters/anthropic.js';
import {
  completeGoogle,
  streamGoogle,
  type GoogleStreamInput,
} from './adapters/google.js';
import {
  completeOpenAI,
  streamOpenAI,
  type OpenAiStreamInput,
} from './adapters/openai.js';
import {
  completeOpenRouter,
  streamOpenRouter,
  type OpenRouterStreamInput,
} from './adapters/openrouter.js';

export interface LlmRuntimeAdapterOverrides {
  anthropic?: {
    stream?: (input: AnthropicStreamInput) => AsyncIterable<LlmEvent>;
    complete?: (input: AnthropicStreamInput) => Promise<LlmCompleteResult>;
  };
  google?: {
    stream?: (input: GoogleStreamInput) => AsyncIterable<LlmEvent>;
    complete?: (input: GoogleStreamInput) => Promise<LlmCompleteResult>;
  };
  openai?: {
    stream?: (input: OpenAiStreamInput) => AsyncIterable<LlmEvent>;
    complete?: (input: OpenAiStreamInput) => Promise<LlmCompleteResult>;
  };
  openrouter?: {
    stream?: (input: OpenRouterStreamInput) => AsyncIterable<LlmEvent>;
    complete?: (input: OpenRouterStreamInput) => Promise<LlmCompleteResult>;
  };
}

interface ResolvedLlmRuntimeAdapters {
  anthropic: {
    stream: (input: AnthropicStreamInput) => AsyncIterable<LlmEvent>;
    complete: (input: AnthropicStreamInput) => Promise<LlmCompleteResult>;
  };
  google: {
    stream: (input: GoogleStreamInput) => AsyncIterable<LlmEvent>;
    complete: (input: GoogleStreamInput) => Promise<LlmCompleteResult>;
  };
  openai: {
    stream: (input: OpenAiStreamInput) => AsyncIterable<LlmEvent>;
    complete: (input: OpenAiStreamInput) => Promise<LlmCompleteResult>;
  };
  openrouter: {
    stream: (input: OpenRouterStreamInput) => AsyncIterable<LlmEvent>;
    complete: (input: OpenRouterStreamInput) => Promise<LlmCompleteResult>;
  };
}

class LlmRuntimeImpl implements LlmRuntime {
  private readonly adapters: ResolvedLlmRuntimeAdapters;

  constructor(overrides?: LlmRuntimeAdapterOverrides) {
    this.adapters = {
      anthropic: {
        stream: overrides?.anthropic?.stream ?? streamAnthropic,
        complete: overrides?.anthropic?.complete ?? completeAnthropic,
      },
      google: {
        stream: overrides?.google?.stream ?? streamGoogle,
        complete: overrides?.google?.complete ?? completeGoogle,
      },
      openai: {
        stream: overrides?.openai?.stream ?? streamOpenAI,
        complete: overrides?.openai?.complete ?? completeOpenAI,
      },
      openrouter: {
        stream: overrides?.openrouter?.stream ?? streamOpenRouter,
        complete: overrides?.openrouter?.complete ?? completeOpenRouter,
      },
    };
  }

  async *stream<P extends LlmProviderId>(
    input: LlmRuntimeRequest<P>
  ): AsyncIterable<LlmEvent> {
    if (input.model.provider === 'anthropic') {
      yield* this.adapters.anthropic.stream(input as AnthropicStreamInput);
      return;
    }

    if (input.model.provider === 'google') {
      yield* this.adapters.google.stream(input as GoogleStreamInput);
      return;
    }

    if (input.model.provider === 'openai') {
      yield* this.adapters.openai.stream(input as OpenAiStreamInput);
      return;
    }

    if (input.model.provider === 'openrouter') {
      yield* this.adapters.openrouter.stream(input as OpenRouterStreamInput);
      return;
    }

    yield {
      type: 'error',
      error: `llm-runtime provider adapter not implemented yet for ${input.model.provider}:${input.model.model}`,
    };
  }

  async complete<P extends LlmProviderId>(
    input: LlmRuntimeRequest<P>
  ): Promise<LlmCompleteResult> {
    if (input.model.provider === 'anthropic') {
      return this.adapters.anthropic.complete(input as AnthropicStreamInput);
    }

    if (input.model.provider === 'google') {
      return this.adapters.google.complete(input as GoogleStreamInput);
    }

    if (input.model.provider === 'openai') {
      return this.adapters.openai.complete(input as OpenAiStreamInput);
    }

    if (input.model.provider === 'openrouter') {
      return this.adapters.openrouter.complete(input as OpenRouterStreamInput);
    }

    const events: LlmEvent[] = [];
    let text = '';

    for await (const event of this.stream(input)) {
      events.push(event);
      if (event.type === 'text-delta') {
        text += event.textDelta;
      }
      if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

    return {
      text,
      events,
    };
  }

  streamOpenRouter(input: OpenRouterStreamInput): AsyncIterable<LlmEvent> {
    return this.adapters.openrouter.stream(input);
  }

  completeOpenRouter(input: OpenRouterStreamInput): Promise<LlmCompleteResult> {
    return this.adapters.openrouter.complete(input);
  }

  streamOpenAI(input: OpenAiStreamInput): AsyncIterable<LlmEvent> {
    return this.adapters.openai.stream(input);
  }

  completeOpenAI(input: OpenAiStreamInput): Promise<LlmCompleteResult> {
    return this.adapters.openai.complete(input);
  }

  streamAnthropic(input: AnthropicStreamInput): AsyncIterable<LlmEvent> {
    return this.adapters.anthropic.stream(input);
  }

  completeAnthropic(input: AnthropicStreamInput): Promise<LlmCompleteResult> {
    return this.adapters.anthropic.complete(input);
  }

  streamGoogle(input: GoogleStreamInput): AsyncIterable<LlmEvent> {
    return this.adapters.google.stream(input);
  }

  completeGoogle(input: GoogleStreamInput): Promise<LlmCompleteResult> {
    return this.adapters.google.complete(input);
  }
}

export function createLlmRuntime(overrides?: LlmRuntimeAdapterOverrides): LlmRuntime {
  return new LlmRuntimeImpl(overrides);
}
