import { describe, expect, test } from 'bun:test';
import { WordCueTimelineBuilder } from '../src/runtime/word-cue-timeline.js';

describe('WordCueTimelineBuilder', () => {
  test('emits append updates for deltas and replace update for final', () => {
    const builder = new WordCueTimelineBuilder();

    const firstDelta = builder.ingestDelta({
      spokenText: 'Hello ',
      playbackMs: 120,
    });
    expect(firstDelta.update?.mode).toBe('append');
    expect(firstDelta.update?.cues.length).toBe(1);
    expect(firstDelta.timeline.length).toBe(1);

    const secondDelta = builder.ingestDelta({
      spokenText: 'Hello world ',
      playbackMs: 260,
    });
    expect(secondDelta.update?.mode).toBe('append');
    expect(secondDelta.update?.cues.length).toBe(1);
    expect(secondDelta.timeline.length).toBe(2);

    const final = builder.ingestFinal({
      spokenText: 'Hello world again',
      playbackMs: 420,
    });
    expect(final.update?.mode).toBe('replace');
    expect(final.timeline.length).toBe(3);
    expect(final.timeline.every((cue) => cue.timeBase === 'utterance')).toBe(true);
    expect(final.timeline.every((cue) => cue.source === 'synthetic')).toBe(true);
  });

  test('normalizes segment-relative provider timestamps into utterance-relative cues', () => {
    const builder = new WordCueTimelineBuilder();

    builder.ingestDelta({
      spokenText: 'Alpha ',
      playbackMs: 200,
      providerWordTimestamps: [{ word: 'Alpha', startMs: 0, endMs: 100 }],
      providerTimeBase: 'segment',
    });

    const second = builder.ingestDelta({
      spokenText: 'Alpha Beta ',
      playbackMs: 400,
      providerWordTimestamps: [{ word: 'Beta', startMs: 0, endMs: 120 }],
      providerTimeBase: 'segment',
    });

    expect(second.update?.mode).toBe('append');
    expect(second.timeline.map((cue) => cue.startMs)).toEqual([0, 200]);
    expect(second.timeline.map((cue) => cue.endMs)).toEqual([100, 320]);
    expect(second.timeline.every((cue) => cue.source === 'provider')).toBe(true);
    expect(second.timeline.every((cue) => cue.timeBase === 'utterance')).toBe(true);
  });

  test('keeps utterance-relative provider timestamps unshifted when base is explicit', () => {
    const builder = new WordCueTimelineBuilder();

    builder.ingestDelta({
      spokenText: 'One ',
      playbackMs: 150,
      providerWordTimestamps: [{ word: 'One', startMs: 0, endMs: 100 }],
      providerTimeBase: 'segment',
    });

    const second = builder.ingestDelta({
      spokenText: 'One Two ',
      playbackMs: 350,
      providerWordTimestamps: [{ word: 'Two', startMs: 180, endMs: 300 }],
      providerTimeBase: 'utterance',
    });

    expect(second.timeline.map((cue) => cue.startMs)).toEqual([0, 180]);
    expect(second.timeline.map((cue) => cue.endMs)).toEqual([100, 300]);
  });

  test('offsets synthetic cues by speechOnsetMs to skip TTS silence preamble', () => {
    const builder = new WordCueTimelineBuilder();

    // First delta arrives with speechOnsetMs indicating 80ms of initial silence.
    const first = builder.ingestDelta({
      spokenText: 'Hello world ',
      playbackMs: 200,
      speechOnsetMs: 80,
    });

    expect(first.update?.mode).toBe('append');
    expect(first.timeline.length).toBe(2);
    // Both words must start at or after the speech onset (80ms), never at 0.
    expect(first.timeline[0]!.startMs).toBeGreaterThanOrEqual(80);
    expect(first.timeline[1]!.startMs).toBeGreaterThanOrEqual(first.timeline[0]!.endMs);
    expect(first.timeline[1]!.endMs).toBeGreaterThanOrEqual(200);

    // Final rebuild also respects the latched speechOnsetMs.
    const final = builder.ingestFinal({
      spokenText: 'Hello world again',
      playbackMs: 400,
    });
    expect(final.timeline[0]!.startMs).toBeGreaterThanOrEqual(80);
  });

  test('speechOnsetMs=0 behaves the same as omitting it', () => {
    const builder = new WordCueTimelineBuilder();

    const result = builder.ingestDelta({
      spokenText: 'Test ',
      playbackMs: 100,
      speechOnsetMs: 0,
    });

    expect(result.timeline[0]!.startMs).toBe(0);
  });

  test('large batch with small playbackMs uses minimum per-word pace, not cramming', () => {
    const builder = new WordCueTimelineBuilder();

    // Simulates pre-audio buffer drain: 10 words arrive at once but only 50ms
    // of audio has been emitted.  Without min-pace, all words would end by 50ms
    // and highlight instantly.
    const result = builder.ingestDelta({
      spokenText: 'Was ist orange und läuft durch den Wald Eine Wanderine ',
      playbackMs: 50,
      speechOnsetMs: 30,
    });

    expect(result.timeline.length).toBe(10);

    // Words must NOT all end within 50ms — they should be spread out.
    const lastCue = result.timeline[result.timeline.length - 1]!;
    expect(lastCue.endMs).toBeGreaterThan(500);

    // At 200ms of playback, only a fraction of words should be "past"
    // (endMs <= 200).  With 10 words at 150ms/word min, roughly 1 word.
    const wordsHighlightedAt200 = result.timeline.filter((c) => c.endMs <= 200).length;
    expect(wordsHighlightedAt200).toBeLessThanOrEqual(3);
  });

  test('spokenFinal rebuilds with actual audio duration, not minimum pace', () => {
    const builder = new WordCueTimelineBuilder();

    // Stream a batch with min-pace
    builder.ingestDelta({
      spokenText: 'Hello world again ',
      playbackMs: 50,
    });

    // Final comes with actual total audio duration
    const final = builder.ingestFinal({
      spokenText: 'Hello world again',
      playbackMs: 600,
    });

    expect(final.update?.mode).toBe('replace');
    expect(final.timeline.length).toBe(3);
    // Final uses actual playbackMs (600ms), not the over-estimated min-pace.
    // Last word should end at or near 600ms, not at 450ms (3 * 150).
    expect(final.timeline[2]!.endMs).toBeLessThanOrEqual(650);
    expect(final.timeline[2]!.endMs).toBeGreaterThanOrEqual(600);
  });

  test('punctuation pause gives extra time to words ending with punctuation', () => {
    const builder = new WordCueTimelineBuilder({ punctuationPauseMs: 120 });

    const final = builder.ingestFinal({
      spokenText: 'Hello, world again.',
      playbackMs: 600,
    });

    expect(final.timeline.length).toBe(3);
    // "Hello," and "again." have punctuation — they should get wider slots
    // than the unpunctuated "world".
    const helloDuration = final.timeline[0]!.endMs - final.timeline[0]!.startMs;
    const worldDuration = final.timeline[1]!.endMs - final.timeline[1]!.startMs;
    const againDuration = final.timeline[2]!.endMs - final.timeline[2]!.startMs;
    expect(helloDuration).toBeGreaterThan(worldDuration);
    expect(againDuration).toBeGreaterThan(worldDuration);
    // Punctuation words should each get ~120ms more than the base word.
    expect(helloDuration - worldDuration).toBeCloseTo(120, -1);
  });

  test('punctuationPauseMs=0 distributes words evenly (same as default)', () => {
    const withPause = new WordCueTimelineBuilder({ punctuationPauseMs: 0 });
    const withoutPause = new WordCueTimelineBuilder();

    const textWithPunct = 'Hello, world.';
    const input = { spokenText: textWithPunct, playbackMs: 400 };
    const a = withPause.ingestFinal(input);
    const b = withoutPause.ingestFinal(input);

    expect(a.timeline.map((c) => c.endMs)).toEqual(b.timeline.map((c) => c.endMs));
  });

  test('preferProviderTimestamps=false forces synthetic even with provider timestamps', () => {
    const builder = new WordCueTimelineBuilder({ preferProviderTimestamps: false });

    const result = builder.ingestDelta({
      spokenText: 'Alpha Beta ',
      playbackMs: 400,
      providerWordTimestamps: [
        { word: 'Alpha', startMs: 0, endMs: 100 },
        { word: 'Beta', startMs: 120, endMs: 250 },
      ],
      providerTimeBase: 'utterance',
    });

    // Provider timestamps should be ignored — all cues must be synthetic.
    expect(result.timeline.every((cue) => cue.source === 'synthetic')).toBe(true);
    expect(result.timeline.length).toBe(2);
  });

  test('preferProviderTimestamps=false also applies to ingestFinal', () => {
    const builder = new WordCueTimelineBuilder({ preferProviderTimestamps: false });

    const result = builder.ingestFinal({
      spokenText: 'One Two',
      playbackMs: 300,
      providerWordTimestamps: [
        { word: 'One', startMs: 0, endMs: 100 },
        { word: 'Two', startMs: 120, endMs: 250 },
      ],
      providerTimeBase: 'utterance',
    });

    expect(result.timeline.every((cue) => cue.source === 'synthetic')).toBe(true);
  });
});
