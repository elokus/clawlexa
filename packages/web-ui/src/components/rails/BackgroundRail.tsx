import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useUnifiedSessionsStore,
  useActiveView,
} from '../../stores';
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

export function BackgroundRail() {
  const [expanded, setExpanded] = useState(false);

  const allTrees = useUnifiedSessionsStore((s) => s.allTrees);
  const sessionTree = useUnifiedSessionsStore((s) => s.sessionTree);
  const setActiveView = useUnifiedSessionsStore((s) => s.setActiveView);
  const activeView = useActiveView();

  const rootSessions = useMemo(() => {
    const sessions = Array.from(allTrees.values())
      .filter((s) => s.type === 'voice');
    return sessions.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });
  }, [allTrees]);

  const currentRootId = sessionTree?.id ?? null;
  const isPromptsView = activeView === 'prompts';

  const handleSessionClick = (session: SessionTreeNode) => {
    navigateToSession(session.id);
    if (isPromptsView) setActiveView('sessions');
  };

  return (
    <motion.div
      className="flex flex-col h-full overflow-hidden relative"
      animate={{ width: expanded ? 220 : 80 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Sessions area */}
      <div className="flex-1 flex flex-col p-3 gap-1.5 overflow-y-auto overflow-x-hidden min-h-0">
        {/* Back button in prompts view */}
        {isPromptsView && (
          <button
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-accent transition-colors w-full text-left mb-2"
            onClick={() => setActiveView('sessions')}
          >
            <span className="w-2 text-blue-500 dark:text-blue-400 text-xs shrink-0">←</span>
            <span className={`text-xs font-medium text-blue-500 dark:text-blue-400 transition-opacity ${expanded ? 'opacity-100' : 'opacity-0'}`}>
              Back
            </span>
          </button>
        )}

        {rootSessions.length > 0 ? (
          <AnimatePresence mode="popLayout">
            {rootSessions.map((session) => {
              const isActive = hasRunningDescendant(session);
              const isCurrent = session.id === currentRootId;
              const preview = session.name || session.goal?.substring(0, 28) || 'Voice session';
              const time = formatTime(session.created_at);

              return (
                <motion.button
                  key={session.id}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors w-full text-left min-h-[40px] ${
                    isCurrent
                      ? 'bg-accent'
                      : 'hover:bg-accent/50'
                  }`}
                  onClick={() => handleSessionClick(session)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    isCurrent
                      ? 'bg-blue-500'
                      : isActive
                      ? 'bg-green-500'
                      : 'bg-muted-foreground/30'
                  }`} />
                  <div className={`flex-1 min-w-0 transition-opacity ${expanded ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="text-[12px] font-medium text-foreground truncate leading-tight">
                      {preview}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      {time}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4">
            <span className={`w-1.5 h-1.5 rounded-full bg-muted-foreground/20 ${expanded ? 'hidden' : ''}`} />
            <span className={`text-xs text-muted-foreground text-center leading-relaxed transition-opacity ${expanded ? 'opacity-100' : 'opacity-0'}`}>
              No sessions
            </span>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="shrink-0 p-3 border-t border-border/40">
        <button
          className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors w-full ${
            isPromptsView ? 'bg-accent' : 'hover:bg-accent/50'
          }`}
          onClick={() => setActiveView(isPromptsView ? 'sessions' : 'prompts')}
        >
          <span className={`w-2 text-center text-sm shrink-0 ${
            isPromptsView ? 'text-purple-500' : 'text-muted-foreground'
          }`}>≡</span>
          <span className={`text-xs font-medium transition-opacity ${
            isPromptsView ? 'text-purple-500' : 'text-muted-foreground'
          } ${expanded ? 'opacity-100' : 'opacity-0'}`}>
            Prompts
          </span>
        </button>
      </div>
    </motion.div>
  );
}
