import { describe, expect, test } from 'bun:test';
import { LiveTTSEvents } from '@deepgram/sdk';
import { DecomposedAdapter } from '../src/adapters/decomposed-adapter.js';
import type { SessionInput } from '../src/types.js';

function createInput(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    provider: 'decomposed',
    instructions: 'Be concise',
    voice: 'echo',
    model: 'gpt-4.1-mini',
    providerConfig: {
      llmProvider: 'openai',
      ttsProvider: 'openai',
      sttProvider: 'openai',
      openaiApiKey: 'test-key',
      turn: {
        spokenStreamEnabled: true,
      },
    },
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

describe('DecomposedAdapter interruption hardening', () => {
  test('interrupt aborts in-flight llm/tts controllers and clears VAD buffers', async () => {
    const adapter = new DecomposedAdapter();
    const adapterAny = adapter as unknown as {
      beginLlmRequest: () => AbortController;
      beginTtsRequest: () => AbortController;
      activeLlmAbortController: AbortController | null;
      activeTtsAbortController: AbortController | null;
      speechChunks: Uint8Array[];
      speechStartedAtMs: number | null;
      silenceTimer: ReturnType<typeof setTimeout> | null;
    };

    await adapter.connect(createInput());
    const llmController = adapterAny.beginLlmRequest();
    const ttsController = adapterAny.beginTtsRequest();
    adapterAny.speechChunks = [new Uint8Array([1, 2, 3])];
    adapterAny.speechStartedAtMs = Date.now();
    adapterAny.silenceTimer = setTimeout(() => {}, 10_000);

    adapter.interrupt();

    expect(llmController.signal.aborted).toBe(true);
    expect(ttsController.signal.aborted).toBe(true);
    expect(adapterAny.activeLlmAbortController).toBeNull();
    expect(adapterAny.activeTtsAbortController).toBeNull();
    expect(adapterAny.speechChunks).toHaveLength(0);
    expect(adapterAny.speechStartedAtMs).toBeNull();
    expect(adapterAny.silenceTimer).toBeNull();

    await adapter.disconnect();
  });

  test('drops stale assistant turn when interrupted mid-generation', async () => {
    const adapter = new DecomposedAdapter();
    const adapterAny = adapter as unknown as {
      generateAssistantResponseStreaming: (
        systemPrompt: string,
        assistantId: string,
        turnGeneration: number
      ) => Promise<{
        marker: '✓' | '○' | '◐';
        text: string;
        spokeAudio: boolean;
        llmDurationMs: number;
        interrupted: boolean;
      }>;
      assistantTurnQueue: Promise<void>;
      history: Array<{ role: string; content: string }>;
    };

    let capturedTurnGeneration: number | null = null;
    adapterAny.generateAssistantResponseStreaming = async (
      _systemPrompt: string,
      _assistantId: string,
      turnGeneration: number
    ) => {
      capturedTurnGeneration = turnGeneration;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        marker: '✓',
        text: 'stale answer should never commit',
        spokeAudio: false,
        llmDurationMs: 30,
        interrupted: false,
      };
    };

    const assistantTranscripts: string[] = [];
    let turnCompleteCount = 0;
    adapter.on('transcript', (text, role) => {
      if (role === 'assistant') {
        assistantTranscripts.push(text);
      }
    });
    adapter.on('turnComplete', () => {
      turnCompleteCount += 1;
    });

    await adapter.connect(createInput());
    adapter.sendText('test prompt');

    await waitFor(() => capturedTurnGeneration !== null);
    adapter.interrupt();
    await adapterAny.assistantTurnQueue;

    expect(assistantTranscripts).toHaveLength(0);
    expect(turnCompleteCount).toBe(0);
    expect(adapterAny.history.some((entry) => entry.role === 'assistant')).toBe(false);

    await adapter.disconnect();
  });

  test('emits spoken stream events for inline TTS segments when enabled', async () => {
    const adapter = new DecomposedAdapter();
    const adapterAny = adapter as unknown as {
      interruptionGeneration: number;
      streamTextWithInlineTts: (
        textStream: AsyncIterable<string>,
        assistantId: string,
        llmStartedAtMs: number,
        turnGeneration: number
      ) => Promise<{
        text: string;
        spokeAudio: boolean;
        llmDurationMs: number;
        interrupted: boolean;
      }>;
      speakSegment: (
        text: string,
        turnGeneration: number,
        details?: { segmentIndex?: number; onFirstAudio?: () => void }
      ) => Promise<number>;
    };

    await adapter.connect(createInput());

    // Keep this purely unit-level: no network TTS calls in this test.
    adapterAny.speakSegment = async (
      _text: string,
      _turnGeneration: number,
      details?: { segmentIndex?: number; onFirstAudio?: () => void }
    ) => {
      details?.onFirstAudio?.();
      return 120;
    };

    const spokenDeltas: string[] = [];
    const spokenProgress: Array<{ spokenChars: number; spokenWords: number; playbackMs: number }> = [];
    const spokenFinals: string[] = [];

    adapter.on('spokenDelta', (delta) => {
      spokenDeltas.push(delta);
    });
    adapter.on('spokenProgress', (_itemId, progress) => {
      spokenProgress.push(progress);
    });
    adapter.on('spokenFinal', (text) => {
      spokenFinals.push(text);
    });

    const stream = (async function* (): AsyncGenerator<string> {
      yield 'Hello ';
      yield 'world';
    })();

    const result = await adapterAny.streamTextWithInlineTts(
      stream,
      'assistant-inline-1',
      Date.now(),
      adapterAny.interruptionGeneration
    );

    expect(result.interrupted).toBe(false);
    expect(result.spokeAudio).toBe(true);
    expect(result.text).toBe('Hello world');
    expect(spokenDeltas.join('')).toBe('Hello world');
    expect(spokenProgress.length).toBeGreaterThan(0);
    expect(spokenProgress.at(-1)?.spokenChars).toBe('Hello world'.length);
    expect(spokenProgress.at(-1)?.spokenWords).toBe(2);
    expect(spokenFinals).toEqual(['Hello world']);

    await adapter.disconnect();
  });

  test('emits initial zero spoken-progress before streaming output', async () => {
    const adapter = new DecomposedAdapter();
    const adapterAny = adapter as unknown as {
      generateAssistantResponseStreaming: (
        systemPrompt: string,
        assistantId: string,
        turnGeneration: number
      ) => Promise<{
        marker: '✓' | '○' | '◐';
        text: string;
        spokeAudio: boolean;
        llmDurationMs: number;
        interrupted: boolean;
      }>;
      assistantTurnQueue: Promise<void>;
    };

    adapterAny.generateAssistantResponseStreaming = async () => ({
      marker: '✓',
      text: 'streamed response',
      spokeAudio: true,
      llmDurationMs: 1,
      interrupted: false,
    });

    const progressEvents: Array<{ spokenChars: number; spokenWords: number; playbackMs: number }> = [];
    adapter.on('spokenProgress', (_itemId, progress) => {
      progressEvents.push(progress);
    });

    await adapter.connect(createInput());
    adapter.sendText('hello');
    await adapterAny.assistantTurnQueue;

    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[0]).toMatchObject({
      spokenChars: 0,
      spokenWords: 0,
      playbackMs: 0,
    });

    await adapter.disconnect();
  });

  test('drains pending Deepgram flush text when final flush event is missing', async () => {
    const adapter = new DecomposedAdapter();
    const adapterAny = adapter as unknown as {
      interruptionGeneration: number;
      ensureDeepgramTtsConnection: () => Promise<FakeDeepgramConnection>;
      streamTextWithDeepgramTts: (
        textStream: AsyncIterable<string>,
        assistantId: string,
        llmStartedAtMs: number,
        turnGeneration: number
      ) => Promise<{
        text: string;
        spokeAudio: boolean;
        llmDurationMs: number;
        interrupted: boolean;
      }>;
    };

    const connection = new FakeDeepgramConnection();
    adapterAny.ensureDeepgramTtsConnection = async () => connection;

    const spokenDeltas: string[] = [];
    const spokenFinals: string[] = [];
    adapter.on('spokenDelta', (delta) => {
      spokenDeltas.push(delta);
    });
    adapter.on('spokenFinal', (text) => {
      spokenFinals.push(text);
    });

    await adapter.connect(
      createInput({
        providerConfig: {
          llmProvider: 'openai',
          ttsProvider: 'deepgram',
          sttProvider: 'openai',
          openaiApiKey: 'test-key',
          deepgramApiKey: 'deepgram-test-key',
          turn: {
            spokenStreamEnabled: true,
            deepgramTtsPunctuationChunkingEnabled: true,
          },
        },
      })
    );

    const stream = (async function* (): AsyncGenerator<string> {
      yield 'Das ist ein ziemlich langer erster Teil ';
      yield 'und das Ende?';
    })();

    const startedAt = Date.now();
    const result = await adapterAny.streamTextWithDeepgramTts(
      stream,
      'assistant-deepgram-1',
      Date.now(),
      adapterAny.interruptionGeneration
    );
    const elapsedMs = Date.now() - startedAt;

    expect(result.interrupted).toBe(false);
    expect(result.spokeAudio).toBe(true);
    expect(result.text).toBe('Das ist ein ziemlich langer erster Teil und das Ende?');
    expect(elapsedMs).toBeLessThan(2000);
    expect(connection.sentTexts.length).toBe(2);
    expect(spokenDeltas.join('')).toBe(result.text);
    expect(spokenFinals.at(-1)).toBe(result.text);

    await adapter.disconnect();
  });
});

class FakeDeepgramConnection {
  sentTexts: string[] = [];
  private flushCount = 0;
  private handlers = new Map<string, Set<(payload?: unknown) => void>>();

  on(event: string, handler: (payload?: unknown) => void): void {
    const set = this.handlers.get(event) ?? new Set<(payload?: unknown) => void>();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: (payload?: unknown) => void): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  sendText(text: string): void {
    this.sentTexts.push(text);
  }

  flush(): void {
    this.flushCount += 1;
    const flushIndex = this.flushCount;
    queueMicrotask(() => {
      this.emit(LiveTTSEvents.Audio, new Uint8Array(PCM_BYTES_PER_100MS));
      if (flushIndex === 1) {
        this.emit(LiveTTSEvents.Flushed);
      }
    });
  }

  private emit(event: string, payload?: unknown): void {
    const listeners = this.handlers.get(event);
    if (!listeners) return;
    for (const handler of listeners) {
      handler(payload);
    }
  }
}

const PCM_BYTES_PER_100MS = 4800;
