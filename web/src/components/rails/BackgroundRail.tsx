// ═══════════════════════════════════════════════════════════════════════════
// Background Rail - Slim vertical Icon Dock with sessions grouped by thread
// Obsidian Glass / Minority Report aesthetic
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStageStore } from '../../stores/stage';
import { useAgentStore } from '../../stores/agent';
import { useSessionsStore } from '../../stores/sessions';
import type { OverlayType, CliSession, SessionStatus } from '../../types';

// Persistent action icons
const DOCK_ACTIONS: { id: OverlayType; icon: string; label: string }[] = [
  { id: 'events', icon: '⚡', label: 'Events' },
  { id: 'tools', icon: '◇', label: 'Tools' },
  { id: 'history', icon: '◷', label: 'History' },
];

const SESSION_STATUS_COLORS: Record<SessionStatus, string> = {
  pending: 'var(--color-amber)',
  running: 'var(--color-cyan)',
  waiting_for_input: 'var(--color-violet)',
  finished: 'var(--color-text-dim)',
  error: 'var(--color-rose)',
  cancelled: 'var(--color-text-ghost)',
};

function DockButton({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <button
      className={`dock-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="dock-icon">{icon}</span>
      {badge !== undefined && badge > 0 && (
        <span className="dock-badge">{badge > 99 ? '99+' : badge}</span>
      )}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            className="dock-tooltip"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.15 }}
          >
            {label}
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

function SessionButton({
  session,
  onClick,
}: {
  session: CliSession;
  onClick: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const statusColor = SESSION_STATUS_COLORS[session.status];
  const isActive = session.status === 'running' || session.status === 'waiting_for_input';

  return (
    <motion.button
      className={`dock-session ${isActive ? 'active' : ''}`}
      style={{ '--status-color': statusColor } as React.CSSProperties}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      initial={{ opacity: 0, scale: 0.8, x: -10 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
    >
      <span className="dock-session-icon">▣</span>
      <span className={`dock-session-indicator ${isActive ? 'pulse' : ''}`} />
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            className="dock-session-tooltip"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="tooltip-goal">{session.goal}</div>
            <div className="tooltip-id">ID: {session.id.slice(0, 8)}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function ThreadGroup({
  threadId,
  sessions,
  onSessionClick,
}: {
  threadId: string;
  sessions: CliSession[];
  onSessionClick: (session: CliSession) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const activeCount = sessions.filter(
    (s) => s.status === 'running' || s.status === 'waiting_for_input'
  ).length;

  return (
    <div className="thread-group">
      <button
        className={`thread-header ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="thread-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="thread-count">{sessions.length}</span>
        {activeCount > 0 && <span className="thread-active-dot" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="thread-sessions"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {sessions.map((session) => (
              <SessionButton
                key={session.id}
                session={session}
                onClick={() => onSessionClick(session)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function BackgroundRail() {
  // Use new tree-based state
  const backgroundTreeIds = useStageStore((s) => s.backgroundTreeIds);
  const activeOverlay = useStageStore((s) => s.activeOverlay);
  const setActiveOverlay = useStageStore((s) => s.setActiveOverlay);
  const restoreTree = useStageStore((s) => s.restoreTree);
  const focusSession = useStageStore((s) => s.focusSession);
  const events = useAgentStore((s) => s.events);

  const sessions = useSessionsStore((s) => s.sessions);
  const hasFetched = useSessionsStore((s) => s.hasFetched);
  const fetchSessions = useSessionsStore((s) => s.fetchSessions);
  const getSessionsByThread = useSessionsStore((s) => s.getSessionsByThread);

  // Fetch sessions on mount if not already fetched
  useEffect(() => {
    if (!hasFetched) {
      fetchSessions();
    }
  }, [hasFetched, fetchSessions]);

  // Group sessions by thread
  const sessionsByThread = useMemo(() => getSessionsByThread(), [sessions, getSessionsByThread]);

  // Sort threads by most recent session
  const sortedThreads = useMemo(() => {
    const entries = Array.from(sessionsByThread.entries());
    return entries.sort((a, b) => {
      const aLatest = a[1][a[1].length - 1];
      const bLatest = b[1][b[1].length - 1];
      return new Date(bLatest.created_at).getTime() - new Date(aLatest.created_at).getTime();
    });
  }, [sessionsByThread]);

  const handleOverlayToggle = (overlay: OverlayType) => {
    if (activeOverlay === overlay) {
      setActiveOverlay(null);
    } else {
      setActiveOverlay(overlay);
    }
  };

  const handleSessionClick = (session: CliSession) => {
    // Focus the session in the tree if it exists
    focusSession(session.id);
  };

  return (
    <div className="dock-rail">
      <style>{`
        .dock-rail {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          padding: 20px 0;
          gap: 0;
          overflow: hidden;
        }

        .dock-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding-bottom: 20px;
          flex-shrink: 0;
        }

        .dock-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          background: transparent;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .dock-btn::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 0;
          background: var(--color-cyan);
          border-radius: 0 2px 2px 0;
          transition: all 0.2s ease;
          box-shadow: 0 0 8px var(--color-cyan);
        }

        .dock-btn:hover::before {
          height: 24px;
        }

        .dock-btn.active::before {
          height: 32px;
          box-shadow: 0 0 12px var(--color-cyan);
        }

        .dock-btn:hover {
          background: rgba(56, 189, 248, 0.05);
        }

        .dock-btn.active {
          background: rgba(56, 189, 248, 0.08);
        }

        .dock-icon {
          font-size: 20px;
          color: var(--color-text-dim);
          transition: all 0.2s ease;
        }

        .dock-btn:hover .dock-icon,
        .dock-btn.active .dock-icon {
          color: var(--color-cyan);
          text-shadow: 0 0 12px var(--color-cyan);
        }

        .dock-badge {
          position: absolute;
          top: 6px;
          right: 6px;
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
          box-shadow: 0 0 8px var(--color-cyan);
        }

        .dock-tooltip {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 12px;
          padding: 6px 12px;
          background: rgba(10, 10, 15, 0.95);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-normal);
          white-space: nowrap;
          pointer-events: none;
          z-index: 100;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        }

        .dock-tooltip::before {
          content: '';
          position: absolute;
          left: -6px;
          top: 50%;
          transform: translateY(-50%);
          border: 6px solid transparent;
          border-right-color: rgba(10, 10, 15, 0.95);
        }

        .dock-divider {
          width: 32px;
          height: 1px;
          background: var(--color-glass-border);
          margin: 4px 0 16px 0;
          flex-shrink: 0;
        }

        .dock-tasks {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          overflow-y: auto;
          padding: 0 8px;
          flex-shrink: 0;
        }

        .dock-task {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          background: rgba(10, 10, 15, 0.6);
          border: 1px solid var(--color-glass-border);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .dock-task:hover {
          border-color: var(--color-cyan-dim);
          background: rgba(56, 189, 248, 0.05);
        }

        .dock-task.terminal {
          border-left: 2px solid var(--color-cyan);
        }

        .dock-task.terminal .dock-task-icon {
          color: var(--color-cyan);
          animation: task-pulse 2s ease-in-out infinite;
        }

        @keyframes task-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .dock-task-icon {
          font-family: var(--font-mono);
          font-size: 16px;
          color: var(--color-text-dim);
        }

        .dock-task-tooltip {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 12px;
          padding: 6px 12px;
          background: rgba(10, 10, 15, 0.95);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-normal);
          white-space: nowrap;
          pointer-events: none;
          z-index: 100;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        }

        /* ═══════════════════════════════════════════════════════════════════
           SESSION GROUPS
           ═══════════════════════════════════════════════════════════════════ */

        .sessions-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          overflow-y: auto;
          padding: 0 4px;
          min-height: 0;
        }

        .sessions-section::-webkit-scrollbar {
          width: 4px;
        }

        .sessions-section::-webkit-scrollbar-track {
          background: transparent;
        }

        .sessions-section::-webkit-scrollbar-thumb {
          background: rgba(56, 189, 248, 0.2);
          border-radius: 2px;
        }

        .sessions-label {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.1em;
          color: var(--color-text-ghost);
          text-transform: uppercase;
          padding: 4px 0;
        }

        .thread-group {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          width: 100%;
        }

        .thread-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          width: 44px;
          height: 24px;
          background: rgba(10, 10, 15, 0.4);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .thread-header:hover {
          background: rgba(56, 189, 248, 0.05);
          border-color: var(--color-cyan-dim);
        }

        .thread-chevron {
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .thread-count {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
        }

        .thread-active-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-cyan);
          box-shadow: 0 0 8px var(--color-cyan);
          animation: dot-pulse 1.5s ease-in-out infinite;
        }

        @keyframes dot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .thread-sessions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding-left: 8px;
          border-left: 1px solid rgba(56, 189, 248, 0.1);
          margin-left: 8px;
          overflow: hidden;
        }

        .dock-session {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          background: rgba(10, 10, 15, 0.5);
          border: 1px solid var(--color-glass-border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .dock-session:hover {
          border-color: var(--status-color);
          background: color-mix(in srgb, var(--status-color) 5%, transparent);
        }

        .dock-session.active {
          border-left: 2px solid var(--status-color);
        }

        .dock-session-icon {
          font-family: var(--font-mono);
          font-size: 14px;
          color: var(--status-color);
          opacity: 0.8;
        }

        .dock-session-indicator {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--status-color);
        }

        .dock-session-indicator.pulse {
          animation: indicator-pulse 1.5s ease-in-out infinite;
        }

        @keyframes indicator-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px var(--status-color); }
          50% { opacity: 0.5; box-shadow: 0 0 8px var(--status-color); }
        }

        .dock-session-tooltip {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 12px;
          padding: 8px 12px;
          background: rgba(10, 10, 15, 0.95);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          font-family: var(--font-mono);
          pointer-events: none;
          z-index: 100;
          max-width: 200px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        }

        .tooltip-goal {
          font-size: 11px;
          color: var(--color-text-normal);
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tooltip-id {
          font-size: 9px;
          color: var(--color-text-ghost);
        }

        .empty-sessions {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          text-align: center;
          padding: 12px 0;
        }

        .dock-tasks::-webkit-scrollbar {
          width: 0;
        }
      `}</style>

      {/* Action Icons */}
      <div className="dock-actions">
        {DOCK_ACTIONS.map((action) => (
          <DockButton
            key={action.id}
            icon={action.icon}
            label={action.label}
            active={activeOverlay === action.id}
            badge={action.id === 'events' ? events.length : undefined}
            onClick={() => handleOverlayToggle(action.id)}
          />
        ))}
      </div>

      {/* Divider if there are background trees */}
      {backgroundTreeIds.length > 0 && <div className="dock-divider" />}

      {/* Background Trees (minimized session trees) */}
      {backgroundTreeIds.length > 0 && (
        <div className="dock-tasks">
          <AnimatePresence>
            {backgroundTreeIds.map((treeId) => (
              <motion.button
                key={treeId}
                className="dock-task terminal"
                onClick={() => restoreTree(treeId)}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
                title={`Restore tree ${treeId.slice(0, 8)}`}
              >
                <span className="dock-task-icon">◇</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Divider before sessions */}
      {(backgroundTreeIds.length > 0 || sessions.length > 0) && <div className="dock-divider" />}

      {/* Sessions Section */}
      <div className="sessions-section">
        {sessions.length > 0 ? (
          <>
            <span className="sessions-label">Sessions</span>
            {sortedThreads.map(([threadId, threadSessions]) => (
              // Skip group wrapper for single-session threads
              threadSessions.length === 1 ? (
                <SessionButton
                  key={threadSessions[0].id}
                  session={threadSessions[0]}
                  onClick={() => handleSessionClick(threadSessions[0])}
                />
              ) : (
                <ThreadGroup
                  key={threadId}
                  threadId={threadId}
                  sessions={threadSessions}
                  onSessionClick={handleSessionClick}
                />
              )
            ))}
          </>
        ) : (
          hasFetched && <span className="empty-sessions">No sessions</span>
        )}
      </div>
    </div>
  );
}
