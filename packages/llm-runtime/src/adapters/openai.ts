import { createOpenAI } from '@ai-sdk/openai';
import { readUIMessageStream, stepCountIs, streamText } from 'ai';
import type {
  LlmContext,
  LlmModelRef,
  LlmResponseSpec,
  OpenAiLlmOptions,
} from '@voiceclaw/ai-core/llm';
import type { ToolCallHandler } from '@voiceclaw/ai-core/tools';
import {
  assertOpenAiOptions,
  buildOpenAiProviderOverrides,
} from '@voiceclaw/ai-core/llm/dialects';
import type {
  LlmCompleteResult,
  LlmEvent,
  OpenAiProviderId,
} from '../types.js';
import {
  createOpenRouterEventMapperState,
  mapOpenRouterUiMessageToEvents,
  type OpenRouterUiMessage,
} from './openrouter-event-mapper.js';
import { buildAiSdkToolSet } from './tool-bridge.js';

export interface OpenAiStreamInput {
  model: LlmModelRef<OpenAiProviderId>;
  context: LlmContext;
  options?: OpenAiLlmOptions | Record<string, unknown>;
  toolHandler?: ToolCallHandler;
  response?: LlmResponseSpec;
  signal?: AbortSignal;
}

function resolveOpenAiApiKey(options?: OpenAiLlmOptions): string {
  return options?.apiKey ?? process.env.OPENAI_API_KEY ?? '';
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
  options?: OpenAiLlmOptions | Record<string, unknown>
): OpenAiLlmOptions {
  if (!options) return {};
  return options as OpenAiLlmOptions;
}

export async function* streamOpenAI(
  input: OpenAiStreamInput
): AsyncIterable<LlmEvent> {
  if (input.response && input.response.mode !== 'text') {
    yield {
      type: 'error',
      error: `Unsupported response mode for openai adapter: ${input.response.mode}`,
    };
    return;
  }

  if (input.signal?.aborted) {
    yield { type: 'error', error: 'Aborted before stream start' };
    return;
  }

  const options = coerceOptions(input.options);
  const apiKey = resolveOpenAiApiKey(options);
  if (!apiKey) {
    yield {
      type: 'error',
      error: 'OPENAI_API_KEY is not set',
    };
    return;
  }

  const openai = createOpenAI({ apiKey });
  const model = openai.chat(input.model.model);
  const messages = normalizeMessages(input.context);
  const system = input.context.systemPrompt;
  assertOpenAiOptions(input.model.model, options);
  const tools = buildAiSdkToolSet({
    providerId: input.model.provider,
    model: input.model.model,
    definitions: input.context.tools,
    toolHandler: input.toolHandler,
  });
  const providerOverrides = buildOpenAiProviderOverrides(
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
              openai: providerOverrides,
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

export async function completeOpenAI(
  input: OpenAiStreamInput
): Promise<LlmCompleteResult> {
  const events: LlmEvent[] = [];
  let text = '';

  for await (const event of streamOpenAI(input)) {
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
