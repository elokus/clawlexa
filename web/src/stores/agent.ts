// ═══════════════════════════════════════════════════════════════════════════
// Agent Store - Zustand state management for voice agent
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type {
  AgentState,
  TranscriptMessage,
  RealtimeEvent,
  WSMessage,
  StateChangePayload,
  TranscriptPayload,
  ToolPayload,
  ItemPendingPayload,
  ItemCompletedPayload,
  CliSessionCreatedPayload,
  ActivityBlock,
  ReasoningBlock,
  ToolBlock as ActivityToolBlock,
  ContentBlock,
  ErrorBlock,
  SubagentActivityPayload,
  SubagentEventType,
  WelcomePayload,
  MasterChangedPayload,
  SessionStartedPayload,
  SessionTreeUpdatePayload,
  TimelineItem,
  TranscriptItem,
  ToolItem,
} from '../types';
import { useSessionsStore } from './sessions';
import { useStageStore } from './stage';

interface AgentStore {
  // Connection state
  connected: boolean;
  wsError: string | null;

  // Multi-client identity
  clientId: string | null;
  isMaster: boolean;

  // Agent state
  state: AgentState;
  profile: string | null;

  // Unified timeline (transcripts + tools interleaved)
  timeline: TimelineItem[];

  // @deprecated - Use timeline instead. Kept for backwards compatibility.
  messages: TranscriptMessage[];

  // Events log (for debugging/display)
  events: RealtimeEvent[];

  // Tool execution state (for legacy currentTool tracking)
  currentTool: { name: string; args?: Record<string, unknown> } | null;

  // Subagent activity blocks - keyed by orchestratorId for per-session tracking
  // Key is orchestratorId or 'global' for activities without session context
  activitiesBySession: Record<string, ActivityBlock[]>;
  // Currently active orchestrator ID (for early transition before session tree)
  activeOrchestratorId: string | null;
  subagentActive: boolean;

  // Legacy accessor - returns all activities flattened (for backwards compatibility)
  subagentActivities: ActivityBlock[];

  // Actions
  setConnected: (connected: boolean) => void;
  setWsError: (error: string | null) => void;
  handleMessage: (msg: WSMessage) => void;
  clearTimeline: () => void;
  /** @deprecated Use clearTimeline instead */
  clearMessages: () => void;
  clearEvents: () => void;
  clearSubagentActivities: (orchestratorId?: string) => void;
  getActivitiesForSession: (orchestratorId: string | null) => ActivityBlock[];
  reset: () => void;
  loadMockConversation: () => void;
}

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// Mock timeline for demo - interleaved transcripts and tools
const mockTimeline: TimelineItem[] = [
  {
    id: 'mock_1',
    type: 'transcript',
    role: 'user',
    content: 'Hey Jarvis, was steht auf meiner Todo-Liste?',
    timestamp: Date.now() - 120000,
    pending: false,
  },
  {
    id: 'mock_tool_1',
    type: 'tool',
    name: 'view_todos',
    args: {},
    result: '3 tasks found',
    status: 'completed',
    timestamp: Date.now() - 118000,
  },
  {
    id: 'mock_2',
    type: 'transcript',
    role: 'assistant',
    content: 'Alles klar, ich checke deine Todo-Liste. Du hast drei Aufgaben: Den Schnuddelstall aufräumen, im Lidl in Bonn einkaufen gehen, und die Wäsche waschen - das ist für Hannah.',
    timestamp: Date.now() - 115000,
    pending: false,
  },
  {
    id: 'mock_3',
    type: 'transcript',
    role: 'user',
    content: 'Stell einen Timer auf 5 Minuten für den Tee.',
    timestamp: Date.now() - 90000,
    pending: false,
  },
  {
    id: 'mock_tool_2',
    type: 'tool',
    name: 'set_timer',
    args: { time: 'in 5 Minuten', label: 'Tee' },
    result: 'Timer set for 5 minutes',
    status: 'completed',
    timestamp: Date.now() - 88000,
  },
  {
    id: 'mock_4',
    type: 'transcript',
    role: 'assistant',
    content: 'Okay. Timer gesetzt auf 5 Minuten. Ich erinnere dich, wenn der Tee fertig ist.',
    timestamp: Date.now() - 85000,
    pending: false,
  },
  {
    id: 'mock_5',
    type: 'transcript',
    role: 'user',
    content: 'Mach die Stehlampe auf eine gemütliche Farbe.',
    timestamp: Date.now() - 60000,
    pending: false,
  },
  {
    id: 'mock_tool_3',
    type: 'tool',
    name: 'control_light',
    args: { action: 'color', color: 'warm' },
    result: 'Light color changed',
    status: 'completed',
    timestamp: Date.now() - 58000,
  },
  {
    id: 'mock_6',
    type: 'transcript',
    role: 'assistant',
    content: 'Alles klar, einen Moment. Die Stehlampe hat jetzt ein warmes, gemütliches Licht - ein bisschen wie Kerzenschein.',
    timestamp: Date.now() - 55000,
    pending: false,
  },
  {
    id: 'mock_7',
    type: 'transcript',
    role: 'user',
    content: 'Was ist das Wetter morgen in Bonn?',
    timestamp: Date.now() - 30000,
    pending: false,
  },
  {
    id: 'mock_tool_4',
    type: 'tool',
    name: 'web_search',
    args: { query: 'Wetter Bonn morgen' },
    result: 'Weather data retrieved',
    status: 'completed',
    timestamp: Date.now() - 28000,
  },
  {
    id: 'mock_8',
    type: 'transcript',
    role: 'assistant',
    content: 'Ich suche das für dich im Internet. Morgen in Bonn wird es bewölkt mit Temperaturen um 8 Grad. Nachmittags könnte es leicht regnen, also nimm einen Schirm mit wenn du zum Lidl gehst.',
    timestamp: Date.now() - 25000,
    pending: false,
  },
];

// Helper to extract messages from timeline for backwards compatibility
function extractMessagesFromTimeline(timeline: TimelineItem[]): TranscriptMessage[] {
  return timeline
    .filter((item): item is TranscriptItem => item.type === 'transcript')
    .map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      timestamp: item.timestamp,
      pending: item.pending,
    }));
}

// Helper to flatten activities from all sessions
function flattenActivities(bySession: Record<string, ActivityBlock[]>): ActivityBlock[] {
  return Object.values(bySession).flat().sort((a, b) => a.timestamp - b.timestamp);
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  // Initial state - connected: true for demo mode
  connected: true,
  wsError: null,
  clientId: null,
  isMaster: false,
  state: 'idle',
  profile: null,
  timeline: [],
  messages: [], // @deprecated - kept for backwards compatibility
  events: [],
  currentTool: null,
  activitiesBySession: {},
  activeOrchestratorId: null,
  subagentActive: false,

  // Computed property - returns flattened activities (cached per activitiesBySession change)
  // NOTE: Components should use useSubagentActivities() selector for proper memoization
  subagentActivities: [],

  // Get activities for a specific session or all if null
  getActivitiesForSession: (orchestratorId: string | null) => {
    const { activitiesBySession } = get();
    if (orchestratorId) {
      return activitiesBySession[orchestratorId] || [];
    }
    // Return all activities if no specific session
    return flattenActivities(activitiesBySession);
  },

  // Actions
  setConnected: (connected) => set({ connected }),

  setWsError: (error) => set({ wsError: error }),

  loadMockConversation: () => set({
    connected: true,
    state: 'listening',
    profile: 'Jarvis',
    timeline: mockTimeline,
    messages: extractMessagesFromTimeline(mockTimeline), // For backwards compatibility
    events: [
      { id: 'evt_1', type: 'session_started', timestamp: Date.now() - 120000, data: { profile: 'Jarvis' } },
      { id: 'evt_2', type: 'state_change', timestamp: Date.now() - 120000, data: { state: 'listening', profile: 'Jarvis' } },
      { id: 'evt_3', type: 'transcript', timestamp: Date.now() - 115000, data: { role: 'user', text: 'Hey Jarvis...' } },
      { id: 'evt_4', type: 'tool_start', timestamp: Date.now() - 114000, data: { name: 'view_todos' } },
      { id: 'evt_5', type: 'tool_end', timestamp: Date.now() - 113000, data: { name: 'view_todos' } },
      { id: 'evt_6', type: 'transcript', timestamp: Date.now() - 112000, data: { role: 'assistant', text: 'Du hast drei...' } },
      { id: 'evt_7', type: 'tool_start', timestamp: Date.now() - 84000, data: { name: 'set_timer', args: { time: 'in 5 Minuten' } } },
      { id: 'evt_8', type: 'tool_end', timestamp: Date.now() - 83000, data: { name: 'set_timer' } },
      { id: 'evt_9', type: 'tool_start', timestamp: Date.now() - 54000, data: { name: 'control_light', args: { action: 'color' } } },
      { id: 'evt_10', type: 'tool_end', timestamp: Date.now() - 53000, data: { name: 'control_light' } },
      { id: 'evt_11', type: 'tool_start', timestamp: Date.now() - 24000, data: { name: 'web_search', args: { query: 'Wetter Bonn morgen' } } },
      { id: 'evt_12', type: 'tool_end', timestamp: Date.now() - 23000, data: { name: 'web_search' } },
    ],
  }),

  handleMessage: (msg) => {
    const { type, payload, timestamp } = msg;

    // Always log event
    const event: RealtimeEvent = {
      id: generateId(),
      type,
      timestamp,
      data: payload,
    };
    set((state) => ({
      events: [...state.events.slice(-99), event],
    }));

    // Handle specific message types
    switch (type) {
      case 'state_change': {
        const { state: newState, profile } = payload as StateChangePayload;
        set({ state: newState, profile });
        break;
      }

      case 'transcript': {
        const { id, text, role, final } = payload as TranscriptPayload;
        const msgId = id || generateId();

        set((state) => {
          // Update timeline (new unified approach)
          const timelineIndex = state.timeline.findIndex(
            (item) =>
              item.type === 'transcript' &&
              (item.id === msgId || (item.pending && item.role === role))
          );

          let newTimeline: TimelineItem[];
          if (timelineIndex >= 0 && text) {
            newTimeline = [...state.timeline];
            newTimeline[timelineIndex] = {
              ...(newTimeline[timelineIndex] as TranscriptItem),
              content: text,
              pending: !final,
            };
          } else {
            const newItem: TranscriptItem = {
              id: msgId,
              type: 'transcript',
              role,
              content: text || '',
              timestamp,
              pending: !final && !text,
            };
            newTimeline = [...state.timeline, newItem];
          }

          // Also update legacy messages array
          const existingMsgIndex = state.messages.findIndex(
            (m) => m.id === msgId || (m.pending && m.role === role)
          );

          let newMessages: TranscriptMessage[];
          if (existingMsgIndex >= 0 && text) {
            newMessages = [...state.messages];
            newMessages[existingMsgIndex] = {
              ...newMessages[existingMsgIndex],
              content: text,
              pending: !final,
            };
          } else {
            newMessages = [
              ...state.messages,
              { id: msgId, role, content: text || '', timestamp, pending: !final && !text },
            ];
          }

          return { timeline: newTimeline, messages: newMessages };
        });
        break;
      }

      case 'item_pending': {
        const { itemId, role } = payload as ItemPendingPayload;
        const newTimelineItem: TranscriptItem = {
          id: itemId,
          type: 'transcript',
          role,
          content: '',
          timestamp,
          pending: true,
        };
        const newMessage: TranscriptMessage = {
          id: itemId,
          role,
          content: '',
          timestamp,
          pending: true,
        };
        set((state) => ({
          timeline: [...state.timeline, newTimelineItem],
          messages: [...state.messages, newMessage],
        }));
        break;
      }

      case 'item_completed': {
        const { itemId, text, role } = payload as ItemCompletedPayload;
        set((state) => {
          // Update timeline
          const timelineIndex = state.timeline.findIndex(
            (item) => item.type === 'transcript' && item.id === itemId
          );
          let newTimeline = state.timeline;
          if (timelineIndex >= 0) {
            newTimeline = [...state.timeline];
            newTimeline[timelineIndex] = {
              ...(newTimeline[timelineIndex] as TranscriptItem),
              content: text,
              pending: false,
            };
          } else {
            const newItem: TranscriptItem = {
              id: itemId,
              type: 'transcript',
              role,
              content: text,
              timestamp,
              pending: false,
            };
            newTimeline = [...state.timeline, newItem];
          }

          // Update legacy messages
          const existingIndex = state.messages.findIndex((m) => m.id === itemId);
          let newMessages: TranscriptMessage[];
          if (existingIndex >= 0) {
            newMessages = [...state.messages];
            newMessages[existingIndex] = {
              ...newMessages[existingIndex],
              content: text,
              pending: false,
            };
          } else {
            newMessages = [
              ...state.messages,
              { id: itemId, role, content: text, timestamp, pending: false },
            ];
          }

          return { timeline: newTimeline, messages: newMessages };
        });
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
        set((state) => ({
          currentTool: { name, args },
          timeline: [...state.timeline, toolItem],
        }));
        break;
      }

      case 'tool_end': {
        const { name, result } = payload as ToolPayload;
        set((state) => {
          // Find the last running tool with matching name in timeline
          const toolIndex = state.timeline
            .map((item, idx) => ({ item, idx }))
            .filter(
              ({ item }) =>
                item.type === 'tool' &&
                (item as ToolItem).name === name &&
                (item as ToolItem).status === 'running'
            )
            .pop()?.idx;

          if (toolIndex !== undefined) {
            const newTimeline = [...state.timeline];
            newTimeline[toolIndex] = {
              ...(newTimeline[toolIndex] as ToolItem),
              status: 'completed',
              result,
            };
            return { currentTool: null, timeline: newTimeline };
          }

          return { currentTool: null };
        });
        break;
      }

      case 'session_started': {
        set({ timeline: [], messages: [] });
        // Mark voice session as active
        useStageStore.getState().setVoiceActive(true);
        break;
      }

      case 'session_ended': {
        set({
          state: 'idle',
          profile: null,
          currentTool: null,
        });
        // Mark voice session as inactive and clear tree if no running sessions
        useStageStore.getState().setVoiceActive(false);
        break;
      }

      case 'error': {
        const errorPayload = payload as { message: string };
        console.error('[Agent] Error:', errorPayload.message);
        break;
      }

      // Multi-client coordination
      case 'welcome': {
        const { clientId, isMaster } = payload as WelcomePayload;
        console.log(`[Agent] Welcome: clientId=${clientId.slice(0, 8)}, isMaster=${isMaster}`);
        set({ clientId, isMaster });
        break;
      }

      case 'master_changed': {
        const { masterId } = payload as MasterChangedPayload;
        const currentClientId = get().clientId;
        const newIsMaster = currentClientId === masterId;
        console.log(`[Agent] Master changed to ${masterId.slice(0, 8)}, isMaster=${newIsMaster}`);
        set({ isMaster: newIsMaster });
        break;
      }

      // Session tree update from backend (v2 architecture)
      case 'session_tree_update': {
        const { tree, trees } = payload as SessionTreeUpdatePayload;
        const stageStore = useStageStore.getState();

        if (tree) {
          // Single tree update - set as active tree
          stageStore.setSessionTree(tree);
        } else if (trees && trees.length > 0) {
          // Multiple trees - store all trees so focusSession can find them
          console.log(`[Agent] Received ${trees.length} session trees`);
          stageStore.setAllTrees(trees);
        }
        break;
      }

      // Unified subagent activity stream
      case 'subagent_activity': {
        const { agent, type: eventType, payload: eventPayload, orchestratorId } = payload as SubagentActivityPayload;
        handleSubagentActivity(set, get, agent, eventType, eventPayload, timestamp, orchestratorId);
        break;
      }

      case 'cli_session_created': {
        const sessionData = payload as CliSessionCreatedPayload;
        // Add to sessions store using addSession (handles duplicates)
        const sessionsStore = useSessionsStore.getState();
        sessionsStore.addSession({
          id: sessionData.id,
          goal: sessionData.goal,
          status: 'running',
          mac_session_id: null,
          parent_id: sessionData.parentId || null,
          thread_id: sessionData.parentId || null, // Use parent as thread root
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        // Stage navigation now handled by session_tree_update events
        break;
      }

      case 'cli_session_update': {
        const sessionUpdate = payload as { id: string; status: string; goal: string };
        const sessionsStore = useSessionsStore.getState();
        const existing = sessionsStore.sessions.find((s) => s.id === sessionUpdate.id);
        if (existing) {
          sessionsStore.updateSession({
            ...existing,
            status: sessionUpdate.status as 'running' | 'finished' | 'error' | 'cancelled',
            updated_at: new Date().toISOString(),
          });
        }
        // Stage navigation now handled by session_tree_update events
        break;
      }

      case 'cli_session_deleted': {
        const deletePayload = payload as { sessionId?: string; all?: boolean };
        const sessionsStore = useSessionsStore.getState();
        if (deletePayload.all) {
          // All sessions deleted
          console.log('[Agent] All sessions deleted');
          sessionsStore.clearSessions();
        } else if (deletePayload.sessionId) {
          // Single session deleted
          console.log(`[Agent] Session ${deletePayload.sessionId} deleted`);
          sessionsStore.removeSession(deletePayload.sessionId);
        }
        break;
      }
    }
  },

  clearTimeline: () => set({ timeline: [], messages: [] }),

  // @deprecated Use clearTimeline instead
  clearMessages: () => set({ timeline: [], messages: [] }),

  clearEvents: () => set({ events: [] }),

  clearSubagentActivities: (orchestratorId?: string) => {
    if (orchestratorId) {
      // Clear activities for specific session
      set((state) => {
        const updated = { ...state.activitiesBySession };
        delete updated[orchestratorId];
        return { activitiesBySession: updated };
      });
    } else {
      // Clear all activities
      set({ activitiesBySession: {}, activeOrchestratorId: null, subagentActive: false });
    }
  },

  reset: () =>
    set({
      connected: false,
      wsError: null,
      clientId: null,
      isMaster: false,
      state: 'idle',
      profile: null,
      timeline: [],
      messages: [],
      events: [],
      currentTool: null,
      activitiesBySession: {},
      activeOrchestratorId: null,
      subagentActive: false,
    }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Subagent Activity Handler - Aggregates streaming events into UI blocks
// Now stores activities keyed by orchestratorId for per-session tracking
// ═══════════════════════════════════════════════════════════════════════════

type SetState = (fn: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore>)) => void;
type GetState = () => AgentStore;

// Default key for activities without orchestrator context
const GLOBAL_KEY = '_global';

// Helper to get the session key (orchestratorId or global fallback)
function getSessionKey(orchestratorId?: string): string {
  return orchestratorId || GLOBAL_KEY;
}

// Helper to add a block to the session's activity list
function addBlockToSession(
  activitiesBySession: Record<string, ActivityBlock[]>,
  sessionKey: string,
  block: ActivityBlock
): Record<string, ActivityBlock[]> {
  const existing = activitiesBySession[sessionKey] || [];
  return {
    ...activitiesBySession,
    [sessionKey]: [...existing, block],
  };
}

// Helper to update the last block in a session's activity list
function updateLastBlockInSession(
  activitiesBySession: Record<string, ActivityBlock[]>,
  sessionKey: string,
  updateFn: (block: ActivityBlock) => ActivityBlock,
  predicate: (block: ActivityBlock) => boolean
): Record<string, ActivityBlock[]> {
  const existing = activitiesBySession[sessionKey] || [];
  const lastIdx = existing.length - 1;
  const last = existing[lastIdx];

  if (last && predicate(last)) {
    const updated = [...existing];
    updated[lastIdx] = updateFn(last);
    return {
      ...activitiesBySession,
      [sessionKey]: updated,
    };
  }
  return activitiesBySession;
}

function handleSubagentActivity(
  set: SetState,
  get: GetState,
  agent: string,
  eventType: SubagentEventType,
  eventPayload: unknown,
  timestamp: number,
  orchestratorId?: string
): void {
  const payload = eventPayload as Record<string, unknown>;
  const sessionKey = getSessionKey(orchestratorId);

  switch (eventType) {
    case 'reasoning_start': {
      // Create a new reasoning block for the activity feed
      const block: ReasoningBlock = {
        id: generateId(),
        timestamp,
        agent,
        orchestratorId,
        type: 'reasoning',
        content: '',
        isComplete: false,
      };
      set((state) => ({
        subagentActive: true,
        activeOrchestratorId: orchestratorId || state.activeOrchestratorId,
        activitiesBySession: addBlockToSession(state.activitiesBySession, sessionKey, block),
      }));
      break;
    }

    case 'reasoning_delta': {
      // Append delta to the last reasoning block
      const delta = (payload.delta as string) || '';
      set((state) => ({
        activitiesBySession: updateLastBlockInSession(
          state.activitiesBySession,
          sessionKey,
          (block) => ({ ...block, content: (block as ReasoningBlock).content + delta }),
          (block) => block.type === 'reasoning' && !(block as ReasoningBlock).isComplete
        ),
      }));
      break;
    }

    case 'reasoning_end': {
      // Mark reasoning block as complete
      const durationMs = (payload.durationMs as number) || undefined;
      set((state) => ({
        activitiesBySession: updateLastBlockInSession(
          state.activitiesBySession,
          sessionKey,
          (block) => ({ ...block, isComplete: true, durationMs }),
          (block) => block.type === 'reasoning' && !(block as ReasoningBlock).isComplete
        ),
      }));
      break;
    }

    case 'tool_call': {
      // Create a new tool block
      const block: ActivityToolBlock = {
        id: generateId(),
        timestamp,
        agent,
        orchestratorId,
        type: 'tool',
        toolName: (payload.toolName as string) || 'unknown',
        toolCallId: (payload.toolCallId as string) || '',
        args: (payload.args as Record<string, unknown>) || {},
        isComplete: false,
      };
      set((state) => ({
        activitiesBySession: addBlockToSession(state.activitiesBySession, sessionKey, block),
      }));
      break;
    }

    case 'tool_result': {
      // Find and update the matching tool block
      const toolCallId = payload.toolCallId as string;
      const result = (payload.result as string) || '';
      set((state) => {
        const existing = state.activitiesBySession[sessionKey] || [];
        const blocks = [...existing];

        // Find the tool block with matching toolCallId, or fallback to last incomplete tool block
        let idx = blocks.findIndex(
          (b) => b.type === 'tool' && (b as ActivityToolBlock).toolCallId === toolCallId
        );
        if (idx === -1) {
          idx = blocks.findIndex((b) => b.type === 'tool' && !(b as ActivityToolBlock).isComplete);
        }
        if (idx !== -1 && blocks[idx].type === 'tool') {
          blocks[idx] = { ...(blocks[idx] as ActivityToolBlock), result, isComplete: true };
        }

        return {
          activitiesBySession: {
            ...state.activitiesBySession,
            [sessionKey]: blocks,
          },
        };
      });
      break;
    }

    case 'response': {
      // Create a content block with the final response
      const text = (payload.text as string) || '';
      if (text) {
        const block: ContentBlock = {
          id: generateId(),
          timestamp,
          agent,
          orchestratorId,
          type: 'content',
          text,
        };
        set((state) => ({
          activitiesBySession: addBlockToSession(state.activitiesBySession, sessionKey, block),
        }));
      }
      break;
    }

    case 'error': {
      // Create an error block
      const message = (payload.message as string) || 'Unknown error';
      const block: ErrorBlock = {
        id: generateId(),
        timestamp,
        agent,
        orchestratorId,
        type: 'error',
        message,
      };
      set((state) => ({
        activitiesBySession: addBlockToSession(state.activitiesBySession, sessionKey, block),
      }));
      break;
    }

    case 'complete': {
      // Mark subagent as inactive
      set({ subagentActive: false });
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Selectors - Use these for proper memoization in components
// ═══════════════════════════════════════════════════════════════════════════

import { useShallow } from 'zustand/shallow';

/**
 * Selector hook for getting all flattened subagent activities.
 * Uses shallow comparison to prevent unnecessary re-renders.
 */
export function useSubagentActivities(): ActivityBlock[] {
  return useAgentStore(
    useShallow((state) => flattenActivities(state.activitiesBySession))
  );
}
