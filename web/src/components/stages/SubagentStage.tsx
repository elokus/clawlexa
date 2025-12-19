// ═══════════════════════════════════════════════════════════════════════════
// Subagent Stage - Activity stream view for delegated agent tasks
// Shows reasoning, tool calls, and responses in a drill-down stage
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAgentStore } from '../../stores/agent';
import { useStageStore } from '../../stores/stage';
import type { StageItem, ActivityBlock, ReasoningBlock, ToolBlock, ContentBlock, ErrorBlock } from '../../types';

interface SubagentStageProps {
  stage: StageItem;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function getLastSentence(text: string): string {
  const sentences = text.split(/[.!?]\s+/);
  const last = sentences[sentences.length - 1] || '';
  return last.slice(0, 80) + (last.length > 80 ? '...' : '');
}

function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Activity Block Components
// ═══════════════════════════════════════════════════════════════════════════

// Check if reasoning content is meaningful (not empty/placeholder)
function hasUsefulReasoning(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  // Filter out known placeholder patterns from models that hide reasoning
  const placeholders = ['[REDACTED]', '[redacted]', 'Redacted', '[Web search in progress...]'];
  return !placeholders.some(p => trimmed === p || trimmed.startsWith(p));
}

function ReasoningBlockView({ block }: { block: ReasoningBlock }) {
  const [isOpen, setIsOpen] = useState(false);

  // Don't render completed reasoning blocks with no useful content
  if (block.isComplete && !hasUsefulReasoning(block.content)) {
    return null;
  }

  if (!block.isComplete) {
    // Only show "in progress" if there's content being streamed
    // Skip rendering if it's just starting with no content yet
    if (!block.content.trim()) {
      return null;
    }
    return (
      <div className="stage-activity-item reasoning active">
        <div className="activity-icon">◇</div>
        <div className="activity-content">
          <div className="activity-label">Reasoning...</div>
          <div className="activity-preview">
            {getLastSentence(block.content) || 'Processing...'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <details
      className="stage-activity-item reasoning"
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary>
        <div className="activity-icon">◇</div>
        <div className="activity-content">
          <span className="activity-label">
            Reasoned for {formatDuration(block.durationMs || 0)}s
          </span>
        </div>
        <span className="expand-arrow">▶</span>
      </summary>
      <div className="activity-expanded">
        <div className="reasoning-text">{block.content}</div>
      </div>
    </details>
  );
}

function ToolBlockView({ block }: { block: ToolBlock }) {
  const [isOpen, setIsOpen] = useState(!block.isComplete);

  return (
    <details
      className={`stage-activity-item tool ${!block.isComplete ? 'active' : ''}`}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary>
        <div className="activity-icon">▣</div>
        <div className="activity-content">
          <span className="tool-name">{block.toolName}</span>
          <span className={`tool-status ${block.isComplete ? 'done' : 'running'}`}>
            {block.isComplete ? '✓ Done' : 'Running...'}
          </span>
        </div>
        <span className="expand-arrow">▶</span>
      </summary>
      <div className="activity-expanded">
        <div className="tool-section">
          <div className="tool-section-label">Arguments</div>
          <pre className="tool-section-code">{JSON.stringify(block.args, null, 2)}</pre>
        </div>
        {block.result && (
          <div className="tool-section">
            <div className="tool-section-label">Result</div>
            <pre className="tool-section-code">
              {block.result.length > 800 ? block.result.slice(0, 800) + '...' : block.result}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  return (
    <div className="stage-activity-item content">
      <div className="activity-icon">◈</div>
      <div className="activity-content">
        <div className="activity-label">Response</div>
        <div className="content-text">{block.text}</div>
      </div>
    </div>
  );
}

function ErrorBlockView({ block }: { block: ErrorBlock }) {
  return (
    <div className="stage-activity-item error">
      <div className="activity-icon">⚠</div>
      <div className="activity-content">
        <div className="activity-label">Error</div>
        <div className="error-message">{block.message}</div>
      </div>
    </div>
  );
}

function ActivityBlockView({ block }: { block: ActivityBlock }) {
  switch (block.type) {
    case 'reasoning':
      return <ReasoningBlockView block={block} />;
    case 'tool':
      return <ToolBlockView block={block} />;
    case 'content':
      return <ContentBlockView block={block} />;
    case 'error':
      return <ErrorBlockView block={block} />;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function SubagentStage({ stage }: SubagentStageProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentName = stage.data?.agentName || stage.title;

  // Get activities filtered by this agent
  const allActivities = useAgentStore((s) => s.subagentActivities);
  const subagentActive = useAgentStore((s) => s.subagentActive);
  const popStage = useStageStore((s) => s.popStage);

  // Filter activities for this specific agent
  const activities = allActivities.filter((block) => block.agent === agentName);

  // Determine status based on activity
  const isActive = subagentActive && activities.some(
    (block) =>
      (block.type === 'reasoning' && !block.isComplete) ||
      (block.type === 'tool' && !block.isComplete)
  );

  const statusConfig = isActive
    ? { label: 'PROCESSING', color: 'var(--color-violet)', pulse: true }
    : { label: 'COMPLETE', color: 'var(--color-emerald)', pulse: false };

  // Auto-scroll to bottom when new activities arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities]);

  return (
    <motion.div
      className="subagent-stage obsidian-glass"
      layoutId={`stage-${stage.id}`}
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -8 }}
      transition={{
        duration: 0.35,
        ease: [0.4, 0, 0.2, 1],
      }}
    >
      <style>{`
        .subagent-stage {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-radius: 16px;
          overflow: hidden;
          position: relative;
        }

        /* ═══════════════════════════════════════════════════════════════════
           HUD HEADER
           ═══════════════════════════════════════════════════════════════════ */

        .subagent-hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          background: linear-gradient(
            180deg,
            rgba(8, 8, 12, 0.9) 0%,
            rgba(5, 5, 8, 0.85) 100%
          );
          border-bottom: 1px solid rgba(139, 92, 246, 0.15);
          position: relative;
        }

        .subagent-hud-header::before,
        .subagent-hud-header::after {
          content: '';
          position: absolute;
          width: 20px;
          height: 20px;
          border: 1px solid rgba(139, 92, 246, 0.2);
        }

        .subagent-hud-header::before {
          top: 8px;
          left: 8px;
          border-right: none;
          border-bottom: none;
        }

        .subagent-hud-header::after {
          top: 8px;
          right: 8px;
          border-left: none;
          border-bottom: none;
        }

        .hud-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .hud-icon {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 92, 246, 0.08);
          border: 1px solid rgba(139, 92, 246, 0.2);
          border-radius: 8px;
          color: var(--color-violet);
          font-family: var(--font-mono);
          font-size: 16px;
          box-shadow: 0 0 16px rgba(139, 92, 246, 0.15);
        }

        .hud-meta {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .hud-agent-name {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: var(--color-text-bright);
          text-transform: uppercase;
        }

        .hud-subtitle {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .hud-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .hud-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 6px;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          background: ${statusConfig.color}12;
          color: ${statusConfig.color};
          border: 1px solid ${statusConfig.color}35;
          box-shadow: 0 0 12px ${statusConfig.color}20;
        }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${statusConfig.color};
          box-shadow: 0 0 8px ${statusConfig.color};
        }

        .status-indicator.pulse {
          animation: status-glow 1.5s ease-in-out infinite;
        }

        @keyframes status-glow {
          0%, 100% {
            opacity: 1;
            box-shadow: 0 0 8px ${statusConfig.color};
          }
          50% {
            opacity: 0.5;
            box-shadow: 0 0 16px ${statusConfig.color};
          }
        }

        .hud-btn {
          padding: 8px 14px;
          border-radius: 6px;
          border: 1px solid var(--color-glass-border);
          background: rgba(255, 255, 255, 0.02);
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .hud-btn:hover {
          border-color: rgba(139, 92, 246, 0.3);
          color: var(--color-violet);
          background: rgba(139, 92, 246, 0.05);
        }

        /* ═══════════════════════════════════════════════════════════════════
           ACTIVITY STREAM
           ═══════════════════════════════════════════════════════════════════ */

        .activity-stream {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .activity-stream::-webkit-scrollbar {
          width: 6px;
        }

        .activity-stream::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }

        .activity-stream::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.2);
          border-radius: 3px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           ACTIVITY ITEMS
           ═══════════════════════════════════════════════════════════════════ */

        .stage-activity-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 14px;
          background: linear-gradient(
            135deg,
            rgba(10, 10, 15, 0.85) 0%,
            rgba(8, 8, 12, 0.9) 100%
          );
          border: 1px solid var(--color-glass-border);
          border-radius: 12px;
          animation: item-enter 0.3s ease;
        }

        @keyframes item-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .stage-activity-item.active {
          border-color: rgba(139, 92, 246, 0.3);
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.1);
        }

        .stage-activity-item.reasoning {
          border-left: 3px solid var(--color-violet);
        }

        .stage-activity-item.reasoning.active {
          animation: pulse-violet 1.5s ease-in-out infinite;
        }

        @keyframes pulse-violet {
          0%, 100% { border-left-color: var(--color-violet); }
          50% { border-left-color: rgba(139, 92, 246, 0.4); }
        }

        .stage-activity-item.tool {
          border-left: 3px solid var(--color-cyan);
        }

        .stage-activity-item.tool.active {
          animation: pulse-cyan 1.5s ease-in-out infinite;
        }

        @keyframes pulse-cyan {
          0%, 100% { border-left-color: var(--color-cyan); }
          50% { border-left-color: rgba(56, 189, 248, 0.4); }
        }

        .stage-activity-item.content {
          border-left: 3px solid var(--color-emerald);
        }

        .stage-activity-item.error {
          border-left: 3px solid var(--color-rose);
          background: rgba(244, 63, 94, 0.05);
        }

        .activity-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 92, 246, 0.08);
          border: 1px solid rgba(139, 92, 246, 0.15);
          border-radius: 8px;
          font-family: var(--font-mono);
          font-size: 14px;
          color: var(--color-violet);
          flex-shrink: 0;
        }

        .stage-activity-item.tool .activity-icon {
          background: rgba(56, 189, 248, 0.08);
          border-color: rgba(56, 189, 248, 0.15);
          color: var(--color-cyan);
        }

        .stage-activity-item.content .activity-icon {
          background: rgba(52, 211, 153, 0.08);
          border-color: rgba(52, 211, 153, 0.15);
          color: var(--color-emerald);
        }

        .stage-activity-item.error .activity-icon {
          background: rgba(244, 63, 94, 0.08);
          border-color: rgba(244, 63, 94, 0.15);
          color: var(--color-rose);
        }

        .activity-content {
          flex: 1;
          min-width: 0;
        }

        .activity-label {
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-text-ghost);
          margin-bottom: 4px;
        }

        .activity-preview {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-violet);
          font-style: italic;
          line-height: 1.5;
        }

        /* Tool specific */
        .tool-name {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-cyan);
        }

        .tool-status {
          margin-left: 10px;
          font-family: var(--font-mono);
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 4px;
        }

        .tool-status.running {
          background: rgba(56, 189, 248, 0.1);
          color: var(--color-cyan);
        }

        .tool-status.done {
          background: rgba(52, 211, 153, 0.1);
          color: var(--color-emerald);
        }

        /* Content specific */
        .content-text {
          font-size: 13px;
          color: var(--color-text-normal);
          line-height: 1.6;
        }

        .error-message {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-rose);
        }

        /* ═══════════════════════════════════════════════════════════════════
           EXPANDABLE DETAILS
           ═══════════════════════════════════════════════════════════════════ */

        details.stage-activity-item {
          cursor: pointer;
        }

        details.stage-activity-item summary {
          display: flex;
          align-items: center;
          gap: 12px;
          list-style: none;
        }

        details.stage-activity-item summary::-webkit-details-marker {
          display: none;
        }

        .expand-arrow {
          font-size: 10px;
          color: var(--color-text-ghost);
          transition: transform 0.2s ease;
          margin-left: auto;
        }

        details.stage-activity-item[open] .expand-arrow {
          transform: rotate(90deg);
        }

        .activity-expanded {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--color-glass-border);
        }

        .reasoning-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          line-height: 1.6;
          white-space: pre-wrap;
          max-height: 300px;
          overflow-y: auto;
          padding: 12px;
          background: rgba(139, 92, 246, 0.05);
          border-radius: 8px;
        }

        .tool-section {
          margin-bottom: 12px;
        }

        .tool-section:last-child {
          margin-bottom: 0;
        }

        .tool-section-label {
          font-family: var(--font-mono);
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-text-ghost);
          margin-bottom: 6px;
        }

        .tool-section-code {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          background: var(--color-surface);
          padding: 12px;
          border-radius: 8px;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 200px;
          overflow-y: auto;
          margin: 0;
        }

        /* ═══════════════════════════════════════════════════════════════════
           EMPTY STATE
           ═══════════════════════════════════════════════════════════════════ */

        .empty-activity {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 16px;
          padding: 32px;
          text-align: center;
        }

        .empty-icon {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 92, 246, 0.08);
          border: 1px solid rgba(139, 92, 246, 0.15);
          border-radius: 12px;
          font-size: 20px;
          color: var(--color-violet);
          opacity: 0.5;
        }

        .empty-text {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-dim);
          line-height: 1.6;
        }

        /* ═══════════════════════════════════════════════════════════════════
           RESPONSIVE
           ═══════════════════════════════════════════════════════════════════ */

        @media (max-width: 768px) {
          .subagent-hud-header {
            padding: 12px 14px;
          }

          .subagent-hud-header::before,
          .subagent-hud-header::after {
            display: none;
          }

          .hud-subtitle {
            display: none;
          }

          .activity-stream {
            padding: 12px;
          }

          .stage-activity-item {
            padding: 12px;
          }
        }
      `}</style>

      {/* HUD Header */}
      <div className="subagent-hud-header">
        <div className="hud-left">
          <div className="hud-icon">◇</div>
          <div className="hud-meta">
            <span className="hud-agent-name">{agentName}</span>
            <span className="hud-subtitle">Subagent Activity</span>
          </div>
        </div>
        <div className="hud-right">
          <div className="hud-status">
            <span className={`status-indicator ${statusConfig.pulse ? 'pulse' : ''}`} />
            {statusConfig.label}
          </div>
          <button className="hud-btn" onClick={popStage}>
            BACK
          </button>
        </div>
      </div>

      {/* Activity Stream */}
      <div className="activity-stream" ref={scrollRef}>
        {activities.length === 0 ? (
          <div className="empty-activity">
            <div className="empty-icon">◇</div>
            <div className="empty-text">
              Waiting for activity...<br />
              {agentName} is initializing
            </div>
          </div>
        ) : (
          activities.map((block) => (
            <ActivityBlockView key={block.id} block={block} />
          ))
        )}
      </div>
    </motion.div>
  );
}
