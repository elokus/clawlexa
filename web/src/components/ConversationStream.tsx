// ═══════════════════════════════════════════════════════════════════════════
// Conversation Stream - Full-height conversation interface
// Clean, minimal design optimized for the conversation-first layout
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import type { TranscriptMessage } from '../types';

interface ConversationStreamProps {
  messages: TranscriptMessage[];
  currentTool: { name: string; args?: Record<string, unknown> } | null;
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

// Single message bubble
function MessageBubble({ message, isLatest }: { message: TranscriptMessage; isLatest: boolean }) {
  const isUser = message.role === 'user';

  const timestamp = new Date(message.timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`msg-bubble ${isUser ? 'user' : 'agent'} ${message.pending ? 'pending' : ''} ${isLatest ? 'latest' : ''}`}
    >
      <style>{`
        .msg-bubble {
          display: flex;
          flex-direction: column;
          max-width: 80%;
          margin-bottom: 16px;
          animation: msg-appear 0.25s var(--ease-out) forwards;
          opacity: 0;
        }

        @keyframes msg-appear {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .msg-bubble.user {
          align-self: flex-end;
          align-items: flex-end;
        }

        .msg-bubble.agent {
          align-self: flex-start;
          align-items: flex-start;
        }

        .msg-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
          padding: 0 2px;
        }

        .msg-role {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .msg-bubble.user .msg-role {
          color: var(--color-cyan);
        }

        .msg-bubble.agent .msg-role {
          color: var(--color-emerald);
        }

        .msg-time {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .msg-content {
          padding: 14px 18px;
          border-radius: 18px;
          position: relative;
        }

        /* User messages */
        .msg-bubble.user .msg-content {
          background: linear-gradient(135deg,
            rgba(56, 189, 248, 0.12) 0%,
            rgba(56, 189, 248, 0.06) 100%
          );
          border: 1px solid rgba(56, 189, 248, 0.18);
          border-bottom-right-radius: 6px;
        }

        /* Agent messages */
        .msg-bubble.agent .msg-content {
          background: rgba(18, 18, 26, 0.7);
          border: 1px solid rgba(52, 211, 153, 0.12);
          border-bottom-left-radius: 6px;
        }

        .msg-text {
          font-family: var(--font-ui);
          font-size: 15px;
          font-weight: 450;
          line-height: 1.6;
          margin: 0;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .msg-bubble.user .msg-text {
          color: var(--color-text-bright);
        }

        .msg-bubble.agent .msg-text {
          color: var(--color-text-normal);
        }

        .msg-bubble.pending .msg-text {
          color: var(--color-text-dim);
        }

        .msg-bubble.latest.agent .msg-content {
          box-shadow: 0 0 24px rgba(52, 211, 153, 0.08);
        }

        .msg-bubble.latest.user .msg-content {
          box-shadow: 0 0 24px rgba(56, 189, 248, 0.12);
        }

        @media (max-width: 768px) {
          .msg-bubble {
            max-width: 88%;
            margin-bottom: 14px;
          }

          .msg-content {
            padding: 12px 16px;
            border-radius: 16px;
          }

          .msg-text {
            font-size: 15px;
          }
        }
      `}</style>

      <div className="msg-header">
        <span className="msg-role">{isUser ? 'You' : 'Agent'}</span>
        <span className="msg-time">{timestamp}</span>
      </div>
      <div className="msg-content">
        <p className="msg-text">
          {message.pending && !message.content ? (
            <TypingIndicator />
          ) : (
            message.content
          )}
        </p>
      </div>
    </div>
  );
}

// Tool execution card
function ToolCard({ tool }: { tool: { name: string; args?: Record<string, unknown> } }) {
  const toolConfig: Record<string, { label: string; icon: string; color: string }> = {
    view_todos: { label: 'Checking tasks', icon: '◈', color: 'var(--color-violet)' },
    add_todo: { label: 'Adding task', icon: '◈', color: 'var(--color-violet)' },
    delete_todo: { label: 'Removing task', icon: '◈', color: 'var(--color-violet)' },
    set_timer: { label: 'Setting timer', icon: '⧖', color: 'var(--color-amber)' },
    list_timers: { label: 'Checking timers', icon: '⧖', color: 'var(--color-amber)' },
    cancel_timer: { label: 'Canceling timer', icon: '⧖', color: 'var(--color-amber)' },
    web_search: { label: 'Searching web', icon: '⌘', color: 'var(--color-cyan)' },
    control_light: { label: 'Adjusting lights', icon: '◉', color: 'var(--color-emerald)' },
    deep_thinking: { label: 'Deep analysis', icon: '◇', color: 'var(--color-violet)' },
    developer_session: { label: 'Dev session', icon: '▣', color: 'var(--color-cyan)' },
  };

  const config = toolConfig[tool.name] || { label: 'Processing', icon: '◆', color: 'var(--color-text-dim)' };

  return (
    <div className="tool-card">
      <style>{`
        .tool-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          margin: 8px 0 16px 0;
          background: rgba(18, 18, 26, 0.5);
          border-radius: 12px;
          border-left: 3px solid ${config.color};
          animation: tool-appear 0.2s var(--ease-out) forwards;
        }

        @keyframes tool-appear {
          from {
            opacity: 0;
            transform: translateX(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .tool-icon {
          font-size: 16px;
          color: ${config.color};
          animation: tool-pulse 1s ease-in-out infinite;
        }

        @keyframes tool-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        .tool-info {
          flex: 1;
          min-width: 0;
        }

        .tool-label {
          font-family: var(--font-mono);
          font-size: 12px;
          color: ${config.color};
        }

        .tool-name {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          margin-top: 2px;
        }

        .tool-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid var(--color-border);
          border-top-color: ${config.color};
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <span className="tool-icon">{config.icon}</span>
      <div className="tool-info">
        <div className="tool-label">{config.label}</div>
        <div className="tool-name">{tool.name}</div>
      </div>
      <div className="tool-spinner" />
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

export function ConversationStream({ messages, currentTool }: ConversationStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, currentTool]);

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

        .messages-container {
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
          .messages-container {
            padding-bottom: 100px; /* Extra space for mobile nav */
          }
        }
      `}</style>

      {messages.length === 0 && !currentTool ? (
        <EmptyState />
      ) : (
        <div className="messages-container">
          {messages.map((msg, index) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLatest={index === messages.length - 1}
            />
          ))}
          {currentTool && <ToolCard tool={currentTool} />}
        </div>
      )}
    </div>
  );
}
