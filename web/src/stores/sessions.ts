// ═══════════════════════════════════════════════════════════════════════════
// Sessions Store - CLI sessions management
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type { CliSession, CliEvent } from '../types';

// Demo mode check - only skip fetches when explicitly in demo mode
const IS_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// API base URL - empty string means relative URLs (Vite proxy handles routing)
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

console.log('[Sessions] Demo mode:', IS_DEMO_MODE, '| API_BASE_URL:', API_BASE_URL || '(relative)');

interface SessionsStore {
  sessions: CliSession[];
  selectedSessionId: string | null;
  sessionEvents: Record<string, CliEvent[]>;
  loading: boolean;
  error: string | null;
  hasFetched: boolean; // Track if initial fetch has been done

  // Actions
  setSessions: (sessions: CliSession[]) => void;
  selectSession: (id: string | null) => void;
  updateSession: (session: CliSession) => void;
  addSession: (session: CliSession) => void;
  removeSession: (id: string) => void;
  clearSessions: () => void;
  addEvent: (sessionId: string, event: CliEvent) => void;
  setSessionEvents: (sessionId: string, events: CliEvent[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Computed
  getSessionsByThread: () => Map<string, CliSession[]>;
  getActiveSessionCount: () => number;

  // Async actions
  fetchSessions: () => Promise<void>;
  fetchSessionEvents: (sessionId: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  sessionEvents: {},
  loading: false,
  error: null,
  hasFetched: false,

  setSessions: (sessions) => set({ sessions }),

  selectSession: (id) => {
    set({ selectedSessionId: id });
    // Fetch events when a session is selected
    if (id) {
      get().fetchSessionEvents(id);
    }
  },

  updateSession: (session) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === session.id ? session : s
      ),
    })),

  addSession: (session) =>
    set((state) => {
      // Avoid duplicates
      if (state.sessions.some((s) => s.id === session.id)) {
        return { sessions: state.sessions.map((s) => (s.id === session.id ? session : s)) };
      }
      return { sessions: [...state.sessions, session] };
    }),

  removeSession: (id) =>
    set((state) => {
      const { [id]: _removed, ...remainingEvents } = state.sessionEvents;
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        sessionEvents: remainingEvents,
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
      };
    }),

  clearSessions: () =>
    set({
      sessions: [],
      sessionEvents: {},
      selectedSessionId: null,
    }),

  addEvent: (sessionId, event) =>
    set((state) => ({
      sessionEvents: {
        ...state.sessionEvents,
        [sessionId]: [...(state.sessionEvents[sessionId] || []), event],
      },
    })),

  setSessionEvents: (sessionId, events) =>
    set((state) => ({
      sessionEvents: {
        ...state.sessionEvents,
        [sessionId]: events,
      },
    })),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  // Group sessions by thread_id (or by their own id if no thread)
  getSessionsByThread: () => {
    const sessions = get().sessions;
    const grouped = new Map<string, CliSession[]>();

    for (const session of sessions) {
      const threadKey = session.thread_id || session.id;
      const existing = grouped.get(threadKey) || [];
      grouped.set(threadKey, [...existing, session]);
    }

    // Sort sessions within each thread by created_at
    for (const [key, threadSessions] of grouped) {
      grouped.set(
        key,
        threadSessions.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      );
    }

    return grouped;
  },

  // Count active (non-finished) sessions
  getActiveSessionCount: () => {
    return get().sessions.filter((s) => s.status === 'running' || s.status === 'waiting_for_input').length;
  },

  fetchSessions: async () => {
    if (IS_DEMO_MODE) {
      console.log('[Sessions] Demo mode - skipping fetch');
      return;
    }

    set({ loading: true, error: null });
    try {
      // Fetch only active sessions (pending, running, waiting_for_input)
      const response = await fetch(`${API_BASE_URL}/api/sessions/active`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const sessions: CliSession[] = await response.json();
      set({ sessions, loading: false, hasFetched: true });
      console.log(`[Sessions] Fetched ${sessions.length} active sessions`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch sessions';
      console.error('[Sessions] Fetch error:', message);
      set({ error: message, loading: false, hasFetched: true });
    }
  },

  fetchSessionEvents: async (sessionId: string) => {
    if (IS_DEMO_MODE) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/events`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const events: CliEvent[] = await response.json();
      set((state) => ({
        sessionEvents: {
          ...state.sessionEvents,
          [sessionId]: events,
        },
      }));
      console.log(`[Sessions] Fetched ${events.length} events for session ${sessionId}`);
    } catch (error) {
      console.error('[Sessions] Fetch events error:', error);
    }
  },

  deleteSession: async (id: string) => {
    if (IS_DEMO_MODE) {
      get().removeSession(id);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      get().removeSession(id);
      console.log(`[Sessions] Deleted session ${id}`);
    } catch (error) {
      console.error('[Sessions] Delete session error:', error);
    }
  },

  deleteAllSessions: async () => {
    if (IS_DEMO_MODE) {
      get().clearSessions();
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      get().clearSessions();
      console.log(`[Sessions] Deleted all ${result.deleted} sessions`);
    } catch (error) {
      console.error('[Sessions] Delete all sessions error:', error);
    }
  },
}));
