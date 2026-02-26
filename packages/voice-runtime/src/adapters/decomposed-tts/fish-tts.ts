import { decode, encode } from '@msgpack/msgpack';
import WebSocket, { type RawData } from 'ws';
import { chunkArrayBuffer, PCM_BYTES_PER_100MS } from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

const FISH_SAMPLE_RATE = 24_000;
const FISH_MAX_TEXT_CHUNK_CHARS = 180;
const FISH_MIN_SPLIT_INDEX = 60;

export async function synthesizeFishSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  if (!context.fishAudioApiKey) {
    throw new Error('Fish Audio API key is missing for decomposed TTS provider fish');
  }

  if (signal.aborted) {
    throw createAbortError();
  }

  const textChunks = chunkFishText(text);
  if (textChunks.length === 0) {
    return { precision: 'segment' };
  }

  const socket = new WebSocket(context.fishTtsWsUrl, {
    headers: {
      Authorization: `Bearer ${context.fishAudioApiKey}`,
      model: context.model,
    },
  });

  await waitForSocketOpen(socket, signal);

  let finishReceived = false;
  let abortedByConsumer = false;
  let settled = false;
  let stopSent = false;
  let audioPipeline: Promise<void> = Promise.resolve();

  const synthesisComplete = new Promise<SegmentSynthesisResult>((resolve, reject) => {
    const cleanup = (): void => {
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };

    const resolveOnce = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ precision: 'segment' });
    };

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const maybeResolve = (): void => {
      if (settled) return;
      if (!finishReceived && !abortedByConsumer) return;
      void audioPipeline.then(resolveOnce).catch((error) => {
        rejectOnce(toError(error, 'Fish websocket audio pipeline failed'));
      });
    };

    const enqueueAudio = (audio: ArrayBuffer): void => {
      audioPipeline = audioPipeline.then(async () => {
        if (abortedByConsumer || settled) {
          return;
        }

        const chunks = chunkArrayBuffer(audio, PCM_BYTES_PER_100MS);
        for (const chunk of chunks) {
          if (abortedByConsumer || settled) {
            return;
          }

          const keepGoing = await emitChunk(chunk);
          if (!keepGoing) {
            abortedByConsumer = true;
            safeCloseSocket(socket);
            maybeResolve();
            return;
          }
        }
      });

      void audioPipeline.catch((error) => {
        rejectOnce(toError(error, 'Fish websocket audio pipeline failed'));
      });
    };

    const onMessage = (raw: RawData, isBinary: boolean): void => {
      if (!isBinary || settled) return;

      let decoded: unknown;
      try {
        decoded = decode(rawDataToUint8Array(raw));
      } catch (error) {
        rejectOnce(toError(error, 'Failed to decode Fish websocket message'));
        return;
      }

      const decodedMessage = coerceDecodedMessage(decoded);
      if (!decodedMessage) {
        return;
      }

      const event = decodedMessage.event;
      if (event === 'audio') {
        const audio = toArrayBufferCopy(decodedMessage.audio);
        if (audio) {
          enqueueAudio(audio);
        }
        return;
      }

      if (event === 'finish') {
        const reason = typeof decodedMessage.reason === 'string' ? decodedMessage.reason : '';
        if (reason === 'error') {
          const errorMessage =
            typeof decodedMessage.message === 'string' && decodedMessage.message.trim().length > 0
              ? decodedMessage.message
              : 'Fish websocket TTS returned finish=error';
          rejectOnce(new Error(errorMessage));
          return;
        }
        if (reason === 'stop') {
          finishReceived = true;
          maybeResolve();
        }
      }
    };

    const onError = (error: Error): void => {
      if (signal.aborted) {
        rejectOnce(createAbortError());
        return;
      }
      rejectOnce(toError(error, 'Fish websocket TTS error'));
    };

    const onClose = (): void => {
      if (settled) return;
      if (signal.aborted) {
        rejectOnce(createAbortError());
        return;
      }
      if (abortedByConsumer || finishReceived) {
        maybeResolve();
        return;
      }
      if (stopSent) {
        rejectOnce(new Error('Fish websocket closed before finish event was received'));
        return;
      }
      rejectOnce(new Error('Fish websocket closed unexpectedly'));
    };

    const onAbort = (): void => {
      safeCloseSocket(socket);
      rejectOnce(createAbortError());
    };

    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.on('close', onClose);
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    const startRequest = createFishStartRequest(context.voice);
    await sendFishEvent(socket, { event: 'start', request: startRequest });

    for (const chunk of textChunks) {
      if (signal.aborted) {
        throw createAbortError();
      }
      await sendFishEvent(socket, { event: 'text', text: chunk });
    }

    await sendFishEvent(socket, { event: 'flush' });
    stopSent = true;
    await sendFishEvent(socket, { event: 'stop' });
  } catch (error) {
    safeCloseSocket(socket);
    void synthesisComplete.catch(() => {});
    throw toError(error, 'Fish websocket TTS send failed');
  }

  return synthesisComplete;
}

async function waitForSocketOpen(socket: WebSocket, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    safeCloseSocket(socket);
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };

    const resolveOnce = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onOpen = (): void => {
      resolveOnce();
    };

    const onError = (error: Error): void => {
      rejectOnce(toError(error, 'Fish websocket connect failed'));
    };

    const onClose = (): void => {
      rejectOnce(new Error('Fish websocket closed before opening'));
    };

    const onAbort = (): void => {
      safeCloseSocket(socket);
      rejectOnce(createAbortError());
    };

    socket.on('open', onOpen);
    socket.on('error', onError);
    socket.on('close', onClose);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function sendFishEvent(
  socket: WebSocket,
  payload: Record<string, unknown>
): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error('Fish websocket is not open');
  }

  const encoded = encode(payload);
  await new Promise<void>((resolve, reject) => {
    socket.send(encoded, (error) => {
      if (error) {
        reject(toError(error, 'Fish websocket send failed'));
        return;
      }
      resolve();
    });
  });
}

function createFishStartRequest(voice: string): Record<string, unknown> {
  const request: Record<string, unknown> = {
    text: '',
    format: 'pcm',
    sample_rate: FISH_SAMPLE_RATE,
  };

  const trimmedVoice = voice.trim();
  if (trimmedVoice) {
    request.reference_id = trimmedVoice;
  }

  return request;
}

function chunkFishText(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const phraseMatches = normalized.match(/[^.!?;:,\n]+[.!?;:,\n]*\s*/g) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  const flushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    current = '';
  };

  for (const phraseRaw of phraseMatches) {
    const phrase = phraseRaw.trim();
    if (!phrase) continue;

    if (phrase.length > FISH_MAX_TEXT_CHUNK_CHARS) {
      flushCurrent();
      chunks.push(...splitLongFishChunk(phrase));
      continue;
    }

    if (!current) {
      current = phrase;
      continue;
    }

    if (current.length + 1 + phrase.length <= FISH_MAX_TEXT_CHUNK_CHARS) {
      current = `${current} ${phrase}`;
      continue;
    }

    flushCurrent();
    current = phrase;
  }

  flushCurrent();
  return chunks;
}

function splitLongFishChunk(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > FISH_MAX_TEXT_CHUNK_CHARS) {
    let splitAt = remaining.lastIndexOf(' ', FISH_MAX_TEXT_CHUNK_CHARS);
    if (splitAt < FISH_MIN_SPLIT_INDEX) {
      splitAt = remaining.lastIndexOf(',', FISH_MAX_TEXT_CHUNK_CHARS);
    }
    if (splitAt < FISH_MIN_SPLIT_INDEX) {
      splitAt = FISH_MAX_TEXT_CHUNK_CHARS;
    }

    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function rawDataToUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  const maybeView: unknown = data;
  if (isArrayBufferView(maybeView)) {
    return new Uint8Array(maybeView.buffer, maybeView.byteOffset, maybeView.byteLength);
  }
  throw new Error('Unsupported Fish websocket message payload type');
}

function coerceDecodedMessage(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  if (value instanceof Map) {
    const mapped: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      if (typeof key === 'string') {
        mapped[key] = entry;
      }
    }
    return mapped;
  }
  return null;
}

function toArrayBufferCopy(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    const copied = new Uint8Array(bytes.byteLength);
    copied.set(bytes);
    return copied.buffer;
  }
  if (Buffer.isBuffer(value)) {
    const copied = new Uint8Array(value.byteLength);
    copied.set(value);
    return copied.buffer;
  }
  if (value instanceof Uint8Array) {
    const copied = new Uint8Array(value.byteLength);
    copied.set(value);
    return copied.buffer;
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copied = new Uint8Array(bytes.byteLength);
    copied.set(bytes);
    return copied.buffer;
  }
  return null;
}

function safeCloseSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    return;
  }
  try {
    socket.close();
  } catch {
    // ignore close errors on teardown
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(fallback);
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted', 'AbortError');
  }
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
