import type {
  ToolCallHandler,
  ToolDefinition,
} from '../tools/types.js';

export type RuntimeProviderId =
  | 'openrouter'
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'deepgram'
  | 'ultravox'
  | (string & {});

export type ModelModality = 'llm' | 'voice-realtime' | 'stt' | 'tts';

export interface ModelRef {
  provider: RuntimeProviderId;
  /**
   * Provider-native model identifier used directly by the adapter.
   * Example: `openai/gpt-5` for OpenRouter.
   *
   * Intentionally there is no separate `modelId`/`providerModelId` field.
   */
  model: string;
  modality: ModelModality;
}

export interface LlmModelRef<P extends RuntimeProviderId = RuntimeProviderId>
  extends ModelRef {
  provider: P;
  modality: 'llm';
}

export type LlmMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface LlmContext {
  systemPrompt?: string;
  messages: LlmMessage[];
  tools?: ToolDefinition[];
}

export interface LlmCommonOptions {
  temperature?: number;
  maxOutputTokens?: number;
}

export type LlmReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export interface LlmReasoningOptions {
  enabled?: boolean;
  effort?: LlmReasoningEffort;
  maxTokens?: number;
}

export interface OpenRouterLlmOptions extends LlmCommonOptions {
  apiKey?: string;
  reasoning?: {
    effort?: LlmReasoningEffort;
    enabled?: boolean;
    maxTokens?: number;
  };
  /**
   * Passed to `providerOptions.openrouter`.
   */
  providerOverrides?: Record<string, unknown>;
  /**
   * Optional tool set passed through by runtime adapters.
   */
  tools?: unknown;
  /**
   * Optional multi-step cap passed through by runtime adapters.
   */
  maxSteps?: number;
  /**
   * Optional stop condition passed through by runtime adapters.
   */
  stopWhen?: unknown;
}

export interface OpenAiLlmOptions extends LlmCommonOptions {
  apiKey?: string;
  /**
   * OpenAI chat/responses provider option aliases.
   */
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | null;
  serviceTier?: 'default' | 'auto' | 'flex' | 'priority';
  strictJsonSchema?: boolean;
  maxCompletionTokens?: number;
  reasoning?: {
    enabled?: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    summary?: 'auto' | 'concise' | 'detailed';
    maxOutputTokens?: number;
  };
  providerOverrides?: Record<string, unknown>;
}

export interface AnthropicLlmOptions extends LlmCommonOptions {
  apiKey?: string;
  /**
   * pi-mono style aliases for Anthropic configuration.
   */
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'max';
  thinking?: {
    enabled?: boolean;
    budgetTokens?: number;
    effort?: 'low' | 'medium' | 'high' | 'max';
  };
  providerOverrides?: Record<string, unknown>;
}

export interface GoogleLlmOptions extends LlmCommonOptions {
  apiKey?: string;
  thinking?: {
    enabled?: boolean;
    budgetTokens?: number;
    includeThoughts?: boolean;
    level?: 'minimal' | 'low' | 'medium' | 'high';
  };
  providerOverrides?: Record<string, unknown>;
}

export interface GenericLlmOptions extends LlmCommonOptions {
  reasoning?: LlmReasoningOptions;
  providerOverrides?: Record<string, unknown>;
  [key: string]: unknown;
}

export type LlmOptions = GenericLlmOptions;

export interface LlmOptionsByProvider {
  openrouter: OpenRouterLlmOptions;
  openai: OpenAiLlmOptions;
  anthropic: AnthropicLlmOptions;
  google: GoogleLlmOptions;
  deepgram: GenericLlmOptions;
  ultravox: GenericLlmOptions;
}

export type LlmOptionsForProvider<P extends RuntimeProviderId> =
  P extends keyof LlmOptionsByProvider ? LlmOptionsByProvider[P] : GenericLlmOptions;

export type LlmFinishReason =
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'error'
  | 'aborted';

export type LlmEvent =
  | { type: 'start' }
  | { type: 'start-step' }
  | { type: 'text-delta'; textDelta: string }
  | {
      type: 'tool-call';
      toolName: string;
      toolCallId: string;
      input?: unknown;
    }
  | {
      type: 'tool-result';
      toolName: string;
      toolCallId: string;
      output?: unknown;
      isError?: boolean;
    }
  | { type: 'reasoning-delta'; text: string }
  | {
      type: 'finish';
      finishReason?: LlmFinishReason;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }
  | { type: 'error'; error: string };

export interface LlmCompleteResult {
  text: string;
  events: LlmEvent[];
}

export interface LlmResponseSpec {
  mode: 'text' | 'json' | 'schema';
  schema?: Record<string, unknown>;
  strict?: boolean;
}

export interface LlmRuntimeRequest<P extends RuntimeProviderId = RuntimeProviderId> {
  model: LlmModelRef<P>;
  context: LlmContext;
  options?: LlmOptionsForProvider<P> | Record<string, unknown>;
  toolHandler?: ToolCallHandler;
  response?: LlmResponseSpec;
  signal?: AbortSignal;
}

export interface LlmRuntime {
  stream<P extends RuntimeProviderId>(
    input: LlmRuntimeRequest<P>
  ): AsyncIterable<LlmEvent>;

  complete<P extends RuntimeProviderId>(
    input: LlmRuntimeRequest<P>
  ): Promise<LlmCompleteResult>;
}
