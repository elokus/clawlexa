import type { LlmContext, LlmModelRef, LlmResponseSpec } from '@voiceclaw/ai-core/llm';
import type { ToolCallHandler } from '@voiceclaw/ai-core/tools';
import type {
  LlmCompleteResult,
  LlmEvent,
  OpenClawChannelLlmOptions,
} from '../types.js';

export interface OpenClawChannelStreamInput {
  model: LlmModelRef<'openclaw-channel'>;
  context: LlmContext;
  options?: OpenClawChannelLlmOptions | Record<string, unknown>;
  toolHandler?: ToolCallHandler;
  response?: LlmResponseSpec;
  signal?: AbortSignal;
}

/**
 * WebSocket protocol messages between VoiceClaw and OpenClaw channel.
 */
interface OpenClawInboundMessage {
  type: 'transcript';
  text: string;
  isFinal: boolean;
  sessionId?: string;
}

type OpenClawOutboundMessage =
  | { type: 'response'; text: string; isFinal: boolean; runId: string }
  | { type: 'response_end'; runId: string }
  | { type: 'status'; state: 'thinking' | 'responding' | 'idle' }
  | { type: 'pong' }
  | { type: 'error'; message: string };

function coerceOptions(
  options?: OpenClawChannelLlmOptions | Record<string, unknown>
): OpenClawChannelLlmOptions {
  if (!options) return {};
  return options as OpenClawChannelLlmOptions;
}

function resolveEndpoint(options: OpenClawChannelLlmOptions): string {
  return options.endpoint ?? process.env.OPENCLAW_ENDPOINT ?? 'ws://localhost:18800';
}

function resolveToken(options: OpenClawChannelLlmOptions): string | undefined {
  return options.token ?? process.env.OPENCLAW_TOKEN;
}

function resolveClientId(options: OpenClawChannelLlmOptions): string {
  return options.clientId ?? process.env.OPENCLAW_CLIENT_ID ?? 'voiceclaw-default';
}

function extractLastUserMessage(context: LlmContext): string | undefined {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const msg = context.messages[i];
    if (msg?.role === 'user') return msg.content;
  }
  return undefined;
}

/**
 * Stream LLM events from the OpenClaw VoiceClaw channel via WebSocket.
 *
 * Sends the latest user transcript to the channel and yields streaming
 * response chunks as LlmEvent text-delta events.
 */
export async function* streamOpenClawChannel(
  input: OpenClawChannelStreamInput
): AsyncIterable<LlmEvent> {
  const options = coerceOptions(input.options);
  const endpoint = resolveEndpoint(options);
  const token = resolveToken(options);
  const clientId = resolveClientId(options);

  const userText = extractLastUserMessage(input.context);
  if (!userText) {
    yield { type: 'error', error: 'No user message found in context' };
    return;
  }

  if (input.signal?.aborted) {
    yield { type: 'error', error: 'Aborted before stream start' };
    return;
  }

  // Build WebSocket URL with auth
  const wsUrl = new URL(endpoint);
  if (token) wsUrl.searchParams.set('token', token);
  wsUrl.searchParams.set('clientId', clientId);

  let ws: WebSocket | null = null;

  try {
    ws = new WebSocket(wsUrl.toString());

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws!.removeEventListener('open', onOpen);
        ws!.removeEventListener('error', onError);
        resolve();
      };
      const onError = (_e: Event) => {
        ws!.removeEventListener('open', onOpen);
        ws!.removeEventListener('error', onError);
        reject(new Error(`WebSocket connection failed to ${endpoint}`));
      };
      ws!.addEventListener('open', onOpen);
      ws!.addEventListener('error', onError);
    });

    yield { type: 'start' };

    // Send transcript
    const message: OpenClawInboundMessage = {
      type: 'transcript',
      text: userText,
      isFinal: true,
    };
    ws.send(JSON.stringify(message));

    // Listen for response events
    yield* readResponseStream(ws, input.signal);

    yield { type: 'finish', finishReason: 'stop' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield { type: 'error', error: message };
  } finally {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
  }
}

async function* readResponseStream(
  ws: WebSocket,
  signal?: AbortSignal
): AsyncIterable<LlmEvent> {
  // Use a manual queue to bridge WebSocket events to async iteration
  const queue: Array<LlmEvent | null> = [];
  let resolve: (() => void) | null = null;
  let error: Error | null = null;

  function enqueue(event: LlmEvent | null) {
    queue.push(event);
    if (resolve) {
      resolve();
      resolve = null;
    }
  }

  const onMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(
        typeof event.data === 'string' ? event.data : event.data.toString()
      ) as OpenClawOutboundMessage;

      if (data.type === 'response') {
        enqueue({ type: 'text-delta', textDelta: data.text });
      } else if (data.type === 'response_end') {
        enqueue(null); // Signal end
      } else if (data.type === 'error') {
        enqueue({ type: 'error', error: data.message });
        enqueue(null);
      }
      // Ignore 'status' and 'pong' messages
    } catch {
      // Ignore unparseable messages
    }
  };

  const onClose = () => {
    enqueue(null);
  };

  const onError = () => {
    error = new Error('WebSocket error during response stream');
    enqueue(null);
  };

  const onAbort = () => {
    error = new Error('Aborted');
    if (ws.readyState !== WebSocket.CLOSED) {
      // Send interrupt signal before closing
      try {
        ws.send(JSON.stringify({ type: 'interrupt' }));
      } catch {
        // Ignore send errors during abort
      }
    }
    enqueue(null);
  };

  ws.addEventListener('message', onMessage);
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', onError);
  signal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }

      while (queue.length > 0) {
        const item = queue.shift()!;
        if (item === null) {
          if (error) throw error;
          return;
        }
        yield item;
      }
    }
  } finally {
    ws.removeEventListener('message', onMessage);
    ws.removeEventListener('close', onClose);
    ws.removeEventListener('error', onError);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function completeOpenClawChannel(
  input: OpenClawChannelStreamInput
): Promise<LlmCompleteResult> {
  const events: LlmEvent[] = [];
  let text = '';

  for await (const event of streamOpenClawChannel(input)) {
    events.push(event);
    if (event.type === 'text-delta') {
      text += event.textDelta;
    }
    if (event.type === 'error') {
      throw new Error(event.error);
    }
  }

  return { text, events };
}
