import { describe, expect, test } from 'bun:test';
import { VoiceSessionImpl } from '../src/runtime/voice-session.js';
import type {
  AudioFrame,
  AudioNegotiation,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
  ToolCallResult,
  VoiceProviderId,
  VoiceSessionEvents,
} from '../src/types.js';

class FakeAdapter implements ProviderAdapter {
  readonly id: VoiceProviderId = 'openai-sdk';
  private handlers = new Map<keyof VoiceSessionEvents, Set<(...args: unknown[]) => void>>();

  capabilities(): ProviderCapabilities {
    return {
      toolCalling: true,
      transcriptDeltas: true,
      interruption: true,
      providerTransportKinds: ['sdk', 'websocket'],
      audioNegotiation: true,
      vadModes: ['server', 'semantic', 'manual', 'disabled'],
      interruptionModes: ['barge-in'],
      toolTimeout: false,
      asyncTools: true,
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

  interrupt(): void {}

  sendToolResult(_result: ToolCallResult): void {}

  on<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void {
    const set = this.handlers.get(event) ?? new Set<(...args: unknown[]) => void>();
    set.add(handler as (...args: unknown[]) => void);
    this.handlers.set(event, set);
  }

  off<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void {
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

describe('VoiceSessionImpl assistant transcript dedupe', () => {
  test('suppresses assistant final when same item already streamed deltas', async () => {
    const adapter = new FakeAdapter();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'openai-sdk',
      instructions: 'test',
      voice: 'echo',
      model: 'test-model',
    });

    const assistantFinals: string[] = [];
    session.on('transcript', (text, role) => {
      if (role === 'assistant') assistantFinals.push(text);
    });

    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-1');
    adapter.emit('transcriptDelta', 'Hello ', 'assistant', 'assistant-1');
    adapter.emit('transcript', 'Hello world', 'assistant', 'assistant-1');

    expect(assistantFinals).toEqual([]);

    await session.close();
  });

  test('suppresses assistant final without itemId when turn already streamed deltas', async () => {
    const adapter = new FakeAdapter();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'openai-sdk',
      instructions: 'test',
      voice: 'echo',
      model: 'test-model',
    });

    const assistantFinals: string[] = [];
    session.on('transcript', (text, role) => {
      if (role === 'assistant') assistantFinals.push(text);
    });

    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-1');
    adapter.emit('transcriptDelta', 'Hello ', 'assistant', 'assistant-1');
    adapter.emit('transcript', 'Hello world', 'assistant');

    expect(assistantFinals).toEqual([]);

    await session.close();
  });

  test('emits assistant final when no deltas were seen for the turn', async () => {
    const adapter = new FakeAdapter();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'openai-sdk',
      instructions: 'test',
      voice: 'echo',
      model: 'test-model',
    });

    const assistantFinals: string[] = [];
    session.on('transcript', (text, role) => {
      if (role === 'assistant') assistantFinals.push(text);
    });

    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-2');
    adapter.emit('transcript', 'No streaming path', 'assistant', 'assistant-2');

    expect(assistantFinals).toEqual(['No streaming path']);

    await session.close();
  });

  test('resets dedupe state at turn completion', async () => {
    const adapter = new FakeAdapter();
    const session = new VoiceSessionImpl(adapter, {
      provider: 'openai-sdk',
      instructions: 'test',
      voice: 'echo',
      model: 'test-model',
    });

    const assistantFinals: string[] = [];
    session.on('transcript', (text, role) => {
      if (role === 'assistant') assistantFinals.push(text);
    });

    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-1');
    adapter.emit('transcriptDelta', 'First turn', 'assistant', 'assistant-1');
    adapter.emit('transcript', 'First turn', 'assistant');
    adapter.emit('turnComplete');
    adapter.emit('transcript', 'Second turn final', 'assistant');

    expect(assistantFinals).toEqual(['Second turn final']);

    await session.close();
  });
});
