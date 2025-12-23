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

// WebSocket message types
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
  | 'cli_session_deleted'
  // Unified subagent activity stream
  | 'subagent_activity'
  // Session tree updates (v2 architecture)
  | 'session_tree_update'
  // Multi-client master/replica coordination
  | 'welcome'
  | 'master_changed'
  | 'request_master';

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
  timestamp: number;
}

// Multi-client coordination payloads
export interface WelcomePayload {
  clientId: string;
  isMaster: boolean;
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

export interface TranscriptPayload {
  id?: string;
  text: string;
  role: MessageRole;
  final?: boolean;
}

export interface ToolPayload {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
}

export interface ItemPendingPayload {
  itemId: string;
  role: MessageRole;
}

export interface ItemCompletedPayload {
  itemId: string;
  text: string;
  role: MessageRole;
}

// CLI Session payloads (still used for session management)
export interface CliSessionCreatedPayload {
  id: string;
  goal: string;
  mode: 'headless' | 'interactive';
  projectPath: string;
  command: string;
  parentId?: string;
}

export interface CliSessionOutputPayload {
  sessionId: string;
  output: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Subagent Activity Types - Unified UI state for all subagent events
// ═══════════════════════════════════════════════════════════════════════════

export type SubagentEventType =
  | 'reasoning_start'
  | 'reasoning_delta'
  | 'reasoning_end'
  | 'tool_call'
  | 'tool_result'
  | 'response'
  | 'error'
  | 'complete';

export interface SubagentActivityPayload {
  agent: string;
  type: SubagentEventType;
  payload: unknown;
  /** Orchestrator session ID for per-session activity tracking */
  orchestratorId?: string;
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
