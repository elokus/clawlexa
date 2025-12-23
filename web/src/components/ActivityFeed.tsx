// ═══════════════════════════════════════════════════════════════════════════
// Activity Feed - Unified UI for subagent activity blocks
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useEffect, useState } from 'react';
import type {
  ActivityBlock,
  ReasoningBlock,
  ToolBlock,
  ContentBlock,
  ErrorBlock,
} from '../types';

interface ActivityFeedProps {
  blocks: ActivityBlock[];
  isActive: boolean;
  onClear: () => void;
}

// Get the last sentence from text for preview
function getLastSentence(text: string): string {
  const sentences = text.split(/[.!?]\s+/);
  const last = sentences[sentences.length - 1] || '';
  return last.slice(0, 60) + (last.length > 60 ? '...' : '');
}

// Format duration in seconds
function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1);
}

// Check if reasoning content is meaningful (not empty/placeholder)
function hasUsefulReasoning(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  // Filter out known placeholder patterns from models that hide reasoning
  const placeholders = ['[REDACTED]', '[redacted]', 'Redacted', '[Web search in progress...]'];
  return !placeholders.some(p => trimmed === p || trimmed.startsWith(p));
}

// Reasoning Block Component
function ReasoningBlockView({ block }: { block: ReasoningBlock }) {
  const [isOpen, setIsOpen] = useState(false);

  // Don't render completed reasoning blocks with no useful content
  if (block.isComplete && !hasUsefulReasoning(block.content)) {
    return null;
  }

  if (!block.isComplete) {
    // Only show "in progress" if there's content being streamed
    if (!block.content.trim()) {
      return null;
    }
    // Active reasoning - show pulsing preview
    return (
      <div className="activity-item reasoning active">
        <style>{`
          .activity-item.reasoning {
            border-left-color: var(--color-violet);
          }
          .activity-item.reasoning.active {
            animation: pulse-border 1.5s ease-in-out infinite;
          }
          @keyframes pulse-border {
            0%, 100% { border-left-color: var(--color-violet); }
            50% { border-left-color: color-mix(in srgb, var(--color-violet) 40%, transparent); }
          }
          .reasoning-preview {
            font-family: var(--font-mono);
            font-size: 10px;
            color: var(--color-violet);
            font-style: italic;
          }
          .reasoning-label {
            font-family: var(--font-mono);
            font-size: 9px;
            text-transform: uppercase;
            color: var(--color-text-ghost);
            margin-bottom: 4px;
          }
        `}</style>
        <div className="reasoning-label">Thinking...</div>
        <div className="reasoning-preview">
          {getLastSentence(block.content) || 'Processing...'}
        </div>
      </div>
    );
  }

  // Completed reasoning - collapsible
  return (
    <details className="activity-item reasoning" open={isOpen} onToggle={(e) => setIsOpen(e.currentTarget.open)}>
      <style>{`
        details.activity-item.reasoning {
          cursor: pointer;
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
      `}</style>
      <summary>
        Reasoned for {formatDuration(block.durationMs || 0)}s
      </summary>
      <div className="reasoning-content">
        {block.content}
      </div>
    </details>
  );
}

// Tool Block Component
function ToolBlockView({ block }: { block: ToolBlock }) {
  const [isOpen, setIsOpen] = useState(false);

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
        }
        details.activity-item.tool[open] summary::before {
          transform: rotate(90deg);
        }
        .tool-status {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .tool-status.pending {
          background: rgba(56, 189, 248, 0.1);
          color: var(--color-cyan);
        }
        .tool-status.complete {
          background: rgba(52, 211, 153, 0.1);
          color: var(--color-emerald);
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
      `}</style>
      <summary>
        <span>&gt; Used {block.toolName}</span>
        <span className={`tool-status ${block.isComplete ? 'complete' : 'pending'}`}>
          {block.isComplete ? 'done' : 'running'}
        </span>
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

export function ActivityFeed({ blocks, isActive, onClear }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new blocks arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [blocks]);

  return (
    <div className="activity-feed">
      <style>{`
        .activity-feed {
          display: flex;
          flex-direction: column;
          height: 100%;
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
        }
      `}</style>

      <div className="activity-header">
        <div className="activity-status">
          <span className={`activity-dot ${isActive ? 'active' : ''}`} />
          <span className={`activity-label ${isActive ? 'active' : ''}`}>
            {isActive ? 'Processing' : 'Idle'}
          </span>
        </div>
        {blocks.length > 0 && (
          <button className="activity-clear" onClick={onClear} type="button">
            Clear
          </button>
        )}
      </div>

      <div className="activity-list" ref={scrollRef}>
        {blocks.length === 0 ? (
          <div className="empty-activity">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="empty-activity-text">
              Subagent idle<br />
              Waiting for activity
            </span>
          </div>
        ) : (
          blocks.map((block) => (
            <ActivityBlockView key={block.id} block={block} />
          ))
        )}
      </div>
    </div>
  );
}
