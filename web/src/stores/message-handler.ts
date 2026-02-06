// ═══════════════════════════════════════════════════════════════════════════
// Message Handler - Routes WebSocket events to unified sessions store
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase 5: Simplified Protocol
// - Core events: welcome, stream_chunk, session_tree_update, state_change, master_changed
// - Lifecycle: session_started, session_ended, cli_session_deleted, error
//
// stream_chunk handles ALL agent content (voice + subagent) in AI SDK format.
// Voice sessions also populate voiceTimeline for AgentStage compatibility.

import { useUnifiedSessionsStore, type TranscriptItem, type ToolItem } from './unified-sessions';
import type { WSMessage } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// Types (Phase 5: Simplified Protocol)
// ═══════════════════════════════════════════════════════════════════════════

interface StateChangePayload {
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  profile: string | null;
}

interface WelcomePayload {
  clientId: string;
  isMaster: boolean;
  serviceActive: boolean;
  audioMode: 'web' | 'local';
}

interface ServiceStateChangedPayload {
  active: boolean;
  mode: 'web' | 'local';
}

interface MasterChangedPayload {
  masterId: string;
}

interface SessionTreeUpdatePayload {
  tree?: {
    id: string;
    type: 'voice' | 'orchestrator' | 'terminal';
    status: string;
    goal: string;
    agent_name: string | null;
    tool_call_id: string | null;
    created_at: string;
    children: SessionTreeUpdatePayload['tree'][];
  };
  trees?: SessionTreeUpdatePayload['tree'][];
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
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find timeline item index by OpenAI itemId.
 * Used for correlating transcripts with their placeholders.
 */
function findTimelineItemByItemId(timeline: TranscriptItem[], itemId: string): number {
  return timeline.findIndex(
    (item) => item.type === 'transcript' && item.itemId === itemId
  );
}

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
      const { clientId, isMaster, serviceActive, audioMode } = payload as WelcomePayload;
      console.log(`[WS] Welcome: clientId=${clientId.slice(0, 8)}, isMaster=${isMaster}, serviceActive=${serviceActive}, audioMode=${audioMode}`);
      store.setClientIdentity(clientId, isMaster, serviceActive, audioMode);
      break;
    }

    case 'service_state_changed': {
      const { active, mode } = payload as ServiceStateChangedPayload;
      console.log(`[WS] Service state changed: active=${active}, mode=${mode}`);
      store.setServiceState(active, mode);
      break;
    }

    case 'audio_control': {
      const { action } = payload as { action: 'start' | 'stop' | 'interrupt' };
      // Dispatch custom event for useAudioSession to handle
      window.dispatchEvent(new CustomEvent('ws-audio-control', { detail: action }));
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

    // NOTE: transcript, item_pending, item_completed, tool_start, tool_end
    // are now handled via stream_chunk for voice sessions (Phase 5 simplification)

    // ─────────────────────────────────────────────────────────────────────────
    // Session Tree Events (v2 Architecture)
    // ─────────────────────────────────────────────────────────────────────────

    case 'session_tree_update': {
      const treePayload = payload as SessionTreeUpdatePayload;
      store.handleSessionTreeUpdate(treePayload as Parameters<typeof store.handleSessionTreeUpdate>[0]);
      break;
    }

    // NOTE: subagent_activity is replaced by stream_chunk (Phase 5)
    // NOTE: cli_session_created/update are handled via session_tree_update

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
      // Unified AI SDK protocol for all agents (voice + subagent)
      const { sessionId, event } = payload as { sessionId: string; event: Parameters<typeof store.handleStreamChunk>[1] };

      // Update session messages (works for all session types)
      store.handleStreamChunk(sessionId, event);

      // Handle process-status events (toast notifications for completed/errored processes)
      if (event.type === 'process-status') {
        store.addToast({
          id: `toast-${Date.now()}`,
          sessionName: event.processName,
          sessionId: event.sessionId || sessionId,
          status: event.status,
          summary: event.summary || (event.status === 'completed' ? 'Task finished' : 'Task failed'),
          timestamp: Date.now(),
        });
      }

      // For voice sessions, also populate voiceTimeline for AgentStage compatibility
      // Detect voice session: it's the root of the current tree with type='voice'
      const { sessionTree, voiceActive } = store;
      const isVoiceSession =
        voiceActive &&
        sessionTree?.id === sessionId &&
        sessionTree?.type === 'voice';

      if (isVoiceSession) {
        // Convert AI SDK events to voiceTimeline format
        switch (event.type) {
          case 'user-placeholder': {
            // Create placeholder for user message (reserves position before transcript arrives)
            const newItem: TranscriptItem = {
              id: generateId(),
              type: 'transcript',
              role: 'user',
              content: '',
              timestamp,
              pending: true,
              itemId: event.itemId,
            };
            store.addVoiceTimelineItem(newItem);
            break;
          }

          case 'assistant-placeholder': {
            // Create placeholder for assistant message (reserves position before transcript arrives)
            const newItem: TranscriptItem = {
              id: generateId(),
              type: 'transcript',
              role: 'assistant',
              content: '',
              timestamp,
              pending: true,
              itemId: event.itemId,
            };
            store.addVoiceTimelineItem(newItem);
            break;
          }

          case 'text-delta': {
            // Add/update assistant transcript in voice timeline
            const { voiceTimeline } = store;

            // Try to find existing placeholder by itemId first
            if (event.itemId) {
              const transcriptItems = voiceTimeline.filter(
                (item): item is TranscriptItem => item.type === 'transcript'
              );
              const idx = findTimelineItemByItemId(transcriptItems, event.itemId);
              if (idx >= 0) {
                const item = transcriptItems[idx];
                store.updateVoiceTimelineItem(item.id, {
                  content: item.content + event.textDelta,
                } as Partial<TranscriptItem>);
                break;
              }
            }

            // Fallback: find last pending assistant message
            const lastItem = voiceTimeline[voiceTimeline.length - 1];
            const isAssistantTranscript =
              lastItem?.type === 'transcript' &&
              lastItem.role === 'assistant' &&
              lastItem.pending;

            if (isAssistantTranscript) {
              store.updateVoiceTimelineItem(lastItem.id, {
                content: (lastItem as TranscriptItem).content + event.textDelta,
                ...(event.itemId && { itemId: event.itemId }),
              } as Partial<TranscriptItem>);
            } else {
              const newItem: TranscriptItem = {
                id: generateId(),
                type: 'transcript',
                role: 'assistant',
                content: event.textDelta,
                timestamp,
                pending: true,
                itemId: event.itemId,
              };
              store.addVoiceTimelineItem(newItem);
            }
            break;
          }

          case 'user-transcript': {
            // Try to find and fill placeholder by itemId
            if (event.itemId) {
              const { voiceTimeline } = store;
              const transcriptItems = voiceTimeline.filter(
                (item): item is TranscriptItem => item.type === 'transcript'
              );
              const idx = findTimelineItemByItemId(transcriptItems, event.itemId);
              if (idx >= 0) {
                const item = transcriptItems[idx];
                store.updateVoiceTimelineItem(item.id, {
                  content: event.text,
                  pending: false,
                } as Partial<TranscriptItem>);
                break;
              }
            }

            // Fallback: create new timeline item
            const newItem: TranscriptItem = {
              id: generateId(),
              type: 'transcript',
              role: 'user',
              content: event.text,
              timestamp,
              pending: false,
              itemId: event.itemId,
            };
            store.addVoiceTimelineItem(newItem);
            break;
          }

          case 'tool-call': {
            const toolItem: ToolItem = {
              id: event.toolCallId,
              type: 'tool',
              name: event.toolName,
              args: event.input as Record<string, unknown>,
              status: 'running',
              timestamp,
            };
            store.addVoiceTimelineItem(toolItem);
            store.setCurrentTool({ name: event.toolName, args: event.input as Record<string, unknown> });
            break;
          }

          case 'tool-result': {
            const { voiceTimeline } = store;
            // Match by toolCallId first (reliable even with repeated same tool names).
            // Fall back to the latest running tool with same name for older events.
            let toolIdx = voiceTimeline.findIndex(
              (item) => item.type === 'tool' && item.id === event.toolCallId
            );
            if (toolIdx < 0) {
              toolIdx = [...voiceTimeline]
                .map((item, idx) => ({ item, idx }))
                .reverse()
                .find(
                  ({ item }) =>
                    item.type === 'tool' &&
                    (item as ToolItem).name === event.toolName &&
                    (item as ToolItem).status === 'running'
                )?.idx ?? -1;
            }
            if (toolIdx >= 0) {
              const resultText =
                typeof event.output === 'string'
                  ? event.output
                  : JSON.stringify(event.output, null, 2);
              store.updateVoiceTimelineItem(voiceTimeline[toolIdx].id, {
                status: 'completed',
                result: resultText,
              } as Partial<ToolItem>);
            }
            store.setCurrentTool(null);
            break;
          }

          case 'finish': {
            // Mark last pending transcript as complete
            const { voiceTimeline } = store;
            const lastItem = voiceTimeline[voiceTimeline.length - 1];
            if (lastItem?.type === 'transcript' && lastItem.pending) {
              store.updateVoiceTimelineItem(lastItem.id, {
                pending: false,
              } as Partial<TranscriptItem>);
            }
            break;
          }
        }
      }
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
