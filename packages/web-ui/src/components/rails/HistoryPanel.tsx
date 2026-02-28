import { useMemo } from 'react';
import { useUnifiedSessionsStore } from '../../stores';
import { navigateToSession } from '../../hooks/useRouter';
import type { SessionTreeNode } from '../../types';

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

export function HistoryPanel() {
  const allTrees = useUnifiedSessionsStore((s) => s.allTrees);
  const sessionTree = useUnifiedSessionsStore((s) => s.sessionTree);
  const toggleHistoryPanel = useUnifiedSessionsStore((s) => s.toggleHistoryPanel);

  const rootSessions = useMemo(() => {
    return Array.from(allTrees.values())
      .filter((s) => s.type === 'voice')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [allTrees]);

  const currentRootId = sessionTree?.id ?? null;

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <span className="history-panel-title">Sessions</span>
        <button
          type="button"
          className="history-panel-close"
          onClick={toggleHistoryPanel}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="history-panel-list">
        {rootSessions.length > 0 ? (
          rootSessions.map((session) => {
            const isActive = hasRunningDescendant(session);
            const isCurrent = session.id === currentRootId;
            const preview = session.name || 'Voice session';
            const time = formatTime(session.created_at);

            return (
              <button
                key={session.id}
                type="button"
                className={`history-panel-item ${isCurrent ? 'active' : ''}`}
                onClick={() => {
                  navigateToSession(session.id);
                  toggleHistoryPanel();
                }}
              >
                <span
                  className="history-panel-dot"
                  style={{
                    background: isCurrent
                      ? 'var(--color-blue)'
                      : isActive
                        ? 'var(--color-green)'
                        : 'var(--muted-foreground)',
                    opacity: isCurrent || isActive ? 1 : 0.3,
                  }}
                />
                <span className="history-panel-name">{preview}</span>
                <span className="history-panel-time">{time}</span>
              </button>
            );
          })
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            No sessions yet
          </div>
        )}
      </div>
    </div>
  );
}
