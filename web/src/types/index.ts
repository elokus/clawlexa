// ═══════════════════════════════════════════════════════════════════════════
// VΞRTΞX Types
// ═══════════════════════════════════════════════════════════════════════════

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface TranscriptMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  pending?: boolean; // True when we have an ID but no transcription yet
}

export interface RealtimeEvent {
  id: string;
  type: string;
  timestamp: number;
  data: unknown;
}

// CLI Session types (matching pi-agent)
export type SessionStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_input'
  | 'finished'
  | 'error'
  | 'cancelled';

export interface CliSession {
  id: string;
  goal: string;
  status: SessionStatus;
  mac_session_id: string | null;
  parent_id: string | null;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CliEvent {
  id: number;
  session_id: string;
  event_type: 'created' | 'started' | 'input' | 'output' | 'status_change' | 'error' | 'finished';
  payload: Record<string, unknown> | null;
  created_at: string;
}

// Agent profile
export interface AgentProfile {
  name: string;
  wakeWord: string;
  voice: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Message Types (Phase 5: Simplified Protocol)
// ═══════════════════════════════════════════════════════════════════════════
//
// Core types (7):
// - welcome            : Client identity + service state on connect
// - stream_chunk       : All agent message events (AI SDK format)
// - session_tree_update: Session hierarchy changes
// - state_change       : Voice UI state (listening/thinking/speaking)
// - master_changed     : Multi-client coordination
// - service_state_changed: Service active/dormant + audio mode
// - audio_control      : Audio playback control (start/stop/interrupt)
//
// Lifecycle types (3):
// - session_started/ended: Voice session lifecycle
// - cli_session_deleted  : Terminal session cleanup
// - error                : Error messages
//
export type WSMessageType =
  // Core unified protocol
  | 'welcome'               // Client identity on connect
  | 'stream_chunk'          // All agent events (AI SDK format: text-delta, tool-call, etc.)
  | 'session_tree_update'   // Session hierarchy for ThreadRail
  | 'state_change'          // Voice UI state (listening/thinking/speaking/idle)
  | 'master_changed'        // Multi-client master coordination
  | 'service_state_changed' // Service active/dormant + audio mode
  | 'audio_control'         // Audio playback control (start/stop/interrupt)
  // Lifecycle events
  | 'session_started'       // Voice session activated
  | 'session_ended'         // Voice session deactivated
  | 'cli_session_deleted'   // Terminal session removed
  | 'error';                // Error messages

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Payload Types (Phase 5: Simplified)
// ═══════════════════════════════════════════════════════════════════════════

export interface WelcomePayload {
  clientId: string;
  isMaster: boolean;
  serviceActive: boolean;
  audioMode: 'web' | 'local';
}

export interface ServiceStateChangedPayload {
  active: boolean;
  mode: 'web' | 'local';
}

export interface MasterChangedPayload {
  masterId: string;
}

export interface StateChangePayload {
  state: AgentState;
  profile: string | null;
}

export interface SessionStartedPayload {
  sessionId?: string;
  profile?: string;
}

// Activity Block types for UI rendering
export type ActivityBlockType = 'reasoning' | 'tool' | 'content' | 'error';

interface BaseBlock {
  id: string;
  timestamp: number;
  agent: string;
  /** Orchestrator session ID for per-session activity tracking */
  orchestratorId?: string;
}

export interface ReasoningBlock extends BaseBlock {
  type: 'reasoning';
  content: string; // Accumulated reasoning text
  isComplete: boolean;
  durationMs?: number;
}

export interface ToolBlock extends BaseBlock {
  type: 'tool';
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result?: string;
  isComplete: boolean;
}

export interface ContentBlock extends BaseBlock {
  type: 'content';
  text: string;
}

export interface ErrorBlock extends BaseBlock {
  type: 'error';
  message: string;
}

export type ActivityBlock = ReasoningBlock | ToolBlock | ContentBlock | ErrorBlock;

// Re-export stage types
export * from './stage';

// Re-export timeline types
export * from './timeline';
