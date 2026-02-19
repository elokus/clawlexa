import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { UltravoxWsAdapter } from '../src/adapters/ultravox-ws-adapter.js';
import type { SessionInput } from '../src/types.js';

type Listener = {
  handler: (event: unknown) => void;
  once: boolean;
};

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  public readonly url: string;
  public readyState = FakeWebSocket.CONNECTING;
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
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: 1000 });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  emitJson(payload: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(payload) });
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
    provider: 'ultravox-ws',
    instructions: 'You are a helpful assistant',
    voice: 'echo',
    model: 'test-model',
    providerConfig: {
      apiKey: 'test-key',
      apiBaseUrl: 'https://api.ultravox.ai',
    },
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 200): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WEBSOCKET = globalThis.WebSocket;

describe('UltravoxWsAdapter transcript normalization', () => {
  let sockets: FakeWebSocket[] = [];

  beforeEach(() => {
    sockets = [];
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          joinUrl: 'ws://ultravox.test/ws',
          medium: {
            serverWebSocket: {
              inputSampleRate: 48000,
              outputSampleRate: 48000,
            },
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )) as typeof fetch;

    globalThis.WebSocket = class extends FakeWebSocket {
      constructor(url: string | URL) {
        super(String(url));
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.WebSocket = ORIGINAL_WEBSOCKET;
  });

  test('skips whitespace-only scaffold ordinals before first meaningful assistant text', async () => {
    const adapter = new UltravoxWsAdapter();
    const assistantItems: string[] = [];
    const assistantDeltas: Array<{ itemId?: string; text: string }> = [];

    adapter.on('assistantItemCreated', (itemId) => {
      assistantItems.push(itemId);
    });
    adapter.on('transcriptDelta', (delta, role, itemId) => {
      if (role === 'assistant') {
        assistantDeltas.push({ itemId, text: delta });
      }
    });

    const connectPromise = adapter.connect(createInput());
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0];
    expect(socket).toBeDefined();
    socket?.open();
    await connectPromise;

    socket?.emitJson({ type: 'transcript', role: 'assistant', ordinal: 1, delta: '\n' });
    socket?.emitJson({ type: 'transcript', role: 'assistant', ordinal: 2, delta: 'Na' });

    await waitFor(() => assistantDeltas.length === 1);
    expect(assistantItems).toEqual(['assistant-2']);
    expect(assistantDeltas).toEqual([{ itemId: 'assistant-2', text: 'Na' }]);
  });

  test('trims leading scaffold whitespace when first meaningful delta arrives on same ordinal', async () => {
    const adapter = new UltravoxWsAdapter();
    const assistantItems: string[] = [];
    const assistantDeltas: Array<{ itemId?: string; text: string }> = [];

    adapter.on('assistantItemCreated', (itemId) => {
      assistantItems.push(itemId);
    });
    adapter.on('transcriptDelta', (delta, role, itemId) => {
      if (role === 'assistant') {
        assistantDeltas.push({ itemId, text: delta });
      }
    });

    const connectPromise = adapter.connect(createInput());
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0];
    expect(socket).toBeDefined();
    socket?.open();
    await connectPromise;

    socket?.emitJson({ type: 'transcript', role: 'assistant', ordinal: 5, delta: '\n' });
    socket?.emitJson({ type: 'transcript', role: 'assistant', ordinal: 5, delta: ' Hallo' });

    await waitFor(() => assistantDeltas.length === 1);
    expect(assistantItems).toEqual(['assistant-5']);
    expect(assistantDeltas).toEqual([{ itemId: 'assistant-5', text: 'Hallo' }]);
  });

  test('announces user placeholder on first user transcript activity before meaningful text', async () => {
    const adapter = new UltravoxWsAdapter();
    const userItems: string[] = [];

    adapter.on('userItemCreated', (itemId) => {
      userItems.push(itemId);
    });

    const connectPromise = adapter.connect(createInput());
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0];
    expect(socket).toBeDefined();
    socket?.open();
    await connectPromise;

    socket?.emitJson({ type: 'transcript', role: 'user', ordinal: 1, delta: '\n' });
    await waitFor(() => userItems.length === 1);
    expect(userItems).toEqual(['user-1']);
  });
});
