import { describe, expect, test } from 'bun:test';
import { resamplePcm16Mono } from '../src/voice/audio-utils.js';

function pcm(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, idx) => out.writeInt16LE(value, idx * 2));
  return out;
}

describe('resamplePcm16Mono', () => {
  test('returns unchanged buffer for identical sample rates', () => {
    const input = pcm(0, 1000, -1000, 500);
    const output = resamplePcm16Mono(input, 24000, 24000);
    expect(output.equals(input)).toBe(true);
  });

  test('upsamples 24k to 48k', () => {
    const input = pcm(-3000, 0, 3000, 6000);
    const output = resamplePcm16Mono(input, 24000, 48000);
    expect(output.length).toBe(input.length * 2);
  });
});
