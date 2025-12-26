/**
 * API Types - Shared types for WebSocket and HTTP API communication.
 */

/**
 * WebSocket message types.
 */
export type WSMessageType =
  | 'state_change'
  | 'transcript'
  | 'audio_start'
  | 'audio_end'
  | 'error'
  | 'session_started'
  | 'session_ended'
  | 'tool_start'
  | 'tool_end'
  | 'item_pending'
  | 'item_completed'
  | 'cli_session_update'
  | 'cli_session_created'
  | 'cli_session_output'
  | 'subagent_activity'
  | 'welcome'
  | 'master_changed'
  | 'request_master';

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
