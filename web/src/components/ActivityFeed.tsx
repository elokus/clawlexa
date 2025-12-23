// ═══════════════════════════════════════════════════════════════════════════
// Activity Feed - Unified UI for subagent activity blocks
// Supports multiple display modes: full (with header), compact (list only)
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useEffect, useState } from 'react';
import {
  getLastSentence,
  formatDuration,
  hasUsefulReasoning,
} from '../lib/activity-utils';
import type {
  ActivityBlock,
  ReasoningBlock,
  ToolBlock,
  ContentBlock,
  ErrorBlock,
  SessionTreeNode,
} from '../types';

export interface ActivityFeedProps {
  blocks: ActivityBlock[];
  isActive?: boolean;
  /** Show header with status and clear button */
  showHeader?: boolean;
  /** Callback when clear button is clicked */
  onClear?: () => void;
  /** Max blocks to show (for compact displays) */
  maxBlocks?: number;
  /** Custom empty state message */
  emptyMessage?: string;
  /** Additional CSS class */
  className?: string;
  /** Child sessions of the focused orchestrator (for linking tool calls) */
  childSessions?: SessionTreeNode[];
  /** Callback when user clicks on a linked session in a tool call */
  onNavigateToSession?: (sessionId: string) => void;
}

// Reasoning Block Component - Expandable for both active and completed states
function ReasoningBlockView({ block }: { block: ReasoningBlock }) {
  // Default to collapsed
  const [isOpen, setIsOpen] = useState(false);

  // Don't render completed reasoning blocks with no useful content
  if (block.isComplete && !hasUsefulReasoning(block.content)) {
    return null;
  }

  // Don't render if no content yet
  if (!block.content.trim()) {
    return null;
  }

  const isActive = !block.isComplete;

  return (
    <details
      className={`activity-item reasoning ${isActive ? 'active' : ''}`}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <style>{`
        .activity-item.reasoning {
          border-left-color: var(--color-violet);
          cursor: pointer;
        }
        .activity-item.reasoning.active {
          animation: pulse-border 1.5s ease-in-out infinite;
        }
        @keyframes pulse-border {
          0%, 100% { border-left-color: var(--color-violet); }
          50% { border-left-color: color-mix(in srgb, var(--color-violet) 40%, transparent); }
        }
        details.activity-item.reasoning summary {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-violet);
          list-style: none;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        details.activity-item.reasoning summary::-webkit-details-marker {
          display: none;
        }
        details.activity-item.reasoning summary::before {
          content: '▶';
          font-size: 8px;
          transition: transform 0.2s ease;
        }
        details.activity-item.reasoning[open] summary::before {
          transform: rotate(90deg);
        }
        .reasoning-summary-content {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .reasoning-active-dot {
          width: 6px;
          height: 6px;
          background: var(--color-violet);
          border-radius: 50%;
          box-shadow: 0 0 8px var(--color-violet);
          animation: pulse-glow 1s ease-in-out infinite;
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .reasoning-content {
          margin-top: 8px;
          padding: 8px;
          background: rgba(139, 92, 246, 0.05);
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          line-height: 1.5;
          white-space: pre-wrap;
          max-height: 200px;
          overflow-y: auto;
        }
        .reasoning-cursor {
          display: inline-block;
          width: 2px;
          height: 1em;
          background: var(--color-violet);
          margin-left: 2px;
          animation: cursor-blink 0.8s ease-in-out infinite;
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
      <summary>
        <span className="reasoning-summary-content">
          {isActive ? 'Thinking...' : `Reasoned for ${formatDuration(block.durationMs || 0)}s`}
          {isActive && <span className="reasoning-active-dot" />}
        </span>
      </summary>
      <div className="reasoning-content">
        {block.content}
        {isActive && <span className="reasoning-cursor" />}
      </div>
    </details>
  );
}

// Tool Block Component
interface ToolBlockViewProps {
  block: ToolBlock;
  childSessions?: SessionTreeNode[];
  onNavigateToSession?: (sessionId: string) => void;
}

// Tools that are known to create terminal sessions
const SESSION_CREATING_TOOLS = ['start_interactive_session', 'start_headless_session'];

function ToolBlockView({ block, childSessions, onNavigateToSession }: ToolBlockViewProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Find linked child session:
  // 1. First try exact match by tool_call_id
  // 2. Fallback: for session-creating tools, find terminal children
  let linkedSession = childSessions?.find(
    (child) => child.tool_call_id && child.tool_call_id === block.toolCallId
  );

  // Fallback for session-creating tools when tool_call_id isn't set
  if (!linkedSession && SESSION_CREATING_TOOLS.includes(block.toolName)) {
    if (childSessions?.length) {
      // Find terminal sessions among children
      const terminalChildren = childSessions.filter((child) => child.type === 'terminal');
      // Use the most recent one (last in array) as a best guess
      linkedSession = terminalChildren[terminalChildren.length - 1];
      console.log('[ToolBlockView] Fallback session linking:', {
        toolName: block.toolName,
        childSessions: childSessions.map((c) => ({ id: c.id, type: c.type, goal: c.goal })),
        terminalChildren: terminalChildren.length,
        linkedSession: linkedSession?.id,
      });
    } else {
      console.log('[ToolBlockView] Session-creating tool but no childSessions:', {
        toolName: block.toolName,
        childSessions,
      });
    }
  }

  const handleSessionClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (linkedSession && onNavigateToSession) {
      onNavigateToSession(linkedSession.id);
    }
  };

  const hasLinkedSession = linkedSession && onNavigateToSession;

  return (
    <details className="activity-item tool" open={isOpen} onToggle={(e) => setIsOpen(e.currentTarget.open)}>
      <style>{`
        .activity-item.tool {
          border-left-color: var(--color-cyan);
        }
        .activity-item.tool.pending {
          animation: pulse-border-cyan 1.5s ease-in-out infinite;
        }
        @keyframes pulse-border-cyan {
          0%, 100% { border-left-color: var(--color-cyan); }
          50% { border-left-color: color-mix(in srgb, var(--color-cyan) 40%, transparent); }
        }
        details.activity-item.tool summary {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-cyan);
          list-style: none;
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
        }
        details.activity-item.tool summary::-webkit-details-marker {
          display: none;
        }
        details.activity-item.tool summary::before {
          content: '▶';
          font-size: 8px;
          transition: transform 0.2s ease;
          flex-shrink: 0;
        }
        details.activity-item.tool[open] summary::before {
          transform: rotate(90deg);
        }
        .tool-summary-content {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .tool-status {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .tool-status.pending {
          background: rgba(56, 189, 248, 0.1);
          color: var(--color-cyan);
        }
        .tool-status.complete {
          background: rgba(52, 211, 153, 0.1);
          color: var(--color-emerald);
        }
        .tool-view-session-btn {
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid rgba(56, 189, 248, 0.3);
          background: rgba(56, 189, 248, 0.1);
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .tool-view-session-btn:hover {
          background: rgba(56, 189, 248, 0.2);
          border-color: rgba(56, 189, 248, 0.5);
          box-shadow: 0 0 8px rgba(56, 189, 248, 0.2);
        }
        .tool-view-session-btn .icon {
          font-size: 10px;
        }
        .tool-details {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .tool-section {
          padding: 8px;
          background: var(--color-surface);
          border-radius: 4px;
        }
        .tool-section-label {
          font-family: var(--font-mono);
          font-size: 9px;
          text-transform: uppercase;
          color: var(--color-text-ghost);
          margin-bottom: 4px;
        }
        .tool-section-content {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 150px;
          overflow-y: auto;
        }
        .tool-session-link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: rgba(56, 189, 248, 0.08);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .tool-session-link:hover {
          background: rgba(56, 189, 248, 0.15);
          border-color: rgba(56, 189, 248, 0.4);
          transform: translateX(4px);
        }
        .tool-session-icon {
          font-size: 14px;
          color: var(--color-cyan);
        }
        .tool-session-info {
          flex: 1;
          min-width: 0;
        }
        .tool-session-label {
          font-family: var(--font-mono);
          font-size: 9px;
          text-transform: uppercase;
          color: var(--color-text-ghost);
        }
        .tool-session-goal {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-cyan);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tool-session-arrow {
          font-size: 12px;
          color: var(--color-text-ghost);
        }
      `}</style>
      <summary>
        <span className="tool-summary-content">
          <span>&gt; {block.toolName}</span>
          <span className={`tool-status ${block.isComplete ? 'complete' : 'pending'}`}>
            {block.isComplete ? 'done' : 'running'}
          </span>
        </span>
        {hasLinkedSession && (
          <button
            type="button"
            className="tool-view-session-btn"
            onClick={handleSessionClick}
          >
            <span className="icon">▣</span>
            <span>View</span>
          </button>
        )}
      </summary>
      <div className="tool-details">
        <div className="tool-section">
          <div className="tool-section-label">Arguments</div>
          <div className="tool-section-content">
            {JSON.stringify(block.args, null, 2)}
          </div>
        </div>
        {block.result && (
          <div className="tool-section">
            <div className="tool-section-label">Result</div>
            <div className="tool-section-content">
              {block.result.length > 500 ? block.result.slice(0, 500) + '...' : block.result}
            </div>
          </div>
        )}
        {linkedSession && onNavigateToSession && (
          <button
            type="button"
            className="tool-session-link"
            onClick={handleSessionClick}
          >
            <span className="tool-session-icon">▣</span>
            <div className="tool-session-info">
              <div className="tool-session-label">View Session</div>
              <div className="tool-session-goal">
                {linkedSession.goal.length > 40
                  ? linkedSession.goal.substring(0, 40) + '...'
                  : linkedSession.goal}
              </div>
            </div>
            <span className="tool-session-arrow">→</span>
          </button>
        )}
      </div>
    </details>
  );
}

// Content Block Component
function ContentBlockView({ block }: { block: ContentBlock }) {
  return (
    <div className="activity-item content">
      <style>{`
        .activity-item.content {
          border-left-color: var(--color-emerald);
        }
        .content-text {
          font-size: 12px;
          color: var(--color-text-normal);
          line-height: 1.5;
        }
        .content-agent {
          font-family: var(--font-mono);
          font-size: 9px;
          text-transform: uppercase;
          color: var(--color-emerald);
          margin-bottom: 4px;
        }
      `}</style>
      <div className="content-agent">{block.agent}</div>
      <div className="content-text">{block.text}</div>
    </div>
  );
}

// Error Block Component
function ErrorBlockView({ block }: { block: ErrorBlock }) {
  return (
    <div className="activity-item error">
      <style>{`
        .activity-item.error {
          border-left-color: var(--color-rose);
          background: rgba(244, 63, 94, 0.05);
        }
        .error-label {
          font-family: var(--font-mono);
          font-size: 9px;
          text-transform: uppercase;
          color: var(--color-rose);
          margin-bottom: 4px;
        }
        .error-message {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-rose);
        }
      `}</style>
      <div className="error-label">Error</div>
      <div className="error-message">{block.message}</div>
    </div>
  );
}

// Block Router
interface ActivityBlockViewProps {
  block: ActivityBlock;
  childSessions?: SessionTreeNode[];
  onNavigateToSession?: (sessionId: string) => void;
}

function ActivityBlockView({ block, childSessions, onNavigateToSession }: ActivityBlockViewProps) {
  switch (block.type) {
    case 'reasoning':
      return <ReasoningBlockView block={block} />;
    case 'tool':
      return (
        <ToolBlockView
          block={block}
          childSessions={childSessions}
          onNavigateToSession={onNavigateToSession}
        />
      );
    case 'content':
      return <ContentBlockView block={block} />;
    case 'error':
      return <ErrorBlockView block={block} />;
    default:
      return null;
  }
}

export function ActivityFeed({
  blocks,
  isActive = false,
  showHeader = true,
  onClear,
  maxBlocks,
  emptyMessage = 'Subagent idle\nWaiting for activity',
  className = '',
  childSessions,
  onNavigateToSession,
}: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Apply maxBlocks limit if specified
  const displayBlocks = maxBlocks ? blocks.slice(-maxBlocks) : blocks;

  // Auto-scroll to bottom when new blocks arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [blocks]);

  return (
    <div className={`activity-feed ${className}`}>
      <style>{`
        .activity-feed {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .activity-feed.compact {
          height: auto;
        }

        .activity-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
        }

        .activity-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .activity-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--color-text-ghost);
        }

        .activity-dot.active {
          background: var(--color-amber);
          box-shadow: 0 0 10px var(--color-amber);
          animation: pulse-glow 1s ease-in-out infinite;
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .activity-label {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
        }

        .activity-label.active {
          color: var(--color-amber);
        }

        .activity-clear {
          padding: 5px 8px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          cursor: pointer;
        }

        .activity-list {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding: 8px;
        }

        .activity-feed.compact .activity-list {
          overflow-y: visible;
          padding: 0;
        }

        .activity-item {
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

        .empty-activity {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 10px;
          padding: 24px;
          text-align: center;
        }

        .empty-activity svg {
          width: 28px;
          height: 28px;
          color: var(--color-text-ghost);
          opacity: 0.5;
        }

        .empty-activity-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          white-space: pre-line;
        }
      `}</style>

      {showHeader && (
        <div className="activity-header">
          <div className="activity-status">
            <span className={`activity-dot ${isActive ? 'active' : ''}`} />
            <span className={`activity-label ${isActive ? 'active' : ''}`}>
              {isActive ? 'Processing' : 'Idle'}
            </span>
          </div>
          {blocks.length > 0 && onClear && (
            <button className="activity-clear" onClick={onClear} type="button">
              Clear
            </button>
          )}
        </div>
      )}

      <div className="activity-list" ref={scrollRef}>
        {displayBlocks.length === 0 ? (
          <div className="empty-activity">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="empty-activity-text">
              {emptyMessage}
            </span>
          </div>
        ) : (
          displayBlocks.map((block) => (
            <ActivityBlockView
              key={block.id}
              block={block}
              childSessions={childSessions}
              onNavigateToSession={onNavigateToSession}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Export block components for reuse
export { ActivityBlockView, ReasoningBlockView, ToolBlockView, ContentBlockView, ErrorBlockView };
