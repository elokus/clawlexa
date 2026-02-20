// ═══════════════════════════════════════════════════════════════════════════
// Thread Rail - Simple Hierarchical Tree View
//
// ARCHITECTURE:
// - Root session flush left, children indent progressively
// - Simple margin-left based indentation (16px per level)
// - All cards same structure, only indent changes
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useUnifiedSessionsStore,
  useFlattenedSessionTree,
} from '../../stores';
import { navigateToSession } from '../../hooks/useRouter';
import type { SessionTreeNode, SessionStatus } from '../../types';

const API_URL = process.env.PUBLIC_API_URL || '';

// Simple indent per depth level
const INDENT_PX = 16;

// Icons
const ICONS: Record<string, string> = {
  voice: '◉',
  cli: '⌘',
  web_search: '⊕',
  deep_thinking: '◈',
  orchestrator: '◆',
  terminal: '▣',
};

// Type labels
const TYPE_LABELS: Record<string, string> = {
  voice: 'VOICE',
  orchestrator: 'AGENT',
  terminal: 'TERMINAL',
};

// Status indicator config
const STATUS_CONFIG: Record<string, { symbol: string; className: string }> = {
  running:           { symbol: '●', className: 'status-running' },
  pending:           { symbol: '○', className: 'status-pending' },
  waiting_for_input: { symbol: '❚❚', className: 'status-waiting' },
  finished:          { symbol: '✓', className: 'status-finished' },
  error:             { symbol: '✗', className: 'status-error' },
  cancelled:         { symbol: '—', className: 'status-cancelled' },
};

// Unified card component for all session types
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

  // Use name as primary label when available, fall back to title (goal)
  const primaryLabel = name || title;
  const displayTitle = primaryLabel.length > 28 ? primaryLabel.substring(0, 28) + '…' : primaryLabel;
  // Show goal as subtitle when name is present
  const subtitle = name && title ? (title.length > 40 ? title.substring(0, 40) + '…' : title) : null;

  // Calculate indent - root has 0, children have depth * INDENT_PX
  const marginLeft = depth * INDENT_PX;

  return (
    <motion.button
      className={`session-card ${isFocused ? 'is-focused' : ''} ${isRoot ? 'is-root' : ''}`}
      data-type={type}
      onClick={onClick}
      style={{ marginLeft }}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      whileHover={{ x: -2 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="session-card-icon" data-type={type}>
        {icon}
      </div>
      <div className="session-card-content">
        <div className="session-card-title">{displayTitle}</div>
        {subtitle && (
          <div className="session-card-subtitle">{subtitle}</div>
        )}
        <div className="session-card-meta">
          {statusInfo && (
            <span className={`session-card-status ${statusInfo.className}`}>
              {statusInfo.symbol}
            </span>
          )}
          <span className="session-card-type">{typeLabel}</span>
          {isFocused && <span className="session-card-active">ACTIVE</span>}
        </div>
      </div>
      <div className="session-card-end">
        {isFocused ? (
          <span className="session-card-dot" />
        ) : (
          <span className="session-card-chevron">‹</span>
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

      // The currently focused session may be gone; clear URL and let tree sync pick the next root.
      navigateToSession(null, true);
    } catch (err) {
      console.error('[ThreadRail] Error:', err);
    } finally {
      setIsClearing(false);
    }
  };

  // Build the display list
  const voiceSessionId = sessionTree?.type === 'voice' ? sessionTree.id : null;
  const showVoiceCard = voiceActive && flattenedTree.length > 0;

  // Filter out voice from flattened tree if we're showing it separately
  const childSessions = showVoiceCard
    ? flattenedTree.filter((item) => item.node.type !== 'voice')
    : flattenedTree;

  // Only treat as voice-focused if explicitly focused on voice session
  // Don't treat null as "voice focused" - it causes flicker during URL sync
  const isVoiceFocused = voiceSessionId !== null && focusedSessionId === voiceSessionId;
  const totalItems = (showVoiceCard ? 1 : 0) + childSessions.length;

  return (
    <div className="thread-rail">
      <style>{`
        .thread-rail {
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 16px;
          overflow: hidden;
        }

        /* ═══════════════════════════════════════════════════════════════════
           HEADER
           ═══════════════════════════════════════════════════════════════════ */
        .thread-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
          flex-shrink: 0;
        }

        .thread-title {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.12em;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .thread-count {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          color: var(--color-cyan);
          padding: 2px 7px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 4px;
        }

        .thread-spacer {
          flex: 1;
        }

        .thread-clear {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.2);
          border-radius: 5px;
          color: var(--color-rose);
          font-size: 12px;
          cursor: pointer;
          opacity: 0.6;
          transition: all 0.15s ease;
        }

        .thread-clear:hover:not(:disabled) {
          opacity: 1;
          background: rgba(244, 63, 94, 0.15);
        }

        .thread-clear:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        /* ═══════════════════════════════════════════════════════════════════
           SESSION LIST
           ═══════════════════════════════════════════════════════════════════ */
        .thread-list {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           SESSION CARD - Simple, consistent design
           ═══════════════════════════════════════════════════════════════════ */
        .session-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s ease;
        }

        .session-card:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .session-card.is-focused {
          background: rgba(56, 189, 248, 0.06);
          border-color: rgba(56, 189, 248, 0.25);
        }

        .session-card.is-root {
          background: rgba(52, 211, 153, 0.04);
          border-color: rgba(52, 211, 153, 0.15);
        }

        .session-card.is-root.is-focused {
          background: rgba(52, 211, 153, 0.08);
          border-color: rgba(52, 211, 153, 0.3);
        }

        /* Icon */
        .session-card-icon {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 92, 246, 0.1);
          border: 1px solid rgba(139, 92, 246, 0.2);
          border-radius: 6px;
          font-size: 12px;
          color: var(--color-violet);
          flex-shrink: 0;
        }

        .session-card-icon[data-type="voice"] {
          background: rgba(52, 211, 153, 0.1);
          border-color: rgba(52, 211, 153, 0.2);
          color: var(--color-emerald);
        }

        .session-card-icon[data-type="terminal"] {
          background: rgba(56, 189, 248, 0.1);
          border-color: rgba(56, 189, 248, 0.2);
          color: var(--color-cyan);
        }

        .session-card.is-focused .session-card-icon {
          box-shadow: 0 0 10px currentColor;
        }

        /* Content */
        .session-card-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .session-card-title {
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-normal);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .session-card.is-focused .session-card-title {
          color: var(--color-text-bright);
        }

        .session-card-subtitle {
          font-family: var(--font-ui);
          font-size: 11px;
          font-weight: 400;
          color: var(--color-text-ghost);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .session-card-meta {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .session-card-type {
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 500;
          color: var(--color-text-ghost);
          letter-spacing: 0.05em;
        }

        .session-card-active {
          font-family: var(--font-mono);
          font-size: 8px;
          font-weight: 600;
          color: var(--color-emerald);
          letter-spacing: 0.08em;
          padding: 1px 5px;
          background: rgba(52, 211, 153, 0.12);
          border-radius: 3px;
        }

        /* Status indicator */
        .session-card-status {
          font-size: 8px;
          line-height: 1;
        }

        .session-card-status.status-running {
          color: var(--color-cyan);
          animation: status-pulse 1.5s ease-in-out infinite;
        }

        .session-card-status.status-pending {
          color: var(--color-text-ghost);
        }

        .session-card-status.status-waiting {
          color: var(--color-amber);
          font-size: 7px;
          letter-spacing: -1px;
        }

        .session-card-status.status-finished {
          color: var(--color-emerald);
        }

        .session-card-status.status-error {
          color: var(--color-rose);
        }

        .session-card-status.status-cancelled {
          color: var(--color-text-ghost);
        }

        @keyframes status-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* End indicator */
        .session-card-end {
          width: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .session-card-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-emerald);
          box-shadow: 0 0 6px var(--color-emerald);
        }

        .session-card-chevron {
          font-size: 14px;
          color: var(--color-text-ghost);
          opacity: 0.5;
          transition: all 0.15s ease;
        }

        .session-card:hover .session-card-chevron {
          opacity: 1;
          transform: translateX(-2px);
          color: var(--color-cyan);
        }

        /* ═══════════════════════════════════════════════════════════════════
           EMPTY STATE
           ═══════════════════════════════════════════════════════════════════ */
        .thread-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 24px;
          opacity: 0.6;
        }

        .thread-empty-icon {
          font-size: 24px;
          color: var(--color-text-ghost);
          margin-bottom: 12px;
        }

        .thread-empty-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
          line-height: 1.6;
        }

        /* ═══════════════════════════════════════════════════════════════════
           RESPONSIVE
           ═══════════════════════════════════════════════════════════════════ */
        @media (max-width: 1024px) {
          .thread-rail {
            padding: 12px;
          }

          .session-card {
            padding: 8px 10px;
          }

          .session-card-content {
            display: none;
          }

          .session-card-icon {
            width: 32px;
            height: 32px;
          }
        }
      `}</style>

      <div className="thread-header">
        <span className="thread-title">Thread</span>
        {totalItems > 0 && <span className="thread-count">{totalItems}</span>}
        <div className="thread-spacer" />
        <button
          className="thread-clear"
          onClick={handleClearSessions}
          disabled={isClearing || !sessionTree}
          title="Clear current thread"
        >
          {isClearing ? '…' : '×'}
        </button>
      </div>

      {totalItems === 0 ? (
        <div className="thread-empty">
          <div className="thread-empty-icon">◇</div>
          <div className="thread-empty-text">
            No active sessions<br />
            Start a conversation
          </div>
        </div>
      ) : (
        <div className="thread-list">
          <AnimatePresence mode="popLayout">
            {/* Voice root card - depth 0 */}
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

            {/* Child sessions - depth starts at 1 when voice is shown */}
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
