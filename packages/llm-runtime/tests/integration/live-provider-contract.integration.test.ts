import { describe, expect, it } from 'bun:test';
import { createLlmRuntime } from '../../src/runtime.js';
import type { LlmEvent } from '../../src/types.js';

const LIVE_PROVIDER_LIST =
  process.env.LLM_RUNTIME_LIVE_PROVIDERS ??
  (process.env.LLM_RUNTIME_LIVE_PROVIDER_TESTS === 'true' ? 'openrouter' : '');
const OPENROUTER_API_KEY =
  process.env.OPEN_ROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const GOOGLE_API_KEY =
  process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
const LIVE_MODEL = process.env.LLM_RUNTIME_LIVE_MODEL ?? 'openai/gpt-4o-mini';
const LIVE_REASONING_TESTS_ENABLED =
  process.env.LLM_RUNTIME_LIVE_REASONING_TESTS === 'true';

function hasLiveProvider(provider: string): boolean {
  return LIVE_PROVIDER_LIST
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(provider);
}

function shouldRunOpenRouterLiveTests(): boolean {
  return hasLiveProvider('openrouter') && OPENROUTER_API_KEY.length > 0;
}

function shouldRunOpenAiLiveTests(): boolean {
  return hasLiveProvider('openai') && OPENAI_API_KEY.length > 0;
}

function shouldRunAnthropicLiveTests(): boolean {
  return hasLiveProvider('anthropic') && ANTHROPIC_API_KEY.length > 0;
}

function shouldRunGoogleLiveTests(): boolean {
  return hasLiveProvider('google') && GOOGLE_API_KEY.length > 0;
}

function collectText(events: LlmEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type === 'text-delta') {
      text += event.textDelta;
    }
    if (event.type === 'error') {
      throw new Error(event.error);
    }
  }
  return text;
}

describe('llm-runtime live provider contract (OpenRouter)', () => {
  it('keeps stream and complete in parity for a deterministic prompt', async () => {
    if (!shouldRunOpenRouterLiveTests()) return;

    const runtime = createLlmRuntime();
    const token = `VC_LIVE_${Date.now().toString(36).toUpperCase()}`;
    const userPrompt = `Reply with exactly this token and nothing else: ${token}`;
    const input = {
      model: {
        provider: 'openrouter' as const,
        model: LIVE_MODEL,
        modality: 'llm' as const,
      },
      context: {
        messages: [{ role: 'user' as const, content: userPrompt }],
      },
      options: {
        reasoning: { enabled: false },
        maxOutputTokens: 64,
      },
    };

    const streamEvents: LlmEvent[] = [];
    for await (const event of runtime.stream(input)) {
      streamEvents.push(event);
    }
    const streamText = collectText(streamEvents);

    const completeResult = await runtime.complete(input);
    const completeText = completeResult.text;

    const streamFinish = streamEvents.some((event) => event.type === 'finish');
    const completeFinish = completeResult.events.some((event) => event.type === 'finish');

    expect(streamFinish).toBe(true);
    expect(completeFinish).toBe(true);
    expect(streamText.toUpperCase()).toContain(token);
    expect(completeText.toUpperCase()).toContain(token);
  });

  it('accepts reasoning config toggles when explicitly enabled', async () => {
    if (!shouldRunOpenRouterLiveTests() || !LIVE_REASONING_TESTS_ENABLED) return;

    const runtime = createLlmRuntime();
    const model = process.env.LLM_RUNTIME_LIVE_REASONING_MODEL ?? LIVE_MODEL;

    const disabledResult = await runtime.complete({
      model: {
        provider: 'openrouter',
        model,
        modality: 'llm',
      },
      context: {
        messages: [
          {
            role: 'user',
            content: 'Return the word READY.',
          },
        ],
      },
      options: {
        reasoning: {
          enabled: false,
        },
        maxOutputTokens: 64,
      },
    });

    const enabledResult = await runtime.complete({
      model: {
        provider: 'openrouter',
        model,
        modality: 'llm',
      },
      context: {
        messages: [
          {
            role: 'user',
            content: 'Return the word READY.',
          },
        ],
      },
      options: {
        reasoning: {
          enabled: true,
          effort: 'high',
        },
        maxOutputTokens: 64,
      },
    });

    expect(disabledResult.text.toUpperCase()).toContain('READY');
    expect(enabledResult.text.toUpperCase()).toContain('READY');
  });
});

describe('llm-runtime live provider contract (OpenAI)', () => {
  it('keeps stream and complete in parity for a deterministic prompt', async () => {
    if (!shouldRunOpenAiLiveTests()) return;

    const runtime = createLlmRuntime();
    const token = `VC_LIVE_${Date.now().toString(36).toUpperCase()}`;
    const userPrompt = `Reply with exactly this token and nothing else: ${token}`;
    const model = process.env.LLM_RUNTIME_LIVE_OPENAI_MODEL ?? 'gpt-4.1-mini';
    const input = {
      model: {
        provider: 'openai' as const,
        model,
        modality: 'llm' as const,
      },
      context: {
        messages: [{ role: 'user' as const, content: userPrompt }],
      },
      options: {
        apiKey: OPENAI_API_KEY,
        maxOutputTokens: 64,
      },
    };

    const streamEvents: LlmEvent[] = [];
    for await (const event of runtime.stream(input)) {
      streamEvents.push(event);
    }
    const streamText = collectText(streamEvents);

    const completeResult = await runtime.complete(input);
    const completeText = completeResult.text;

    expect(streamEvents.some((event) => event.type === 'finish')).toBe(true);
    expect(completeResult.events.some((event) => event.type === 'finish')).toBe(true);
    expect(streamText.toUpperCase()).toContain(token);
    expect(completeText.toUpperCase()).toContain(token);
  });
});

describe('llm-runtime live provider contract (Anthropic)', () => {
  it('keeps stream and complete in parity for a deterministic prompt', async () => {
    if (!shouldRunAnthropicLiveTests()) return;

    const runtime = createLlmRuntime();
    const token = `VC_LIVE_${Date.now().toString(36).toUpperCase()}`;
    const userPrompt = `Reply with exactly this token and nothing else: ${token}`;
    const model =
      process.env.LLM_RUNTIME_LIVE_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
    const input = {
      model: {
        provider: 'anthropic' as const,
        model,
        modality: 'llm' as const,
      },
      context: {
        messages: [{ role: 'user' as const, content: userPrompt }],
      },
      options: {
        apiKey: ANTHROPIC_API_KEY,
        maxOutputTokens: 64,
      },
    };

    const streamEvents: LlmEvent[] = [];
    for await (const event of runtime.stream(input)) {
      streamEvents.push(event);
    }
    const streamText = collectText(streamEvents);

    const completeResult = await runtime.complete(input);
    const completeText = completeResult.text;

    expect(streamEvents.some((event) => event.type === 'finish')).toBe(true);
    expect(completeResult.events.some((event) => event.type === 'finish')).toBe(true);
    expect(streamText.toUpperCase()).toContain(token);
    expect(completeText.toUpperCase()).toContain(token);
  });
});

describe('llm-runtime live provider contract (Google)', () => {
  it('keeps stream and complete in parity for a deterministic prompt', async () => {
    if (!shouldRunGoogleLiveTests()) return;

    const runtime = createLlmRuntime();
    const token = `VC_LIVE_${Date.now().toString(36).toUpperCase()}`;
    const userPrompt = `Reply with exactly this token and nothing else: ${token}`;
    const model =
      process.env.LLM_RUNTIME_LIVE_GOOGLE_MODEL ?? 'gemini-2.5-flash';
    const input = {
      model: {
        provider: 'google' as const,
        model,
        modality: 'llm' as const,
      },
      context: {
        messages: [{ role: 'user' as const, content: userPrompt }],
      },
      options: {
        apiKey: GOOGLE_API_KEY,
        maxOutputTokens: 64,
      },
    };

    const streamEvents: LlmEvent[] = [];
    for await (const event of runtime.stream(input)) {
      streamEvents.push(event);
    }
    const streamText = collectText(streamEvents);

    const completeResult = await runtime.complete(input);
    const completeText = completeResult.text;

    expect(streamEvents.some((event) => event.type === 'finish')).toBe(true);
    expect(completeResult.events.some((event) => event.type === 'finish')).toBe(true);
    expect(streamText.toUpperCase()).toContain(token);
    expect(completeText.toUpperCase()).toContain(token);
  });
});
