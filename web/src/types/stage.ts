/**
 * Stage Types for Morphic Stage Interface
 *
 * NEW ARCHITECTURE (v2):
 * - sessionTree: Full tree from backend (orchestrator → terminals)
 * - focusedSessionId: Currently viewed session in the tree
 * - backgroundTrees: Minimized thread trees
 *
 * The frontend no longer manages stage transitions - it just renders
 * what the backend tells it via session_tree_update events.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Session Tree Types (from backend)
// ═══════════════════════════════════════════════════════════════════════════

export type SessionType = 'orchestrator' | 'terminal';

export type SessionStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_input'
  | 'finished'
  | 'error'
  | 'cancelled';

export type AgentName = 'cli' | 'web_search' | 'deep_thinking';

/**
 * Session tree node - matches backend SessionTreeNode
 */
export interface SessionTreeNode {
  id: string;
  type: SessionType;
  status: SessionStatus;
  goal: string;
  agent_name: AgentName | null;
  tool_call_id: string | null; // For terminals: links to the tool call that created them
  created_at: string;
  children: SessionTreeNode[];
}

/**
 * Payload for session_tree_update WebSocket event
 */
export interface SessionTreeUpdatePayload {
  /** Root session ID being updated */
  rootId?: string;
  /** Updated tree structure (single tree update) */
  tree?: SessionTreeNode;
  /** All active trees (initial load) */
  trees?: SessionTreeNode[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Stage Types (kept for compatibility during migration)
// ═══════════════════════════════════════════════════════════════════════════

export type StageType = 'chat' | 'terminal' | 'subagent';

export type StageStatus = 'active' | 'waiting' | 'background';

export interface StageData {
  /** CLI session ID for terminal stages */
  sessionId?: string;
  /** Future: reference to chat history segment */
  chatHistoryRef?: string;
  /** Subagent name for subagent stages */
  agentName?: string;
  /** Parent agent name for context */
  parentAgentName?: string;
}

export interface StageItem {
  /** Unique identifier for the stage */
  id: string;
  /** Type of stage content */
  type: StageType;
  /** Display title for the stage */
  title: string;
  /** Parent stage ID for thread linkage */
  parentId?: string;
  /** Additional data specific to stage type */
  data?: StageData;
  /** Current status of the stage */
  status: StageStatus;
  /** Timestamp when stage was created */
  createdAt: number;
}

/** @deprecated Use session_tree_update events instead */
export type StageAction =
  | { type: 'PUSH'; item: StageItem }
  | { type: 'POP' }
  | { type: 'BACKGROUND'; id: string }
  | { type: 'RESTORE'; id: string }
  | { type: 'RESET' };

/** Overlay types for modals triggered from BackgroundRail */
export type OverlayType = 'events' | 'tools' | 'history' | null;
