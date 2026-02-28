import WebSocket, { type RawData } from 'ws';
import type { SpokenWordTimestamp } from '../../types.js';
import { decodeBase64ToArrayBuffer } from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

const RIME_SAMPLE_RATE = 24000;
const RIME_TEXT_CHUNK_MAX_CHARS = 220;

export async function synthesizeRimeSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  if (!context.rimeApiKey) {
    throw new Error('Rime API key is missing for decomposed TTS');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { precision: 'segment' };
  }

  const endpoint = normalizeRimeWsEndpoint(context.rimeTtsWsUrl);
  endpoint.searchParams.set('speaker', context.voice);
  endpoint.searchParams.set('modelId', context.model);
  endpoint.searchParams.set('audioFormat', 'pcm');
  endpoint.searchParams.set('samplingRate', String(RIME_SAMPLE_RATE));
  if (!endpoint.searchParams.has('segment')) {
    endpoint.searchParams.set('segment', 'never');
  }

  const textChunks = chunkTextNaturally(trimmed, RIME_TEXT_CHUNK_MAX_CHARS);
  const contextId = createContextId();
  let providerWordTimestamps: SpokenWordTimestamp[] | undefined;

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const socket = new WebSocket(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${context.rimeApiKey}`,
      },
    });

    let settled = false;
    let opened = false;
    let sentFlushAndEos = false;
    let consumerStopped = false;
    let audioPipeline: Promise<void> = Promise.resolve();

    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
      socket.off('open', onOpen);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      socket.off('error', onSocketError);
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
      try {
        if (
          socket.readyState === WebSocket.CONNECTING
          || socket.readyState === WebSocket.OPEN
        ) {
          socket.close();
        }
      } catch {
        // ignore close race
      }
      reject(error);
    };

    const onAbort = (): void => {
      rejectOnce(createAbortError());
    };

    const onOpen = (): void => {
      opened = true;
      void (async () => {
        for (const chunk of textChunks) {
          await sendJson(socket, { text: chunk, contextId });
        }

        // One flush/eos sequence after all text preserves continuous provider buffering.
        await sendJson(socket, { operation: 'flush' });
        await sendJson(socket, { operation: 'eos' });
        sentFlushAndEos = true;
      })().catch((error: unknown) => {
        rejectOnce(toError(error, 'Failed to send Rime websocket payload'));
      });
    };

    const onSocketError = (error: Error): void => {
      rejectOnce(toError(error, 'Rime websocket TTS failed'));
    };

    const onMessage = (data: RawData, isBinary: boolean): void => {
      if (settled || isBinary) {
        return;
      }

      const parsed = parseJsonMessage(data);
      if (!parsed.ok) {
        rejectOnce(parsed.error);
        return;
      }

      const payload = parsed.value;
      const eventType = typeof payload.type === 'string' ? payload.type : '';

      if (eventType === 'error') {
        rejectOnce(new Error(readRimeErrorMessage(payload)));
        return;
      }

      if (eventType === 'chunk') {
        const base64 = typeof payload.data === 'string' ? payload.data : '';
        if (!base64) {
          return;
        }
        audioPipeline = audioPipeline
          .then(async () => {
            if (settled || consumerStopped) {
              return;
            }
            const keepGoing = await emitChunk(decodeBase64ToArrayBuffer(base64));
            if (!keepGoing) {
              consumerStopped = true;
              resolveOnce();
              try {
                if (
                  socket.readyState === WebSocket.CONNECTING
                  || socket.readyState === WebSocket.OPEN
                ) {
                  socket.close();
                }
              } catch {
                // ignore close race
              }
            }
          })
          .catch((error: unknown) => {
            rejectOnce(toError(error, 'Failed while streaming Rime audio chunk'));
          });
        return;
      }

      if (eventType === 'timestamps') {
        const mapped = mapRimeWordTimestamps(payload.word_timestamps);
        if (mapped.length > 0) {
          providerWordTimestamps = mapped;
        }
        return;
      }

      if (eventType === 'done' || eventType === 'complete' || eventType === 'eos') {
        void audioPipeline.then(() => resolveOnce()).catch((error: unknown) => {
          rejectOnce(toError(error, 'Failed while finalizing Rime audio stream'));
        });
      }
    };

    const onClose = (): void => {
      if (settled) {
        return;
      }
      if (consumerStopped) {
        resolveOnce();
        return;
      }
      if (signal.aborted) {
        rejectOnce(createAbortError());
        return;
      }
      if (!opened) {
        rejectOnce(new Error('Rime websocket closed before opening'));
        return;
      }
      if (!sentFlushAndEos) {
        rejectOnce(new Error('Rime websocket closed before flush/eos were sent'));
        return;
      }
      void audioPipeline.then(() => resolveOnce()).catch((error: unknown) => {
        rejectOnce(toError(error, 'Failed while completing Rime audio stream'));
      });
    };

    signal.addEventListener('abort', onAbort, { once: true });
    socket.on('open', onOpen);
    socket.on('message', onMessage);
    socket.on('close', onClose);
    socket.on('error', onSocketError);
  });

  if (providerWordTimestamps && providerWordTimestamps.length > 0) {
    return {
      precision: 'provider-word-timestamps',
      wordTimestamps: providerWordTimestamps,
      wordTimestampsTimeBase: 'segment',
    };
  }

  return { precision: 'segment' };
}

function sendJson(
  socket: WebSocket,
  payload: Record<string, unknown>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Rime websocket is not open'));
      return;
    }
    socket.send(JSON.stringify(payload), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function chunkTextNaturally(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const words = trimmed.split(/\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (word.length <= maxChars) {
      current = word;
      continue;
    }

    for (let index = 0; index < word.length; index += maxChars) {
      chunks.push(word.slice(index, index + maxChars));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function normalizeRimeWsEndpoint(rawUrl: string): URL {
  const endpoint = new URL(rawUrl);
  if (endpoint.protocol === 'https:') {
    endpoint.protocol = 'wss:';
  } else if (endpoint.protocol === 'http:') {
    endpoint.protocol = 'ws:';
  }

  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  if (normalizedPath.endsWith('/ws')) {
    endpoint.pathname = `${normalizedPath}2`;
  } else {
    endpoint.pathname = normalizedPath;
  }
  return endpoint;
}

function createContextId(): string {
  return `segment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJsonMessage(
  data: RawData
): { ok: true; value: Record<string, unknown> } | { ok: false; error: Error } {
  const raw = rawDataToUtf8(data);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: new Error('Rime websocket sent non-object JSON payload') };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      error: new Error(`Rime websocket JSON parse failed: ${toError(error).message}`),
    };
  }
}

function rawDataToUtf8(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

function readRimeErrorMessage(payload: Record<string, unknown>): string {
  const message = toStringValue(payload.message);
  if (message) {
    return `Rime websocket error: ${message}`;
  }

  const errorString = toStringValue(payload.error);
  if (errorString) {
    return `Rime websocket error: ${errorString}`;
  }

  if (payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)) {
    const nested = payload.error as Record<string, unknown>;
    const nestedMessage = toStringValue(nested.message);
    if (nestedMessage) {
      return `Rime websocket error: ${nestedMessage}`;
    }
    const nestedCode = toStringValue(nested.code);
    if (nestedCode) {
      return `Rime websocket error (${nestedCode})`;
    }
  }

  const code = toStringValue(payload.code);
  if (code) {
    return `Rime websocket error (${code})`;
  }

  return 'Rime websocket error';
}

function mapRimeWordTimestamps(value: unknown): SpokenWordTimestamp[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const payload = value as Record<string, unknown>;
  const words = Array.isArray(payload.words) ? payload.words : [];
  const starts = Array.isArray(payload.start) ? payload.start : [];
  const ends = Array.isArray(payload.end) ? payload.end : [];
  const count = Math.min(words.length, starts.length, ends.length);
  if (count === 0) {
    return [];
  }

  const numericValues: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = toFiniteNumber(starts[index]);
    const end = toFiniteNumber(ends[index]);
    if (start !== null) numericValues.push(start);
    if (end !== null) numericValues.push(end);
  }
  const useSeconds = shouldTreatAsSeconds(numericValues);

  const mapped: SpokenWordTimestamp[] = [];
  for (let index = 0; index < count; index += 1) {
    const word = toStringValue(words[index]);
    const start = toFiniteNumber(starts[index]);
    const end = toFiniteNumber(ends[index]);
    if (!word || start === null || end === null) {
      continue;
    }

    const startMs = toMilliseconds(start, useSeconds);
    const endMs = Math.max(startMs, toMilliseconds(end, useSeconds));
    mapped.push({ word, startMs, endMs });
  }

  return mapped;
}

function shouldTreatAsSeconds(values: number[]): boolean {
  if (values.length === 0) {
    return false;
  }
  if (values.some((value) => !Number.isInteger(value))) {
    return true;
  }
  const maxValue = Math.max(...values.map((value) => Math.abs(value)));
  return maxValue <= 300;
}

function toMilliseconds(value: number, useSeconds: boolean): number {
  return useSeconds ? Math.round(value * 1000) : Math.round(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function createAbortError(): Error {
  try {
    return new DOMException('Rime websocket TTS request aborted', 'AbortError');
  } catch {
    const fallback = new Error('Rime websocket TTS request aborted');
    fallback.name = 'AbortError';
    return fallback;
  }
}

function toError(error: unknown, fallback = 'Unknown error'): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return new Error(error);
  }
  return new Error(fallback);
}
