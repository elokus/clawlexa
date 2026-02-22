import { describe, expect, it } from 'bun:test';
import type { LlmEvent, LlmRuntimeRequest } from '../src/types.js';
import { createLlmRuntime } from '../src/runtime.js';
import {
  createOpenRouterEventMapperState,
  mapOpenRouterUiMessageToEvents,
  type OpenRouterUiMessage,
} from '../src/adapters/openrouter-event-mapper.js';

interface ReplayFixture {
  model: LlmRuntimeRequest<'openrouter'>['model'];
  context: LlmRuntimeRequest<'openrouter'>['context'];
  uiMessages: OpenRouterUiMessage[];
  expectedEvents: LlmEvent[];
  expectedText: string;
}

function collectText(events: LlmEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type === 'text-delta') {
      text += event.textDelta;
    }
  }
  return text;
}

function replayEventsFromUiMessages(uiMessages: OpenRouterUiMessage[]): LlmEvent[] {
  const state = createOpenRouterEventMapperState();
  const events: LlmEvent[] = [{ type: 'start' }];

  for (const uiMessage of uiMessages) {
    events.push(...mapOpenRouterUiMessageToEvents(uiMessage, state));
  }

  events.push({ type: 'finish', finishReason: 'stop' });
  return events;
}

async function loadFixture(name: string): Promise<ReplayFixture> {
  const fixturePath = new URL(`./contracts/fixtures/${name}`, import.meta.url);
  return (await Bun.file(fixturePath).json()) as ReplayFixture;
}

describe('llm-runtime provider contract replay', () => {
  it('replays OpenRouter UI stream fixture to normalized events', async () => {
    const fixture = await loadFixture('openrouter-contract.basic.json');
    const replayedEvents = replayEventsFromUiMessages(fixture.uiMessages);

    expect(replayedEvents).toEqual(fixture.expectedEvents);
    expect(collectText(replayedEvents)).toBe(fixture.expectedText);
  });

  it('keeps stream and complete parity through createLlmRuntime', async () => {
    const fixture = await loadFixture('openrouter-contract.basic.json');
    const replayedEvents = replayEventsFromUiMessages(fixture.uiMessages);

    const runtime = createLlmRuntime({
      openrouter: {
        async *stream() {
          for (const event of replayedEvents) {
            yield event;
          }
        },
        async complete() {
          return {
            text: collectText(replayedEvents),
            events: replayedEvents,
          };
        },
      },
    });

    const streamedEvents: LlmEvent[] = [];
    for await (const event of runtime.stream({
      model: fixture.model,
      context: fixture.context,
    })) {
      streamedEvents.push(event);
    }

    const completeResult = await runtime.complete({
      model: fixture.model,
      context: fixture.context,
    });

    expect(streamedEvents).toEqual(fixture.expectedEvents);
    expect(completeResult.events).toEqual(fixture.expectedEvents);
    expect(completeResult.text).toBe(fixture.expectedText);
  });

  it('does not replay prior text when uiMessage snapshots are cumulative', () => {
    const uiMessages: OpenRouterUiMessage[] = [
      {
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'Alles klar, einen Moment.' },
        ],
      },
      {
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'Alles klar, einen Moment.' },
          { type: 'text', text: 'Be' },
        ],
      },
      {
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'Alles klar, einen Moment.Beide' },
        ],
      },
      {
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'Alles klar, einen Moment.Beide Stehlampen' },
        ],
      },
      {
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'Alles klar, einen Moment.Beide Stehlampen sind jetzt an.' },
        ],
      },
    ];

    const replayedEvents = replayEventsFromUiMessages(uiMessages);
    const text = collectText(replayedEvents);
    const startSteps = replayedEvents.filter((event) => event.type === 'start-step');

    expect(text).toBe('Alles klar, einen Moment.Beide Stehlampen sind jetzt an.');
    expect(text).not.toContain('Alles klar, einen Moment.BeAlles klar, einen Moment.');
    expect(startSteps).toHaveLength(1);
  });
});
