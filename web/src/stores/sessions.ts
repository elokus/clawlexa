// ═══════════════════════════════════════════════════════════════════════════
// Sessions Store - CLI sessions management
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type { CliSession, CliEvent } from '../types';

// Always use relative URLs - let Vite proxy handle routing in dev
// In production, configure VITE_API_URL or deploy API on same origin
const API_BASE_URL = import.meta.env.VITE_DEMO_MODE === 'true'
  ? null
  : (import.meta.env.VITE_API_URL || '');

console.log('[Sessions] API_BASE_URL:', API_BASE_URL);

interface SessionsStore {
  sessions: CliSession[];
  selectedSessionId: string | null;
  sessionEvents: Record<string, CliEvent[]>;
  loading: boolean;
  error: string | null;

  // Actions
  setSessions: (sessions: CliSession[]) => void;
  selectSession: (id: string | null) => void;
  updateSession: (session: CliSession) => void;
  addEvent: (sessionId: string, event: CliEvent) => void;
  setSessionEvents: (sessionId: string, events: CliEvent[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Async actions
  fetchSessions: () => Promise<void>;
  fetchSessionEvents: (sessionId: string) => Promise<void>;
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  sessionEvents: {},
  loading: false,
  error: null,

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

  fetchSessions: async () => {
    if (!API_BASE_URL) {
      console.log('[Sessions] Demo mode - skipping fetch');
      return;
    }

    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const sessions: CliSession[] = await response.json();
      set({ sessions, loading: false });
      console.log(`[Sessions] Fetched ${sessions.length} sessions`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch sessions';
      console.error('[Sessions] Fetch error:', message);
      set({ error: message, loading: false });
    }
  },

  fetchSessionEvents: async (sessionId: string) => {
    if (!API_BASE_URL) {
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
}));
