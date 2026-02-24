import { describe, expect, test } from 'bun:test';
import { DecomposedSpokenWordBuffer } from '../src/adapters/decomposed-spoken-buffer.js';

describe('DecomposedSpokenWordBuffer', () => {
  test('preserves token order when audio starts after text streaming', () => {
    const buffer = new DecomposedSpokenWordBuffer();
    const emitted: string[] = [];
    const deltas = [
      ' Was',
      ' ist',
      ' orange',
      ' und',
      ' läuft',
      ' durch',
      ' den',
      ' Wald',
      '?',
      ' Eine',
      ' Wander',
      'ine',
      '.',
    ];

    for (const delta of deltas) {
      const chunk = buffer.ingestDelta(delta);
      if (chunk) {
        emitted.push(chunk);
      }
    }

    expect(emitted).toEqual([]);

    const buffered = buffer.markAudioStarted();
    if (buffered) {
      emitted.push(buffered);
    }
    const trailing = buffer.flushRemainder();
    if (trailing) {
      emitted.push(trailing);
    }

    expect(emitted.join('')).toBe(' Was ist orange und läuft durch den Wald? Eine Wanderine.');
  });

  test('emits complete chunks after audio starts and flushes trailing partial word', () => {
    const buffer = new DecomposedSpokenWordBuffer();

    expect(buffer.markAudioStarted()).toBeNull();
    expect(buffer.ingestDelta('Hello ')).toBe('Hello ');
    expect(buffer.ingestDelta('world')).toBeNull();
    expect(buffer.flushRemainder()).toBe('world');
  });

  test('drains pre-audio chunks exactly once when audio starts', () => {
    const buffer = new DecomposedSpokenWordBuffer();

    expect(buffer.ingestDelta('Hello world ')).toBeNull();
    expect(buffer.markAudioStarted()).toBe('Hello world ');
    expect(buffer.markAudioStarted()).toBeNull();
  });
});
