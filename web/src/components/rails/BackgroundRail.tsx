// ═══════════════════════════════════════════════════════════════════════════
// Background Rail - Expandable sidebar for session history
// Collapsed: 80px icon dock | Expanded: 220px with session previews
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useUnifiedSessionsStore,
  useActiveView,
} from '../../stores';
import { navigateToSession } from '../../hooks/useRouter';
import type { SessionTreeNode } from '../../types';

// Format relative time compactly
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

// Check if a session tree has any running descendants
function hasRunningDescendant(node: SessionTreeNode): boolean {
  if (['pending', 'running', 'waiting_for_input'].includes(node.status)) return true;
  return node.children.some(hasRunningDescendant);
}

export function BackgroundRail() {
  const [expanded, setExpanded] = useState(false);

  // Store state
  const allTrees = useUnifiedSessionsStore((s) => s.allTrees);
  const sessionTree = useUnifiedSessionsStore((s) => s.sessionTree);
  const setActiveView = useUnifiedSessionsStore((s) => s.setActiveView);
  const activeView = useActiveView();

  // Get only voice sessions (true roots), sorted by creation time (newest first)
  const rootSessions = useMemo(() => {
    const sessions = Array.from(allTrees.values())
      .filter((s) => s.type === 'voice'); // Only show voice sessions, not subagents
    return sessions.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });
  }, [allTrees]);

  // The current tree root ID (even if focused on a child)
  const currentRootId = sessionTree?.id ?? null;
  const isPromptsView = activeView === 'prompts';

  const handleSessionClick = (session: SessionTreeNode) => {
    // Navigate via URL - the router sync will update the store
    navigateToSession(session.id);
    if (isPromptsView) setActiveView('sessions');
  };

  return (
    <motion.div
      className="bg-rail"
      animate={{ width: expanded ? 220 : 80 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <style>{`
        .bg-rail {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: rgba(5, 5, 10, 0.4);
          overflow: hidden;
          position: relative;
        }

        /* ════════════════════════════════════════════════════════════════
           SESSIONS AREA
           ════════════════════════════════════════════════════════════════ */

        .rail-sessions {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 16px 12px;
          gap: 8px;
          overflow-y: auto;
          overflow-x: hidden;
          min-height: 0;
        }

        .rail-sessions::-webkit-scrollbar {
          width: 2px;
        }

        .rail-sessions::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 1px;
        }

        /* ════════════════════════════════════════════════════════════════
           SESSION ITEM - Minimal card
           ════════════════════════════════════════════════════════════════ */

        .rail-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s ease;
          text-align: left;
          min-height: 40px;
          width: 100%;
        }

        .rail-item:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .rail-item.is-current {
          background: rgba(255, 255, 255, 0.06);
        }

        /* Dot indicator */
        .rail-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          flex-shrink: 0;
          transition: all 0.2s ease;
        }

        .rail-item.is-active .rail-dot {
          background: rgba(52, 211, 153, 0.8);
          box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
        }

        .rail-item.is-current .rail-dot {
          background: rgba(56, 189, 248, 0.8);
          box-shadow: 0 0 6px rgba(56, 189, 248, 0.5);
        }

        /* Text content - only visible when expanded */
        .rail-text {
          flex: 1;
          min-width: 0;
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .bg-rail:hover .rail-text {
          opacity: 1;
        }

        .rail-preview {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.7);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.3;
        }

        .rail-item.is-current .rail-preview {
          color: rgba(255, 255, 255, 0.9);
        }

        .rail-time {
          font-family: var(--font-mono);
          font-size: 9px;
          color: rgba(255, 255, 255, 0.3);
          margin-top: 2px;
        }

        /* ════════════════════════════════════════════════════════════════
           EMPTY STATE
           ════════════════════════════════════════════════════════════════ */

        .rail-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .rail-empty-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
        }

        .rail-empty-text {
          opacity: 0;
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(255, 255, 255, 0.3);
          text-align: center;
          line-height: 1.5;
          transition: opacity 0.15s ease;
        }

        .bg-rail:hover .rail-empty-text {
          opacity: 1;
        }

        .bg-rail:hover .rail-empty-dot {
          display: none;
        }

        /* ════════════════════════════════════════════════════════════════
           FOOTER - Navigation
           ════════════════════════════════════════════════════════════════ */

        .rail-footer {
          flex-shrink: 0;
          padding: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        .rail-nav {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s ease;
          width: 100%;
        }

        .rail-nav:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .rail-nav.is-active {
          background: rgba(255, 255, 255, 0.06);
        }

        .rail-nav-icon {
          width: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.4);
          flex-shrink: 0;
        }

        .rail-nav.is-active .rail-nav-icon {
          color: rgba(139, 92, 246, 0.8);
        }

        .rail-nav-label {
          font-family: var(--font-mono);
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .bg-rail:hover .rail-nav-label {
          opacity: 1;
        }

        .rail-nav.is-active .rail-nav-label {
          color: rgba(139, 92, 246, 0.8);
        }

        /* Back button in prompts view */
        .rail-back {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          margin-bottom: 8px;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s ease;
          width: 100%;
        }

        .rail-back:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .rail-back-icon {
          width: 8px;
          font-size: 12px;
          color: rgba(56, 189, 248, 0.7);
          flex-shrink: 0;
        }

        .rail-back-label {
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(56, 189, 248, 0.7);
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .bg-rail:hover .rail-back-label {
          opacity: 1;
        }
      `}</style>

      {/* Sessions area */}
      <div className="rail-sessions">
        {/* Back button when in prompts view */}
        {isPromptsView && (
          <button className="rail-back" onClick={() => setActiveView('sessions')}>
            <span className="rail-back-icon">←</span>
            <span className="rail-back-label">Back</span>
          </button>
        )}

        {rootSessions.length > 0 ? (
          <AnimatePresence mode="popLayout">
            {rootSessions.map((session) => {
              const isActive = hasRunningDescendant(session);
              const isCurrent = session.id === currentRootId;
              const preview = session.goal?.substring(0, 28) || 'Voice session';
              const time = formatTime(session.created_at);

              return (
                <motion.button
                  key={session.id}
                  className={`rail-item ${isActive ? 'is-active' : ''} ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => handleSessionClick(session)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <span className="rail-dot" />
                  <div className="rail-text">
                    <div className="rail-preview">{preview}</div>
                    <div className="rail-time">{time}</div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        ) : (
          <div className="rail-empty">
            <span className="rail-empty-dot" />
            <span className="rail-empty-text">No sessions</span>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="rail-footer">
        <button
          className={`rail-nav ${isPromptsView ? 'is-active' : ''}`}
          onClick={() => setActiveView(isPromptsView ? 'sessions' : 'prompts')}
        >
          <span className="rail-nav-icon">≡</span>
          <span className="rail-nav-label">Prompts</span>
        </button>
      </div>
    </motion.div>
  );
}
