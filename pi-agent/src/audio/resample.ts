/**
 * Audio Resampling - Convert between sample rates
 *
 * Uses linear interpolation for simple resampling.
 * Converts 16kHz (Jabra device) ↔ 24kHz (Realtime API)
 */

/**
 * Resample PCM16 audio data from one sample rate to another.
 * @param audioData PCM16 audio as Buffer
 * @param fromRate Source sample rate
 * @param toRate Target sample rate
 * @returns Resampled PCM16 audio as Buffer
 */
export function resampleAudio(audioData: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) {
    return audioData;
  }

  // Convert Buffer to Int16Array
  const numSamples = audioData.length / 2;
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = audioData.readInt16LE(i * 2);
  }

  // Calculate new length
  const newLength = Math.floor(numSamples * toRate / fromRate);

  // Linear interpolation resampling
  const resampled = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * fromRate / toRate;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, numSamples - 1);
    const fraction = srcIndex - srcIndexFloor;

    // Linear interpolation
    resampled[i] = samples[srcIndexFloor]! * (1 - fraction) + samples[srcIndexCeil]! * fraction;
  }

  // Convert back to Buffer with Int16
  const result = Buffer.alloc(newLength * 2);
  for (let i = 0; i < newLength; i++) {
    // Clamp to Int16 range
    const value = Math.max(-32768, Math.min(32767, Math.round(resampled[i]!)));
    result.writeInt16LE(value, i * 2);
  }

  return result;
}

// Common sample rates
export const DEVICE_SAMPLE_RATE = 16000;  // Jabra Speak2 55 MS
export const API_SAMPLE_RATE = 24000;      // OpenAI Realtime API

/**
 * Resample from device rate (16kHz) to API rate (24kHz)
 */
export function resampleForApi(audioData: Buffer): Buffer {
  return resampleAudio(audioData, DEVICE_SAMPLE_RATE, API_SAMPLE_RATE);
}

/**
 * Resample from API rate (24kHz) to device rate (16kHz)
 */
export function resampleForDevice(audioData: Buffer): Buffer {
  return resampleAudio(audioData, API_SAMPLE_RATE, DEVICE_SAMPLE_RATE);
}
