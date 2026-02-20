import type { AudioFrame } from '../types.js';

/**
 * Lightweight PCM16 mono resampler for runtime boundary adaptation.
 * Uses linear interpolation and preserves mono PCM16 framing.
 */
export function resamplePcm16Mono(frame: AudioFrame, targetSampleRate: number): AudioFrame {
  if (frame.format !== 'pcm16') {
    throw new Error(`Unsupported audio format: ${frame.format}`);
  }
  if (frame.sampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error(
      `Invalid sample rate conversion: ${frame.sampleRate} -> ${targetSampleRate}`
    );
  }
  if (frame.sampleRate === targetSampleRate) {
    return frame;
  }
  if (frame.data.byteLength % 2 !== 0) {
    throw new Error(`PCM16 payload must be 2-byte aligned, got ${frame.data.byteLength} bytes`);
  }

  const source = new Int16Array(frame.data);
  if (source.length === 0) {
    return { ...frame, sampleRate: targetSampleRate };
  }

  const ratio = frame.sampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.round(source.length / ratio));
  const target = new Int16Array(targetLength);

  if (targetLength === 1) {
    target[0] = source[0] ?? 0;
  } else {
    for (let i = 0; i < targetLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const fractional = position - index;
      const nextIndex = Math.min(index + 1, source.length - 1);
      const s1 = source[index] ?? source[source.length - 1] ?? 0;
      const s2 = source[nextIndex] ?? s1;
      target[i] = Math.round(s1 + (s2 - s1) * fractional);
    }
  }

  return {
    data: target.buffer,
    sampleRate: targetSampleRate,
    format: 'pcm16',
  };
}
