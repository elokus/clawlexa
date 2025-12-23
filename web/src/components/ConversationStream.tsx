// ═══════════════════════════════════════════════════════════════════════════
// Conversation Stream - Full-height conversation interface
// Clean, minimal design optimized for the conversation-first layout
// Renders unified timeline (transcripts + tools interleaved)
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { useStageStore } from '../stores/stage';
import type { TimelineItem, TranscriptItem, ToolItem } from '../types';

interface ConversationStreamProps {
  timeline: TimelineItem[];
}

// Typing indicator with pulsing dots
function TypingIndicator() {
  return (
    <span className="typing-indicator">
      <style>{`
        .typing-indicator {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 0;
        }
        .typing-dot {
          width: 6px;
          height: 6px;
          background: var(--color-cyan);
          border-radius: 50%;
          animation: typing-bounce 1.2s ease-in-out infinite;
        }
        .typing-dot:nth-child(2) {
          animation-delay: 0.15s;
        }
        .typing-dot:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes typing-bounce {
          0%, 60%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          30% {
            transform: translateY(-6px);
            opacity: 1;
          }
        }
      `}</style>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}

// HUD-style message - floating text without bubble containers
function HUDMessage({ item, isLatest }: { item: TranscriptItem; isLatest: boolean }) {
  const isUser = item.role === 'user';

  const timestamp = new Date(item.timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div
      className={`hud-message ${isUser ? 'user' : 'agent'} ${item.pending ? 'pending' : ''} ${isLatest ? 'latest' : ''}`}
    >
      <style>{`
        .hud-message {
          display: flex;
          flex-direction: column;
          max-width: 85%;
          margin-bottom: 32px;
          animation: hud-appear 0.3s var(--ease-out) forwards;
          opacity: 0;
          position: relative;
        }

        @keyframes hud-appear {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* User messages - right aligned */
        .hud-message.user {
          align-self: flex-end;
          align-items: flex-end;
          text-align: right;
        }

        /* Agent messages - left aligned with accent border */
        .hud-message.agent {
          align-self: flex-start;
          align-items: flex-start;
          padding-left: 16px;
          border-left: 2px solid rgba(56, 189, 248, 0.3);
        }

        .hud-message.agent.latest {
          border-left-color: rgba(56, 189, 248, 0.6);
        }

        /* Metadata header - monospaced, dim */
        .hud-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
          opacity: 0.5;
        }

        .hud-message.user .hud-meta {
          flex-direction: row-reverse;
        }

        .hud-role {
          font-family: var(--font-display);
          font-size: 9px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }

        .hud-message.user .hud-role {
          color: var(--color-cyan);
        }

        .hud-message.agent .hud-role {
          color: var(--color-emerald);
        }

        .hud-time {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          letter-spacing: 0.05em;
        }

        /* Message content - clean floating text */
        .hud-content {
          font-family: var(--font-ui);
          font-size: 17px;
          line-height: 1.65;
          margin: 0;
          word-wrap: break-word;
          overflow-wrap: break-word;
          text-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
        }

        .hud-message.user .hud-content {
          color: #ffffff;
          font-weight: 450;
        }

        .hud-message.agent .hud-content {
          color: #cccccc;
          font-weight: 400;
        }

        .hud-message.pending .hud-content {
          color: var(--color-text-dim);
        }

        /* Latest message subtle emphasis */
        .hud-message.latest .hud-content {
          text-shadow: 0 0 40px rgba(56, 189, 248, 0.15);
        }

        .hud-message.latest .hud-meta {
          opacity: 0.7;
        }

        @media (max-width: 768px) {
          .hud-message {
            max-width: 92%;
            margin-bottom: 28px;
          }

          .hud-message.agent {
            padding-left: 14px;
          }

          .hud-content {
            font-size: 16px;
          }
        }
      `}</style>

      <div className="hud-meta">
        <span className="hud-role">{isUser ? 'You' : 'Agent'}</span>
        <span className="hud-time">{timestamp}</span>
      </div>
      <p className="hud-content">
        {item.pending && !item.content ? (
          <TypingIndicator />
        ) : (
          item.content
        )}
      </p>
    </div>
  );
}

// Tool execution card - Expandable with details about arguments
function ToolCard({ item }: { item: ToolItem }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const focusSession = useStageStore((s) => s.focusSession);
  const focusedSessionId = useStageStore((s) => s.focusedSessionId);

  const toolConfig: Record<string, { label: string; icon: string; color: string; isPortal?: boolean }> = {
    view_todos: { label: 'Checking tasks', icon: '◈', color: 'var(--color-violet)' },
    add_todo: { label: 'Adding task', icon: '◈', color: 'var(--color-violet)' },
    delete_todo: { label: 'Removing task', icon: '◈', color: 'var(--color-violet)' },
    set_timer: { label: 'Setting timer', icon: '⧖', color: 'var(--color-amber)' },
    list_timers: { label: 'Checking timers', icon: '⧖', color: 'var(--color-amber)' },
    cancel_timer: { label: 'Canceling timer', icon: '⧖', color: 'var(--color-amber)' },
    web_search: { label: 'Searching web', icon: '⌘', color: 'var(--color-cyan)' },
    control_light: { label: 'Adjusting lights', icon: '◉', color: 'var(--color-emerald)' },
    deep_thinking: { label: 'Deep analysis', icon: '◇', color: 'var(--color-violet)' },
    developer_session: { label: 'Dev Session', icon: '▣', color: 'var(--color-cyan)', isPortal: true },
  };

  const config = toolConfig[item.name] || { label: 'Processing', icon: '◆', color: 'var(--color-text-dim)' };
  const isPortal = config.isPortal === true;
  const sessionId = item.args?.sessionId as string | undefined;
  const isRunning = item.status === 'running';
  const isCompleted = item.status === 'completed';

  // Check if this session is currently focused
  const isOnStage = sessionId && focusedSessionId === sessionId;

  const handleViewSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessionId && !isOnStage) {
      focusSession(sessionId);
    }
  };

  const handleToggleExpand = () => {
    setIsExpanded((prev) => !prev);
  };

  const hasArgs = item.args && Object.keys(item.args).length > 0;
  const hasResult = item.result !== undefined;

  return (
    <div className={`tool-card ${isPortal ? 'is-portal' : ''} ${isOnStage ? 'is-docked' : ''} ${isExpanded ? 'is-expanded' : ''}`}>
      <style>{`
        .tool-card {
          display: flex;
          flex-direction: column;
          padding: 14px 18px;
          margin: 10px 0 18px 0;
          background: linear-gradient(
            135deg,
            rgba(10, 10, 15, 0.7) 0%,
            rgba(8, 8, 12, 0.8) 100%
          );
          backdrop-filter: blur(12px);
          border-radius: 14px;
          border: 1px solid var(--color-glass-border);
          border-left: 3px solid ${config.color};
          animation: tool-appear 0.25s var(--ease-out) forwards;
          transition: all 0.25s var(--ease-out);
        }

        .tool-card.is-portal {
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-left: 3px solid var(--color-cyan);
          box-shadow:
            0 0 20px rgba(56, 189, 248, 0.08),
            0 4px 16px rgba(0, 0, 0, 0.2);
        }

        .tool-card.is-portal:hover:not(.is-docked) {
          border-color: rgba(56, 189, 248, 0.35);
          box-shadow:
            0 0 30px rgba(56, 189, 248, 0.12),
            0 4px 20px rgba(0, 0, 0, 0.25);
        }

        .tool-card.is-docked {
          opacity: 0.6;
          border-color: rgba(56, 189, 248, 0.1);
          box-shadow: none;
        }

        @keyframes tool-appear {
          from {
            opacity: 0;
            transform: translateX(-12px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }

        .tool-header {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
        }

        .tool-icon-wrapper {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${config.color}15;
          border: 1px solid ${config.color}25;
          border-radius: 8px;
          flex-shrink: 0;
        }

        .tool-icon {
          font-size: 16px;
          color: ${config.color};
          animation: tool-pulse 1.2s ease-in-out infinite;
        }

        .tool-card.is-portal .tool-icon {
          text-shadow: 0 0 8px ${config.color};
        }

        @keyframes tool-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.95); }
        }

        .tool-info {
          flex: 1;
          min-width: 0;
        }

        .tool-label {
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-normal);
        }

        .tool-card.is-portal .tool-label {
          color: var(--color-cyan);
        }

        .tool-name {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          margin-top: 3px;
          letter-spacing: 0.02em;
        }

        .tool-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .tool-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.08);
          border-top-color: ${config.color};
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .tool-expand-chevron {
          font-size: 10px;
          color: var(--color-text-ghost);
          transition: transform 0.2s ease;
        }

        .tool-card.is-expanded .tool-expand-chevron {
          transform: rotate(90deg);
        }

        .tool-view-btn {
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid rgba(56, 189, 248, 0.25);
          background: rgba(56, 189, 248, 0.08);
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tool-view-btn:hover {
          background: rgba(56, 189, 248, 0.15);
          border-color: rgba(56, 189, 248, 0.4);
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
        }

        .tool-docked-label {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        /* Portal connection indicator */
        .tool-card.is-portal::after {
          content: '';
          position: absolute;
          right: -8px;
          top: 50%;
          transform: translateY(-50%);
          width: 8px;
          height: 2px;
          background: linear-gradient(90deg, var(--color-cyan), transparent);
          opacity: 0.5;
        }

        .tool-expanded-content {
          overflow: hidden;
          max-height: 0;
          opacity: 0;
          transition: max-height 0.25s ease, opacity 0.2s ease, padding 0.25s ease;
          padding-top: 0;
          margin-top: 0;
          border-top: none;
        }

        .tool-card.is-expanded .tool-expanded-content {
          max-height: 400px;
          opacity: 1;
          padding-top: 12px;
          margin-top: 12px;
          border-top: 1px solid var(--color-border);
        }

        .tool-args-code {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          white-space: pre-wrap;
          word-break: break-word;
          background: rgba(0, 0, 0, 0.2);
          padding: 10px;
          border-radius: 6px;
          max-height: 150px;
          overflow-y: auto;
          margin-bottom: 8px;
        }

        .tool-result-section {
          margin-top: 8px;
        }

        .tool-result-label {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        .tool-result-code {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-emerald);
          white-space: pre-wrap;
          word-break: break-word;
          background: rgba(52, 211, 153, 0.05);
          padding: 10px;
          border-radius: 6px;
          border: 1px solid rgba(52, 211, 153, 0.1);
          max-height: 150px;
          overflow-y: auto;
        }

        .tool-checkmark {
          color: var(--color-emerald);
          font-size: 16px;
        }
      `}</style>

      {/* Header - clickable to expand */}
      <div className="tool-header" onClick={handleToggleExpand}>
        <div className="tool-icon-wrapper">
          <span className="tool-icon">{config.icon}</span>
        </div>
        <div className="tool-info">
          <div className="tool-label">{config.label}</div>
          <div className="tool-name">{item.name}</div>
        </div>
        <div className="tool-actions">
          {isPortal && sessionId && !isOnStage && (
            <button className="tool-view-btn" onClick={handleViewSession}>
              View
            </button>
          )}
          {isOnStage && (
            <span className="tool-docked-label">On Stage</span>
          )}
          {isRunning && !isOnStage && <div className="tool-spinner" />}
          {isCompleted && <span className="tool-checkmark">✓</span>}
          {(hasArgs || hasResult) && <span className="tool-expand-chevron">▶</span>}
        </div>
      </div>

      {/* Expanded content with args and result */}
      {(hasArgs || hasResult) && (
        <div className="tool-expanded-content">
          {hasArgs && (
            <>
              <div className="tool-result-label">Arguments</div>
              <pre className="tool-args-code">
                {JSON.stringify(item.args, null, 2)}
              </pre>
            </>
          )}
          {hasResult && (
            <div className="tool-result-section">
              <div className="tool-result-label">Result</div>
              <pre className="tool-result-code">{item.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Empty state - centered, minimal
function EmptyState() {
  return (
    <div className="empty-state">
      <style>{`
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 48px 32px;
          text-align: center;
        }

        .empty-glyph {
          width: 72px;
          height: 72px;
          margin-bottom: 24px;
          position: relative;
        }

        .empty-glyph::before {
          content: '';
          position: absolute;
          inset: -20px;
          background: radial-gradient(
            circle,
            rgba(56, 189, 248, 0.08) 0%,
            transparent 70%
          );
          border-radius: 50%;
        }

        .empty-glyph svg {
          width: 100%;
          height: 100%;
          color: var(--color-text-ghost);
          opacity: 0.5;
          animation: glyph-float 4s ease-in-out infinite;
        }

        @keyframes glyph-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        .empty-title {
          font-family: var(--font-display);
          font-size: 12px;
          letter-spacing: 0.2em;
          color: var(--color-text-dim);
          margin-bottom: 16px;
        }

        .empty-hint {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--color-text-ghost);
          line-height: 2;
        }

        .wake-word {
          color: var(--color-cyan);
          font-weight: 500;
        }

        @media (max-width: 768px) {
          .empty-state {
            padding: 32px 24px;
          }

          .empty-glyph {
            width: 60px;
            height: 60px;
          }

          .empty-hint {
            font-size: 14px;
          }
        }
      `}</style>

      <div className="empty-glyph">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </div>
      <div className="empty-title">AWAITING INPUT</div>
      <div className="empty-hint">
        Say <span className="wake-word">"Jarvis"</span> or <span className="wake-word">"Computer"</span><br />
        to start a conversation
      </div>
    </div>
  );
}

export function ConversationStream({ timeline }: ConversationStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new timeline items
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [timeline]);

  // Get the last transcript for "isLatest" styling
  const lastTranscriptIndex = timeline
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.type === 'transcript')
    .pop()?.idx ?? -1;

  return (
    <div className="conversation-stream" ref={scrollRef}>
      <style>{`
        .conversation-stream {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          scroll-behavior: smooth;
        }

        .timeline-container {
          display: flex;
          flex-direction: column;
          padding: 8px 0 24px 0;
          min-height: 100%;
        }

        /* Scroll fade at top */
        .conversation-stream::before {
          content: '';
          position: sticky;
          top: 0;
          left: 0;
          right: 0;
          height: 20px;
          background: linear-gradient(
            180deg,
            rgba(5, 5, 10, 0.8) 0%,
            transparent 100%
          );
          pointer-events: none;
          z-index: 10;
          flex-shrink: 0;
        }

        @media (max-width: 768px) {
          .timeline-container {
            padding-bottom: 100px; /* Extra space for mobile nav */
          }
        }
      `}</style>

      {timeline.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="timeline-container">
          {timeline.map((item, index) => {
            if (item.type === 'transcript') {
              return (
                <HUDMessage
                  key={item.id}
                  item={item}
                  isLatest={index === lastTranscriptIndex}
                />
              );
            } else {
              return <ToolCard key={item.id} item={item} />;
            }
          })}
        </div>
      )}
    </div>
  );
}
