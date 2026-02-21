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
  readonly id: VoiceProviderId;
  private handlers = new Map<keyof VoiceSessionEvents, Set<(...args: unknown[]) => void>>();

  constructor(id: VoiceProviderId = 'openai-sdk') {
    this.id = id;
  }

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

function createSession(adapter: FakeAdapter): VoiceSessionImpl {
  return new VoiceSessionImpl(adapter, {
    provider: adapter.id,
    instructions: 'test',
    voice: 'echo',
    model: 'test-model',
  });
}

describe('VoiceSessionImpl ordering metadata', () => {
  test('assigns monotonic item order and reuses it across transcript events', async () => {
    const adapter = new FakeAdapter();
    const session = createSession(adapter);

    const userItems: Array<{ itemId: string; order?: number }> = [];
    const assistantItems: Array<{ itemId: string; order?: number }> = [];
    const transcripts: Array<{ role: 'user' | 'assistant'; text: string; order?: number }> = [];
    const deltas: Array<{ role: 'user' | 'assistant'; delta: string; order?: number }> = [];

    session.on('userItemCreated', (itemId, order) => {
      userItems.push({ itemId, order });
    });
    session.on('assistantItemCreated', (itemId, _previousItemId, order) => {
      assistantItems.push({ itemId, order });
    });
    session.on('transcript', (text, role, _itemId, order) => {
      transcripts.push({ role, text, order });
    });
    session.on('transcriptDelta', (delta, role, _itemId, order) => {
      deltas.push({ role, delta, order });
    });

    await session.connect();

    adapter.emit('userItemCreated', 'user-1');
    adapter.emit('transcript', 'Hallo', 'user', 'user-1');
    adapter.emit('assistantItemCreated', 'assistant-1', 'user-1');
    adapter.emit('transcriptDelta', 'Hi ', 'assistant', 'assistant-1');
    adapter.emit('transcriptDelta', 'there', 'assistant', 'assistant-1');
    adapter.emit('turnComplete');
    adapter.emit('transcript', 'Hi there', 'assistant', 'assistant-1');

    expect(userItems).toEqual([{ itemId: 'user-1', order: 1 }]);
    expect(assistantItems).toEqual([{ itemId: 'assistant-1', order: 2 }]);
    expect(transcripts).toEqual([
      { role: 'user', text: 'Hallo', order: 1 },
      { role: 'assistant', text: 'Hi there', order: 2 },
    ]);
    expect(deltas).toEqual([
      { role: 'assistant', delta: 'Hi ', order: 2 },
      { role: 'assistant', delta: 'there', order: 2 },
    ]);

    await session.close();
  });

  test('transcript-first paths get stable order that is reused by later item_created event', async () => {
    const adapter = new FakeAdapter();
    const session = createSession(adapter);

    const userOrders: number[] = [];
    const transcriptOrders: number[] = [];

    session.on('userItemCreated', (_itemId, order) => {
      if (typeof order === 'number') userOrders.push(order);
    });
    session.on('transcript', (_text, role, _itemId, order) => {
      if (role === 'user' && typeof order === 'number') transcriptOrders.push(order);
    });

    await session.connect();

    adapter.emit('transcript', 'early', 'user', 'user-early');
    adapter.emit('userItemCreated', 'user-early');
    adapter.emit('transcript', 'next', 'user', 'user-next');

    expect(transcriptOrders).toEqual([1, 2]);
    expect(userOrders).toEqual([1]);

    await session.close();
  });

  test('missing itemId assistant transcript events inherit latest assistant order', async () => {
    const adapter = new FakeAdapter();
    const session = createSession(adapter);

    const deltaOrders: Array<number | undefined> = [];
    const finalOrders: Array<number | undefined> = [];

    session.on('transcriptDelta', (_delta, role, _itemId, order) => {
      if (role === 'assistant') deltaOrders.push(order);
    });
    session.on('transcript', (_text, role, _itemId, order) => {
      if (role === 'assistant') finalOrders.push(order);
    });

    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-1');
    adapter.emit('transcriptDelta', 'chunk-a', 'assistant');
    adapter.emit('transcriptDelta', 'chunk-b', 'assistant');
    adapter.emit('turnComplete');
    adapter.emit('transcript', 'final-a', 'assistant');
    adapter.emit('assistantItemCreated', 'assistant-2');
    adapter.emit('transcript', 'final-b', 'assistant');

    expect(deltaOrders).toEqual([1, 1]);
    expect(finalOrders).toEqual([1, 2]);

    await session.close();
  });

  test('order sequence resets between sessions', async () => {
    const adapter = new FakeAdapter();
    const session = createSession(adapter);
    const orders: number[] = [];

    session.on('userItemCreated', (_itemId, order) => {
      if (typeof order === 'number') orders.push(order);
    });

    await session.connect();
    adapter.emit('userItemCreated', 'first-session-user');
    await session.close();

    await session.connect();
    adapter.emit('userItemCreated', 'second-session-user');
    await session.close();

    expect(orders).toEqual([1, 1]);
  });

  test('assistant previousItemId reserves earlier order for later user item events', async () => {
    const adapter = new FakeAdapter();
    const session = createSession(adapter);
    const events: Array<{ kind: 'user' | 'assistant'; itemId: string; order?: number }> = [];

    session.on('userItemCreated', (itemId, order) => {
      events.push({ kind: 'user', itemId, order });
    });
    session.on('assistantItemCreated', (itemId, _previousItemId, order) => {
      events.push({ kind: 'assistant', itemId, order });
    });

    await session.connect();

    adapter.emit('assistantItemCreated', 'assistant-1', 'user-1');
    adapter.emit('userItemCreated', 'user-1');
    adapter.emit('assistantItemCreated', 'assistant-2', 'user-2');
    adapter.emit('userItemCreated', 'user-2');

    expect(events).toEqual([
      { kind: 'assistant', itemId: 'assistant-1', order: 2 },
      { kind: 'user', itemId: 'user-1', order: 1 },
      { kind: 'assistant', itemId: 'assistant-2', order: 4 },
      { kind: 'user', itemId: 'user-2', order: 3 },
    ]);

    await session.close();
  });

  test('preserves adapter-provided order hints when events arrive out of order', async () => {
    const adapter = new FakeAdapter();
    const session = createSession(adapter);
    const events: Array<{ kind: 'user' | 'assistant'; itemId: string; order?: number }> = [];

    session.on('userItemCreated', (itemId, order) => {
      events.push({ kind: 'user', itemId, order });
    });
    session.on('assistantItemCreated', (itemId, _previousItemId, order) => {
      events.push({ kind: 'assistant', itemId, order });
    });

    await session.connect();

    // Provider emits assistant turn before delayed user transcript.
    adapter.emit('assistantItemCreated', 'assistant-2', 'user-1', 3);
    adapter.emit('transcriptDelta', 'Ja', 'assistant', 'assistant-2', 3);
    adapter.emit('userItemCreated', 'user-1', 2);
    adapter.emit('transcript', 'Hi', 'user', 'user-1', 2);

    expect(events).toEqual([
      { kind: 'assistant', itemId: 'assistant-2', order: 3 },
      { kind: 'user', itemId: 'user-1', order: 2 },
    ]);

    await session.close();
  });
});
