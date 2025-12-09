// ═══════════════════════════════════════════════════════════════════════════
// Command Panel - Mobile-optimized bottom sheet with tabs
// Touch-friendly, swipeable, with smooth animations
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useEffect, useState } from 'react';
import { useSessionsStore } from '../stores/sessions';
import { useAgentStore } from '../stores/agent';
import type { RealtimeEvent, CliSession, CliAgentActivity } from '../types';

type TabType = 'sessions' | 'agent' | 'tools' | 'events';

interface CommandPanelProps {
  events: RealtimeEvent[];
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onClearEvents: () => void;
}

// Compact tab button
function TabButton({
  tab,
  label,
  icon,
  count,
  active,
  onClick,
}: {
  tab: TabType;
  label: string;
  icon: React.ReactNode;
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
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 10px 8px;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--color-text-dim);
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          min-height: 56px;
        }

        .tab-btn:active {
          transform: scale(0.95);
        }

        .tab-btn.active {
          color: var(--color-cyan);
          border-bottom-color: var(--color-cyan);
          background: rgba(56, 189, 248, 0.05);
        }

        .tab-icon {
          width: 20px;
          height: 20px;
          transition: all 0.2s ease;
        }

        .tab-btn.active .tab-icon {
          filter: drop-shadow(0 0 6px var(--color-cyan));
        }

        .tab-label {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .tab-badge {
          position: absolute;
          top: 6px;
          right: calc(50% - 16px);
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--color-cyan);
          border-radius: 8px;
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 600;
          color: var(--color-void);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        @media (min-width: 769px) {
          .tab-btn {
            flex-direction: row;
            gap: 8px;
            padding: 12px 16px;
            min-height: auto;
          }

          .tab-badge {
            position: static;
            margin-left: 4px;
          }
        }
      `}</style>
      <span className="tab-icon">{icon}</span>
      <span className="tab-label">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="tab-badge">{count > 99 ? '99+' : count}</span>
      )}
    </button>
  );
}

// Sessions Tab
function SessionsTab() {
  const { sessions, selectedSessionId, selectSession, loading, error, fetchSessions } = useSessionsStore();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

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
          gap: 12px;
          padding: 12px;
        }

        .sessions-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .sessions-count {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .refresh-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 10px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .refresh-btn:active {
          transform: scale(0.95);
        }

        .refresh-btn svg {
          width: 12px;
          height: 12px;
        }

        .refresh-btn.loading svg {
          animation: spin 1s linear infinite;
        }

        .session-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .group-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-display);
          font-size: 9px;
          letter-spacing: 0.1em;
          color: var(--color-text-ghost);
          padding: 4px 0;
        }

        .group-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .group-dot.active {
          background: var(--color-cyan);
          box-shadow: 0 0 8px var(--color-cyan);
        }

        .group-dot.completed {
          background: var(--color-emerald);
        }

        .empty-sessions {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 32px 16px;
          text-align: center;
          gap: 10px;
        }

        .empty-sessions svg {
          width: 28px;
          height: 28px;
          color: var(--color-text-ghost);
          opacity: 0.5;
        }

        .empty-sessions-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          line-height: 1.6;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="sessions-header">
        <span className="sessions-count">
          {loading ? 'Loading...' : `${sessions.length} sessions`}
        </span>
        <button
          className={`refresh-btn ${loading ? 'loading' : ''}`}
          onClick={() => fetchSessions()}
          type="button"
          disabled={loading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {!loading && !error && sessions.length === 0 ? (
        <div className="empty-sessions">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span className="empty-sessions-text">
            No sessions yet<br />
            Say "Computer" to start
          </span>
        </div>
      ) : (
        <>
          {activeSessions.length > 0 && (
            <div className="session-group">
              <div className="group-label">
                <span className="group-dot active" />
                Active ({activeSessions.length})
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
                Completed ({completedSessions.length})
              </div>
              {completedSessions.slice(0, 3).map((session) => (
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
  const timeAgo = getTimeAgo(new Date(session.created_at));
  // Use session ID - TmuxOpener will derive tmux session name as dev-assistant-{id}
  const tmuxUrl = `tmux://${session.id}`;

  const openInTerminal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(tmuxUrl, '_blank');
  };

  const statusColors: Record<string, string> = {
    running: 'var(--color-cyan)',
    pending: 'var(--color-amber)',
    waiting_for_input: 'var(--color-amber)',
    finished: 'var(--color-emerald)',
    error: 'var(--color-rose)',
    cancelled: 'var(--color-text-ghost)',
  };

  const statusColor = statusColors[session.status] || 'var(--color-text-ghost)';

  return (
    <div className={`session-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <style>{`
        .session-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .session-card:active {
          transform: scale(0.98);
        }

        .session-card.selected {
          border-color: var(--color-cyan);
          background: rgba(56, 189, 248, 0.08);
        }

        .session-top {
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
          padding: 3px 8px;
          border-radius: 4px;
          background: color-mix(in srgb, ${statusColor} 15%, transparent);
          color: ${statusColor};
          border: 1px solid ${statusColor}40;
        }

        .session-goal {
          font-size: 13px;
          color: var(--color-text-normal);
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          margin: 0;
        }

        .session-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .session-time {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .session-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 4px;
          padding-top: 8px;
          border-top: 1px solid var(--color-border);
        }

        .open-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 12px;
          background: var(--color-emerald-dim);
          border: 1px solid var(--color-emerald);
          border-radius: 4px;
          color: var(--color-emerald);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-decoration: none;
        }

        .open-btn:hover {
          background: var(--color-emerald);
          color: var(--color-void);
        }

        .open-btn:active {
          transform: scale(0.95);
        }

        .open-btn svg {
          width: 12px;
          height: 12px;
        }
      `}</style>

      <div className="session-top">
        <span className="session-id">#{session.id.slice(0, 8)}</span>
        <span className="session-status">{session.status.replace('_', ' ')}</span>
      </div>
      <p className="session-goal">{session.goal}</p>
      <div className="session-meta">
        <span className="session-time">{timeAgo}</span>
      </div>

      <div className="session-actions">
        <button className="open-btn" onClick={openInTerminal} type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15,3 21,3 21,9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open
        </button>
      </div>
    </div>
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

// Events Tab
function EventsTab({ events, onClear }: { events: RealtimeEvent[]; onClear: () => void }) {
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
  };

  return (
    <div className="events-tab">
      <style>{`
        .events-tab {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .events-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
        }

        .events-count {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .clear-btn {
          padding: 5px 8px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .clear-btn:active {
          transform: scale(0.95);
          border-color: var(--color-rose);
          color: var(--color-rose);
        }

        .events-list {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding: 8px;
        }

        .event-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px;
          margin-bottom: 4px;
          background: var(--color-surface);
          border-radius: 6px;
          animation: fade-in 0.15s ease;
        }

        .event-time {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          width: 50px;
        }

        .event-type {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 3px;
        }

        .event-data {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        .empty-events {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      {events.length > 0 && (
        <div className="events-header">
          <span className="events-count">{events.length} events</span>
          <button className="clear-btn" onClick={onClear} type="button">Clear</button>
        </div>
      )}

      <div className="events-list" ref={scrollRef}>
        {events.length === 0 ? (
          <div className="empty-events">No events yet</div>
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
                    color,
                    background: `color-mix(in srgb, ${color} 15%, transparent)`,
                  }}
                >
                  {event.type}
                </span>
                <span className="event-data">
                  {JSON.stringify(event.data).slice(0, 35)}...
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Tools Tab
function ToolsTab() {
  const tools = [
    { name: 'add_todo', desc: 'Add task', icon: '◈', color: 'var(--color-violet)' },
    { name: 'view_todos', desc: 'List tasks', icon: '◈', color: 'var(--color-violet)' },
    { name: 'set_timer', desc: 'Set timer', icon: '⧖', color: 'var(--color-amber)' },
    { name: 'web_search', desc: 'Search web', icon: '⌘', color: 'var(--color-cyan)' },
    { name: 'control_light', desc: 'Control lights', icon: '◉', color: 'var(--color-emerald)' },
    { name: 'deep_thinking', desc: 'Deep analysis', icon: '◇', color: 'var(--color-violet)' },
    { name: 'developer_session', desc: 'Dev session', icon: '▣', color: 'var(--color-cyan)' },
  ];

  return (
    <div className="tools-tab">
      <style>{`
        .tools-tab {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          padding: 12px;
        }

        @media (min-width: 769px) {
          .tools-tab {
            grid-template-columns: 1fr;
          }
        }

        .tool-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 14px 10px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 10px;
          transition: all 0.2s ease;
        }

        .tool-icon {
          font-size: 18px;
        }

        .tool-name {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-bright);
        }

        .tool-desc {
          font-size: 9px;
          color: var(--color-text-ghost);
        }

        .tool-ready {
          font-family: var(--font-mono);
          font-size: 8px;
          padding: 2px 6px;
          border-radius: 3px;
          background: var(--color-emerald-dim);
          color: var(--color-emerald);
        }
      `}</style>

      {tools.map((tool) => (
        <div key={tool.name} className="tool-item">
          <span className="tool-icon" style={{ color: tool.color }}>{tool.icon}</span>
          <span className="tool-name">{tool.name}</span>
          <span className="tool-desc">{tool.desc}</span>
          <span className="tool-ready">Ready</span>
        </div>
      ))}
    </div>
  );
}

// Agent Tab
function AgentTab({ activities, isActive, onClear }: {
  activities: CliAgentActivity[];
  isActive: boolean;
  onClear: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities]);

  const getConfig = (type: CliAgentActivity['type']) => {
    switch (type) {
      case 'thinking': return { icon: '◈', color: 'var(--color-amber)' };
      case 'tool_call': return { icon: '▶', color: 'var(--color-cyan)' };
      case 'tool_result': return { icon: '◀', color: 'var(--color-emerald)' };
      case 'response': return { icon: '◉', color: 'var(--color-violet)' };
      case 'session_created': return { icon: '▣', color: 'var(--color-rose)' };
      default: return { icon: '•', color: 'var(--color-text-dim)' };
    }
  };

  return (
    <div className="agent-tab">
      <style>{`
        .agent-tab {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .agent-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
        }

        .agent-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .agent-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--color-text-ghost);
        }

        .agent-dot.active {
          background: var(--color-amber);
          box-shadow: 0 0 10px var(--color-amber);
          animation: pulse-glow 1s ease-in-out infinite;
        }

        .agent-label {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
        }

        .agent-label.active {
          color: var(--color-amber);
        }

        .agent-clear {
          padding: 5px 8px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
        }

        .agent-list {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding: 8px;
        }

        .activity-item {
          display: flex;
          gap: 8px;
          padding: 10px;
          margin-bottom: 6px;
          background: var(--color-surface);
          border-radius: 8px;
          border-left: 3px solid;
          animation: slide-in 0.2s ease;
        }

        @keyframes slide-in {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }

        .activity-icon {
          flex-shrink: 0;
          width: 20px;
          text-align: center;
          font-size: 12px;
        }

        .activity-content {
          flex: 1;
          min-width: 0;
        }

        .activity-type {
          font-family: var(--font-mono);
          font-size: 9px;
          text-transform: uppercase;
          margin-bottom: 2px;
        }

        .activity-text {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-normal);
          line-height: 1.4;
          word-break: break-word;
        }

        .activity-time {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
        }

        .empty-agent {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 10px;
          padding: 24px;
          text-align: center;
        }

        .empty-agent svg {
          width: 28px;
          height: 28px;
          color: var(--color-text-ghost);
          opacity: 0.5;
        }

        .empty-agent-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <div className="agent-header">
        <div className="agent-status">
          <span className={`agent-dot ${isActive ? 'active' : ''}`} />
          <span className={`agent-label ${isActive ? 'active' : ''}`}>
            {isActive ? 'Processing' : 'Idle'}
          </span>
        </div>
        {activities.length > 0 && (
          <button className="agent-clear" onClick={onClear} type="button">Clear</button>
        )}
      </div>

      <div className="agent-list" ref={scrollRef}>
        {activities.length === 0 ? (
          <div className="empty-agent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="empty-agent-text">
              CLI Agent idle<br />
              Say "Computer" to start
            </span>
          </div>
        ) : (
          activities.map((activity) => {
            const config = getConfig(activity.type);
            const data = activity.data as Record<string, unknown>;
            let text = '';

            switch (activity.type) {
              case 'thinking':
                text = `Processing: ${(data.request as string)?.substring(0, 40)}...`;
                break;
              case 'tool_call':
                text = `${data.toolName}()`;
                break;
              case 'tool_result':
                text = `${data.toolName} completed`;
                break;
              case 'response':
                text = (data.response as string)?.substring(0, 50) || 'Done';
                break;
              case 'session_created':
                text = `Session in ${data.projectPath}`;
                break;
              default:
                text = JSON.stringify(data).substring(0, 40);
            }

            return (
              <div
                key={activity.id}
                className="activity-item"
                style={{ borderLeftColor: config.color }}
              >
                <span className="activity-icon" style={{ color: config.color }}>
                  {config.icon}
                </span>
                <div className="activity-content">
                  <div className="activity-type" style={{ color: config.color }}>
                    {activity.type.replace('_', ' ')}
                  </div>
                  <div className="activity-text">{text}</div>
                </div>
                <span className="activity-time">
                  {new Date(activity.timestamp).toLocaleTimeString('de-DE', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function CommandPanel({ events, activeTab, onTabChange, onClearEvents }: CommandPanelProps) {
  const { sessions } = useSessionsStore();
  const { cliAgentActivities, cliAgentActive, clearCliAgentActivities } = useAgentStore();

  return (
    <div className="cmd-panel">
      <style>{`
        .cmd-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-deep);
          border-radius: 20px 20px 0 0;
          overflow: hidden;
          min-height: 0; /* Critical for flex scroll */
        }

        @media (min-width: 769px) {
          .cmd-panel {
            border-radius: 0;
            height: 100%;
          }
        }

        .tab-bar {
          display: flex;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-abyss);
          flex-shrink: 0;
        }

        .tab-content {
          flex: 1;
          overflow: hidden; /* Changed from overflow-y: auto */
          -webkit-overflow-scrolling: touch;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }

        /* Ensure child tabs take full height and scroll internally */
        .tab-content > * {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
        }
      `}</style>

      <div className="tab-bar">
        <TabButton
          tab="sessions"
          label="Sessions"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          }
          count={sessions.length}
          active={activeTab === 'sessions'}
          onClick={() => onTabChange('sessions')}
        />
        <TabButton
          tab="agent"
          label="Agent"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          }
          count={cliAgentActivities.length || undefined}
          active={activeTab === 'agent'}
          onClick={() => onTabChange('agent')}
        />
        <TabButton
          tab="tools"
          label="Tools"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
            </svg>
          }
          active={activeTab === 'tools'}
          onClick={() => onTabChange('tools')}
        />
        <TabButton
          tab="events"
          label="Events"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          }
          count={events.length}
          active={activeTab === 'events'}
          onClick={() => onTabChange('events')}
        />
      </div>

      <div className="tab-content">
        {activeTab === 'sessions' && <SessionsTab />}
        {activeTab === 'agent' && (
          <AgentTab
            activities={cliAgentActivities}
            isActive={cliAgentActive}
            onClear={clearCliAgentActivities}
          />
        )}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'events' && <EventsTab events={events} onClear={onClearEvents} />}
      </div>
    </div>
  );
}
