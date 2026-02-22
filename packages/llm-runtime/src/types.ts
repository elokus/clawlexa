import type {
  AnthropicLlmOptions,
  GoogleLlmOptions,
  LlmCompleteResult,
  LlmContext,
  LlmEvent,
  LlmModelRef,
  LlmRuntime as CoreLlmRuntime,
  LlmRuntimeRequest as CoreLlmRuntimeRequest,
  LlmOptionsForProvider,
  OpenAiLlmOptions,
  OpenRouterLlmOptions,
  RuntimeProviderId,
} from '@voiceclaw/ai-core/llm';

export type LlmProviderId = RuntimeProviderId;
export type OpenRouterProviderId = 'openrouter';
export type OpenAiProviderId = 'openai';
export type AnthropicProviderId = 'anthropic';
export type GoogleProviderId = 'google';

export type {
  AnthropicLlmOptions,
  GoogleLlmOptions,
  LlmCompleteResult,
  LlmEvent,
  OpenAiLlmOptions,
  OpenRouterLlmOptions,
} from '@voiceclaw/ai-core/llm';

export interface LlmRuntimeRequest<P extends LlmProviderId = LlmProviderId> {
  model: CoreLlmRuntimeRequest<P>['model'];
  context: CoreLlmRuntimeRequest<P>['context'];
  options?: LlmOptionsForProvider<P> | Record<string, unknown>;
  toolHandler?: CoreLlmRuntimeRequest<P>['toolHandler'];
  response?: CoreLlmRuntimeRequest<P>['response'];
  signal?: CoreLlmRuntimeRequest<P>['signal'];
}

export interface LlmRuntime extends CoreLlmRuntime {
  stream<P extends LlmProviderId>(
    input: LlmRuntimeRequest<P>
  ): AsyncIterable<LlmEvent>;

  complete<P extends LlmProviderId>(
    input: LlmRuntimeRequest<P>
  ): Promise<LlmCompleteResult>;

  streamOpenRouter(input: {
    model: LlmModelRef<OpenRouterProviderId>;
    context: LlmContext;
    options?: OpenRouterLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<OpenRouterProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<OpenRouterProviderId>['response'];
    signal?: AbortSignal;
  }): AsyncIterable<LlmEvent>;

  completeOpenRouter(input: {
    model: LlmModelRef<OpenRouterProviderId>;
    context: LlmContext;
    options?: OpenRouterLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<OpenRouterProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<OpenRouterProviderId>['response'];
    signal?: AbortSignal;
  }): Promise<LlmCompleteResult>;

  streamOpenAI(input: {
    model: LlmModelRef<OpenAiProviderId>;
    context: LlmContext;
    options?: OpenAiLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<OpenAiProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<OpenAiProviderId>['response'];
    signal?: AbortSignal;
  }): AsyncIterable<LlmEvent>;

  completeOpenAI(input: {
    model: LlmModelRef<OpenAiProviderId>;
    context: LlmContext;
    options?: OpenAiLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<OpenAiProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<OpenAiProviderId>['response'];
    signal?: AbortSignal;
  }): Promise<LlmCompleteResult>;

  streamAnthropic(input: {
    model: LlmModelRef<AnthropicProviderId>;
    context: LlmContext;
    options?: AnthropicLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<AnthropicProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<AnthropicProviderId>['response'];
    signal?: AbortSignal;
  }): AsyncIterable<LlmEvent>;

  completeAnthropic(input: {
    model: LlmModelRef<AnthropicProviderId>;
    context: LlmContext;
    options?: AnthropicLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<AnthropicProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<AnthropicProviderId>['response'];
    signal?: AbortSignal;
  }): Promise<LlmCompleteResult>;

  streamGoogle(input: {
    model: LlmModelRef<GoogleProviderId>;
    context: LlmContext;
    options?: GoogleLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<GoogleProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<GoogleProviderId>['response'];
    signal?: AbortSignal;
  }): AsyncIterable<LlmEvent>;

  completeGoogle(input: {
    model: LlmModelRef<GoogleProviderId>;
    context: LlmContext;
    options?: GoogleLlmOptions | Record<string, unknown>;
    toolHandler?: LlmRuntimeRequest<GoogleProviderId>['toolHandler'];
    response?: LlmRuntimeRequest<GoogleProviderId>['response'];
    signal?: AbortSignal;
  }): Promise<LlmCompleteResult>;
}
