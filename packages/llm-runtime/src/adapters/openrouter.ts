import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { readUIMessageStream, stepCountIs, streamText } from 'ai';
import type { LlmContext, LlmModelRef, LlmResponseSpec } from '@voiceclaw/ai-core/llm';
import type { ToolCallHandler } from '@voiceclaw/ai-core/tools';
import {
  buildOpenRouterProviderOverrides,
} from '@voiceclaw/ai-core/llm/dialects';
import type {
  LlmCompleteResult,
  LlmEvent,
  OpenRouterLlmOptions,
  OpenRouterProviderId,
} from '../types.js';
import {
  createOpenRouterEventMapperState,
  mapOpenRouterUiMessageToEvents,
  type OpenRouterUiMessage,
} from './openrouter-event-mapper.js';
import { buildAiSdkToolSet } from './tool-bridge.js';

export interface OpenRouterStreamInput {
  model: LlmModelRef<OpenRouterProviderId>;
  context: LlmContext;
  options?: OpenRouterLlmOptions | Record<string, unknown>;
  toolHandler?: ToolCallHandler;
  response?: LlmResponseSpec;
  signal?: AbortSignal;
}

function resolveOpenRouterApiKey(options?: OpenRouterLlmOptions): string {
  return (
    options?.apiKey ??
    process.env.OPEN_ROUTER_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    ''
  );
}

function normalizeMessages(context: LlmContext): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of context.messages) {
    if (message.role === 'user' || message.role === 'assistant') {
      messages.push({ role: message.role, content: message.content });
    }
  }
  return messages;
}

function coerceOptions(
  options?: OpenRouterLlmOptions | Record<string, unknown>
): OpenRouterLlmOptions {
  if (!options) return {};
  return options as OpenRouterLlmOptions;
}

export async function* streamOpenRouter(
  input: OpenRouterStreamInput
): AsyncIterable<LlmEvent> {
  if (input.response && input.response.mode !== 'text') {
    yield {
      type: 'error',
      error: `Unsupported response mode for openrouter adapter: ${input.response.mode}`,
    };
    return;
  }

  if (input.signal?.aborted) {
    yield { type: 'error', error: 'Aborted before stream start' };
    return;
  }

  const options = coerceOptions(input.options);
  const apiKey = resolveOpenRouterApiKey(options);
  if (!apiKey) {
    yield {
      type: 'error',
      error: 'OPEN_ROUTER_API_KEY (or OPENROUTER_API_KEY) is not set',
    };
    return;
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter.chat(input.model.model);
  const messages = normalizeMessages(input.context);
  const system = input.context.systemPrompt;
  const providerOverrides = buildOpenRouterProviderOverrides(
    input.model.model,
    options
  );
  const tools = buildAiSdkToolSet({
    providerId: input.model.provider,
    model: input.model.model,
    definitions: input.context.tools,
    toolHandler: input.toolHandler,
    legacyTools: options.tools,
  });

  try {
    const request: Record<string, unknown> = {
      model,
      ...(system ? { system } : {}),
      ...(messages.length > 0 ? { messages } : {}),
      ...(typeof options.temperature === 'number'
        ? { temperature: options.temperature }
        : {}),
      ...(typeof options.maxOutputTokens === 'number'
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      ...(tools ? { tools } : {}),
      ...(options.stopWhen
        ? { stopWhen: options.stopWhen }
        : typeof options.maxSteps === 'number'
          ? { stopWhen: stepCountIs(options.maxSteps) }
          : {}),
      ...(providerOverrides
        ? {
            providerOptions: {
              openrouter: providerOverrides,
            },
          }
        : {}),
    };

    if (input.signal) {
      // AI SDK has evolved signal/abortSignal naming over versions.
      // Set both to maximize compatibility for the local pinned version.
      request.signal = input.signal;
      request.abortSignal = input.signal;
    }

    const result = streamText(request as any);

    yield { type: 'start' };

    const eventMapperState = createOpenRouterEventMapperState();

    for await (const uiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
    })) {
      const mappedEvents = mapOpenRouterUiMessageToEvents(
        uiMessage as OpenRouterUiMessage,
        eventMapperState
      );
      for (const event of mappedEvents) {
        yield event;
      }
    }

    yield {
      type: 'finish',
      finishReason: 'stop',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield { type: 'error', error: message };
  }
}

export async function completeOpenRouter(
  input: OpenRouterStreamInput
): Promise<LlmCompleteResult> {
  const events: LlmEvent[] = [];
  let text = '';

  for await (const event of streamOpenRouter(input)) {
    events.push(event);
    if (event.type === 'text-delta') {
      text += event.textDelta;
    }
    if (event.type === 'error') {
      throw new Error(event.error);
    }
  }

  return { text, events };
}
