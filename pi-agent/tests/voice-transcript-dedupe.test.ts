import { describe, expect, test } from 'bun:test';
import { shouldEmitAssistantTranscript } from '../src/agent/voice-agent.js';

describe('assistant transcript dedupe', () => {
  test('skips final transcript when the same item already streamed deltas', () => {
    const emitted = shouldEmitAssistantTranscript({
      itemId: 'assistant-42',
      assistantDeltaItemIds: new Set(['assistant-42']),
      assistantDeltaSeenThisTurn: true,
    });
    expect(emitted).toBe(false);
  });

  test('emits final transcript when no deltas were seen for that item', () => {
    const emitted = shouldEmitAssistantTranscript({
      itemId: 'assistant-43',
      assistantDeltaItemIds: new Set(['assistant-99']),
      assistantDeltaSeenThisTurn: true,
    });
    expect(emitted).toBe(true);
  });

  test('skips final transcript without itemId when turn already streamed deltas', () => {
    const emitted = shouldEmitAssistantTranscript({
      assistantDeltaItemIds: new Set(),
      assistantDeltaSeenThisTurn: true,
    });
    expect(emitted).toBe(false);
  });

  test('emits final transcript without itemId when turn had no deltas', () => {
    const emitted = shouldEmitAssistantTranscript({
      assistantDeltaItemIds: new Set(),
      assistantDeltaSeenThisTurn: false,
    });
    expect(emitted).toBe(true);
  });
});
