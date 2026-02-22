export type ToolReaction = 'speaks' | 'listens' | 'speaks-once';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  precomputable?: boolean;
  timeout?: number;
  defaultReaction?: ToolReaction;
  nonBlocking?: boolean;
}

export interface ToolCallContext {
  providerId: string;
  callId: string;
  invocationId: string;
  history?: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    text: string;
    createdAt: number;
    providerMeta?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
}

export interface ToolCallResult {
  invocationId: string;
  result: string;
  isError?: boolean;
  errorMessage?: string;
  agentReaction?: ToolReaction;
  scheduling?: 'interrupt' | 'when_idle' | 'silent';
  stateUpdate?: Record<string, unknown>;
  stageTransition?: boolean;
}

export type ToolCallHandler = (
  name: string,
  args: Record<string, unknown>,
  context: ToolCallContext
) => Promise<ToolCallResult | string>;
