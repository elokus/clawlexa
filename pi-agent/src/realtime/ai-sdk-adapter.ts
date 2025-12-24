/**
 * AI SDK Adapter - Converts OpenAI Realtime API events to AI SDK format.
 *
 * This adapter enables voice sessions to emit the same event format as text-based
 * subagents (CLI, web-search). The frontend receives `stream_chunk` messages for
 * all agent types, simplifying state management.
 *
 * Mapping:
 * - transcript (assistant) → text-delta
 * - transcript (user) → text-delta (user messages are also streamed)
 * - toolStart → tool-call
 * - toolEnd → tool-result
 * - stateChange (thinking) → start-step
 * - stateChange (idle) → finish
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
  transcript: { text: string; role: 'user' | 'assistant' };
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
      const { text } = payload as VoiceEventPayloads['transcript'];
      // AI SDK v5 uses 'text-delta' with 'textDelta' property
      return { type: 'text-delta', textDelta: text };
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
      if (state === 'idle') {
        return { type: 'finish', finishReason: 'stop' };
      }
      // listening and speaking don't have direct AI SDK equivalents
      // They're handled by the frontend via state_change events
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
  return {
    /**
     * Emit a transcript event (user or assistant speech).
     */
    transcript(text: string, role: 'user' | 'assistant'): void {
      adaptVoiceEvent(sessionId, 'transcript', { text, role });
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
     */
    stateChange(state: 'idle' | 'listening' | 'thinking' | 'speaking', profile: string | null): void {
      adaptVoiceEvent(sessionId, 'stateChange', { state, profile });
    },

    /**
     * Emit an error event.
     */
    error(message: string): void {
      adaptVoiceEvent(sessionId, 'error', { message });
    },
  };
}

export type VoiceAdapter = ReturnType<typeof createVoiceAdapter>;
