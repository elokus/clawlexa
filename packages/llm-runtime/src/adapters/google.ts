import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { readUIMessageStream, stepCountIs, streamText } from 'ai';
import type {
  GoogleLlmOptions,
  LlmContext,
  LlmModelRef,
  LlmResponseSpec,
} from '@voiceclaw/ai-core/llm';
import type { ToolCallHandler } from '@voiceclaw/ai-core/tools';
import {
  assertGoogleOptions,
  buildGoogleProviderOverrides,
} from '@voiceclaw/ai-core/llm/dialects';
import type {
  GoogleProviderId,
  LlmCompleteResult,
  LlmEvent,
} from '../types.js';
import {
  createOpenRouterEventMapperState,
  mapOpenRouterUiMessageToEvents,
  type OpenRouterUiMessage,
} from './openrouter-event-mapper.js';
import { buildAiSdkToolSet } from './tool-bridge.js';

export interface GoogleStreamInput {
  model: LlmModelRef<GoogleProviderId>;
  context: LlmContext;
  options?: GoogleLlmOptions | Record<string, unknown>;
  toolHandler?: ToolCallHandler;
  response?: LlmResponseSpec;
  signal?: AbortSignal;
}

function resolveGoogleApiKey(options?: GoogleLlmOptions): string {
  return options?.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
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
  options?: GoogleLlmOptions | Record<string, unknown>
): GoogleLlmOptions {
  if (!options) return {};
  return options as GoogleLlmOptions;
}

export async function* streamGoogle(
  input: GoogleStreamInput
): AsyncIterable<LlmEvent> {
  if (input.response && input.response.mode !== 'text') {
    yield {
      type: 'error',
      error: `Unsupported response mode for google adapter: ${input.response.mode}`,
    };
    return;
  }

  if (input.signal?.aborted) {
    yield { type: 'error', error: 'Aborted before stream start' };
    return;
  }

  const options = coerceOptions(input.options);
  const apiKey = resolveGoogleApiKey(options);
  if (!apiKey) {
    yield {
      type: 'error',
      error: 'GOOGLE_API_KEY (or GEMINI_API_KEY) is not set',
    };
    return;
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const model = google.chat(input.model.model);
  const messages = normalizeMessages(input.context);
  const system = input.context.systemPrompt;
  assertGoogleOptions(input.model.model, options);
  const tools = buildAiSdkToolSet({
    providerId: input.model.provider,
    model: input.model.model,
    definitions: input.context.tools,
    toolHandler: input.toolHandler,
  });
  const providerOverrides = buildGoogleProviderOverrides(
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
              google: providerOverrides,
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

export async function completeGoogle(
  input: GoogleStreamInput
): Promise<LlmCompleteResult> {
  const events: LlmEvent[] = [];
  let text = '';

  for await (const event of streamGoogle(input)) {
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
