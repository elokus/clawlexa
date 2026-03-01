/**
 * API Types - Shared types for WebSocket and HTTP API communication.
 */

export type { WSMessageType } from '@voiceclaw/voice-runtime';

/**
 * Payload for session handoff events.
 * Used when a voice session spawns a CLI session.
 */
export interface HandoffPayload {
  sessionId: string;
  parentId: string;
  threadId: string;
  mode: 'headless' | 'interactive';
  projectPath: string;
  goal: string;
}

/**
 * Payload for CLI session created events.
 */
export interface CliSessionCreatedPayload {
  id: string;
  goal: string;
  mode: 'headless' | 'interactive';
  projectPath: string;
  command: string;
  parentId?: string;
}

/**
 * Payload for CLI session update events.
 */
export interface CliSessionUpdatePayload {
  id: string;
  status: string;
  goal: string;
}

/**
 * Payload for CLI session output events.
 */
export interface CliSessionOutputPayload {
  sessionId: string;
  output: string;
}

/**
 * Payload for service state changed events.
 */
export interface ServiceStateChangedPayload {
  active: boolean;
  mode: 'web' | 'local';
}
