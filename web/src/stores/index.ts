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

  // Legacy compatibility selectors (for migration)
  useSessionPath,        // Alias for useFocusPath
  useSubagentActivities, // Alias for useAllActivities
  useSessions,           // Get sessions Map
  useEvents,             // Get events array
  useOverlayState,       // Get overlay state

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
  type ToolBlock,
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
// Legacy Stores - DELETED (2025-12-24)
// ─────────────────────────────────────────────────────────────────────────────
//
// The following stores have been deleted as part of Phase 3.4 migration:
//   - agent.ts → Use useUnifiedSessionsStore + useVoiceState, useVoiceTimeline
//   - stage.ts → Use useUnifiedSessionsStore + useFocusedSession, useFocusPath
//   - sessions.ts → Use useUnifiedSessionsStore.sessions Map
//
// See docs/SESSION_CENTRIC_REFACTOR_PLAN.md section 3.4.3 for migration mapping
//
