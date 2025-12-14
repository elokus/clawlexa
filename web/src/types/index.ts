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
  // CLI Agent streaming events (legacy)
  | 'cli_agent_thinking'
  | 'cli_agent_tool_call'
  | 'cli_agent_tool_result'
  | 'cli_agent_response'
  | 'cli_session_created'
  | 'cli_session_output'
  // Generic worker activity (new Observable Agent Runner pattern)
  | 'worker_activity';

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
  timestamp: number;
}

export interface StateChangePayload {
  state: AgentState;
  profile: string | null;
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

// CLI Agent event payloads
export interface CliAgentThinkingPayload {
  request: string;
}

export interface CliAgentToolCallPayload {
  toolName: string;
  args: Record<string, unknown>;
}

export interface CliAgentToolResultPayload {
  toolName: string;
  result: string;
  sessionId?: string;
}

export interface CliAgentResponsePayload {
  response: string;
}

export interface CliSessionCreatedPayload {
  id: string;
  goal: string;
  mode: 'headless' | 'interactive';
  projectPath: string;
  command: string;
}

export interface CliSessionOutputPayload {
  sessionId: string;
  output: string;
}

// CLI Agent activity for UI display
export interface CliAgentActivity {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'session_created';
  timestamp: number;
  data: unknown;
}
