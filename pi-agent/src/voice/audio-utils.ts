export function arrayBufferToBuffer(audio: ArrayBuffer): Buffer {
  return Buffer.from(audio);
}

/**
 * Resample PCM16 mono audio using linear interpolation.
 * Keeps sample format (signed 16-bit little-endian) intact.
 */
export function resamplePcm16Mono(
  input: ArrayBuffer | Buffer,
  fromRate: number,
  toRate: number
): Buffer {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (fromRate <= 0 || toRate <= 0) return source;
  if (fromRate === toRate) return source;

  const sourceSamples = Math.floor(source.length / 2);
  if (sourceSamples <= 1) {
    return source.subarray(0, sourceSamples * 2);
  }

  const sourceView = new Int16Array(source.buffer, source.byteOffset, sourceSamples);
  const ratio = toRate / fromRate;
  const targetSamples = Math.max(1, Math.floor(sourceSamples * ratio));
  const out = Buffer.allocUnsafe(targetSamples * 2);

  for (let i = 0; i < targetSamples; i++) {
    const srcPos = i / ratio;
    const low = Math.floor(srcPos);
    const high = Math.min(low + 1, sourceSamples - 1);
    const frac = srcPos - low;
    const value = sourceView[low]! * (1 - frac) + sourceView[high]! * frac;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(value)));
    out.writeInt16LE(clamped, i * 2);
  }

  return out;
}

export function computeRmsPcm16(audio: ArrayBuffer): number {
  const buffer = arrayBufferToBuffer(audio);
  if (buffer.length < 2) return 0;
  const samples = Math.floor(buffer.length / 2);
  let sumSquares = 0;
  for (let i = 0; i < samples; i++) {
    const value = buffer.readInt16LE(i * 2) / 32768;
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / samples);
}

export function encodeWavPcm16Mono(
  pcm: Buffer,
  sampleRate: number
): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const headerSize = 44;
  const wav = Buffer.alloc(headerSize + dataSize);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcm.copy(wav, 44);

  return wav;
}

export function chunkBuffer(buffer: Buffer, chunkSize: number): Buffer[] {
  if (chunkSize <= 0) return [buffer];
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
  }
  return chunks;
}
