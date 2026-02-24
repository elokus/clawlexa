import { describe, expect, test } from 'bun:test';
import { WordTimeline } from '../src/runtime/word-timeline.js';

describe('WordTimeline', () => {
  test('accumulates words across segments with absolute offsets', () => {
    const timeline = new WordTimeline();

    timeline.beginSegment(0);
    timeline.addWords([
      { word: 'Hello', startMs: 0, endMs: 80 },
      { word: 'world', startMs: 90, endMs: 160 },
    ]);
    timeline.beginSegment(200);
    timeline.addWords([
      { word: 'again', startMs: 0, endMs: 80 },
      { word: 'friend', startMs: 90, endMs: 160 },
    ]);

    const spoken = timeline.getSpokenTextAt(250);
    expect(spoken.text).toBe('Hello world again');
    expect(spoken.wordCount).toBe(3);
    expect(spoken.wordIndex).toBe(2);

    const spans = timeline.getWordSpans();
    expect(spans.length).toBe(4);
    expect(spans.map((span) => span.startMs)).toEqual([0, 90, 200, 290]);
    expect(spans.every((span) => span.type === 'word')).toBe(true);
  });

  test('resolves by last word with startMs strictly before playback', () => {
    const timeline = new WordTimeline();
    timeline.beginSegment(0);
    timeline.addWords([
      { word: 'first', startMs: 0, endMs: 50 },
      { word: 'second', startMs: 100, endMs: 150 },
      { word: 'third', startMs: 200, endMs: 250 },
    ]);

    expect(timeline.getSpokenTextAt(0)).toEqual({ text: '', wordCount: 0 });
    expect(timeline.getSpokenTextAt(100)).toEqual({
      text: 'first',
      wordCount: 1,
      wordIndex: 0,
    });
    expect(timeline.getSpokenTextAt(199)).toEqual({
      text: 'first second',
      wordCount: 2,
      wordIndex: 1,
    });
    expect(timeline.getSpokenTextAt(201)).toEqual({
      text: 'first second third',
      wordCount: 3,
      wordIndex: 2,
    });
  });

  test('deduplicates repeated word timestamps from repeated events', () => {
    const timeline = new WordTimeline();
    timeline.beginSegment(0);
    timeline.addWords([
      { word: 'repeat', startMs: 0, endMs: 40 },
      { word: 'me', startMs: 40, endMs: 80 },
    ]);
    timeline.beginSegment(0);
    timeline.addWords([
      { word: 'repeat', startMs: 0, endMs: 40 },
      { word: 'me', startMs: 40, endMs: 80 },
    ]);

    const spans = timeline.getWordSpans();
    expect(spans.map((span) => span.text)).toEqual(['repeat', 'me']);
    expect(spans.length).toBe(2);
  });

  test('reset clears the timeline', () => {
    const timeline = new WordTimeline();
    timeline.beginSegment(0);
    timeline.addWords([{ word: 'Hello', startMs: 0, endMs: 100 }]);
    expect(timeline.hasWords()).toBe(true);
    timeline.reset();
    expect(timeline.hasWords()).toBe(false);
    expect(timeline.length).toBe(0);
  });
});
