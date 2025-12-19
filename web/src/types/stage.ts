/**
 * Stage Types for Morphic Stage Interface
 *
 * The stage system manages a stack-based navigation where:
 * - activeStage: The currently focused view (center)
 * - threadRail: Parent contexts pushed to the right rail
 * - backgroundTasks: Minimized/persistent tasks on the left rail
 */

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

/** Action types for stage reducer pattern (if needed) */
export type StageAction =
  | { type: 'PUSH'; item: StageItem }
  | { type: 'POP' }
  | { type: 'BACKGROUND'; id: string }
  | { type: 'RESTORE'; id: string }
  | { type: 'RESET' };

/** Overlay types for modals triggered from BackgroundRail */
export type OverlayType = 'events' | 'tools' | 'history' | null;
