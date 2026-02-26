import WebSocket from 'ws';
import type { SpokenWordTimestamp } from '../../types.js';
import { decodeBase64ToArrayBuffer } from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

const CARTESIA_DEFAULT_VERSION = '2025-04-16';
const CARTESIA_REQUIRED_PATH = '/tts/websocket';

interface CartesiaEnvelope {
  type?: unknown;
  data?: unknown;
  error?: unknown;
  message?: unknown;
  word_timestamps?: unknown;
}

interface CartesiaWordTimestampsPayload {
  words?: unknown;
  start?: unknown;
  end?: unknown;
}

export async function synthesizeCartesiaSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  if (!context.cartesiaApiKey) {
    throw new Error('Cartesia API key is missing for decomposed TTS provider cartesia');
  }
  if (signal.aborted) {
    throw createAbortError();
  }

  const endpoint = normalizeCartesiaWsEndpoint(context.cartesiaTtsWsUrl);
  const cartesiaVersion = resolveCartesiaVersion(endpoint);
  const contextId = randomContextId();
  const wordTimestamps: SpokenWordTimestamp[] = [];
  const dedupeWordTimestamps = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let doneReceived = false;
    let stopRequested = false;
    let requestSent = false;
    let audioPipeline: Promise<void> = Promise.resolve();

    const socket = new WebSocket(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${context.cartesiaApiKey}`,
        'cartesia-version': cartesiaVersion,
      },
    });

    const closeSocket = (): void => {
      if (
        socket.readyState === WebSocket.CLOSING
        || socket.readyState === WebSocket.CLOSED
      ) {
        return;
      }
      try {
        socket.close();
      } catch {
        // ignore close failures
      }
    };

    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
      socket.off('open', onOpen);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    const resolveOnce = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(toError(error, 'Cartesia websocket TTS failed'));
    };

    const resolveAfterAudioDrain = (): void => {
      void audioPipeline.then(resolveOnce).catch((error) => {
        closeSocket();
        rejectOnce(error);
      });
    };

    const onAbort = (): void => {
      stopRequested = true;
      closeSocket();
      rejectOnce(createAbortError());
    };

    const onOpen = (): void => {
      if (signal.aborted) {
        onAbort();
        return;
      }

      const request = {
        model_id: context.model,
        voice: {
          mode: 'id',
          id: context.voice,
        },
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: 24000,
        },
        transcript: text,
        context_id: contextId,
        continue: false,
        add_timestamps: true,
      };

      try {
        socket.send(JSON.stringify(request));
        requestSent = true;
      } catch (error) {
        closeSocket();
        rejectOnce(error);
      }
    };

    const onMessage = (raw: WebSocket.RawData): void => {
      if (settled || stopRequested) {
        return;
      }

      const payload = rawDataToString(raw);
      if (!payload) {
        return;
      }

      let message: CartesiaEnvelope;
      try {
        message = JSON.parse(payload) as CartesiaEnvelope;
      } catch (error) {
        closeSocket();
        rejectOnce(
          toError(
            error,
            `Cartesia websocket returned a non-JSON message: ${payload.slice(0, 120)}`
          )
        );
        return;
      }

      const eventType = typeof message.type === 'string' ? message.type : '';
      if (eventType === 'chunk') {
        if (typeof message.data !== 'string' || message.data.length === 0) {
          return;
        }
        let chunk: ArrayBuffer;
        try {
          chunk = decodeBase64ToArrayBuffer(message.data);
        } catch (error) {
          closeSocket();
          rejectOnce(toError(error, 'Cartesia websocket chunk decode failed'));
          return;
        }

        audioPipeline = audioPipeline
          .then(async () => {
            if (settled || stopRequested || signal.aborted) {
              return;
            }
            const keepGoing = await emitChunk(chunk);
            if (!keepGoing) {
              stopRequested = true;
              closeSocket();
              resolveOnce();
            }
          })
          .catch((error) => {
            stopRequested = true;
            closeSocket();
            rejectOnce(toError(error, 'Cartesia websocket chunk emit failed'));
          });
        return;
      }

      if (eventType === 'timestamps') {
        appendProviderWordTimestamps(
          message.word_timestamps,
          wordTimestamps,
          dedupeWordTimestamps
        );
        return;
      }

      if (eventType === 'error') {
        closeSocket();
        rejectOnce(new Error(resolveCartesiaErrorMessage(message)));
        return;
      }

      if (eventType === 'done') {
        doneReceived = true;
        closeSocket();
        resolveAfterAudioDrain();
      }
    };

    const onError = (event: Error): void => {
      closeSocket();
      rejectOnce(toError(event, 'Cartesia websocket TTS connection error'));
    };

    const onClose = (code: number, reason: Buffer): void => {
      if (settled) {
        return;
      }
      if (stopRequested || signal.aborted) {
        return;
      }
      if (doneReceived) {
        resolveAfterAudioDrain();
        return;
      }

      const reasonText = normalizeCloseReason(reason);
      const phase = requestSent ? 'before completion' : 'before request send';
      rejectOnce(
        new Error(
          `Cartesia websocket closed ${phase} (code ${code})${reasonText ? `: ${reasonText}` : ''}`
        )
      );
    };

    signal.addEventListener('abort', onAbort, { once: true });
    socket.on('open', onOpen);
    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.on('close', onClose);
  });

  if (wordTimestamps.length === 0) {
    return { precision: 'segment' };
  }

  return {
    precision: 'provider-word-timestamps',
    wordTimestamps,
    wordTimestampsTimeBase: 'segment',
  };
}

function normalizeCartesiaWsEndpoint(rawUrl: string): URL {
  const endpoint = new URL(rawUrl);
  if (endpoint.protocol === 'https:') {
    endpoint.protocol = 'wss:';
  } else if (endpoint.protocol === 'http:') {
    endpoint.protocol = 'ws:';
  }

  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  if (normalizedPath.endsWith(CARTESIA_REQUIRED_PATH)) {
    endpoint.pathname = normalizedPath;
    return endpoint;
  }
  endpoint.pathname = `${normalizedPath}${CARTESIA_REQUIRED_PATH}`;
  return endpoint;
}

function resolveCartesiaVersion(endpoint: URL): string {
  const versionFromQuery =
    endpoint.searchParams.get('cartesia_version')
    ?? endpoint.searchParams.get('cartesia-version');
  return versionFromQuery || CARTESIA_DEFAULT_VERSION;
}

function randomContextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rawDataToString(raw: WebSocket.RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8');
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  }
  if (Array.isArray(raw)) {
    const buffers: Buffer[] = [];
    for (const chunk of raw) {
      if (chunk instanceof ArrayBuffer) {
        buffers.push(Buffer.from(chunk));
        continue;
      }
      if (ArrayBuffer.isView(chunk)) {
        buffers.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      }
    }
    return Buffer.concat(buffers).toString('utf8');
  }
  return '';
}

function appendProviderWordTimestamps(
  payload: unknown,
  target: SpokenWordTimestamp[],
  dedupe: Set<string>
): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const wordTimestamps = payload as CartesiaWordTimestampsPayload;
  if (
    !Array.isArray(wordTimestamps.words)
    || !Array.isArray(wordTimestamps.start)
    || !Array.isArray(wordTimestamps.end)
  ) {
    return;
  }

  const count = Math.min(
    wordTimestamps.words.length,
    wordTimestamps.start.length,
    wordTimestamps.end.length
  );

  for (let index = 0; index < count; index += 1) {
    const rawWord = wordTimestamps.words[index];
    if (typeof rawWord !== 'string') {
      continue;
    }
    const word = rawWord.trim();
    if (!word) {
      continue;
    }

    const startMs = toMilliseconds(wordTimestamps.start[index]);
    if (startMs === null) {
      continue;
    }
    const endRawMs = toMilliseconds(wordTimestamps.end[index]);
    const endMs = Math.max(startMs, endRawMs ?? startMs);
    const key = `${word}|${startMs}|${endMs}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    target.push({
      word,
      startMs,
      endMs,
    });
  }
}

function toMilliseconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, value * 1000);
}

function resolveCartesiaErrorMessage(message: CartesiaEnvelope): string {
  if (typeof message.error === 'string' && message.error) {
    return `Cartesia websocket TTS error: ${message.error}`;
  }
  if (typeof message.message === 'string' && message.message) {
    return `Cartesia websocket TTS error: ${message.message}`;
  }
  if (message.error && typeof message.error === 'object') {
    const nested = message.error as { message?: unknown; error?: unknown };
    if (typeof nested.message === 'string' && nested.message) {
      return `Cartesia websocket TTS error: ${nested.message}`;
    }
    if (typeof nested.error === 'string' && nested.error) {
      return `Cartesia websocket TTS error: ${nested.error}`;
    }
  }
  return 'Cartesia websocket TTS returned an unknown error event';
}

function normalizeCloseReason(reason: Buffer): string {
  if (!reason || reason.byteLength === 0) {
    return '';
  }
  return reason.toString('utf8').trim();
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string' && error) {
    return new Error(error);
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
