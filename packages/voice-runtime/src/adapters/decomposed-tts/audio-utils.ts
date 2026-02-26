export const AUDIO_SAMPLE_RATE = 24000;
export const PCM_BYTES_PER_100MS = (AUDIO_SAMPLE_RATE * 2) / 10;

export function chunkArrayBuffer(input: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
  const bytes = new Uint8Array(input);
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.byteLength);
    chunks.push(bytes.slice(offset, end).buffer);
  }
  return chunks;
}

export async function streamPcmResponse(
  response: Response,
  emitChunk: (chunk: ArrayBuffer) => Promise<boolean>
): Promise<void> {
  if (!response.body) {
    const audio = await response.arrayBuffer();
    const chunks = chunkArrayBuffer(audio, PCM_BYTES_PER_100MS);
    for (const chunk of chunks) {
      const keepGoing = await emitChunk(chunk);
      if (!keepGoing) {
        break;
      }
    }
    return;
  }

  const reader = response.body.getReader();
  let pending = new Uint8Array(0);

  const appendPending = (value: Uint8Array): void => {
    if (value.byteLength === 0) return;
    if (pending.byteLength === 0) {
      pending = value.slice();
      return;
    }
    const merged = new Uint8Array(pending.byteLength + value.byteLength);
    merged.set(pending, 0);
    merged.set(value, pending.byteLength);
    pending = merged;
  };

  const flushPending = async (force: boolean): Promise<boolean> => {
    while (pending.byteLength >= PCM_BYTES_PER_100MS || (force && pending.byteLength > 0)) {
      const chunkSize =
        pending.byteLength >= PCM_BYTES_PER_100MS
          ? PCM_BYTES_PER_100MS
          : pending.byteLength;
      const chunk = pending.slice(0, chunkSize);
      pending = pending.slice(chunkSize);
      const keepGoing = await emitChunk(chunk.buffer);
      if (!keepGoing) {
        return false;
      }
    }
    return true;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      appendPending(value);
      const keepGoing = await flushPending(false);
      if (!keepGoing) {
        await reader.cancel();
        break;
      }
    }
    await flushPending(true);
  } finally {
    reader.releaseLock();
  }
}

export function decodeBase64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = Buffer.from(value, 'base64');
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

export function stripWavHeader(audio: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(audio);
  if (bytes.byteLength < 44) {
    return audio;
  }

  const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const wave = String.fromCharCode(
    bytes[8] ?? 0,
    bytes[9] ?? 0,
    bytes[10] ?? 0,
    bytes[11] ?? 0
  );
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return audio;
  }

  const dataOffset = findWavDataOffset(bytes);
  if (dataOffset < 0 || dataOffset >= bytes.byteLength) {
    return audio;
  }

  return bytes.slice(dataOffset).buffer;
}

function findWavDataOffset(bytes: Uint8Array): number {
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0
    );
    const sizeView = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4);
    const chunkSize = sizeView.getUint32(0, true);
    if (chunkId === 'data') {
      return offset + 8;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset += 8 + paddedSize;
  }

  return -1;
}
