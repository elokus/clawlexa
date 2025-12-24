// ═══════════════════════════════════════════════════════════════════════════
// Stores Index - Unified exports for gradual migration
// ═══════════════════════════════════════════════════════════════════════════
//
// Migration Strategy:
// 1. New components should import from unified-sessions
// 2. Legacy components can continue importing from agent, stage, sessions
// 3. Eventually, delete legacy stores and update all imports
//
// Usage:
//   // New way (preferred)
//   import { useUnifiedSessionsStore, useFocusedSession } from '@/stores';
//
//   // Legacy way (deprecated)
//   import { useAgentStore } from '@/stores/agent';
//   import { useStageStore } from '@/stores/stage';
//   import { useSessionsStore } from '@/stores/sessions';

// ─────────────────────────────────────────────────────────────────────────────
// New Unified Store (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Main store
  useUnifiedSessionsStore,

  // Selector hooks
  useFocusedSession,
  useFocusPath,
  useFocusedSessionChildren,
  useSessionActivities,
  useAllActivities,
  useHasActiveSession,
  useVoiceTimeline,
  useConnectionState,
  useVoiceState,

  // Types
  type SessionState,
  type SessionType,
  type SessionStatus,
  type AgentState,
  type Message,
  type MessagePart,
  type MessageRole,
  type ActivityBlock,
  type ReasoningBlock,
  type ToolActivityBlock,
  type ContentBlock,
  type ErrorBlock,
  type AISDKStreamEvent,
  type TimelineItem,
  type TranscriptItem,
  type ToolItem,
  type SessionTreeNode,
  type OverlayType,
} from './unified-sessions';

// ─────────────────────────────────────────────────────────────────────────────
// Message Handler
// ─────────────────────────────────────────────────────────────────────────────

export { handleWebSocketMessage, createDualModeHandler } from './message-handler';

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Stores (deprecated - use unified store instead)
// ─────────────────────────────────────────────────────────────────────────────

// Re-export for backward compatibility during migration
export { useAgentStore, useSubagentActivities } from './agent';
export { useStageStore, useFocusedSession as useLegacyFocusedSession, useSessionPath, useFocusedSessionChildren as useLegacyFocusedSessionChildren, useHasActiveTree } from './stage';
export { useSessionsStore } from './sessions';
