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

import { broadcast } from '../api/websocket.js';
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
  transcript: { text: string; role: 'user' | 'assistant'; itemId?: string };
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

// Track current tool call IDs for tool-result matching
const pendingToolCalls = new Map<string, string>(); // toolName → toolCallId

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
  payload: VoiceEventPayloads[T]
): AISDKStreamEvent | null {
  switch (eventType) {
    case 'transcript': {
      const { text, role, itemId } = payload as VoiceEventPayloads['transcript'];
      // User messages use custom 'user-transcript' event
      // Assistant messages use standard AI SDK 'text-delta'
      if (role === 'user') {
        return { type: 'user-transcript', text, itemId };
      }
      return { type: 'text-delta', textDelta: text, itemId };
    }

    case 'toolStart': {
      const { name, args, callId } = payload as VoiceEventPayloads['toolStart'];
      const toolCallId = callId ?? generateToolCallId();
      // Track for matching with tool-result
      pendingToolCalls.set(name, toolCallId);
      return {
        type: 'tool-call',
        toolName: name,
        toolCallId,
        input: args,
      };
    }

    case 'toolEnd': {
      const { name, result, callId } = payload as VoiceEventPayloads['toolEnd'];
      // Use provided callId or look up from pending
      const toolCallId = callId ?? pendingToolCalls.get(name) ?? generateToolCallId();
      pendingToolCalls.delete(name);
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
 */
function broadcastStreamChunk(chunk: StreamChunkMessage): void {
  broadcast('stream_chunk', {
    sessionId: chunk.sessionId,
    event: chunk.event,
  });
}

/**
 * Create an adapter instance for a specific voice session.
 * Provides a cleaner API for VoiceSession to use.
 */
export function createVoiceAdapter(sessionId: string) {
  // Initialize previous state tracking for this session
  previousStates.set(sessionId, 'idle');

  return {
    /**
     * Emit a user placeholder event (reserves position before transcript arrives).
     */
    userPlaceholder(itemId: string): void {
      const chunk = createStreamChunk(sessionId, { type: 'user-placeholder', itemId });
      broadcastStreamChunk(chunk);
    },

    /**
     * Emit an assistant placeholder event (reserves position before transcript arrives).
     */
    assistantPlaceholder(itemId: string, previousItemId?: string): void {
      const chunk = createStreamChunk(sessionId, { type: 'assistant-placeholder', itemId, previousItemId });
      broadcastStreamChunk(chunk);
    },

    /**
     * Emit a transcript event (user or assistant speech).
     */
    transcript(text: string, role: 'user' | 'assistant', itemId?: string): void {
      adaptVoiceEvent(sessionId, 'transcript', { text, role, itemId });
    },

    /**
     * Emit a tool start event.
     */
    toolStart(name: string, args: Record<string, unknown>, callId?: string): void {
      adaptVoiceEvent(sessionId, 'toolStart', { name, args, callId });
    },

    /**
     * Emit a tool end event.
     */
    toolEnd(name: string, result: string, callId?: string): void {
      adaptVoiceEvent(sessionId, 'toolEnd', { name, result, callId });
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
    },
  };
}

export type VoiceAdapter = ReturnType<typeof createVoiceAdapter>;
