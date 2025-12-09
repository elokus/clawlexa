// ═══════════════════════════════════════════════════════════════════════════
// Command Panel - Tabbed interface for Sessions, Tools, Events
// Right side panel with game-inspired console aesthetic
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useEffect } from 'react';
import { useSessionsStore } from '../stores/sessions';
import type { RealtimeEvent, CliSession, SessionStatus } from '../types';

type TabType = 'sessions' | 'tools' | 'events';

interface CommandPanelProps {
  events: RealtimeEvent[];
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

// Tab button component
function TabButton({
  tab,
  label,
  count,
  active,
  onClick,
}: {
  tab: TabType;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`tab-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <style>{`
        .tab-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 12px 8px;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.15em;
          color: var(--color-text-dim);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tab-btn:hover {
          color: var(--color-text-normal);
          background: var(--color-surface);
        }

        .tab-btn.active {
          color: var(--color-cyan);
          border-bottom-color: var(--color-cyan);
          background: var(--color-surface);
        }

        .tab-count {
          font-family: var(--font-mono);
          font-size: 9px;
          padding: 1px 5px;
          background: var(--color-abyss);
          border: 1px solid var(--color-border);
          color: var(--color-text-ghost);
        }

        .tab-btn.active .tab-count {
          background: var(--color-cyan-dim);
          border-color: var(--color-cyan);
          color: var(--color-cyan);
        }
      `}</style>
      {label}
      {count !== undefined && <span className="tab-count">{count}</span>}
    </button>
  );
}

// Sessions Tab Content
function SessionsTab() {
  const { sessions, selectedSessionId, selectSession } = useSessionsStore();

  const activeSessions = sessions.filter((s) =>
    ['pending', 'running', 'waiting_for_input'].includes(s.status)
  );
  const completedSessions = sessions.filter((s) =>
    ['finished', 'error', 'cancelled'].includes(s.status)
  );

  return (
    <div className="sessions-tab">
      <style>{`
        .sessions-tab {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
        }

        .session-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .group-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.1em;
          color: var(--color-text-ghost);
          margin-bottom: 4px;
        }

        .group-dot {
          width: 6px;
          height: 6px;
        }

        .group-dot.active {
          background: var(--color-cyan);
          box-shadow: 0 0 8px var(--color-cyan);
        }

        .group-dot.completed {
          background: var(--color-emerald);
        }

        .session-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .session-card:hover {
          border-color: var(--color-border-active);
          background: var(--color-hover);
        }

        .session-card.selected {
          border-color: var(--color-cyan);
          background: var(--color-cyan-dim);
        }

        .session-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .session-id {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .session-status {
          font-family: var(--font-mono);
          font-size: 9px;
          padding: 2px 6px;
          border: 1px solid;
        }

        .session-status.running {
          color: var(--color-cyan);
          border-color: var(--color-cyan);
          background: var(--color-cyan-dim);
        }

        .session-status.finished {
          color: var(--color-emerald);
          border-color: var(--color-emerald);
          background: var(--color-emerald-dim);
        }

        .session-status.error {
          color: var(--color-rose);
          border-color: var(--color-rose);
          background: var(--color-rose-dim);
        }

        .session-status.pending,
        .session-status.waiting_for_input {
          color: var(--color-amber);
          border-color: var(--color-amber);
          background: var(--color-amber-dim);
        }

        .session-goal {
          font-size: 12px;
          color: var(--color-text-normal);
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .session-time {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .empty-sessions {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
          gap: 12px;
        }

        .empty-sessions svg {
          width: 32px;
          height: 32px;
          color: var(--color-text-ghost);
          opacity: 0.4;
        }

        .empty-sessions-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          line-height: 1.8;
        }
      `}</style>

      {sessions.length === 0 ? (
        <div className="empty-sessions">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span className="empty-sessions-text">
            No active sessions<br/>
            Say "Computer" to spawn
          </span>
        </div>
      ) : (
        <>
          {activeSessions.length > 0 && (
            <div className="session-group">
              <div className="group-label">
                <span className="group-dot active" />
                ACTIVE ({activeSessions.length})
              </div>
              {activeSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  selected={selectedSessionId === session.id}
                  onClick={() => selectSession(session.id)}
                />
              ))}
            </div>
          )}

          {completedSessions.length > 0 && (
            <div className="session-group">
              <div className="group-label">
                <span className="group-dot completed" />
                COMPLETED ({completedSessions.length})
              </div>
              {completedSessions.slice(0, 5).map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  selected={selectedSessionId === session.id}
                  onClick={() => selectSession(session.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SessionCard({
  session,
  selected,
  onClick,
}: {
  session: CliSession;
  selected: boolean;
  onClick: () => void;
}) {
  const createdAt = new Date(session.created_at);
  const timeAgo = getTimeAgo(createdAt);

  return (
    <button
      className={`session-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
      type="button"
    >
      <div className="session-header">
        <span className="session-id">#{session.id.slice(0, 8)}</span>
        <span className={`session-status ${session.status}`}>
          {session.status.replace('_', ' ').toUpperCase()}
        </span>
      </div>
      <p className="session-goal">{session.goal}</p>
      <span className="session-time">{timeAgo}</span>
    </button>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Events Tab Content
function EventsTab({ events }: { events: RealtimeEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const eventColors: Record<string, string> = {
    state_change: 'var(--color-cyan)',
    transcript: 'var(--color-emerald)',
    audio_start: 'var(--color-cyan)',
    audio_end: 'var(--color-cyan)',
    tool_start: 'var(--color-violet)',
    tool_end: 'var(--color-violet)',
    error: 'var(--color-rose)',
    session_started: 'var(--color-amber)',
    session_ended: 'var(--color-amber)',
    item_pending: 'var(--color-text-dim)',
    item_completed: 'var(--color-emerald)',
  };

  return (
    <div className="events-tab" ref={scrollRef}>
      <style>{`
        .events-tab {
          display: flex;
          flex-direction: column;
          padding: 12px;
          overflow-y: auto;
          height: 100%;
        }

        .event-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px;
          border-bottom: 1px solid var(--color-border);
          animation: slide-up 0.15s ease forwards;
        }

        .event-item:last-child {
          border-bottom: none;
        }

        .event-time {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          width: 55px;
        }

        .event-type {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 9px;
          padding: 2px 6px;
          border: 1px solid;
          max-width: 100px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .event-data {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @keyframes slide-up {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {events.length === 0 ? (
        <div className="empty-sessions">
          <span className="empty-sessions-text">No events recorded</span>
        </div>
      ) : (
        events.map((event) => {
          const color = eventColors[event.type] || 'var(--color-text-dim)';
          return (
            <div key={event.id} className="event-item">
              <span className="event-time">
                {new Date(event.timestamp).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span
                className="event-type"
                style={{
                  color: color,
                  borderColor: color,
                  background: `color-mix(in srgb, ${color} 10%, transparent)`,
                }}
              >
                {event.type}
              </span>
              <span className="event-data">
                {JSON.stringify(event.data).slice(0, 40)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

// Tools Tab Content (placeholder for now)
function ToolsTab() {
  const tools = [
    { name: 'add_todo', desc: 'Add task to registry', icon: '◈' },
    { name: 'view_todos', desc: 'List all tasks', icon: '◈' },
    { name: 'delete_todo', desc: 'Remove task', icon: '◈' },
    { name: 'set_timer', desc: 'Start countdown', icon: '⧖' },
    { name: 'list_timers', desc: 'View active timers', icon: '⧖' },
    { name: 'cancel_timer', desc: 'Stop countdown', icon: '⧖' },
    { name: 'web_search', desc: 'Search network', icon: '⌘' },
    { name: 'control_light', desc: 'Adjust illumination', icon: '◉' },
    { name: 'deep_thinking', desc: 'Complex analysis', icon: '◇' },
    { name: 'developer_session', desc: 'Spawn dev session', icon: '▣' },
  ];

  return (
    <div className="tools-tab">
      <style>{`
        .tools-tab {
          display: flex;
          flex-direction: column;
          padding: 16px;
          gap: 8px;
        }

        .tool-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          transition: all 0.2s ease;
        }

        .tool-item:hover {
          border-color: var(--color-border-active);
          background: var(--color-hover);
        }

        .tool-icon {
          font-size: 14px;
          color: var(--color-violet);
          width: 20px;
          text-align: center;
        }

        .tool-info {
          flex: 1;
        }

        .tool-name {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-bright);
          margin-bottom: 2px;
        }

        .tool-desc {
          font-size: 10px;
          color: var(--color-text-dim);
        }

        .tool-status {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-emerald);
          padding: 2px 6px;
          background: var(--color-emerald-dim);
          border: 1px solid var(--color-emerald);
        }
      `}</style>

      {tools.map((tool) => (
        <div key={tool.name} className="tool-item">
          <span className="tool-icon">{tool.icon}</span>
          <div className="tool-info">
            <div className="tool-name">{tool.name}</div>
            <div className="tool-desc">{tool.desc}</div>
          </div>
          <span className="tool-status">READY</span>
        </div>
      ))}
    </div>
  );
}

export function CommandPanel({ events, activeTab, onTabChange }: CommandPanelProps) {
  const { sessions } = useSessionsStore();

  return (
    <div className="cmd-panel">
      <style>{`
        .cmd-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-deep);
        }

        .cmd-header {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
        }

        .cmd-title {
          font-family: var(--font-display);
          font-size: 11px;
          letter-spacing: 0.15em;
          color: var(--color-text-dim);
        }

        .tab-bar {
          display: flex;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-abyss);
        }

        .tab-content {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }
      `}</style>

      <div className="cmd-header">
        <span className="cmd-title">COMMAND CONSOLE</span>
      </div>

      <div className="tab-bar">
        <TabButton
          tab="sessions"
          label="SESSIONS"
          count={sessions.length}
          active={activeTab === 'sessions'}
          onClick={() => onTabChange('sessions')}
        />
        <TabButton
          tab="tools"
          label="TOOLS"
          active={activeTab === 'tools'}
          onClick={() => onTabChange('tools')}
        />
        <TabButton
          tab="events"
          label="EVENTS"
          count={events.length}
          active={activeTab === 'events'}
          onClick={() => onTabChange('events')}
        />
      </div>

      <div className="tab-content">
        {activeTab === 'sessions' && <SessionsTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'events' && <EventsTab events={events} />}
      </div>
    </div>
  );
}
