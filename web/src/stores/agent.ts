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
  ToolBlock,
  SubagentActivityPayload,
  SubagentEventType,
} from '../types';
import { useSessionsStore } from './sessions';

interface AgentStore {
  // Connection state
  connected: boolean;
  wsError: string | null;

  // Agent state
  state: AgentState;
  profile: string | null;

  // Transcript (conversation history)
  messages: TranscriptMessage[];

  // Events log (for debugging/display)
  events: RealtimeEvent[];

  // Tool execution state
  currentTool: { name: string; args?: Record<string, unknown> } | null;

  // Subagent activity blocks (unified for all subagents)
  subagentActivities: ActivityBlock[];
  subagentActive: boolean;

  // Actions
  setConnected: (connected: boolean) => void;
  setWsError: (error: string | null) => void;
  handleMessage: (msg: WSMessage) => void;
  clearMessages: () => void;
  clearEvents: () => void;
  clearSubagentActivities: () => void;
  reset: () => void;
  loadMockConversation: () => void;
}

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// Mock conversation for demo
const mockConversation: TranscriptMessage[] = [
  {
    id: 'mock_1',
    role: 'user',
    content: 'Hey Jarvis, was steht auf meiner Todo-Liste?',
    timestamp: Date.now() - 120000,
    pending: false,
  },
  {
    id: 'mock_2',
    role: 'assistant',
    content: 'Alles klar, ich checke deine Todo-Liste. Du hast drei Aufgaben: Den Schnuddelstall aufräumen, im Lidl in Bonn einkaufen gehen, und die Wäsche waschen - das ist für Hannah.',
    timestamp: Date.now() - 115000,
    pending: false,
  },
  {
    id: 'mock_3',
    role: 'user',
    content: 'Stell einen Timer auf 5 Minuten für den Tee.',
    timestamp: Date.now() - 90000,
    pending: false,
  },
  {
    id: 'mock_4',
    role: 'assistant',
    content: 'Okay. Timer gesetzt auf 5 Minuten. Ich erinnere dich, wenn der Tee fertig ist.',
    timestamp: Date.now() - 85000,
    pending: false,
  },
  {
    id: 'mock_5',
    role: 'user',
    content: 'Mach die Stehlampe auf eine gemütliche Farbe.',
    timestamp: Date.now() - 60000,
    pending: false,
  },
  {
    id: 'mock_6',
    role: 'assistant',
    content: 'Alles klar, einen Moment. Die Stehlampe hat jetzt ein warmes, gemütliches Licht - ein bisschen wie Kerzenschein.',
    timestamp: Date.now() - 55000,
    pending: false,
  },
  {
    id: 'mock_7',
    role: 'user',
    content: 'Was ist das Wetter morgen in Bonn?',
    timestamp: Date.now() - 30000,
    pending: false,
  },
  {
    id: 'mock_8',
    role: 'assistant',
    content: 'Ich suche das für dich im Internet. Morgen in Bonn wird es bewölkt mit Temperaturen um 8 Grad. Nachmittags könnte es leicht regnen, also nimm einen Schirm mit wenn du zum Lidl gehst.',
    timestamp: Date.now() - 25000,
    pending: false,
  },
];

export const useAgentStore = create<AgentStore>((set, get) => ({
  // Initial state - connected: true for demo mode
  connected: true,
  wsError: null,
  state: 'idle',
  profile: null,
  messages: [],
  events: [],
  currentTool: null,
  subagentActivities: [],
  subagentActive: false,

  // Actions
  setConnected: (connected) => set({ connected }),

  setWsError: (error) => set({ wsError: error }),

  loadMockConversation: () => set({
    connected: true,
    state: 'listening',
    profile: 'Jarvis',
    messages: mockConversation,
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
          const existingIndex = state.messages.findIndex(
            (m) => m.id === msgId || (m.pending && m.role === role)
          );

          if (existingIndex >= 0 && text) {
            const updated = [...state.messages];
            updated[existingIndex] = {
              ...updated[existingIndex],
              content: text,
              pending: !final,
            };
            return { messages: updated };
          }

          const newMessage: TranscriptMessage = {
            id: msgId,
            role,
            content: text || '',
            timestamp,
            pending: !final && !text,
          };
          return { messages: [...state.messages, newMessage] };
        });
        break;
      }

      case 'item_pending': {
        const { itemId, role } = payload as ItemPendingPayload;
        const newMessage: TranscriptMessage = {
          id: itemId,
          role,
          content: '',
          timestamp,
          pending: true,
        };
        set((state) => ({ messages: [...state.messages, newMessage] }));
        break;
      }

      case 'item_completed': {
        const { itemId, text, role } = payload as ItemCompletedPayload;
        set((state) => {
          const existingIndex = state.messages.findIndex((m) => m.id === itemId);
          if (existingIndex >= 0) {
            const updated = [...state.messages];
            updated[existingIndex] = {
              ...updated[existingIndex],
              content: text,
              pending: false,
            };
            return { messages: updated };
          }
          return {
            messages: [
              ...state.messages,
              { id: itemId, role, content: text, timestamp, pending: false },
            ],
          };
        });
        break;
      }

      case 'tool_start': {
        const { name, args } = payload as ToolPayload;
        set({ currentTool: { name, args } });
        break;
      }

      case 'tool_end': {
        set({ currentTool: null });
        break;
      }

      case 'session_started': {
        set({ messages: [] });
        break;
      }

      case 'session_ended': {
        set({
          state: 'idle',
          profile: null,
          currentTool: null,
        });
        break;
      }

      case 'error': {
        const errorPayload = payload as { message: string };
        console.error('[Agent] Error:', errorPayload.message);
        break;
      }

      // Unified subagent activity stream
      case 'subagent_activity': {
        const { agent, type: eventType, payload: eventPayload } = payload as SubagentActivityPayload;
        handleSubagentActivity(set, get, agent, eventType, eventPayload, timestamp);
        break;
      }

      case 'cli_session_created': {
        const sessionData = payload as CliSessionCreatedPayload;
        // Add to sessions store
        const sessionsStore = useSessionsStore.getState();
        sessionsStore.setSessions([
          ...sessionsStore.sessions,
          {
            id: sessionData.id,
            goal: sessionData.goal,
            status: 'running',
            mac_session_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
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
        break;
      }
    }
  },

  clearMessages: () => set({ messages: [] }),

  clearEvents: () => set({ events: [] }),

  clearSubagentActivities: () => set({ subagentActivities: [], subagentActive: false }),

  reset: () =>
    set({
      connected: false,
      wsError: null,
      state: 'idle',
      profile: null,
      messages: [],
      events: [],
      currentTool: null,
      subagentActivities: [],
      subagentActive: false,
    }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Subagent Activity Handler - Aggregates streaming events into UI blocks
// ═══════════════════════════════════════════════════════════════════════════

type SetState = (fn: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore>)) => void;
type GetState = () => AgentStore;

function handleSubagentActivity(
  set: SetState,
  get: GetState,
  agent: string,
  eventType: SubagentEventType,
  eventPayload: unknown,
  timestamp: number
): void {
  const payload = eventPayload as Record<string, unknown>;

  switch (eventType) {
    case 'reasoning_start': {
      // Create a new reasoning block
      const block: ReasoningBlock = {
        id: generateId(),
        timestamp,
        agent,
        type: 'reasoning',
        content: '',
        isComplete: false,
      };
      set((state) => ({
        subagentActive: true,
        subagentActivities: [...state.subagentActivities, block],
      }));
      break;
    }

    case 'reasoning_delta': {
      // Append delta to the last reasoning block
      const delta = (payload.delta as string) || '';
      set((state) => {
        const blocks = [...state.subagentActivities];
        const lastIdx = blocks.length - 1;
        const last = blocks[lastIdx];
        if (last && last.type === 'reasoning' && !last.isComplete) {
          blocks[lastIdx] = { ...last, content: last.content + delta };
        }
        return { subagentActivities: blocks };
      });
      break;
    }

    case 'reasoning_end': {
      // Mark reasoning block as complete
      const durationMs = (payload.durationMs as number) || undefined;
      set((state) => {
        const blocks = [...state.subagentActivities];
        const lastIdx = blocks.length - 1;
        const last = blocks[lastIdx];
        if (last && last.type === 'reasoning' && !last.isComplete) {
          blocks[lastIdx] = { ...last, isComplete: true, durationMs };
        }
        return { subagentActivities: blocks };
      });
      break;
    }

    case 'tool_call': {
      // Create a new tool block
      const block: ToolBlock = {
        id: generateId(),
        timestamp,
        agent,
        type: 'tool',
        toolName: (payload.toolName as string) || 'unknown',
        toolCallId: (payload.toolCallId as string) || '',
        args: (payload.args as Record<string, unknown>) || {},
        isComplete: false,
      };
      set((state) => ({
        subagentActivities: [...state.subagentActivities, block],
      }));
      break;
    }

    case 'tool_result': {
      // Find and update the matching tool block
      const toolCallId = payload.toolCallId as string;
      const result = (payload.result as string) || '';
      set((state) => {
        const blocks = [...state.subagentActivities];
        // Find the tool block with matching toolCallId, or fallback to last incomplete tool block
        let idx = blocks.findIndex(
          (b) => b.type === 'tool' && (b as ToolBlock).toolCallId === toolCallId
        );
        if (idx === -1) {
          idx = blocks.findIndex((b) => b.type === 'tool' && !(b as ToolBlock).isComplete);
        }
        if (idx !== -1 && blocks[idx].type === 'tool') {
          blocks[idx] = { ...(blocks[idx] as ToolBlock), result, isComplete: true };
        }
        return { subagentActivities: blocks };
      });
      break;
    }

    case 'response': {
      // Create a content block with the final response
      const text = (payload.text as string) || '';
      if (text) {
        set((state) => ({
          subagentActivities: [
            ...state.subagentActivities,
            {
              id: generateId(),
              timestamp,
              agent,
              type: 'content',
              text,
            },
          ],
        }));
      }
      break;
    }

    case 'error': {
      // Create an error block
      const message = (payload.message as string) || 'Unknown error';
      set((state) => ({
        subagentActivities: [
          ...state.subagentActivities,
          {
            id: generateId(),
            timestamp,
            agent,
            type: 'error',
            message,
          },
        ],
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
