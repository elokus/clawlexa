import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useUnifiedSessionsStore,
} from '../../stores';
import { navigateToSession } from '../../hooks/useRouter';
import type { SessionTreeNode } from '../../types';

const MAX_VISIBLE_SESSIONS = 8;

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function hasRunningDescendant(node: SessionTreeNode): boolean {
  if (['pending', 'running', 'waiting_for_input'].includes(node.status)) return true;
  return node.children.some(hasRunningDescendant);
}

export function BackgroundRail() {
  const [expanded, setExpanded] = useState(false);

  const allTrees = useUnifiedSessionsStore((s) => s.allTrees);
  const sessionTree = useUnifiedSessionsStore((s) => s.sessionTree);

  const rootSessions = useMemo(() => {
    const sessions = Array.from(allTrees.values())
      .filter((s) => s.type === 'voice');
    return sessions
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, MAX_VISIBLE_SESSIONS);
  }, [allTrees]);

  const totalCount = useMemo(() => {
    return Array.from(allTrees.values()).filter((s) => s.type === 'voice').length;
  }, [allTrees]);

  const currentRootId = sessionTree?.id ?? null;

  return (
    <>
      <style>{`
        .bg-rail {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          border-right: 1px solid var(--border);
        }

        .bg-rail-sessions {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 8px 6px;
          gap: 2px;
          overflow-y: auto;
          overflow-x: hidden;
          min-height: 0;
        }

        .bg-rail-sessions::-webkit-scrollbar {
          width: 0;
        }

        .bg-rail-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 8px;
          border: none;
          background: none;
          cursor: pointer;
          transition: background 0.12s ease;
          width: 100%;
          text-align: left;
          min-height: 36px;
        }

        .bg-rail-item:hover {
          background: var(--accent);
        }

        .bg-rail-item.active {
          background: var(--accent);
        }

        .bg-rail-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .bg-rail-dot.current {
          background: var(--color-blue);
        }

        .bg-rail-dot.running {
          background: var(--color-green);
        }

        .bg-rail-dot.idle {
          background: var(--muted-foreground);
          opacity: 0.3;
        }

        .bg-rail-text {
          flex: 1;
          min-width: 0;
          transition: opacity 0.15s ease;
        }

        .bg-rail-text.hidden {
          opacity: 0;
          width: 0;
          overflow: hidden;
        }

        .bg-rail-name {
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
        }

        .bg-rail-time {
          font-family: var(--font-sans);
          font-size: 10px;
          color: var(--muted-foreground);
          margin-top: 1px;
        }

        .bg-rail-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .bg-rail-empty-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--muted-foreground);
          opacity: 0.15;
        }

        .bg-rail-empty-text {
          font-family: var(--font-sans);
          font-size: 11px;
          color: var(--muted-foreground);
          text-align: center;
          line-height: 1.5;
        }

        .bg-rail-footer {
          flex-shrink: 0;
          padding: 6px 8px;
          border-top: 1px solid var(--border);
        }

        .bg-rail-count {
          font-family: var(--font-sans);
          font-size: 10px;
          color: var(--muted-foreground);
          text-align: center;
          padding: 4px;
          transition: opacity 0.15s ease;
        }
      `}</style>

      <motion.div
        className="bg-rail"
        animate={{ width: expanded ? 200 : 48 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <div className="bg-rail-sessions">
          {rootSessions.length > 0 ? (
            <AnimatePresence mode="popLayout">
              {rootSessions.map((session) => {
                const isActive = hasRunningDescendant(session);
                const isCurrent = session.id === currentRootId;
                const preview = session.name || 'Voice session';
                const time = formatTime(session.created_at);

                return (
                  <motion.button
                    key={session.id}
                    className={`bg-rail-item ${isCurrent ? 'active' : ''}`}
                    onClick={() => navigateToSession(session.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <span className={`bg-rail-dot ${
                      isCurrent ? 'current' : isActive ? 'running' : 'idle'
                    }`} />
                    <div className={`bg-rail-text ${expanded ? '' : 'hidden'}`}>
                      <div className="bg-rail-name">{preview}</div>
                      <div className="bg-rail-time">{time}</div>
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          ) : (
            <div className="bg-rail-empty">
              {expanded ? (
                <span className="bg-rail-empty-text">No sessions</span>
              ) : (
                <span className="bg-rail-empty-dot" />
              )}
            </div>
          )}
        </div>

        {totalCount > MAX_VISIBLE_SESSIONS && (
          <div className="bg-rail-footer">
            <div className="bg-rail-count" style={{ opacity: expanded ? 1 : 0 }}>
              {totalCount - MAX_VISIBLE_SESSIONS} more sessions
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
