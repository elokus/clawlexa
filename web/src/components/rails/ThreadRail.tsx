// ═══════════════════════════════════════════════════════════════════════════
// Thread Rail - Mission Control Tree View
//
// ARCHITECTURE:
// - Root session is most prominent (largest)
// - Children cascade with diminishing size
// - Visual connection lines show parent-child relationships
// - Click any card to focus that session
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useUnifiedSessionsStore,
  useFlattenedSessionTree,
} from '../../stores';
import type { SessionTreeNode } from '../../types';

// API base URL
const API_URL = import.meta.env.VITE_API_URL || '';

// Icons for session types - using simpler, cleaner icons
const SESSION_ICONS: Record<string, string> = {
  orchestrator: '◆',
  terminal: '▣',
};

// Agent-specific icons
const AGENT_ICONS: Record<string, string> = {
  cli: '⌘',
  web_search: '⊕',
  deep_thinking: '◈',
};

// Session type display names
const SESSION_TYPE_LABELS: Record<string, string> = {
  orchestrator: 'AGENT',
  terminal: 'TERMINAL',
};

// Depth-based styling configuration
const DEPTH_CONFIG = {
  0: { width: '100%', iconSize: 36, titleSize: 14, labelSize: 10, padding: 14, opacity: 1 },
  1: { width: '94%', iconSize: 30, titleSize: 13, labelSize: 9, padding: 12, opacity: 0.95 },
  2: { width: '88%', iconSize: 26, titleSize: 12, labelSize: 9, padding: 10, opacity: 0.9 },
  3: { width: '82%', iconSize: 24, titleSize: 11, labelSize: 8, padding: 10, opacity: 0.85 },
} as const;

function getDepthConfig(depth: number) {
  const maxDepth = 3;
  const d = Math.min(depth, maxDepth) as keyof typeof DEPTH_CONFIG;
  return DEPTH_CONFIG[d];
}

function TreeCard({
  node,
  depth,
  index,
  isFocused,
  isLast,
  onClick,
}: {
  node: SessionTreeNode;
  depth: number;
  index: number;
  isFocused: boolean;
  isLast: boolean;
  onClick: () => void;
}) {
  const config = getDepthConfig(depth);

  // Get icon - prefer agent-specific, fallback to type-based
  const icon = node.agent_name
    ? AGENT_ICONS[node.agent_name] || SESSION_ICONS[node.type]
    : SESSION_ICONS[node.type] || '◆';

  // Get display label
  const typeLabel = node.agent_name?.toUpperCase() || SESSION_TYPE_LABELS[node.type] || node.type.toUpperCase();

  // Truncate goal for display
  const maxLen = 32 - depth * 4;
  const displayTitle = node.goal.length > maxLen
    ? node.goal.substring(0, maxLen) + '…'
    : node.goal;

  return (
    <div
      className="tree-node-wrapper"
      style={{
        paddingLeft: depth > 0 ? 20 : 0,
        opacity: config.opacity,
      }}
    >
      {/* Connection line for nested items */}
      {depth > 0 && (
        <div className="tree-connector">
          <div className="tree-line-vertical" style={{ height: isLast ? '24px' : '100%' }} />
          <div className="tree-line-horizontal" />
        </div>
      )}

      <motion.button
        className={`thread-card ${isFocused ? 'is-active' : ''}`}
        data-type={node.type}
        data-depth={depth}
        onClick={onClick}
        style={{
          width: config.width,
          '--icon-size': `${config.iconSize}px`,
          '--title-size': `${config.titleSize}px`,
          '--label-size': `${config.labelSize}px`,
          '--card-padding': `${config.padding}px`,
        } as React.CSSProperties}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 16, scale: 0.98 }}
        transition={{
          duration: 0.25,
          delay: index * 0.05,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        whileHover={{ x: -3 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className="thread-card-inner">
          <div className="thread-icon">{icon}</div>
          <div className="thread-info">
            <div className="thread-title">{displayTitle}</div>
            <div className="thread-meta">
              <span className="thread-type">{typeLabel}</span>
              {isFocused && <span className="thread-status">ACTIVE</span>}
            </div>
          </div>
          <div className="thread-indicator">
            {isFocused ? (
              <span className="thread-status-dot" />
            ) : (
              <span className="thread-chevron">‹</span>
            )}
          </div>
        </div>
      </motion.button>
    </div>
  );
}

// Voice Session card - Root of the tree, most prominent
function VoiceCard({
  profile,
  index,
  isFocused,
  hasChildren,
  onClick,
}: {
  profile: string | null;
  index: number;
  isFocused: boolean;
  hasChildren: boolean;
  onClick: () => void;
}) {
  const displayName = profile || 'Voice';
  const config = getDepthConfig(0);

  return (
    <div className="tree-node-wrapper tree-root">
      <motion.button
        className={`thread-card thread-card-root ${isFocused ? 'is-active' : ''}`}
        data-type="voice"
        onClick={onClick}
        style={{
          '--icon-size': `${config.iconSize}px`,
          '--title-size': `${config.titleSize}px`,
          '--label-size': `${config.labelSize}px`,
          '--card-padding': `${config.padding}px`,
        } as React.CSSProperties}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{
          duration: 0.3,
          delay: index * 0.05,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <div className="thread-card-inner">
          <div className="thread-icon voice-icon">◉</div>
          <div className="thread-info">
            <div className="thread-title">{displayName}</div>
            <div className="thread-meta">
              <span className="thread-type">VOICE SESSION</span>
              {isFocused && <span className="thread-status">ACTIVE</span>}
            </div>
          </div>
          <div className="thread-indicator">
            {isFocused ? (
              <span className="thread-status-dot" />
            ) : (
              <span className="thread-chevron">‹</span>
            )}
          </div>
        </div>
      </motion.button>

      {/* Trunk line connecting to children */}
      {hasChildren && (
        <div className="tree-trunk" />
      )}
    </div>
  );
}

export function ThreadRail() {
  const [isClearing, setIsClearing] = useState(false);

  // Get flattened tree (memoized in the hook to avoid infinite loops)
  const flattenedTree = useFlattenedSessionTree();

  // Use unified store for all state
  const focusedSessionId = useUnifiedSessionsStore((s) => s.focusedSessionId);
  const sessionTree = useUnifiedSessionsStore((s) => s.sessionTree);
  const focusSession = useUnifiedSessionsStore((s) => s.focusSession);
  const voiceActive = useUnifiedSessionsStore((s) => s.voiceActive);
  const profile = useUnifiedSessionsStore((s) => s.voiceProfile);

  // Clear all agent sessions from database
  const handleClearSessions = async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      const res = await fetch(`${API_URL}/api/sessions`, { method: 'DELETE' });
      if (!res.ok) {
        console.error('[ThreadRail] Failed to clear sessions:', res.status);
      } else {
        const data = await res.json();
        console.log('[ThreadRail] Cleared', data.deleted, 'sessions');
      }
    } catch (err) {
      console.error('[ThreadRail] Error clearing sessions:', err);
    } finally {
      setIsClearing(false);
    }
  };

  // Get voice session ID from tree root (if it's a voice session)
  const voiceSessionId = sessionTree?.type === 'voice' ? sessionTree.id : null;

  // Filter out voice sessions when showing separate VoiceCard
  const showVoiceCard = voiceActive && flattenedTree.length > 0;
  const displayTree = showVoiceCard
    ? flattenedTree.filter((item) => item.node.type !== 'voice')
    : flattenedTree;

  // Adjust depths when voice card is shown (since voice is removed from tree)
  const adjustedTree = showVoiceCard
    ? displayTree.map((item) => ({ ...item, depth: Math.max(0, item.depth - 1) }))
    : displayTree;

  // Voice is "focused" when the voice session is focused OR no session is focused
  const isVoiceFocused = focusedSessionId === null || focusedSessionId === voiceSessionId;

  // Total items including virtual voice card
  const totalItems = (showVoiceCard ? 1 : 0) + adjustedTree.length;

  const handleCardClick = (node: SessionTreeNode) => {
    console.log('[ThreadRail] Card clicked:', node.id, node.type, node.goal);
    focusSession(node.id);
  };

  const handleVoiceClick = () => {
    if (voiceSessionId) {
      console.log('[ThreadRail] Voice card clicked - focusing voice session:', voiceSessionId);
      focusSession(voiceSessionId);
    } else {
      console.log('[ThreadRail] Voice card clicked - no voice session in tree');
    }
  };

  return (
    <div className="thread-rail">
      <style>{`
        /* ═══════════════════════════════════════════════════════════════════
           THREAD RAIL - Mission Control Tree View
           ═══════════════════════════════════════════════════════════════════ */

        .thread-rail {
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 16px;
          overflow: hidden;
          position: relative;
        }

        /* ═══════════════════════════════════════════════════════════════════
           HEADER - Fixed visibility issues
           ═══════════════════════════════════════════════════════════════════ */

        .thread-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 20px;
          padding: 0 2px;
          flex-shrink: 0;
        }

        .thread-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .thread-label {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.15em;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .thread-count {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          color: var(--color-cyan);
          padding: 3px 8px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 4px;
          min-width: 24px;
          text-align: center;
        }

        .thread-clear-btn {
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(244, 63, 94, 0.06);
          border: 1px solid rgba(244, 63, 94, 0.15);
          border-radius: 6px;
          color: var(--color-rose);
          font-size: 11px;
          cursor: pointer;
          opacity: 0.7;
          transition: all 0.2s ease;
        }

        .thread-clear-btn:hover:not(:disabled) {
          opacity: 1;
          background: rgba(244, 63, 94, 0.12);
          border-color: rgba(244, 63, 94, 0.35);
          transform: scale(1.05);
        }

        .thread-clear-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        /* ═══════════════════════════════════════════════════════════════════
           TREE CONTAINER
           ═══════════════════════════════════════════════════════════════════ */

        .thread-tree-container {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
        }

        .thread-tree {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           TREE NODE WRAPPER - Handles indentation and connectors
           ═══════════════════════════════════════════════════════════════════ */

        .tree-node-wrapper {
          position: relative;
          display: flex;
          flex-direction: column;
        }

        .tree-root {
          margin-bottom: 4px;
        }

        /* Trunk line from voice root to children */
        .tree-trunk {
          position: absolute;
          left: 26px;
          top: 100%;
          width: 2px;
          height: 12px;
          background: linear-gradient(
            to bottom,
            rgba(52, 211, 153, 0.4) 0%,
            rgba(52, 211, 153, 0.15) 100%
          );
          border-radius: 1px;
        }

        /* Connection lines for nested items */
        .tree-connector {
          position: absolute;
          left: 6px;
          top: 0;
          bottom: 0;
          width: 20px;
          pointer-events: none;
        }

        .tree-line-vertical {
          position: absolute;
          left: 0;
          top: -8px;
          width: 2px;
          background: linear-gradient(
            to bottom,
            rgba(56, 189, 248, 0.25) 0%,
            rgba(56, 189, 248, 0.1) 100%
          );
          border-radius: 1px;
        }

        .tree-line-horizontal {
          position: absolute;
          left: 0;
          top: 24px;
          width: 14px;
          height: 2px;
          background: rgba(56, 189, 248, 0.2);
          border-radius: 1px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           THREAD CARD - Depth-aware sizing
           ═══════════════════════════════════════════════════════════════════ */

        .thread-card {
          position: relative;
          padding: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          margin-left: auto;
        }

        .thread-card-root {
          width: 100%;
        }

        .thread-card-inner {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: var(--card-padding, 14px);
          background: linear-gradient(
            145deg,
            rgba(12, 12, 18, 0.9) 0%,
            rgba(8, 8, 14, 0.95) 100%
          );
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          transition: all 0.2s ease;
        }

        .thread-card:hover .thread-card-inner {
          border-color: rgba(56, 189, 248, 0.2);
          background: linear-gradient(
            145deg,
            rgba(14, 14, 22, 0.95) 0%,
            rgba(10, 10, 16, 0.98) 100%
          );
        }

        .thread-card.is-active .thread-card-inner {
          border-color: rgba(56, 189, 248, 0.35);
          box-shadow:
            0 0 0 1px rgba(56, 189, 248, 0.1) inset,
            0 4px 20px rgba(0, 0, 0, 0.3),
            0 0 30px rgba(56, 189, 248, 0.08);
        }

        /* Root card special styling */
        .thread-card-root .thread-card-inner {
          border-color: rgba(52, 211, 153, 0.15);
          background: linear-gradient(
            145deg,
            rgba(10, 18, 14, 0.9) 0%,
            rgba(8, 12, 10, 0.95) 100%
          );
        }

        .thread-card-root:hover .thread-card-inner {
          border-color: rgba(52, 211, 153, 0.3);
        }

        .thread-card-root.is-active .thread-card-inner {
          border-color: rgba(52, 211, 153, 0.4);
          box-shadow:
            0 0 0 1px rgba(52, 211, 153, 0.1) inset,
            0 4px 20px rgba(0, 0, 0, 0.3),
            0 0 30px rgba(52, 211, 153, 0.1);
        }

        /* ═══════════════════════════════════════════════════════════════════
           ICON - Type-specific colors
           ═══════════════════════════════════════════════════════════════════ */

        .thread-icon {
          width: var(--icon-size, 32px);
          height: var(--icon-size, 32px);
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 92, 246, 0.1);
          border: 1px solid rgba(139, 92, 246, 0.2);
          border-radius: 8px;
          font-family: var(--font-mono);
          font-size: calc(var(--icon-size, 32px) * 0.45);
          color: var(--color-violet);
          flex-shrink: 0;
          transition: all 0.2s ease;
        }

        .voice-icon {
          background: rgba(52, 211, 153, 0.12) !important;
          border-color: rgba(52, 211, 153, 0.25) !important;
          color: var(--color-emerald) !important;
        }

        .thread-card[data-type="terminal"] .thread-icon {
          background: rgba(56, 189, 248, 0.1);
          border-color: rgba(56, 189, 248, 0.2);
          color: var(--color-cyan);
        }

        .thread-card[data-type="orchestrator"] .thread-icon {
          background: rgba(139, 92, 246, 0.1);
          border-color: rgba(139, 92, 246, 0.2);
          color: var(--color-violet);
        }

        .thread-card.is-active .thread-icon {
          box-shadow: 0 0 16px currentColor;
        }

        /* ═══════════════════════════════════════════════════════════════════
           INFO SECTION
           ═══════════════════════════════════════════════════════════════════ */

        .thread-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .thread-title {
          font-family: var(--font-ui);
          font-size: var(--title-size, 13px);
          font-weight: 500;
          color: var(--color-text-normal);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.2;
        }

        .thread-card.is-active .thread-title {
          color: var(--color-text-bright);
        }

        .thread-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .thread-type {
          font-family: var(--font-mono);
          font-size: var(--label-size, 9px);
          font-weight: 500;
          color: var(--color-text-dim);
          letter-spacing: 0.08em;
        }

        .thread-status {
          font-family: var(--font-mono);
          font-size: 8px;
          font-weight: 600;
          color: var(--color-emerald);
          letter-spacing: 0.1em;
          padding: 2px 6px;
          background: rgba(52, 211, 153, 0.1);
          border-radius: 3px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           INDICATOR (right side)
           ═══════════════════════════════════════════════════════════════════ */

        .thread-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          flex-shrink: 0;
        }

        .thread-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--color-emerald);
          box-shadow: 0 0 8px var(--color-emerald);
          animation: status-pulse 2s ease-in-out infinite;
        }

        @keyframes status-pulse {
          0%, 100% {
            opacity: 1;
            box-shadow: 0 0 8px var(--color-emerald);
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            box-shadow: 0 0 12px var(--color-emerald);
            transform: scale(1.1);
          }
        }

        .thread-chevron {
          font-size: 16px;
          font-weight: 300;
          color: var(--color-text-ghost);
          transition: all 0.2s ease;
          opacity: 0.6;
        }

        .thread-card:hover .thread-chevron {
          transform: translateX(-3px);
          color: var(--color-cyan);
          opacity: 1;
        }

        /* ═══════════════════════════════════════════════════════════════════
           EMPTY STATE
           ═══════════════════════════════════════════════════════════════════ */

        .thread-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          text-align: center;
          padding: 32px 20px;
        }

        .thread-empty-icon {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          color: var(--color-text-ghost);
          background: rgba(255, 255, 255, 0.02);
          border: 1px dashed rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .thread-empty-title {
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-dim);
          margin-bottom: 8px;
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

          .thread-header {
            margin-bottom: 16px;
          }

          .thread-label {
            font-size: 10px;
          }

          .thread-card-inner {
            padding: 10px !important;
          }

          .thread-info {
            display: none;
          }

          .thread-icon {
            width: 32px !important;
            height: 32px !important;
          }

          .thread-chevron {
            display: none;
          }
        }
      `}</style>

      {/* Header with proper layout */}
      <div className="thread-header">
        <div className="thread-header-left">
          <span className="thread-label">Thread</span>
          {totalItems > 0 && (
            <span className="thread-count">{totalItems}</span>
          )}
        </div>
        <button
          className="thread-clear-btn"
          onClick={handleClearSessions}
          disabled={isClearing}
          title="Clear all sessions"
        >
          {isClearing ? '…' : '×'}
        </button>
      </div>

      {totalItems === 0 ? (
        <div className="thread-empty">
          <div className="thread-empty-icon">◇</div>
          <div className="thread-empty-title">No Active Sessions</div>
          <div className="thread-empty-text">
            Start a voice conversation<br />
            to see the session tree
          </div>
        </div>
      ) : (
        <div className="thread-tree-container">
          <div className="thread-tree">
            <AnimatePresence mode="popLayout">
              {/* Voice Session card at root - most prominent */}
              {showVoiceCard && (
                <VoiceCard
                  key="voice-root"
                  profile={profile}
                  index={0}
                  isFocused={isVoiceFocused}
                  hasChildren={adjustedTree.length > 0}
                  onClick={handleVoiceClick}
                />
              )}

              {/* Flattened session tree with proper hierarchy */}
              {adjustedTree.map((item, index) => {
                // Check if this is the last item at its depth level
                const isLast = !adjustedTree.slice(index + 1).some(
                  (next) => next.depth <= item.depth
                );

                return (
                  <TreeCard
                    key={item.node.id}
                    node={item.node}
                    depth={item.depth + (showVoiceCard ? 1 : 0)}
                    index={showVoiceCard ? index + 1 : index}
                    isFocused={item.node.id === focusedSessionId}
                    isLast={isLast}
                    onClick={() => handleCardClick(item.node)}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
