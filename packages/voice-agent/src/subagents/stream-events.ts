import type { LlmEvent } from '@voiceclaw/llm-runtime';
import { wsBroadcast } from '../api/websocket.js';

interface StreamBridgeOptions {
  sessionId?: string;
  onToolCall?: (event: {
    toolName: string;
    toolCallId: string;
    input?: unknown;
  }) => void;
  onToolResult?: (event: {
    toolName: string;
    toolCallId: string;
    output?: unknown;
    isError?: boolean;
  }) => void;
}

export async function forwardLlmStreamToSession(
  events: AsyncIterable<LlmEvent>,
  options: StreamBridgeOptions
): Promise<{ text: string; eventCount: number }> {
  let text = '';
  let eventCount = 0;

  for await (const event of events) {
    eventCount++;

    if (event.type === 'start') {
      if (options.sessionId) {
        wsBroadcast.streamChunk(options.sessionId, { type: 'start' });
      }
      continue;
    }

    if (event.type === 'start-step') {
      if (options.sessionId) {
        wsBroadcast.streamChunk(options.sessionId, { type: 'start-step' });
      }
      continue;
    }

    if (event.type === 'text-delta') {
      text += event.textDelta;
      if (options.sessionId) {
        wsBroadcast.streamChunk(options.sessionId, {
          type: 'text-delta',
          textDelta: event.textDelta,
        });
      }
      continue;
    }

    if (event.type === 'reasoning-delta') {
      if (options.sessionId) {
        wsBroadcast.streamChunk(options.sessionId, {
          type: 'reasoning-delta',
          text: event.text,
        });
      }
      continue;
    }

    if (event.type === 'tool-call') {
      options.onToolCall?.({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: event.input,
      });

      if (options.sessionId) {
        wsBroadcast.streamChunk(options.sessionId, {
          type: 'tool-call',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input,
        });
      }
      continue;
    }

    if (event.type === 'tool-result') {
      options.onToolResult?.({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        output: event.output,
        isError: event.isError,
      });

      if (options.sessionId) {
        const outputStr =
          typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
        wsBroadcast.streamChunk(options.sessionId, {
          type: 'tool-result',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          output: outputStr,
          ...(event.isError ? { isError: true } : {}),
        });
      }
      continue;
    }

    if (event.type === 'finish') {
      if (options.sessionId) {
        wsBroadcast.streamChunk(options.sessionId, {
          type: 'finish',
          finishReason: event.finishReason ?? 'stop',
        });
      }
      continue;
    }

    if (event.type === 'error') {
      if (options.sessionId) {
        wsBroadcast.streamChunk(options.sessionId, {
          type: 'error',
          error: event.error,
        });
      }
      throw new Error(event.error);
    }
  }

  return { text, eventCount };
}
