// ═══════════════════════════════════════════════════════════════════════════
// Sessions Store - CLI sessions management
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type { CliSession, CliEvent } from '../types';

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
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: [],
  selectedSessionId: null,
  sessionEvents: {},
  loading: false,
  error: null,

  setSessions: (sessions) => set({ sessions }),

  selectSession: (id) => set({ selectedSessionId: id }),

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
}));
