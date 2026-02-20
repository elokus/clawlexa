/**
 * AI SDK Adapter - Converts OpenAI Realtime API events to AI SDK format.
 *
 * This adapter enables voice sessions to emit the same event format as text-based
 * subagents (CLI, web-search). The frontend receives `stream_chunk` messages for
 * all agent types, simplifying state management.
 *
 * Mapping:
 * - transcript (assistant) → text-delta (streamed token by token)
 * - transcript (user) → user-transcript (complete message)
 * - toolStart → tool-call
 * - toolEnd → tool-result
 * - stateChange (thinking) → start-step
 * - stateChange (speaking → *) → finish (marks message complete between turns)
 * - error → error
 */

import { wsBroadcast } from '../api/websocket.js';
import type { AISDKStreamEvent, StreamChunkMessage } from '../api/stream-types.js';
import { createStreamChunk } from '../api/stream-types.js';

/**
 * Voice event types from VoiceSession/VoiceAgent.
 */
export type VoiceEventType =
  | 'stateChange'
  | 'transcript'
  | 'toolStart'
  | 'toolEnd'
  | 'error';

/**
 * Payload types for voice events.
 */
export interface VoiceEventPayloads {
  stateChange: { state: 'idle' | 'listening' | 'thinking' | 'speaking'; profile: string | null };
  transcript: { text: string; role: 'user' | 'assistant'; itemId?: string; order?: number };
  toolStart: { name: string; args: Record<string, unknown>; callId?: string };
  toolEnd: { name: string; result: string; callId?: string };
  error: { message: string };
}

/**
 * Generate a tool call ID for tracking tool-call → tool-result pairs.
 */
let toolCallCounter = 0;
function generateToolCallId(): string {
  return `voice-tool-${++toolCallCounter}`;
}

// Track previous state per session for detecting transitions
const previousStates = new Map<string, string>(); // sessionId → previous state

/**
 * Adapt a voice event to AI SDK format and broadcast as stream_chunk.
 *
 * @param sessionId - The voice session ID
 * @param eventType - The voice event type
 * @param payload - Event-specific payload
 */
export function adaptVoiceEvent<T extends VoiceEventType>(
  sessionId: string,
  eventType: T,
  payload: VoiceEventPayloads[T]
): void {
  const event = convertToAISDKEvent(eventType, payload);
  if (event) {
    const chunk = createStreamChunk(sessionId, event);
    broadcastStreamChunk(chunk);
  }
}

/**
 * Convert a voice event to an AI SDK stream event.
 */
function convertToAISDKEvent<T extends VoiceEventType>(
  eventType: T,
  payload: VoiceEventPayloads[T],
  options?: {
    consumePendingToolCall?: (toolName: string) => string | undefined;
    pushPendingToolCall?: (toolName: string, toolCallId: string) => void;
  }
): AISDKStreamEvent | null {
  switch (eventType) {
    case 'transcript': {
      const { text, role, itemId, order } = payload as VoiceEventPayloads['transcript'];
      // User messages use custom 'user-transcript' event
      // Assistant messages use standard AI SDK 'text-delta'
      if (role === 'user') {
        return { type: 'user-transcript', text, itemId, order };
      }
      return { type: 'text-delta', textDelta: text, itemId, order };
    }

    case 'toolStart': {
      const { name, args, callId } = payload as VoiceEventPayloads['toolStart'];
      const toolCallId = callId ?? generateToolCallId();
      options?.pushPendingToolCall?.(name, toolCallId);
      return {
        type: 'tool-call',
        toolName: name,
        toolCallId,
        input: args,
      };
    }

    case 'toolEnd': {
      const { name, result, callId } = payload as VoiceEventPayloads['toolEnd'];
      // Use provided callId or dequeue one from pending starts for the same tool name.
      const toolCallId = callId ?? options?.consumePendingToolCall?.(name) ?? generateToolCallId();
      return {
        type: 'tool-result',
        toolName: name,
        toolCallId,
        output: result,
      };
    }

    case 'stateChange': {
      const { state } = payload as VoiceEventPayloads['stateChange'];
      // Map state transitions to AI SDK events
      if (state === 'thinking') {
        return { type: 'start-step' };
      }
      // Note: 'finish' is now emitted by the stateChange() method when leaving 'speaking'
      // state, so we don't emit it here anymore to avoid duplicates.
      // listening, speaking, and idle don't have direct AI SDK equivalents
      return null;
    }

    case 'error': {
      const { message } = payload as VoiceEventPayloads['error'];
      return { type: 'error', error: message };
    }

    default:
      return null;
  }
}

/**
 * Broadcast a stream chunk message via WebSocket.
 * Uses wsBroadcast.streamChunk which also persists the event to database.
 */
function broadcastStreamChunk(chunk: StreamChunkMessage): void {
  wsBroadcast.streamChunk(chunk.sessionId, chunk.event);
}

/**
 * Create an adapter instance for a specific voice session.
 * Provides a cleaner API for VoiceSession to use.
 */
export function createVoiceAdapter(sessionId: string) {
  // Initialize previous state tracking for this session
  previousStates.set(sessionId, 'idle');
  const pendingToolCalls = new Map<string, string[]>();

  const pushPendingToolCall = (toolName: string, toolCallId: string): void => {
    const list = pendingToolCalls.get(toolName) ?? [];
    list.push(toolCallId);
    pendingToolCalls.set(toolName, list);
  };

  const consumePendingToolCall = (toolName: string): string | undefined => {
    const list = pendingToolCalls.get(toolName);
    if (!list || list.length === 0) {
      return undefined;
    }
    const next = list.shift();
    if (list.length === 0) {
      pendingToolCalls.delete(toolName);
    } else {
      pendingToolCalls.set(toolName, list);
    }
    return next;
  };

  return {
    /**
     * Emit a user placeholder event (reserves position before transcript arrives).
     */
    userPlaceholder(itemId: string, previousItemId?: string, order?: number): void {
      const chunk = createStreamChunk(sessionId, {
        type: 'user-placeholder',
        itemId,
        previousItemId,
        order,
      });
      broadcastStreamChunk(chunk);
    },

    /**
     * Emit an assistant placeholder event (reserves position before transcript arrives).
     */
    assistantPlaceholder(itemId: string, previousItemId?: string, order?: number): void {
      const chunk = createStreamChunk(sessionId, {
        type: 'assistant-placeholder',
        itemId,
        previousItemId,
        order,
      });
      broadcastStreamChunk(chunk);
    },

    /**
     * Emit a transcript event (user or assistant speech).
     */
    transcript(
      text: string,
      role: 'user' | 'assistant',
      itemId?: string,
      order?: number
    ): void {
      const event = convertToAISDKEvent('transcript', { text, role, itemId, order });
      if (!event) return;
      const chunk = createStreamChunk(sessionId, event);
      broadcastStreamChunk(chunk);
    },

    /**
     * Emit a tool start event.
     */
    toolStart(name: string, args: Record<string, unknown>, callId?: string): void {
      const event = convertToAISDKEvent(
        'toolStart',
        { name, args, callId },
        { pushPendingToolCall, consumePendingToolCall }
      );
      if (!event) return;
      const chunk = createStreamChunk(sessionId, event);
      broadcastStreamChunk(chunk);
    },

    /**
     * Emit a tool end event.
     */
    toolEnd(name: string, result: string, callId?: string): void {
      const event = convertToAISDKEvent(
        'toolEnd',
        { name, result, callId },
        { pushPendingToolCall, consumePendingToolCall }
      );
      if (!event) return;
      const chunk = createStreamChunk(sessionId, event);
      broadcastStreamChunk(chunk);
    },

    /**
     * Emit a state change event.
     * Emits 'finish' when transitioning FROM speaking (end of assistant turn).
     * Emits 'start-step' when entering thinking state.
     */
    stateChange(state: 'idle' | 'listening' | 'thinking' | 'speaking', profile: string | null): void {
      const prevState = previousStates.get(sessionId) ?? 'idle';
      previousStates.set(sessionId, state);

      // Emit finish when leaving speaking state (marks assistant message as complete)
      // This happens between turns (speaking → listening) and at end (speaking → idle)
      if (prevState === 'speaking' && state !== 'speaking') {
        const chunk = createStreamChunk(sessionId, { type: 'finish', finishReason: 'stop' });
        broadcastStreamChunk(chunk);
      }

      // Also emit the regular state-based events
      adaptVoiceEvent(sessionId, 'stateChange', { state, profile });
    },

    /**
     * Emit an error event.
     */
    error(message: string): void {
      adaptVoiceEvent(sessionId, 'error', { message });
    },

    /**
     * Clean up tracking state when session ends.
     */
    cleanup(): void {
      previousStates.delete(sessionId);
      pendingToolCalls.clear();
    },
  };
}

export type VoiceAdapter = ReturnType<typeof createVoiceAdapter>;
