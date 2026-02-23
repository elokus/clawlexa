import { describe, expect, test } from 'bun:test';
import { VoiceSessionImpl } from '../src/runtime/voice-session.js';
import type {
  AudioFrame,
  AudioNegotiation,
  ClientTransport,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
  ToolCallResult,
  VoiceHistoryItem,
  VoiceSessionEvents,
  VoiceState,
} from '../src/types.js';

function audioFrame(durationMs: number, sampleRate = 24000): AudioFrame {
  const sampleCount = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  return {
    data: new ArrayBuffer(sampleCount * 2),
    sampleRate,
    format: 'pcm16',
  };
}

class FakeTransport implements ClientTransport {
  readonly kind = 'ws-pcm' as const;
  private audioHandlers = new Set<(frame: AudioFrame) => void>();
  private playbackPositionMs = 0;
  public interruptedCount = 0;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  onAudioFrame(handler: (frame: AudioFrame) => void): void {
    this.audioHandlers.add(handler);
  }

  offAudioFrame(handler: (frame: AudioFrame) => void): void {
    this.audioHandlers.delete(handler);
  }

  playAudioFrame(frame: AudioFrame): void {
    this.playbackPositionMs += (frame.data.byteLength / 2 / frame.sampleRate) * 1000;
  }

  interruptPlayback(): void {
    this.interruptedCount += 1;
  }

  getPlaybackPositionMs(): number {
    return this.playbackPositionMs;
  }

  setPlaybackPositionMs(positionMs: number): void {
    this.playbackPositionMs = positionMs;
  }
}

class FakeAdapter implements ProviderAdapter {
  readonly id = 'ultravox-ws' as const;
  public interruptCount = 0;
  public truncateCalls: Array<{ itemId: string; audioEndMs: number }> = [];
  private handlers = new Map<keyof VoiceSessionEvents, Set<(...args: unknown[]) => void>>();

  capabilities(): ProviderCapabilities {
    return {
      toolCalling: true,
      transcriptDeltas: true,
      interruption: true,
      providerTransportKinds: ['websocket'],
      audioNegotiation: true,
      vadModes: ['server'],
      interruptionModes: ['barge-in'],
      toolTimeout: false,
      asyncTools: false,
      toolCancellation: false,
      toolScheduling: false,
      toolReaction: false,
      precomputableTools: false,
      toolApproval: false,
      mcpTools: false,
      serverSideTools: false,
      sessionResumption: false,
      midSessionConfigUpdate: false,
      contextCompression: false,
      forceAgentMessage: false,
      outputMediumSwitch: false,
      callState: false,
      deferredText: false,
      callStages: false,
      proactivity: false,
      usageMetrics: false,
      orderedTranscripts: true,
      ephemeralTokens: false,
      nativeTruncation: false,
      wordLevelTimestamps: false,
    };
  }

  async connect(_input: SessionInput): Promise<AudioNegotiation> {
    return {
      providerInputRate: 24000,
      providerOutputRate: 24000,
      preferredClientInputRate: 24000,
      preferredClientOutputRate: 24000,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {}
  sendAudio(_frame: AudioFrame): void {}
  sendText(_text: string): void {}

  interrupt(): void {
    this.interruptCount += 1;
  }

  truncateOutput(input: { itemId: string; audioEndMs: number }): void {
    this.truncateCalls.push(input);
  }

  sendToolResult(_result: ToolCallResult): void {}

  on<K extends keyof VoiceSessionEvents>(event: K, handler: EventHandler<VoiceSessionEvents, K>): void {
    const set = this.handlers.get(event) ?? new Set<(...args: unknown[]) => void>();
    set.add(handler as (...args: unknown[]) => void);
    this.handlers.set(event, set);
  }

  off<K extends keyof VoiceSessionEvents>(event: K, handler: EventHandler<VoiceSessionEvents, K>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as (...args: unknown[]) => void);
  }

  emit<K extends keyof VoiceSessionEvents>(
    event: K,
    ...args: Parameters<NonNullable<VoiceSessionEvents[K]>>
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as (...eventArgs: Parameters<NonNullable<VoiceSessionEvents[K]>>) => void)(...args);
    }
  }
}

describe('VoiceSessionImpl interruption resolution', () => {
  test('truncates local history when provider has no native truncation', async () => {
    const adapter = new FakeAdapter();
    const transport = new FakeTransport();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'ultravox-ws',
      instructions: 'Be concise',
      voice: 'echo',
      model: 'test-model',
    });

    const interruptionContexts: Array<{ spokenText: string; fullText: string; truncated: boolean }> = [];
    const historyUpdates: VoiceHistoryItem[][] = [];

    session.on('interruptionResolved', (context) => {
      interruptionContexts.push({
        spokenText: context.spokenText,
        fullText: context.fullText,
        truncated: context.truncated,
      });
    });

    session.on('historyUpdated', (history) => {
      historyUpdates.push(history);
    });

    await session.attachClientTransport(transport);
    await session.connect();

    adapter.emit('historyUpdated', [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: 'Hello world',
        createdAt: Date.now(),
      },
    ]);
    adapter.emit('assistantItemCreated', 'assistant-1');
    adapter.emit('transcriptDelta', 'Hello ', 'assistant', 'assistant-1');
    adapter.emit('audio', audioFrame(100));
    adapter.emit('transcript', 'Hello world', 'assistant', 'assistant-1');

    transport.setPlaybackPositionMs(80);
    session.interrupt();

    expect(adapter.interruptCount).toBe(1);
    expect(transport.interruptedCount).toBe(1);
    expect(interruptionContexts).toHaveLength(1);
    expect(interruptionContexts[0]?.fullText).toBe('Hello world');
    expect(interruptionContexts[0]?.spokenText).toBe('Hello ');
    expect(interruptionContexts[0]?.truncated).toBe(true);
    expect(historyUpdates.at(-1)?.[0]?.text).toBe('Hello ');
  });

  test('resolves interruption when adapter emits audioInterrupted', async () => {
    const adapter = new FakeAdapter();
    const transport = new FakeTransport();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'ultravox-ws',
      instructions: 'Be concise',
      voice: 'echo',
      model: 'test-model',
    });

    const interruptionContexts: Array<{ spokenText: string; fullText: string; truncated: boolean }> = [];
    const historyUpdates: VoiceHistoryItem[][] = [];

    session.on('interruptionResolved', (context) => {
      interruptionContexts.push({
        spokenText: context.spokenText,
        fullText: context.fullText,
        truncated: context.truncated,
      });
    });

    session.on('historyUpdated', (history) => {
      historyUpdates.push(history);
    });

    await session.attachClientTransport(transport);
    await session.connect();

    adapter.emit('historyUpdated', [
      {
        id: 'assistant-2',
        role: 'assistant',
        text: 'Hello world',
        createdAt: Date.now(),
      },
    ]);
    adapter.emit('assistantItemCreated', 'assistant-2');
    adapter.emit('transcriptDelta', 'Hello ', 'assistant', 'assistant-2');
    adapter.emit('audio', audioFrame(100));
    adapter.emit('transcript', 'Hello world', 'assistant', 'assistant-2');

    transport.setPlaybackPositionMs(80);
    adapter.emit('audioInterrupted');

    expect(interruptionContexts).toHaveLength(1);
    expect(interruptionContexts[0]?.fullText).toBe('Hello world');
    expect(interruptionContexts[0]?.spokenText).toBe('Hello ');
    expect(interruptionContexts[0]?.truncated).toBe(true);
    expect(historyUpdates.at(-1)?.[0]?.text).toBe('Hello ');
    expect(transport.interruptedCount).toBe(1);
  });

  test('emits synthesized spoken channel events from audio progression', async () => {
    const adapter = new FakeAdapter();
    const transport = new FakeTransport();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'ultravox-ws',
      instructions: 'Be concise',
      voice: 'echo',
      model: 'test-model',
    });

    const spokenDeltas: Array<{ delta: string; itemId?: string }> = [];
    const spokenProgress: Array<{ itemId: string; spokenChars: number; spokenWords: number }> = [];
    const spokenFinals: Array<{ text: string; itemId?: string; precision?: string }> = [];

    session.on('spokenDelta', (delta, _role, itemId) => {
      spokenDeltas.push({ delta, itemId });
    });
    session.on('spokenProgress', (itemId, progress) => {
      spokenProgress.push({
        itemId,
        spokenChars: progress.spokenChars,
        spokenWords: progress.spokenWords,
      });
    });
    session.on('spokenFinal', (text, _role, itemId, meta) => {
      spokenFinals.push({ text, itemId, precision: meta?.precision });
    });

    await session.attachClientTransport(transport);
    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-3');
    adapter.emit('transcriptDelta', 'Hello ', 'assistant', 'assistant-3');
    transport.setPlaybackPositionMs(100);
    adapter.emit('audio', audioFrame(100));
    adapter.emit('transcript', 'Hello world', 'assistant', 'assistant-3');
    adapter.emit('turnComplete');

    expect(spokenDeltas).toEqual([{ delta: 'Hello ', itemId: 'assistant-3' }]);
    expect(spokenProgress.length).toBeGreaterThan(0);
    expect(spokenProgress[0]?.itemId).toBe('assistant-3');
    expect(spokenProgress[0]?.spokenChars).toBe(6);
    expect(spokenProgress[0]?.spokenWords).toBe(1);
    expect(spokenFinals).toEqual([
      {
        text: 'Hello ',
        itemId: 'assistant-3',
        precision: 'segment',
      },
    ]);
  });

  test('uses adapter spoken progress for interruption context when available', async () => {
    const adapter = new FakeAdapter();
    const transport = new FakeTransport();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'ultravox-ws',
      instructions: 'Be concise',
      voice: 'echo',
      model: 'test-model',
    });

    const interruptionContexts: Array<{
      spokenText: string;
      precision?: string;
      spokenWordCount?: number;
    }> = [];

    session.on('interruptionResolved', (context) => {
      interruptionContexts.push({
        spokenText: context.spokenText,
        precision: context.precision,
        spokenWordCount: context.spokenWordCount,
      });
    });

    await session.attachClientTransport(transport);
    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-4');
    adapter.emit('transcript', 'Hello world', 'assistant', 'assistant-4');
    adapter.emit('spokenProgress', 'assistant-4', {
      spokenChars: 6,
      spokenWords: 1,
      playbackMs: 120,
      precision: 'segment',
    });

    session.interrupt();

    expect(interruptionContexts).toHaveLength(1);
    expect(interruptionContexts[0]?.spokenText).toBe('Hello ');
    expect(interruptionContexts[0]?.precision).toBe('segment');
    expect(interruptionContexts[0]?.spokenWordCount).toBe(1);
  });
});
