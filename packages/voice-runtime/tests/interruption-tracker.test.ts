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

  test('interpolates within explicit segments when playback is behind emitted audio', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-5');
    tracker.trackAssistantTranscript('One two three four five six', 'assistant-5');
    tracker.trackAssistantSpokenDelta('One two ', 'assistant-5', {
      spokenChars: 8,
      spokenWords: 2,
      playbackMs: 1000,
      precision: 'segment',
    });
    tracker.trackAssistantSpokenDelta('three four ', 'assistant-5', {
      spokenChars: 19,
      spokenWords: 4,
      playbackMs: 2000,
      precision: 'segment',
    });
    tracker.trackAssistantSpokenDelta('five six', 'assistant-5', {
      spokenChars: 27,
      spokenWords: 6,
      playbackMs: 3000,
      precision: 'segment',
    });

    const context = tracker.resolve(1500);
    expect(context).not.toBeNull();
    expect(context?.spokenText).toBe('One two three');
    expect(context?.spokenWordCount).toBe(3);
    expect(context?.precision).toBe('segment');
    expect(context?.spans?.length).toBe(3);
  });

  test('keeps full explicit spoken text when playback position is not provided', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-6');
    tracker.trackAssistantTranscript('Hello world from runtime', 'assistant-6');
    tracker.trackAssistantSpokenFinal('Hello world from runtime', 'assistant-6', {
      spokenChars: 24,
      spokenWords: 4,
      playbackMs: 400,
      precision: 'segment',
    });

    const context = tracker.resolve();
    expect(context).not.toBeNull();
    expect(context?.spokenText).toBe('Hello world from runtime');
    expect(context?.spokenWordCount).toBe(4);
  });

  test('interpolates within a single explicit segment (continuous flush mode)', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-6b');
    tracker.trackAssistantTranscript('The quick brown fox', 'assistant-6b');
    tracker.trackAssistantSpokenFinal('The quick brown fox', 'assistant-6b', {
      spokenChars: 19,
      spokenWords: 4,
      playbackMs: 400,
      precision: 'segment',
    });

    const context = tracker.resolve(200);
    expect(context).not.toBeNull();
    expect(context?.spokenText).toBe('The quick');
    expect(context?.spokenWordCount).toBe(2);
    expect(context?.precision).toBe('segment');
  });

  test('prefers provider word timeline over segment interpolation when available', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-7');
    tracker.trackAssistantTranscript('Hello world again', 'assistant-7');
    tracker.trackAssistantSpokenFinal('Hello world again', 'assistant-7', {
      spokenChars: 17,
      spokenWords: 3,
      playbackMs: 300,
      precision: 'segment',
      wordTimestamps: [
        { word: 'Hello', startMs: 0, endMs: 40 },
        { word: 'world', startMs: 40, endMs: 80 },
        { word: 'again', startMs: 220, endMs: 300 },
      ],
    });

    const context = tracker.resolve(90);
    expect(context).not.toBeNull();
    expect(context?.spokenText).toBe('Hello world');
    expect(context?.spokenWordCount).toBe(2);
    expect(context?.precision).toBe('provider-word-timestamps');
    expect(context?.spans?.every((span) => span.type === 'word')).toBe(true);
  });

  test('respects explicit utterance-relative time base for deltas', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-8');
    tracker.trackAssistantTranscript('Alpha Beta Gamma', 'assistant-8');
    // First delta: segment-relative (starts at 0), offset 0 → no shift
    tracker.trackAssistantSpokenDelta('Alpha ', 'assistant-8', {
      spokenChars: 6,
      spokenWords: 1,
      playbackMs: 200,
      precision: 'provider-word-timestamps',
      wordTimestampsTimeBase: 'segment',
      wordTimestamps: [
        { word: 'Alpha', startMs: 0, endMs: 100 },
      ],
    });
    // Second delta: utterance-relative (starts near the offset of 200ms)
    // Should NOT be shifted by another 200ms.
    tracker.trackAssistantSpokenDelta('Beta ', 'assistant-8', {
      spokenChars: 11,
      spokenWords: 2,
      playbackMs: 400,
      precision: 'provider-word-timestamps',
      wordTimestampsTimeBase: 'utterance',
      wordTimestamps: [
        { word: 'Beta', startMs: 200, endMs: 350 },
      ],
    });

    const context = tracker.resolve(250);
    expect(context).not.toBeNull();
    expect(context?.spokenText).toBe('Alpha Beta');
    expect(context?.spokenWordCount).toBe(2);
    expect(context?.precision).toBe('provider-word-timestamps');
  });

  test('spokenFinal replaces partial delta timestamps with corrected data', () => {
    const tracker = new InterruptionTracker();

    tracker.beginAssistantItem('assistant-9');
    tracker.trackAssistantTranscript('One Two Three', 'assistant-9');
    // Delta with partial timestamps
    tracker.trackAssistantSpokenDelta('One Two ', 'assistant-9', {
      spokenChars: 8,
      spokenWords: 2,
      playbackMs: 200,
      precision: 'provider-word-timestamps',
      wordTimestamps: [
        { word: 'One', startMs: 0, endMs: 80 },
        { word: 'Two', startMs: 80, endMs: 160 },
      ],
    });
    // Final with corrected complete timestamps — should replace delta data
    tracker.trackAssistantSpokenFinal('One Two Three', 'assistant-9', {
      spokenChars: 13,
      spokenWords: 3,
      playbackMs: 500,
      precision: 'provider-word-timestamps',
      wordTimestamps: [
        { word: 'One', startMs: 0, endMs: 100 },
        { word: 'Two', startMs: 100, endMs: 250 },
        { word: 'Three', startMs: 250, endMs: 500 },
      ],
    });

    // The corrected timestamps should be used, not the delta ones
    const context = tracker.resolve(200);
    expect(context).not.toBeNull();
    expect(context?.spokenText).toBe('One Two');
    expect(context?.spokenWordCount).toBe(2);
    // At 200ms, "Two" (endMs: 250) hasn't started yet with corrected data
    // "One" has startMs < 200 and "Two" has startMs: 100 < 200
    expect(context?.precision).toBe('provider-word-timestamps');
  });
});
