// ═══════════════════════════════════════════════════════════════════════════
// Command Panel - Tabbed interface for Sessions, Tools, Events, Agent
// Right side panel with game-inspired console aesthetic
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
  const { sessions, selectedSessionId, selectSession, loading, error, fetchSessions } = useSessionsStore();

  // Fetch sessions on mount
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

        .sessions-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 0 8px 0;
        }

        .sessions-refresh-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .sessions-refresh-btn:hover {
          border-color: var(--color-cyan);
          color: var(--color-cyan);
          background: rgba(34, 211, 238, 0.1);
        }

        .sessions-refresh-btn.loading {
          opacity: 0.5;
          pointer-events: none;
        }

        .sessions-refresh-btn svg {
          width: 10px;
          height: 10px;
        }

        .sessions-refresh-btn.loading svg {
          animation: spin 1s linear infinite;
        }

        .sessions-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 20px;
          text-align: center;
          gap: 8px;
        }

        .sessions-error-text {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-rose);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="sessions-header">
        <span className="group-label">
          {loading ? 'LOADING...' : `${sessions.length} SESSIONS`}
        </span>
        <button
          className={`sessions-refresh-btn ${loading ? 'loading' : ''}`}
          onClick={() => fetchSessions()}
          type="button"
          disabled={loading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          REFRESH
        </button>
      </div>

      {error && (
        <div className="sessions-error">
          <span className="sessions-error-text">{error}</span>
          <button
            className="sessions-refresh-btn"
            onClick={() => fetchSessions()}
            type="button"
          >
            RETRY
          </button>
        </div>
      )}

      {!loading && !error && sessions.length === 0 ? (
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
      ) : !loading && !error && (
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
  const [copied, setCopied] = useState(false);
  const createdAt = new Date(session.created_at);
  const timeAgo = getTimeAgo(createdAt);

  const isActive = ['pending', 'running', 'waiting_for_input'].includes(session.status);
  const tmuxCommand = session.mac_session_id
    ? `tmux attach -t ${session.mac_session_id}`
    : null;

  const copyCommand = async () => {
    if (tmuxCommand) {
      await navigator.clipboard.writeText(tmuxCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`session-card ${selected ? 'selected' : ''}`}>
      <style>{`
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
          margin: 0;
        }

        .session-time {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .session-tmux {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
          padding-top: 8px;
          border-top: 1px solid var(--color-border);
        }

        .tmux-command {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-cyan);
          background: var(--color-abyss);
          padding: 4px 8px;
          border: 1px solid var(--color-border);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tmux-copy-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px 8px;
          background: var(--color-cyan-dim);
          border: 1px solid var(--color-cyan);
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tmux-copy-btn:hover {
          background: var(--color-cyan);
          color: var(--color-void);
        }

        .tmux-copy-btn.copied {
          background: var(--color-emerald-dim);
          border-color: var(--color-emerald);
          color: var(--color-emerald);
        }

        .tmux-copy-btn svg {
          width: 12px;
          height: 12px;
          margin-right: 4px;
        }
      `}</style>
      <button
        className="session-card-inner"
        onClick={onClick}
        type="button"
        style={{ all: 'unset', cursor: 'pointer', display: 'contents' }}
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

      {/* Show tmux attach command for active sessions with mac_session_id */}
      {selected && isActive && tmuxCommand && (
        <div className="session-tmux">
          <code className="tmux-command">{tmuxCommand}</code>
          <button className={`tmux-copy-btn ${copied ? 'copied' : ''}`} onClick={copyCommand} type="button">
            {copied ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                COPIED
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                COPY
              </>
            )}
          </button>
        </div>
      )}
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

// Events Tab Content
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
    item_pending: 'var(--color-text-dim)',
    item_completed: 'var(--color-emerald)',
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
          padding: 8px 12px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface);
        }

        .events-count {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .events-clear-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 6px;
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .events-clear-btn:hover {
          border-color: var(--color-rose);
          color: var(--color-rose);
          background: rgba(251, 113, 133, 0.1);
        }

        .events-clear-btn svg {
          width: 10px;
          height: 10px;
        }

        .events-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 12px;
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

      {events.length > 0 && (
        <div className="events-header">
          <span className="events-count">{events.length} events</span>
          <button className="events-clear-btn" onClick={onClear} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
            CLEAR
          </button>
        </div>
      )}

      <div className="events-list" ref={scrollRef}>
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

// Agent Tab - Shows CLI Agent activity stream
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

  const getActivityIcon = (type: CliAgentActivity['type']) => {
    switch (type) {
      case 'thinking': return '◈';
      case 'tool_call': return '▶';
      case 'tool_result': return '◀';
      case 'response': return '◉';
      case 'session_created': return '▣';
      default: return '•';
    }
  };

  const getActivityColor = (type: CliAgentActivity['type']) => {
    switch (type) {
      case 'thinking': return 'var(--color-amber)';
      case 'tool_call': return 'var(--color-cyan)';
      case 'tool_result': return 'var(--color-emerald)';
      case 'response': return 'var(--color-violet)';
      case 'session_created': return 'var(--color-rose)';
      default: return 'var(--color-text-dim)';
    }
  };

  const formatActivityContent = (activity: CliAgentActivity) => {
    const data = activity.data as Record<string, unknown>;
    switch (activity.type) {
      case 'thinking':
        return `Processing: ${(data.request as string)?.substring(0, 60)}...`;
      case 'tool_call':
        return `Calling ${data.toolName}(${JSON.stringify(data.args).substring(0, 50)}...)`;
      case 'tool_result':
        return `${data.toolName} → ${(data.result as string)?.substring(0, 80)}...`;
      case 'response':
        return (data.response as string) || 'No response';
      case 'session_created':
        return `Session ${(data.id as string)?.substring(0, 8)} created in ${data.projectPath}`;
      default:
        return JSON.stringify(data).substring(0, 60);
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
          padding: 8px 12px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface);
        }

        .agent-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: 10px;
        }

        .agent-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-text-ghost);
        }

        .agent-status-dot.active {
          background: var(--color-amber);
          box-shadow: 0 0 8px var(--color-amber);
          animation: pulse-glow 1s ease-in-out infinite;
        }

        .agent-status-label {
          color: var(--color-text-dim);
        }

        .agent-status-label.active {
          color: var(--color-amber);
        }

        .agent-clear-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 6px;
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .agent-clear-btn:hover {
          border-color: var(--color-rose);
          color: var(--color-rose);
          background: rgba(251, 113, 133, 0.1);
        }

        .agent-clear-btn svg {
          width: 10px;
          height: 10px;
        }

        .agent-activities {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .agent-activity {
          display: flex;
          gap: 8px;
          padding: 8px;
          margin-bottom: 6px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-left: 3px solid;
          animation: slide-up 0.15s ease forwards;
        }

        .activity-icon {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
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
          letter-spacing: 0.05em;
          margin-bottom: 4px;
        }

        .activity-text {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-normal);
          word-break: break-word;
          line-height: 1.4;
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
          padding: 40px 20px;
          text-align: center;
          gap: 12px;
        }

        .empty-agent svg {
          width: 32px;
          height: 32px;
          color: var(--color-text-ghost);
          opacity: 0.4;
        }

        .empty-agent-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          line-height: 1.8;
        }

        @keyframes slide-up {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <div className="agent-header">
        <div className="agent-status">
          <span className={`agent-status-dot ${isActive ? 'active' : ''}`} />
          <span className={`agent-status-label ${isActive ? 'active' : ''}`}>
            {isActive ? 'PROCESSING' : 'IDLE'}
          </span>
        </div>
        {activities.length > 0 && (
          <button className="agent-clear-btn" onClick={onClear} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
            CLEAR
          </button>
        )}
      </div>

      <div className="agent-activities" ref={scrollRef}>
        {activities.length === 0 ? (
          <div className="empty-agent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="empty-agent-text">
              CLI Agent inactive<br/>
              Say "Computer" to start a dev session
            </span>
          </div>
        ) : (
          activities.map((activity) => {
            const color = getActivityColor(activity.type);
            return (
              <div
                key={activity.id}
                className="agent-activity"
                style={{ borderLeftColor: color }}
              >
                <span className="activity-icon" style={{ color }}>
                  {getActivityIcon(activity.type)}
                </span>
                <div className="activity-content">
                  <div className="activity-type" style={{ color }}>
                    {activity.type.replace('_', ' ')}
                  </div>
                  <div className="activity-text">
                    {formatActivityContent(activity)}
                  </div>
                </div>
                <span className="activity-time">
                  {new Date(activity.timestamp).toLocaleTimeString('de-DE', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
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

        .tab-btn.agent-active {
          color: var(--color-amber);
          border-bottom-color: var(--color-amber);
        }

        .tab-btn.agent-active .tab-count {
          background: var(--color-amber-dim);
          border-color: var(--color-amber);
          color: var(--color-amber);
          animation: pulse-glow 1s ease-in-out infinite;
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
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
          tab="agent"
          label="AGENT"
          count={cliAgentActivities.length || undefined}
          active={activeTab === 'agent'}
          onClick={() => onTabChange('agent')}
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
