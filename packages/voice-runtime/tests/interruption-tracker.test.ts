import { describe, expect, test } from 'bun:test';
import { InterruptionTracker } from '../src/runtime/interruption-tracker.js';
import type { AudioFrame } from '../src/types.js';

function audioFrame(durationMs: number, sampleRate = 24000): AudioFrame {
  const sampleCount = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  return {
    data: new ArrayBuffer(sampleCount * 2),
    sampleRate,
    format: 'pcm16',
  };
}

describe('InterruptionTracker', () => {
  test('resolves spoken text from text+audio timeline', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-1');
    tracker.trackAssistantDelta('Hello ', 'assistant-1');
    tracker.trackAssistantAudio(audioFrame(100));
    tracker.trackAssistantDelta('world', 'assistant-1');
    tracker.trackAssistantAudio(audioFrame(100));
    tracker.trackAssistantTranscript('Hello world', 'assistant-1');

    const context = tracker.resolve(100);
    expect(context).not.toBeNull();
    expect(context?.itemId).toBe('assistant-1');
    expect(context?.fullText).toBe('Hello world');
    expect(context?.spokenText).toBe('Hello ');
    expect(context?.truncated).toBe(true);
  });

  test('uses ratio fallback when no text/audio segments are aligned', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-2');
    tracker.trackAssistantTranscript('The weather today is sunny', 'assistant-2');
    tracker.trackAssistantAudio(audioFrame(1000));

    const context = tracker.resolve(500);
    expect(context).not.toBeNull();
    expect(context?.itemId).toBe('assistant-2');
    expect(context?.fullText).toBe('The weather today is sunny');
    expect((context?.spokenText.length ?? 0) > 0).toBe(true);
    expect(context?.truncated).toBe(true);
  });

  test('prefers explicit spoken deltas when provided by adapter', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-3');
    tracker.trackAssistantTranscript('Hello world', 'assistant-3');
    tracker.trackAssistantSpokenDelta('Hello ', 'assistant-3', {
      spokenChars: 6,
      spokenWords: 1,
      playbackMs: 120,
      precision: 'segment',
    });

    const context = tracker.resolve(120);
    expect(context).not.toBeNull();
    expect(context?.itemId).toBe('assistant-3');
    expect(context?.fullText).toBe('Hello world');
    expect(context?.spokenText).toBe('Hello ');
    expect(context?.precision).toBe('segment');
    expect(context?.spokenWordCount).toBe(1);
    expect(context?.spokenWordIndex).toBe(0);
    expect(context?.spans?.length).toBe(1);
  });

  test('uses explicit spoken progress char cursor without spoken delta', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-4');
    tracker.trackAssistantTranscript('The weather today is sunny', 'assistant-4');
    tracker.trackAssistantSpokenProgress('assistant-4', {
      spokenChars: 11,
      spokenWords: 2,
      playbackMs: 500,
      precision: 'provider-word-timestamps',
    });

    const context = tracker.resolve(500);
    expect(context).not.toBeNull();
    expect(context?.itemId).toBe('assistant-4');
    expect(context?.spokenText).toBe('The weather');
    expect(context?.spokenWordCount).toBe(2);
    expect(context?.precision).toBe('provider-word-timestamps');
  });
});
