import { describe, expect, test } from 'bun:test';
import { PipecatRtviAdapter } from '../src/adapters/pipecat-rtvi-adapter.js';
import type { SessionInput } from '../src/types.js';

type Listener = {
  handler: (event: unknown) => void;
  once: boolean;
};

class FakeWebSocket {
  public readonly url: string;
  public readyState = 0;
  public binaryType: 'blob' | 'arraybuffer' = 'blob';
  public readonly sent: unknown[] = [];

  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    handler: (event: unknown) => void,
    options?: AddEventListenerOptions
  ): void {
    const current = this.listeners.get(type) ?? [];
    current.push({
      handler,
      once: options?.once === true,
    });
    this.listeners.set(type, current);
  }

  removeEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    handler: (event: unknown) => void
  ): void {
    const current = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      current.filter((listener) => listener.handler !== handler)
    );
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close', { code: 1000 });
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  fail(message: string): void {
    this.emit('error', { message });
  }

  emitJson(payload: Record<string, unknown>): void {
    this.emit('message', {
      data: JSON.stringify(payload),
    });
  }

  emitBinary(data: ArrayBuffer): void {
    this.emit('message', { data });
  }

  private emit(type: string, event: unknown): void {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const listener of listeners) {
      listener.handler(event);
      if (listener.once) {
        this.removeEventListener(
          type as 'open' | 'close' | 'error' | 'message',
          listener.handler
        );
      }
    }
  }
}

function createInput(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    provider: 'pipecat-rtvi',
    instructions: 'You are a helpful assistant',
    voice: 'echo',
    model: 'test-model',
    providerConfig: {
      serverUrl: 'ws://localhost:9999/rtvi',
      transport: 'websocket',
      readyTimeoutMs: 200,
    },
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

function parseSentMessages(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => JSON.parse(entry) as Record<string, unknown>);
}

async function completeHandshake(socket: FakeWebSocket): Promise<void> {
  socket.open();
  await waitFor(() =>
    parseSentMessages(socket).some((message) => message.type === 'client-ready')
  );
  socket.emitJson({ type: 'bot-ready', data: {} });
}

describe('PipecatRtviAdapter', () => {
  test('connects with RTVI handshake and emits connected/listening', async () => {
    const sockets: FakeWebSocket[] = [];
    const adapter = new PipecatRtviAdapter({
      socketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    const states: string[] = [];
    let connected = 0;
    adapter.on('connected', () => {
      connected += 1;
    });
    adapter.on('stateChange', (state) => {
      states.push(state);
    });

    const connectPromise = adapter.connect(createInput());
    const socket = sockets[0];
    expect(socket).toBeDefined();
    await completeHandshake(socket as FakeWebSocket);
    await connectPromise;

    expect(connected).toBe(1);
    expect(states).toContain('listening');

    const sent = parseSentMessages(socket as FakeWebSocket);
    const messageTypes = sent.map((message) => message.type);
    expect(messageTypes).toContain('client-ready');
    expect(messageTypes).toContain('describe-actions');
    expect(messageTypes).toContain('describe-config');
    expect(messageTypes).toContain('client-message');
  });

  test('normalizes user transcription partial/final flow', async () => {
    const sockets: FakeWebSocket[] = [];
    const adapter = new PipecatRtviAdapter({
      socketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    const deltas: string[] = [];
    const finals: string[] = [];
    const userItems: string[] = [];

    adapter.on('transcriptDelta', (delta, role) => {
      if (role === 'user') deltas.push(delta);
    });
    adapter.on('transcript', (text, role) => {
      if (role === 'user') finals.push(text);
    });
    adapter.on('userItemCreated', (itemId) => {
      userItems.push(itemId);
    });

    const connectPromise = adapter.connect(createInput());
    const socket = sockets[0] as FakeWebSocket;
    await completeHandshake(socket);
    await connectPromise;

    socket.emitJson({
      type: 'user-transcription',
      data: { user_id: 'u1', text: 'Hello', final: false },
    });
    socket.emitJson({
      type: 'user-transcription',
      data: { user_id: 'u1', text: 'Hello world', final: true },
    });

    expect(userItems.length).toBe(1);
    expect(deltas).toEqual(['Hello', ' world']);
    expect(finals).toEqual(['Hello world']);
  });

  test('maps assistant text lifecycle and speaking state', async () => {
    const sockets: FakeWebSocket[] = [];
    const adapter = new PipecatRtviAdapter({
      socketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    const assistantDeltas: string[] = [];
    const assistantFinals: string[] = [];
    const states: string[] = [];
    let turnStarted = 0;
    let turnComplete = 0;

    adapter.on('transcriptDelta', (delta, role) => {
      if (role === 'assistant') assistantDeltas.push(delta);
    });
    adapter.on('transcript', (text, role) => {
      if (role === 'assistant') assistantFinals.push(text);
    });
    adapter.on('stateChange', (state) => {
      states.push(state);
    });
    adapter.on('turnStarted', () => {
      turnStarted += 1;
    });
    adapter.on('turnComplete', () => {
      turnComplete += 1;
    });

    const connectPromise = adapter.connect(createInput());
    const socket = sockets[0] as FakeWebSocket;
    await completeHandshake(socket);
    await connectPromise;

    socket.emitJson({ type: 'bot-llm-started', data: {} });
    socket.emitJson({ type: 'bot-output', data: { text: 'Hello' } });
    socket.emitJson({ type: 'bot-output', data: { text: 'Hello world' } });
    socket.emitJson({ type: 'bot-started-speaking', data: {} });
    socket.emitJson({ type: 'bot-stopped-speaking', data: {} });

    expect(assistantDeltas).toEqual(['Hello', ' world']);
    expect(assistantFinals).toEqual(['Hello world']);
    expect(states).toContain('thinking');
    expect(states).toContain('speaking');
    expect(states.at(-1)).toBe('listening');
    expect(turnStarted).toBeGreaterThanOrEqual(1);
    expect(turnComplete).toBeGreaterThanOrEqual(1);
  });

  test('auto-executes tool calls and returns llm-function-call-result', async () => {
    const sockets: FakeWebSocket[] = [];
    const adapter = new PipecatRtviAdapter({
      socketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    const starts: Array<{ name: string; callId: string }> = [];
    const ends: Array<{ name: string; callId: string; result: string }> = [];

    adapter.on('toolStart', (name, _args, callId) => {
      starts.push({ name, callId });
    });
    adapter.on('toolEnd', (name, result, callId) => {
      ends.push({ name, callId, result });
    });

    const connectPromise = adapter.connect(
      createInput({
        toolHandler: async (_name, args) => {
          return JSON.stringify({ ok: true, city: args.city });
        },
      })
    );
    const socket = sockets[0] as FakeWebSocket;
    await completeHandshake(socket);
    await connectPromise;

    socket.emitJson({
      type: 'llm-function-call',
      data: {
        function_name: 'weather',
        tool_call_id: 'call-1',
        arguments: { city: 'Berlin' },
      },
    });

    await waitFor(() => ends.length === 1);

    expect(starts).toHaveLength(1);
    expect(starts[0]).toEqual({ name: 'weather', callId: 'call-1' });
    expect(ends).toHaveLength(1);
    expect(ends[0]?.callId).toBe('call-1');

    const sent = parseSentMessages(socket);
    const resultEnvelope = sent.find((entry) => entry.type === 'llm-function-call-result');
    expect(resultEnvelope).toBeDefined();
    const data = resultEnvelope?.data as Record<string, unknown>;
    expect(data.tool_call_id).toBe('call-1');
  });

  test('reconnects automatically after unexpected close', async () => {
    const sockets: FakeWebSocket[] = [];
    const adapter = new PipecatRtviAdapter({
      maxReconnectRetries: 2,
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 3,
      socketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    let connectedCount = 0;
    adapter.on('connected', () => {
      connectedCount += 1;
    });

    const connectPromise = adapter.connect(createInput());
    await completeHandshake(sockets[0] as FakeWebSocket);
    await connectPromise;
    expect(connectedCount).toBe(1);

    sockets[0]?.close();
    await waitFor(() => sockets.length >= 2);
    await completeHandshake(sockets[1] as FakeWebSocket);
    await waitFor(() => connectedCount >= 2);
    expect(connectedCount).toBe(2);
  });

  test('emits turnComplete once when final bot-output and bot-stopped-speaking both arrive', async () => {
    const sockets: FakeWebSocket[] = [];
    const adapter = new PipecatRtviAdapter({
      socketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    let turnStarted = 0;
    let turnComplete = 0;
    const assistantFinals: string[] = [];

    adapter.on('turnStarted', () => {
      turnStarted += 1;
    });
    adapter.on('turnComplete', () => {
      turnComplete += 1;
    });
    adapter.on('transcript', (text, role) => {
      if (role === 'assistant') assistantFinals.push(text);
    });

    const connectPromise = adapter.connect(createInput());
    const socket = sockets[0] as FakeWebSocket;
    await completeHandshake(socket);
    await connectPromise;

    socket.emitJson({ type: 'bot-llm-started', data: {} });
    socket.emitJson({ type: 'bot-started-speaking', data: {} });
    socket.emitJson({
      type: 'bot-output',
      data: { text: 'Hello world', final: true },
    });
    socket.emitJson({ type: 'bot-stopped-speaking', data: {} });

    expect(turnStarted).toBe(1);
    expect(turnComplete).toBe(1);
    expect(assistantFinals).toEqual(['Hello world']);
  });

  test('starts keepalive ping after bot-ready and uses configured message type', async () => {
    const sockets: FakeWebSocket[] = [];
    const adapter = new PipecatRtviAdapter({
      socketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    const connectPromise = adapter.connect(
      createInput({
        providerConfig: {
          serverUrl: 'ws://localhost:9999/rtvi',
          transport: 'websocket',
          readyTimeoutMs: 200,
          keepAliveIntervalMs: 5,
          pingMessageType: 'health-check',
        },
      })
    );
    const socket = sockets[0] as FakeWebSocket;
    await completeHandshake(socket);
    await connectPromise;

    await waitFor(() =>
      parseSentMessages(socket).some((message) => {
        if (message.type !== 'client-message') return false;
        const data = message.data as Record<string, unknown> | undefined;
        return data?.t === 'health-check';
      }),
      250
    );

    await adapter.disconnect();
  });
});
