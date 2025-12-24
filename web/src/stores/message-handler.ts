// ═══════════════════════════════════════════════════════════════════════════
// Message Handler - Routes WebSocket events to unified sessions store
// ═══════════════════════════════════════════════════════════════════════════
//
// This handler provides backward compatibility by:
// 1. Processing all existing event types (transcript, subagent_activity, etc.)
// 2. Routing them to the unified sessions store
// 3. Maintaining voice timeline for legacy ChatStage compatibility
//
// Migration path:
// - Old events (subagent_activity) → handleSubagentActivity
// - New events (stream_chunk) → handleStreamChunk
// - Voice events (transcript, tool_start) → voice timeline

import { useUnifiedSessionsStore, type TranscriptItem, type ToolItem } from './unified-sessions';
import type { WSMessage } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface StateChangePayload {
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  profile: string | null;
}

interface TranscriptPayload {
  id?: string;
  text: string;
  role: 'user' | 'assistant' | 'system';
  final?: boolean;
}

interface ItemPendingPayload {
  itemId: string;
  role: 'user' | 'assistant' | 'system';
}

interface ItemCompletedPayload {
  itemId: string;
  text: string;
  role: 'user' | 'assistant' | 'system';
}

interface ToolPayload {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
}

interface WelcomePayload {
  clientId: string;
  isMaster: boolean;
}

interface MasterChangedPayload {
  masterId: string;
}

interface SubagentActivityPayload {
  agent: string;
  type: string;
  payload: unknown;
  orchestratorId?: string;
}

interface SessionTreeUpdatePayload {
  tree?: {
    id: string;
    type: 'orchestrator' | 'terminal';
    status: string;
    goal: string;
    agent_name: string | null;
    tool_call_id: string | null;
    created_at: string;
    children: SessionTreeUpdatePayload['tree'][];
  };
  trees?: SessionTreeUpdatePayload['tree'][];
}

interface CliSessionCreatedPayload {
  id: string;
  goal: string;
  mode: 'headless' | 'interactive';
  projectPath: string;
  command: string;
  parentId?: string;
}

interface CliSessionDeletedPayload {
  sessionId?: string;
  all?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// ID Generator
// ═══════════════════════════════════════════════════════════════════════════

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// ═══════════════════════════════════════════════════════════════════════════
// Message Handler
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle incoming WebSocket message and route to unified store.
 * This provides backward compatibility with existing events while
 * preparing for the new stream_chunk protocol.
 */
export function handleWebSocketMessage(msg: WSMessage): void {
  const store = useUnifiedSessionsStore.getState();
  const { type, payload, timestamp } = msg;

  // Log event for debugging
  store.addEvent(type, payload);

  switch (type) {
    // ─────────────────────────────────────────────────────────────────────────
    // Connection Events
    // ─────────────────────────────────────────────────────────────────────────

    case 'welcome': {
      const { clientId, isMaster } = payload as WelcomePayload;
      console.log(`[WS] Welcome: clientId=${clientId.slice(0, 8)}, isMaster=${isMaster}`);
      store.setClientIdentity(clientId, isMaster);
      break;
    }

    case 'master_changed': {
      const { masterId } = payload as MasterChangedPayload;
      const { clientId } = store;
      const newIsMaster = clientId === masterId;
      console.log(`[WS] Master changed to ${masterId.slice(0, 8)}, isMaster=${newIsMaster}`);
      store.setIsMaster(newIsMaster);
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Voice Session Events
    // ─────────────────────────────────────────────────────────────────────────

    case 'state_change': {
      const { state, profile } = payload as StateChangePayload;
      store.setVoiceState(state, profile);
      break;
    }

    case 'session_started': {
      store.clearVoiceTimeline();
      store.setVoiceActive(true);
      break;
    }

    case 'session_ended': {
      store.setVoiceState('idle');
      store.setVoiceActive(false);
      store.setCurrentTool(null);
      break;
    }

    case 'transcript': {
      const { id, text, role, final } = payload as TranscriptPayload;
      const msgId = id || generateId();

      // Update voice timeline
      const { voiceTimeline } = store;
      const existingIdx = voiceTimeline.findIndex(
        (item) => item.type === 'transcript' && (item.id === msgId || (item.pending && item.role === role))
      );

      if (existingIdx >= 0 && text) {
        store.updateVoiceTimelineItem(voiceTimeline[existingIdx].id, {
          content: text,
          pending: !final,
        } as Partial<TranscriptItem>);
      } else {
        const newItem: TranscriptItem = {
          id: msgId,
          type: 'transcript',
          role,
          content: text || '',
          timestamp,
          pending: !final && !text,
        };
        store.addVoiceTimelineItem(newItem);
      }
      break;
    }

    case 'item_pending': {
      const { itemId, role } = payload as ItemPendingPayload;
      const newItem: TranscriptItem = {
        id: itemId,
        type: 'transcript',
        role,
        content: '',
        timestamp,
        pending: true,
      };
      store.addVoiceTimelineItem(newItem);
      break;
    }

    case 'item_completed': {
      const { itemId, text, role } = payload as ItemCompletedPayload;
      const { voiceTimeline } = store;
      const existingIdx = voiceTimeline.findIndex(
        (item) => item.type === 'transcript' && item.id === itemId
      );

      if (existingIdx >= 0) {
        store.updateVoiceTimelineItem(itemId, {
          content: text,
          pending: false,
        } as Partial<TranscriptItem>);
      } else {
        const newItem: TranscriptItem = {
          id: itemId,
          type: 'transcript',
          role,
          content: text,
          timestamp,
          pending: false,
        };
        store.addVoiceTimelineItem(newItem);
      }
      break;
    }

    case 'tool_start': {
      const { name, args } = payload as ToolPayload;
      const toolItem: ToolItem = {
        id: generateId(),
        type: 'tool',
        name,
        args,
        status: 'running',
        timestamp,
      };
      store.addVoiceTimelineItem(toolItem);
      store.setCurrentTool({ name, args });
      break;
    }

    case 'tool_end': {
      const { name, result } = payload as ToolPayload;
      const { voiceTimeline } = store;

      // Find the last running tool with matching name
      const toolIdx = voiceTimeline
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.type === 'tool' && (item as ToolItem).name === name && (item as ToolItem).status === 'running')
        .pop()?.idx;

      if (toolIdx !== undefined) {
        store.updateVoiceTimelineItem(voiceTimeline[toolIdx].id, {
          status: 'completed',
          result,
        } as Partial<ToolItem>);
      }

      store.setCurrentTool(null);
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session Tree Events (v2 Architecture)
    // ─────────────────────────────────────────────────────────────────────────

    case 'session_tree_update': {
      const treePayload = payload as SessionTreeUpdatePayload;
      store.handleSessionTreeUpdate(treePayload as Parameters<typeof store.handleSessionTreeUpdate>[0]);
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Subagent Activity Events (Legacy - will be replaced by stream_chunk)
    // ─────────────────────────────────────────────────────────────────────────

    case 'subagent_activity': {
      const { agent, type: eventType, payload: eventPayload, orchestratorId } = payload as SubagentActivityPayload;
      store.handleSubagentActivity(agent, eventType, eventPayload, timestamp, orchestratorId);
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLI Session Events
    // ─────────────────────────────────────────────────────────────────────────

    case 'cli_session_created': {
      const sessionData = payload as CliSessionCreatedPayload;
      store.upsertSession({
        id: sessionData.id,
        type: 'subagent',
        status: 'running',
        parentId: sessionData.parentId ?? null,
        goal: sessionData.goal,
      });
      break;
    }

    case 'cli_session_update': {
      const sessionUpdate = payload as { id: string; status: string; goal: string };
      store.upsertSession({
        id: sessionUpdate.id,
        status: sessionUpdate.status as 'running' | 'finished' | 'error' | 'cancelled',
      });
      break;
    }

    case 'cli_session_deleted': {
      const deletePayload = payload as CliSessionDeletedPayload;
      if (deletePayload.all) {
        store.clearSessions();
      } else if (deletePayload.sessionId) {
        store.removeSession(deletePayload.sessionId);
      }
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // New Protocol Events (Phase 1)
    // ─────────────────────────────────────────────────────────────────────────

    case 'stream_chunk': {
      // New AI SDK protocol - will be used after Phase 1 backend changes
      const { sessionId, event } = payload as { sessionId: string; event: Parameters<typeof store.handleStreamChunk>[1] };
      store.handleStreamChunk(sessionId, event);
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Error Events
    // ─────────────────────────────────────────────────────────────────────────

    case 'error': {
      const errorPayload = payload as { message: string };
      console.error('[WS] Error:', errorPayload.message);
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Compatibility Layer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a message handler that also updates the legacy agent store.
 * Use this during migration to keep both stores in sync.
 */
export function createDualModeHandler(
  legacyHandler: (msg: WSMessage) => void
): (msg: WSMessage) => void {
  return (msg: WSMessage) => {
    // Update unified store
    handleWebSocketMessage(msg);

    // Also update legacy store for components that haven't migrated yet
    legacyHandler(msg);
  };
}
