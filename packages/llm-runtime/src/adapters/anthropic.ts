import { createAnthropic } from '@ai-sdk/anthropic';
import { readUIMessageStream, stepCountIs, streamText } from 'ai';
import type {
  AnthropicLlmOptions,
  LlmContext,
  LlmModelRef,
  LlmResponseSpec,
} from '@voiceclaw/ai-core/llm';
import type { ToolCallHandler } from '@voiceclaw/ai-core/tools';
import {
  assertAnthropicOptions,
  buildAnthropicProviderOverrides,
} from '@voiceclaw/ai-core/llm/dialects';
import type {
  AnthropicProviderId,
  LlmCompleteResult,
  LlmEvent,
} from '../types.js';
import {
  createOpenRouterEventMapperState,
  mapOpenRouterUiMessageToEvents,
  type OpenRouterUiMessage,
} from './openrouter-event-mapper.js';
import { buildAiSdkToolSet } from './tool-bridge.js';

export interface AnthropicStreamInput {
  model: LlmModelRef<AnthropicProviderId>;
  context: LlmContext;
  options?: AnthropicLlmOptions | Record<string, unknown>;
  toolHandler?: ToolCallHandler;
  response?: LlmResponseSpec;
  signal?: AbortSignal;
}

function resolveAnthropicApiKey(options?: AnthropicLlmOptions): string {
  return options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
}

function normalizeMessages(
  context: LlmContext
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of context.messages) {
    if (message.role === 'user' || message.role === 'assistant') {
      messages.push({ role: message.role, content: message.content });
    }
  }
  return messages;
}

function coerceOptions(
  options?: AnthropicLlmOptions | Record<string, unknown>
): AnthropicLlmOptions {
  if (!options) return {};
  return options as AnthropicLlmOptions;
}

export async function* streamAnthropic(
  input: AnthropicStreamInput
): AsyncIterable<LlmEvent> {
  if (input.response && input.response.mode !== 'text') {
    yield {
      type: 'error',
      error: `Unsupported response mode for anthropic adapter: ${input.response.mode}`,
    };
    return;
  }

  if (input.signal?.aborted) {
    yield { type: 'error', error: 'Aborted before stream start' };
    return;
  }

  const options = coerceOptions(input.options);
  const apiKey = resolveAnthropicApiKey(options);
  if (!apiKey) {
    yield {
      type: 'error',
      error: 'ANTHROPIC_API_KEY is not set',
    };
    return;
  }

  const anthropic = createAnthropic({ apiKey });
  const model = anthropic.messages(input.model.model);
  const messages = normalizeMessages(input.context);
  const system = input.context.systemPrompt;
  assertAnthropicOptions(input.model.model, options);

  const tools = buildAiSdkToolSet({
    providerId: input.model.provider,
    model: input.model.model,
    definitions: input.context.tools,
    toolHandler: input.toolHandler,
  });
  const providerOverrides = buildAnthropicProviderOverrides(
    input.model.model,
    options
  );

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
      ...(typeof (options as { maxSteps?: number }).maxSteps === 'number'
        ? { stopWhen: stepCountIs((options as { maxSteps: number }).maxSteps) }
        : {}),
      ...(providerOverrides
        ? {
            providerOptions: {
              anthropic: providerOverrides,
            },
          }
        : {}),
    };

    if (input.signal) {
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

export async function completeAnthropic(
  input: AnthropicStreamInput
): Promise<LlmCompleteResult> {
  const events: LlmEvent[] = [];
  let text = '';

  for await (const event of streamAnthropic(input)) {
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
