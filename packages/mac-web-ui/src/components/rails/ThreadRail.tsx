import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useUnifiedSessionsStore,
  useFlattenedSessionTree,
} from '../../stores';
import { navigateToSession } from '../../hooks/useRouter';
import type { SessionTreeNode, SessionStatus } from '../../types';

const API_URL = process.env.PUBLIC_API_URL || '';

const INDENT_PX = 16;

const ICONS: Record<string, string> = {
  voice: '◉',
  cli: '⌘',
  web_search: '⊕',
  deep_thinking: '◈',
  orchestrator: '◆',
  terminal: '▣',
};

const TYPE_LABELS: Record<string, string> = {
  voice: 'VOICE',
  orchestrator: 'AGENT',
  terminal: 'TERMINAL',
};

const STATUS_CONFIG: Record<string, { symbol: string; color: string }> = {
  running:           { symbol: '●', color: 'text-blue-500' },
  pending:           { symbol: '○', color: 'text-muted-foreground' },
  waiting_for_input: { symbol: '❚❚', color: 'text-orange-500' },
  finished:          { symbol: '✓', color: 'text-green-500' },
  error:             { symbol: '✗', color: 'text-red-500' },
  cancelled:         { symbol: '—', color: 'text-muted-foreground' },
};

function SessionCard({
  id,
  type,
  agentName,
  name,
  title,
  status,
  depth,
  index,
  isFocused,
  isRoot,
  onClick,
}: {
  id: string;
  type: string;
  agentName?: string | null;
  name?: string | null;
  title: string;
  status?: SessionStatus;
  depth: number;
  index: number;
  isFocused: boolean;
  isRoot: boolean;
  onClick: () => void;
}) {
  const icon = agentName ? ICONS[agentName] || ICONS[type] : ICONS[type] || '◆';
  const typeLabel = agentName?.toUpperCase() || TYPE_LABELS[type] || type.toUpperCase();
  const statusInfo = status ? STATUS_CONFIG[status] : null;

  const primaryLabel = name || title;
  const displayTitle = primaryLabel.length > 28 ? primaryLabel.substring(0, 28) + '…' : primaryLabel;
  const subtitle = name && title ? (title.length > 40 ? title.substring(0, 40) + '…' : title) : null;

  const marginLeft = depth * INDENT_PX;

  const iconBg = type === 'voice'
    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
    : type === 'terminal'
    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    : 'bg-purple-500/10 text-purple-600 dark:text-purple-400';

  return (
    <motion.button
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors w-full ${
        isFocused
          ? isRoot
            ? 'bg-green-500/8 dark:bg-green-500/10'
            : 'bg-blue-500/8 dark:bg-blue-500/10'
          : 'hover:bg-accent/50'
      }`}
      onClick={onClick}
      style={{ marginLeft }}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      whileHover={{ x: -2 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className={`w-6 h-6 flex items-center justify-center rounded-md text-xs shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className={`text-[13px] font-medium truncate ${isFocused ? 'text-foreground' : 'text-foreground/80'}`}>
          {displayTitle}
        </div>
        {subtitle && (
          <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
        )}
        <div className="flex items-center gap-1.5">
          {statusInfo && (
            <span className={`text-[8px] leading-none ${statusInfo.color} ${status === 'running' ? 'animate-pulse' : ''}`}>
              {statusInfo.symbol}
            </span>
          )}
          <span className="text-[9px] font-mono text-muted-foreground tracking-wide">{typeLabel}</span>
          {isFocused && (
            <span className="text-[8px] font-mono font-semibold text-green-600 dark:text-green-400 tracking-wider px-1 py-px bg-green-500/10 rounded">
              ACTIVE
            </span>
          )}
        </div>
      </div>
      <div className="w-4 flex items-center justify-center shrink-0">
        {isFocused ? (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        ) : (
          <span className="text-sm text-muted-foreground/40 group-hover:text-foreground transition-colors">‹</span>
        )}
      </div>
    </motion.button>
  );
}

export function ThreadRail() {
  const [isClearing, setIsClearing] = useState(false);
  const flattenedTree = useFlattenedSessionTree();
  const focusedSessionId = useUnifiedSessionsStore((s) => s.focusedSessionId);
  const sessionTree = useUnifiedSessionsStore((s) => s.sessionTree);
  const voiceActive = useUnifiedSessionsStore((s) => s.voiceActive);
  const profile = useUnifiedSessionsStore((s) => s.voiceProfile);

  const handleClearSessions = async () => {
    const rootId = sessionTree?.id;
    if (isClearing || !rootId) return;

    setIsClearing(true);
    try {
      const res = await fetch(
        `${API_URL}/api/sessions/${encodeURIComponent(rootId)}/tree`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`DELETE /api/sessions/${rootId}/tree failed (${res.status}): ${errorText}`);
      }
      const data = await res.json();
      console.log('[ThreadRail] Cleared thread:', data);
      navigateToSession(null, true);
    } catch (err) {
      console.error('[ThreadRail] Error:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const voiceSessionId = sessionTree?.type === 'voice' ? sessionTree.id : null;
  const showVoiceCard = voiceActive && flattenedTree.length > 0;
  const childSessions = showVoiceCard
    ? flattenedTree.filter((item) => item.node.type !== 'voice')
    : flattenedTree;
  const isVoiceFocused = voiceSessionId !== null && focusedSessionId === voiceSessionId;
  const totalItems = (showVoiceCard ? 1 : 0) + childSessions.length;

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-4 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">Thread</span>
        {totalItems > 0 && (
          <span className="text-[10px] font-mono font-semibold text-blue-600 dark:text-blue-400 px-1.5 py-0.5 bg-blue-500/10 rounded">
            {totalItems}
          </span>
        )}
        <div className="flex-1" />
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-red-500 text-xs hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={handleClearSessions}
          disabled={isClearing || !sessionTree}
          title="Clear current thread"
        >
          {isClearing ? '…' : '×'}
        </button>
      </div>

      {totalItems === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 opacity-60">
          <div className="text-2xl text-muted-foreground/40 mb-3">◇</div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            No active sessions<br />
            Start a conversation
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-1.5">
          <AnimatePresence mode="popLayout">
            {showVoiceCard && (
              <SessionCard
                key="voice-root"
                id={voiceSessionId || 'voice'}
                type="voice"
                name={sessionTree?.name}
                title={profile || 'Voice'}
                status={sessionTree?.status}
                depth={0}
                index={0}
                isFocused={isVoiceFocused}
                isRoot={true}
                onClick={() => voiceSessionId && navigateToSession(voiceSessionId)}
              />
            )}
            {childSessions.map((item, index) => (
              <SessionCard
                key={item.node.id}
                id={item.node.id}
                type={item.node.type}
                agentName={item.node.agent_name}
                name={item.node.name}
                title={item.node.goal}
                status={item.node.status}
                depth={showVoiceCard ? item.depth : item.depth}
                index={showVoiceCard ? index + 1 : index}
                isFocused={item.node.id === focusedSessionId}
                isRoot={false}
                onClick={() => navigateToSession(item.node.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
