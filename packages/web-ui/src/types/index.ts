// ═══════════════════════════════════════════════════════════════════════════
// VΞRTΞX Types
// ═══════════════════════════════════════════════════════════════════════════

import type {
  MasterChangedPayload,
  ServiceStateChangedPayload,
  SessionStartedPayload,
  StateChangePayload as RuntimeStateChangePayload,
  WelcomePayload,
  WSMessage,
  WSMessageType,
} from '@voiceclaw/voice-runtime';

export type {
  MasterChangedPayload,
  ServiceStateChangedPayload,
  SessionStartedPayload,
  WelcomePayload,
  WSMessage,
  WSMessageType,
};

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

// CLI Session types (matching voice-agent)
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

export type StateChangePayload = RuntimeStateChangePayload;

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
