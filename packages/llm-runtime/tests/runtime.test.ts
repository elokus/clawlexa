import { describe, expect, it } from 'bun:test';
import { createLlmRuntime } from '../src/runtime.js';
import type { LlmEvent } from '../src/types.js';

describe('llm-runtime', () => {
  it('returns an error event for unsupported provider', async () => {
    const runtime = createLlmRuntime();
    const events = [] as Array<{ type: string }>;

    for await (const event of runtime.stream({
      model: {
        provider: 'unsupported-provider',
        model: 'fake',
        modality: 'llm',
      },
      context: {
        messages: [{ role: 'user', content: 'hello' }],
      },
    })) {
      events.push(event as { type: string });
    }

    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
  });

  it('routes openai provider calls to the configured adapter', async () => {
    const streamed: LlmEvent[] = [
      { type: 'start' },
      { type: 'text-delta', textDelta: 'ok' },
      { type: 'finish', finishReason: 'stop' },
    ];

    const runtime = createLlmRuntime({
      openai: {
        async *stream() {
          for (const event of streamed) {
            yield event;
          }
        },
        async complete() {
          return {
            text: 'ok',
            events: streamed,
          };
        },
      },
    });

    const streamEvents: LlmEvent[] = [];
    for await (const event of runtime.stream({
      model: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        modality: 'llm',
      },
      context: {
        messages: [{ role: 'user', content: 'ping' }],
      },
    })) {
      streamEvents.push(event);
    }

    const completion = await runtime.complete({
      model: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        modality: 'llm',
      },
      context: {
        messages: [{ role: 'user', content: 'ping' }],
      },
    });

    expect(streamEvents).toEqual(streamed);
    expect(completion.text).toBe('ok');
    expect(completion.events).toEqual(streamed);
  });

  it('routes anthropic provider calls to the configured adapter', async () => {
    const streamed: LlmEvent[] = [
      { type: 'start' },
      { type: 'text-delta', textDelta: 'claude-ok' },
      { type: 'finish', finishReason: 'stop' },
    ];

    const runtime = createLlmRuntime({
      anthropic: {
        async *stream() {
          for (const event of streamed) {
            yield event;
          }
        },
        async complete() {
          return {
            text: 'claude-ok',
            events: streamed,
          };
        },
      },
    });

    const completion = await runtime.complete({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        modality: 'llm',
      },
      context: {
        messages: [{ role: 'user', content: 'ping' }],
      },
    });

    expect(completion.text).toBe('claude-ok');
    expect(completion.events).toEqual(streamed);
  });

  it('routes google provider calls to the configured adapter', async () => {
    const streamed: LlmEvent[] = [
      { type: 'start' },
      { type: 'text-delta', textDelta: 'gemini-ok' },
      { type: 'finish', finishReason: 'stop' },
    ];

    const runtime = createLlmRuntime({
      google: {
        async *stream() {
          for (const event of streamed) {
            yield event;
          }
        },
        async complete() {
          return {
            text: 'gemini-ok',
            events: streamed,
          };
        },
      },
    });

    const completion = await runtime.complete({
      model: {
        provider: 'google',
        model: 'gemini-2.5-flash',
        modality: 'llm',
      },
      context: {
        messages: [{ role: 'user', content: 'ping' }],
      },
    });

    expect(completion.text).toBe('gemini-ok');
    expect(completion.events).toEqual(streamed);
  });
});
