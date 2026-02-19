/**
 * Unified Stream Types - AI SDK Protocol for all agent events.
 *
 * This module defines the unified event protocol used by all agents (voice, subagent).
 * Events follow the Vercel AI SDK Data Stream Protocol format, enabling:
 * - One handler for all agent types on the frontend
 * - Consistent message accumulation logic
 * - Compatible with AI Elements components
 *
 * See: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */

/**
 * AI SDK stream event types.
 * These match the events from `streamText().fullStream` in AI SDK v5.
 *
 * Verified against ai@5.0.108 TypeScript types:
 * - 'text-delta' with textDelta property
 * - 'tool-call' with input property
 * - 'tool-result' with output property
 */
export type AISDKStreamEvent =
  // Text streaming
  | { type: 'text-delta'; textDelta: string; itemId?: string }

  // User transcript (custom extension for voice sessions)
  | { type: 'user-transcript'; text: string; itemId?: string }

  // Placeholders for message ordering (custom extension for voice sessions)
  // These reserve position in the timeline before transcripts arrive
  | { type: 'user-placeholder'; itemId: string; previousItemId?: string }
  | { type: 'assistant-placeholder'; itemId: string; previousItemId?: string }

  // Tool calls
  | { type: 'tool-call'; toolName: string; toolCallId: string; input: unknown }
  | { type: 'tool-result'; toolName: string; toolCallId: string; output: unknown }

  // Reasoning (for thinking models like Grok, DeepSeek R1)
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-end'; text: string; durationMs?: number }

  // Step lifecycle
  | { type: 'start' }
  | { type: 'start-step' }
  | {
      type: 'finish-step';
      finishReason?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        reasoningTokens?: number;
      };
    }
  | { type: 'finish'; finishReason: string }

  // Errors
  | { type: 'error'; error: string }

  // Process lifecycle notifications (background tasks)
  | { type: 'process-status'; processName: string; sessionId: string; status: 'completed' | 'error'; summary?: string };

/**
 * Unified stream chunk message sent via WebSocket.
 *
 * All agents (voice, CLI, web-search) emit this format.
 * The frontend accumulates these into conversation messages.
 */
export interface StreamChunkMessage {
  type: 'stream_chunk';
  /** Session ID this event belongs to */
  sessionId: string;
  /** The AI SDK format event */
  event: AISDKStreamEvent;
  /** Timestamp when event was emitted */
  timestamp: number;
}

/**
 * Session status for stream events.
 */
export type StreamSessionStatus = 'running' | 'finished' | 'error' | 'cancelled';

/**
 * Session metadata for stream chunk context.
 */
export interface StreamSessionMeta {
  sessionId: string;
  agentName: string;
  status: StreamSessionStatus;
}

/**
 * Helper to create a stream chunk message.
 */
export function createStreamChunk(
  sessionId: string,
  event: AISDKStreamEvent
): StreamChunkMessage {
  return {
    type: 'stream_chunk',
    sessionId,
    event,
    timestamp: Date.now(),
  };
}
