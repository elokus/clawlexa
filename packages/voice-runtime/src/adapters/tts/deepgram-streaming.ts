import { createClient, LiveTTSEvents, type SpeakLiveClient } from '@deepgram/sdk';
import { DecomposedSpokenWordBuffer } from '../decomposed-spoken-buffer.js';
import {
  DEEPGRAM_FLUSH_FALLBACK_FORCE_MS,
  DEEPGRAM_FLUSH_FALLBACK_IDLE_MS,
  DEEPGRAM_FLUSH_FALLBACK_POLL_MS,
  countWords,
  detectSpeechOnsetInChunk,
  shouldFlushDeepgramStream,
  sleep,
  toRawDataUint8Array,
} from '../decomposed-utils.js';
import { AUDIO_SAMPLE_RATE, PCM_BYTES_PER_100MS, chunkArrayBuffer } from './audio-utils.js';

export interface DeepgramTtsConnectionOptions {
  apiKey?: string;
  model: string;
  endpoint: string;
}

export interface DeepgramStreamingOptions extends DeepgramTtsConnectionOptions {
  ttsProvider: string;
  punctuationChunkingEnabled: boolean;
  spokenStreamEnabled: boolean;
}

export interface DeepgramStreamingLatencyMetric {
  stage: 'stt' | 'llm' | 'tts' | 'turn' | 'tool';
  durationMs: number;
  provider?: string;
  model?: string;
  details?: Record<string, unknown>;
}

export interface DeepgramStreamingSpokenMeta {
  spokenChars?: number;
  spokenWords?: number;
  playbackMs?: number;
  speechOnsetMs?: number;
  precision?: 'segment';
  wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>;
  wordTimestampsTimeBase?: 'segment' | 'utterance';
}

export interface DeepgramStreamingContext {
  connectionManager: DeepgramConnectionManager;
  options: DeepgramStreamingOptions;
  isTurnCurrent: () => boolean;
  setSpeaking: () => void;
  setListening: () => void;
  trackAssistantOutput: (chunk: ArrayBuffer) => void;
  emitAudio: (chunk: ArrayBuffer) => void;
  emitError: (error: Error) => void;
  emitLatency: (metric: DeepgramStreamingLatencyMetric) => void;
  emitTranscriptDelta: (delta: string) => void;
  emitSpokenDelta: (delta: string, meta: DeepgramStreamingSpokenMeta) => void;
  emitSpokenProgress: (progress: {
    spokenChars: number;
    spokenWords: number;
    playbackMs: number;
    precision: 'segment';
  }) => void;
  emitSpokenFinal: (text: string, meta: DeepgramStreamingSpokenMeta) => void;
}

export interface DeepgramStreamingResult {
  text: string;
  spokenText: string;
  spokeAudio: boolean;
  llmDurationMs: number;
  interrupted: boolean;
}

export class DeepgramTtsConnectionManager implements DeepgramConnectionManager {
  private connection: SpeakLiveClient | null = null;
  private connectionReady: Promise<SpeakLiveClient> | null = null;
  private requestQueue: Promise<void> = Promise.resolve();

  resetQueue(): void {
    this.requestQueue = Promise.resolve();
  }

  enqueueRequest<T>(fn: () => Promise<T>): Promise<T> {
    const request = this.requestQueue.then(() => fn());
    this.requestQueue = request.then(() => undefined).catch(() => undefined);
    return request;
  }

  async ensure(options: DeepgramTtsConnectionOptions): Promise<SpeakLiveClient> {
    if (!options.apiKey) {
      throw new Error('Deepgram API key is missing for decomposed TTS');
    }

    if (this.connection && this.connection.isConnected()) {
      return this.connection;
    }

    if (this.connectionReady) {
      return this.connectionReady;
    }

    const connectPromise = new Promise<SpeakLiveClient>((resolve, reject) => {
      if (!options.apiKey) {
        reject(new Error('Deepgram API key is missing for decomposed TTS'));
        return;
      }

      const connectionTimeout = setTimeout(() => {
        this.close();
        rejectOnce(new Error('Deepgram websocket TTS connect timed out'));
      }, 10000);

      const connection = this.createConnection(options.apiKey, options.model, options.endpoint);

      let settled = false;
      const cleanup = (): void => {
        clearTimeout(connectionTimeout);
        connection.off(LiveTTSEvents.Open, onOpen);
        connection.off(LiveTTSEvents.Error, onError);
        connection.off(LiveTTSEvents.Close, onCloseBeforeOpen);
      };

      const resolveOnce = (client: SpeakLiveClient): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(client);
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onOpen = (): void => {
        this.connection = connection;

        connection.on(LiveTTSEvents.Close, () => {
          if (this.connection === connection) {
            this.connection = null;
          }
        });

        resolveOnce(connection);
      };

      const onError = (event: unknown): void => {
        rejectOnce(toDeepgramLiveError(event, 'Deepgram websocket TTS connect failed'));
      };

      const onCloseBeforeOpen = (): void => {
        rejectOnce(new Error('Deepgram websocket TTS closed before open'));
      };

      connection.once(LiveTTSEvents.Open, onOpen);
      connection.once(LiveTTSEvents.Error, onError);
      connection.once(LiveTTSEvents.Close, onCloseBeforeOpen);
    });

    this.connectionReady = connectPromise;
    try {
      return await connectPromise;
    } finally {
      if (this.connectionReady === connectPromise) {
        this.connectionReady = null;
      }
    }
  }

  close(): void {
    const connection = this.connection;
    this.connection = null;
    this.connectionReady = null;
    if (!connection) return;
    try {
      connection.requestClose();
    } catch {
      // ignore close-send failures
    }
    try {
      connection.disconnect();
    } catch {
      // ignore close failures
    }
  }

  private createConnection(apiKey: string, model: string, endpoint: string): SpeakLiveClient {
    const deepgram = createClient({
      key: apiKey,
    });
    return deepgram.speak.live(
      {
        model,
        encoding: 'linear16',
        sample_rate: AUDIO_SAMPLE_RATE,
        container: 'none',
      },
      endpoint
    );
  }
}

export interface DeepgramConnectionManager {
  ensure(options: DeepgramTtsConnectionOptions): Promise<SpeakLiveClient>;
  close(): void;
}

export function toDeepgramLiveError(event: unknown, fallback: string): Error {
  if (event instanceof Error) {
    return event;
  }

  const object = event as { message?: unknown; description?: unknown; code?: unknown } | null;
  if (object && typeof object === 'object') {
    const message =
      typeof object.message === 'string'
        ? object.message
        : typeof object.description === 'string'
          ? object.description
          : null;
    const code = typeof object.code === 'string' ? object.code : null;
    if (message && code) {
      return new Error(`${message} (code: ${code})`);
    }
    if (message) {
      return new Error(message);
    }
  }

  return new Error(fallback);
}

export async function speakWithDeepgramLiveSegment(input: {
  text: string;
  emitChunk: (chunk: ArrayBuffer) => Promise<boolean>;
  context: DeepgramStreamingContext;
}): Promise<void> {
  const { text, emitChunk, context } = input;
  const { options } = context;

  if (!options.apiKey) {
    throw new Error('Deepgram API key is missing for decomposed TTS');
  }

  const connection = await context.connectionManager.ensure(options);
  if (!context.isTurnCurrent()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let flushReceived = false;
    let aborted = false;
    let audioPipeline: Promise<void> = Promise.resolve();
    const segmentTimeout = setTimeout(() => {
      context.connectionManager.close();
      rejectOnce(new Error('Deepgram websocket TTS segment timed out waiting for flush'));
    }, 10000);

    const cleanup = (): void => {
      clearTimeout(segmentTimeout);
      connection.off(LiveTTSEvents.Audio, onAudio);
      connection.off(LiveTTSEvents.Flushed, onFlushed);
      connection.off(LiveTTSEvents.Warning, onWarning);
      connection.off(LiveTTSEvents.Close, onClose);
      connection.off(LiveTTSEvents.Error, onError);
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

    const maybeResolve = (): void => {
      if (settled) return;
      if (aborted) {
        resolveOnce();
        return;
      }
      if (!flushReceived) {
        return;
      }
      void audioPipeline.then(() => resolveOnce()).catch((error) => {
        rejectOnce(error as Error);
      });
    };

    const enqueueAudio = (payload: ArrayBuffer | Uint8Array): void => {
      audioPipeline = audioPipeline.then(async () => {
        const bytes =
          payload instanceof ArrayBuffer
            ? new Uint8Array(payload)
            : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
        const copied = new Uint8Array(bytes.byteLength);
        copied.set(bytes);
        const audioBuffer = copied.buffer;

        const chunks = chunkArrayBuffer(audioBuffer, PCM_BYTES_PER_100MS);
        for (const chunk of chunks) {
          if (aborted) return;
          const keepGoing = await emitChunk(chunk);
          if (!keepGoing) {
            aborted = true;
            context.connectionManager.close();
            return;
          }
        }
      });
    };

    const onAudio = (payload: unknown): void => {
      const binary = toRawDataUint8Array(payload);
      if (binary) {
        enqueueAudio(binary);
      }
    };

    const onFlushed = (): void => {
      flushReceived = true;
      maybeResolve();
    };

    const onWarning = (event: unknown): void => {
      if (settled) return;
      const error = toDeepgramLiveError(event, 'Deepgram websocket TTS warning');
      context.connectionManager.close();
      rejectOnce(error);
    };

    const onClose = (): void => {
      if (settled) return;
      if (!context.isTurnCurrent()) {
        resolveOnce();
        return;
      }
      rejectOnce(new Error('Deepgram websocket TTS closed before flush completed'));
    };

    const onError = (event: unknown): void => {
      if (settled) return;
      if (!context.isTurnCurrent()) {
        resolveOnce();
        return;
      }
      const error = toDeepgramLiveError(event, 'Deepgram websocket TTS error');
      context.connectionManager.close();
      rejectOnce(error);
    };

    connection.on(LiveTTSEvents.Audio, onAudio);
    connection.on(LiveTTSEvents.Flushed, onFlushed);
    connection.on(LiveTTSEvents.Warning, onWarning);
    connection.on(LiveTTSEvents.Close, onClose);
    connection.on(LiveTTSEvents.Error, onError);

    try {
      connection.sendText(text);
      connection.flush();
    } catch (error) {
      context.connectionManager.close();
      rejectOnce(toDeepgramLiveError(error, 'Deepgram websocket TTS send failed'));
      return;
    }
  });
}

export async function streamTextWithDeepgramTts(input: {
  textStream: AsyncIterable<string>;
  llmStartedAtMs: number;
  context: DeepgramStreamingContext;
}): Promise<DeepgramStreamingResult> {
  const { textStream, llmStartedAtMs, context } = input;
  const { options } = context;

  if (!options.apiKey) {
    throw new Error('Deepgram API key is missing for decomposed TTS');
  }

  if (!context.isTurnCurrent()) {
    return { text: '', spokenText: '', spokeAudio: false, llmDurationMs: 0, interrupted: true };
  }

  const connection = await context.connectionManager.ensure(options);
  if (!context.isTurnCurrent()) {
    return { text: '', spokenText: '', spokeAudio: false, llmDurationMs: 0, interrupted: true };
  }

  const ttsStartedAtMs = Date.now();
  const punctuationChunkingEnabled = options.punctuationChunkingEnabled;
  let llmDurationMs = 0;
  let assistantText = '';
  let pendingText = '';
  let speaking = false;
  let spokeAudio = false;
  let pendingChars = 0;
  let expectedFlushes = 0;
  let receivedFlushes = 0;
  let sendingComplete = false;
  let sendingCompleteAtMs: number | null = null;
  let settled = false;
  let aborted = false;
  let emittedAudioBytes = 0;
  let emittedChunks = 0;
  let firstAudioAtMs: number | null = null;
  let lastAudioAtMs: number | null = null;
  let forceReconnectAfterTurn = false;
  let audioPipeline: Promise<void> = Promise.resolve();
  const spokenStreamEnabled = options.spokenStreamEnabled === true;

  let speechOnsetBytes = 0;
  let speechOnsetDetected = false;
  const flushTextQueue: string[] = [];
  let spokenText = '';
  let spokenChars = 0;
  let spokenWords = 0;
  let spokenPlaybackMs = 0;
  const spokenWordBuffer = new DecomposedSpokenWordBuffer();

  const emitSpokenWord = (word: string): void => {
    if (!word || !spokenStreamEnabled || !context.isTurnCurrent()) return;
    spokenText += word;
    spokenChars = spokenText.length;
    spokenWords = countWords(spokenText);
    const playbackMs = Math.floor((emittedAudioBytes / 2 / AUDIO_SAMPLE_RATE) * 1000);
    const onsetMs = speechOnsetDetected
      ? Math.floor((speechOnsetBytes / 2 / AUDIO_SAMPLE_RATE) * 1000)
      : 0;
    spokenPlaybackMs = playbackMs;
    context.emitSpokenDelta(word, {
      spokenChars,
      spokenWords,
      playbackMs,
      speechOnsetMs: onsetMs,
      precision: 'segment',
    });
    context.emitSpokenProgress({
      spokenChars,
      spokenWords,
      playbackMs,
      precision: 'segment',
    });
  };

  const drainSpokenWordBuffer = (): void => {
    const buffered = spokenWordBuffer.markAudioStarted();
    if (buffered) {
      emitSpokenWord(buffered);
    }
  };

  await new Promise<void>((resolve, reject) => {
    let flushFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const streamingTimeout = setTimeout(() => {
      context.connectionManager.close();
      rejectOnce(new Error('Deepgram websocket TTS streaming turn timed out'));
    }, 30000);

    const cleanup = (): void => {
      clearTimeout(streamingTimeout);
      if (flushFallbackTimer) {
        clearTimeout(flushFallbackTimer);
        flushFallbackTimer = null;
      }
      connection.off(LiveTTSEvents.Audio, onAudio);
      connection.off(LiveTTSEvents.Flushed, onFlushed);
      connection.off(LiveTTSEvents.Warning, onWarning);
      connection.off(LiveTTSEvents.Close, onClose);
      connection.off(LiveTTSEvents.Error, onError);
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

    const updatePlaybackOnFlush = (flushedText: string): void => {
      if (!flushedText || !context.isTurnCurrent()) {
        return;
      }
      const playbackMs = Math.floor((emittedAudioBytes / 2 / AUDIO_SAMPLE_RATE) * 1000);
      spokenPlaybackMs = playbackMs;
    };

    const drainPendingFlushQueue = (): void => {
      while (flushTextQueue.length > 0) {
        const flushedText = flushTextQueue.shift() ?? '';
        updatePlaybackOnFlush(flushedText);
        receivedFlushes += 1;
      }
    };

    const armFlushFallback = (): void => {
      if (settled || !sendingComplete) {
        return;
      }
      if (receivedFlushes >= expectedFlushes) {
        return;
      }
      if (flushFallbackTimer) {
        clearTimeout(flushFallbackTimer);
        flushFallbackTimer = null;
      }

      flushFallbackTimer = setTimeout(() => {
        flushFallbackTimer = null;
        if (settled) return;
        if (!context.isTurnCurrent()) {
          resolveOnce();
          return;
        }

        const idleMs =
          lastAudioAtMs === null ? Number.POSITIVE_INFINITY : Date.now() - lastAudioAtMs;
        if (idleMs < DEEPGRAM_FLUSH_FALLBACK_IDLE_MS) {
          armFlushFallback();
          return;
        }

        if (receivedFlushes < expectedFlushes) {
          const connectionAlive =
            typeof connection.isConnected === 'function' ? connection.isConnected() : true;
          const stalledSinceCompleteMs =
            sendingCompleteAtMs === null ? 0 : Date.now() - sendingCompleteAtMs;
          if (
            connectionAlive &&
            stalledSinceCompleteMs < DEEPGRAM_FLUSH_FALLBACK_FORCE_MS
          ) {
            armFlushFallback();
            return;
          }
          drainPendingFlushQueue();
          if (receivedFlushes < expectedFlushes) {
            receivedFlushes = expectedFlushes;
          }
          forceReconnectAfterTurn = true;
        }

        maybeResolve();
      }, DEEPGRAM_FLUSH_FALLBACK_POLL_MS);
    };

    const maybeResolve = (): void => {
      if (settled) return;
      if (aborted) {
        resolveOnce();
        return;
      }
      if (!context.isTurnCurrent()) {
        resolveOnce();
        return;
      }
      if (!sendingComplete) {
        return;
      }
      if (receivedFlushes < expectedFlushes) {
        return;
      }
      void audioPipeline.then(() => resolveOnce()).catch((error) => {
        rejectOnce(error as Error);
      });
    };

    const emitChunk = async (chunk: ArrayBuffer): Promise<boolean> => {
      if (!context.isTurnCurrent()) {
        return false;
      }

      let onsetDetectedInChunk = false;
      if (!speechOnsetDetected) {
        const onsetByteInChunk = detectSpeechOnsetInChunk(chunk);
        if (onsetByteInChunk >= 0) {
          speechOnsetBytes = emittedAudioBytes + onsetByteInChunk;
          speechOnsetDetected = true;
          onsetDetectedInChunk = true;
        }
      }

      emittedAudioBytes += chunk.byteLength;
      emittedChunks += 1;
      const isFirstAudio = firstAudioAtMs === null;
      if (isFirstAudio) {
        firstAudioAtMs = Date.now();
        if (!speaking) {
          context.setSpeaking();
          speaking = true;
        }
      }

      context.trackAssistantOutput(chunk);
      context.emitAudio(chunk);

      if (onsetDetectedInChunk) {
        drainSpokenWordBuffer();
      }

      await sleep(20);
      return true;
    };

    const enqueueAudio = (payload: Uint8Array | ArrayBuffer): void => {
      audioPipeline = audioPipeline.then(async () => {
        const bytes =
          payload instanceof ArrayBuffer
            ? new Uint8Array(payload)
            : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
        const copied = new Uint8Array(bytes.byteLength);
        copied.set(bytes);
        const chunks = chunkArrayBuffer(copied.buffer, PCM_BYTES_PER_100MS);
        for (const chunk of chunks) {
          if (aborted) return;
          const keepGoing = await emitChunk(chunk);
          if (!keepGoing) {
            aborted = true;
            context.connectionManager.close();
            return;
          }
        }
      });
    };

    const requestFlush = (): void => {
      if (!context.isTurnCurrent() || pendingChars <= 0) return;
      const flushText = pendingText;
      connection.sendText(flushText);
      flushTextQueue.push(flushText);
      pendingText = '';
      pendingChars = 0;
      expectedFlushes += 1;
      spokeAudio = true;
      connection.flush();
    };

    const onAudio = (payload: unknown): void => {
      const binary = toRawDataUint8Array(payload);
      if (!binary || binary.byteLength === 0) return;
      lastAudioAtMs = Date.now();
      enqueueAudio(binary);
      if (sendingComplete) {
        armFlushFallback();
      }
    };

    const onFlushed = (): void => {
      const flushedText = flushTextQueue.shift() ?? '';
      updatePlaybackOnFlush(flushedText);
      receivedFlushes += 1;
      maybeResolve();
    };

    const onWarning = (event: unknown): void => {
      const warning = toDeepgramLiveError(event, 'Deepgram websocket TTS warning');
      context.emitError(warning);
    };

    const onClose = (): void => {
      if (settled) return;
      if (!context.isTurnCurrent()) {
        resolveOnce();
        return;
      }
      if (sendingComplete) {
        drainPendingFlushQueue();
        if (receivedFlushes < expectedFlushes) {
          receivedFlushes = expectedFlushes;
          forceReconnectAfterTurn = true;
        }
        maybeResolve();
        return;
      }
      rejectOnce(new Error('Deepgram websocket TTS closed before flush completed'));
    };

    const onError = (event: unknown): void => {
      if (settled) return;
      if (!context.isTurnCurrent()) {
        resolveOnce();
        return;
      }
      const error = toDeepgramLiveError(event, 'Deepgram websocket TTS error');
      context.connectionManager.close();
      rejectOnce(error);
    };

    connection.on(LiveTTSEvents.Audio, onAudio);
    connection.on(LiveTTSEvents.Flushed, onFlushed);
    connection.on(LiveTTSEvents.Warning, onWarning);
    connection.on(LiveTTSEvents.Close, onClose);
    connection.on(LiveTTSEvents.Error, onError);

    void (async () => {
      try {
        for await (const delta of textStream) {
          if (!context.isTurnCurrent()) {
            aborted = true;
            context.connectionManager.close();
            break;
          }
          if (!delta) continue;
          assistantText += delta;
          context.emitTranscriptDelta(delta);

          if (spokenStreamEnabled) {
            const completeWords = spokenWordBuffer.ingestDelta(delta);
            if (completeWords) {
              emitSpokenWord(completeWords);
            }
          }

          pendingText += delta;
          pendingChars += delta.length;

          if (punctuationChunkingEnabled) {
            if (
              shouldFlushDeepgramStream(
                delta,
                pendingChars,
                expectedFlushes,
                true
              )
            ) {
              requestFlush();
            }
          } else {
            connection.sendText(delta);
          }
        }

        llmDurationMs = Date.now() - llmStartedAtMs;
        sendingComplete = true;
        sendingCompleteAtMs = Date.now();

        if (!aborted && (pendingChars > 0 || expectedFlushes === 0)) {
          if (!punctuationChunkingEnabled) {
            flushTextQueue.push(pendingText);
            pendingText = '';
            pendingChars = 0;
            expectedFlushes += 1;
            spokeAudio = true;
            connection.flush();
          } else {
            requestFlush();
          }
        }

        maybeResolve();
        armFlushFallback();
      } catch (error) {
        context.connectionManager.close();
        if (!context.isTurnCurrent()) {
          aborted = true;
          resolveOnce();
          return;
        }
        rejectOnce(toDeepgramLiveError(error, 'Deepgram websocket TTS stream failed'));
      }
    })();
  });

  context.emitLatency({
    stage: 'tts',
    durationMs: Date.now() - ttsStartedAtMs,
    provider: options.ttsProvider,
    model: options.model,
    details: {
      textChars: assistantText.length,
      audioBytes: emittedAudioBytes,
      chunks: emittedChunks,
      firstAudioLatencyMs:
        firstAudioAtMs === null ? null : Math.max(0, firstAudioAtMs - ttsStartedAtMs),
      streaming: true,
      flushes: expectedFlushes,
      flushMode: punctuationChunkingEnabled ? 'punctuation' : 'size-threshold',
    },
  });

  if (context.isTurnCurrent()) {
    context.setListening();
  }

  if (!speechOnsetDetected && emittedAudioBytes > 0) {
    drainSpokenWordBuffer();
  }

  const trailingWords = spokenWordBuffer.flushRemainder();
  if (trailingWords) {
    emitSpokenWord(trailingWords);
  }

  if (spokenStreamEnabled && spokenText && context.isTurnCurrent()) {
    spokenPlaybackMs = Math.floor((emittedAudioBytes / 2 / AUDIO_SAMPLE_RATE) * 1000);
    context.emitSpokenFinal(spokenText, {
      spokenChars,
      spokenWords,
      playbackMs: spokenPlaybackMs,
      precision: 'segment',
    });
  }

  if (forceReconnectAfterTurn) {
    context.connectionManager.close();
  }

  return {
    text: assistantText,
    spokenText,
    spokeAudio,
    llmDurationMs,
    interrupted: !context.isTurnCurrent(),
  };
}
