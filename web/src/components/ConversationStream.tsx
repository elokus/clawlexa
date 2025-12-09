// ═══════════════════════════════════════════════════════════════════════════
// Conversation Stream - Terminal/log-style conversation display
// Not messenger bubbles - compact, readable, game-dialogue inspired
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import type { TranscriptMessage } from '../types';

interface ConversationStreamProps {
  messages: TranscriptMessage[];
  currentTool: { name: string; args?: Record<string, unknown> } | null;
}

// Typing indicator - terminal cursor style
function TypingCursor() {
  return (
    <span className="typing-cursor">
      <style>{`
        .typing-cursor {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .typing-cursor::after {
          content: '_';
          color: var(--color-cyan);
          animation: cursor-blink 1s step-end infinite;
          font-weight: bold;
        }
        @keyframes cursor-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </span>
  );
}

// Single message entry - log style
function MessageEntry({ message, index }: { message: TranscriptMessage; index: number }) {
  const isUser = message.role === 'user';

  const timestamp = new Date(message.timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const accentColor = isUser ? '#38bdf8' : '#34d399';
  const accentColorDim = isUser ? '#0c4a6e' : '#064e3b';

  return (
    <div
      className={`msg-entry ${isUser ? 'user' : 'agent'} ${message.pending ? 'pending' : ''}`}
      style={{ animationDelay: `${index * 0.03}s` }}
    >
      <style>{`
        .msg-entry {
          display: flex;
          gap: 0;
          padding: 14px 0;
          border-bottom: 1px solid var(--color-border);
          animation: slide-up 0.3s ease forwards;
          opacity: 0;
        }

        .msg-entry:last-child {
          border-bottom: none;
        }

        /* Timestamp column */
        .msg-time {
          flex-shrink: 0;
          width: 65px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
          padding-top: 3px;
        }

        /* Accent bar */
        .msg-accent {
          flex-shrink: 0;
          width: 3px;
          min-height: 20px;
          margin-right: 12px;
          align-self: stretch;
        }

        /* Role indicator */
        .msg-role {
          flex-shrink: 0;
          width: 55px;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.08em;
          padding-top: 4px;
        }

        .msg-entry.user .msg-role {
          color: #38bdf8;
        }

        .msg-entry.agent .msg-role {
          color: #34d399;
        }

        /* Message content */
        .msg-content {
          flex: 1;
          min-width: 0;
          padding-left: 8px;
        }

        .msg-text {
          font-family: var(--font-ui);
          font-size: 14px;
          font-weight: 500;
          line-height: 1.65;
          color: #b8b8cc;
          word-wrap: break-word;
          margin: 0;
        }

        .msg-entry.user .msg-text {
          color: #e4e4f0;
        }

        .msg-entry.pending .msg-text {
          color: #6e6e88;
        }

        @keyframes slide-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <span className="msg-time">{timestamp}</span>
      <div
        className="msg-accent"
        style={{
          background: `linear-gradient(180deg, ${accentColor} 0%, ${accentColorDim} 100%)`,
          boxShadow: `0 0 8px ${accentColor}40`,
        }}
      />
      <span className="msg-role">{isUser ? 'USER' : 'AGENT'}</span>
      <div className="msg-content">
        <p className="msg-text">
          {message.pending && !message.content ? (
            <TypingCursor />
          ) : (
            message.content
          )}
        </p>
      </div>
    </div>
  );
}

// Tool execution indicator
function ToolExecution({ tool }: { tool: { name: string; args?: Record<string, unknown> } }) {
  const toolLabels: Record<string, { label: string; icon: string }> = {
    view_todos: { label: 'Scanning task registry', icon: '◈' },
    add_todo: { label: 'Writing to task registry', icon: '◈' },
    delete_todo: { label: 'Purging task entry', icon: '◈' },
    set_timer: { label: 'Initializing countdown', icon: '⧖' },
    list_timers: { label: 'Querying active timers', icon: '⧖' },
    cancel_timer: { label: 'Terminating countdown', icon: '⧖' },
    web_search: { label: 'Searching network', icon: '⌘' },
    control_light: { label: 'Adjusting illumination', icon: '◉' },
    deep_thinking: { label: 'Deep analysis mode', icon: '◇' },
    developer_session: { label: 'Spawning dev session', icon: '▣' },
  };

  const config = toolLabels[tool.name] || { label: 'Executing', icon: '◆' };

  return (
    <div className="tool-execution">
      <style>{`
        .tool-execution {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          background: var(--color-surface);
          border-left: 2px solid var(--color-violet);
          margin: 12px 0;
          animation: slide-up 0.2s ease forwards;
        }

        .tool-icon {
          font-size: 14px;
          color: var(--color-violet);
          animation: tool-pulse 1s ease-in-out infinite;
        }

        @keyframes tool-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }

        .tool-info {
          flex: 1;
        }

        .tool-label {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-violet);
          margin-bottom: 2px;
        }

        .tool-name {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }

        .tool-spinner {
          width: 14px;
          height: 14px;
          border: 1.5px solid var(--color-border);
          border-top-color: var(--color-violet);
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

// Empty state
function EmptyStream() {
  return (
    <div className="empty-stream">
      <style>{`
        .empty-stream {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 16px;
          padding: 40px;
          text-align: center;
        }

        .empty-icon {
          width: 48px;
          height: 48px;
          color: var(--color-text-ghost);
          opacity: 0.5;
        }

        .empty-title {
          font-family: var(--font-display);
          font-size: 12px;
          letter-spacing: 0.15em;
          color: var(--color-text-dim);
        }

        .empty-hint {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
          line-height: 1.8;
        }

        .wake-word {
          color: var(--color-cyan);
          font-weight: 600;
        }
      `}</style>

      <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
      <span className="empty-title">AWAITING TRANSMISSION</span>
      <span className="empty-hint">
        Speak <span className="wake-word">"Jarvis"</span> or <span className="wake-word">"Computer"</span><br/>
        to establish voice link
      </span>
    </div>
  );
}

export function ConversationStream({ messages, currentTool }: ConversationStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        }
      `}</style>

      {messages.length === 0 && !currentTool ? (
        <EmptyStream />
      ) : (
        <>
          {messages.map((msg, index) => (
            <MessageEntry key={msg.id} message={msg} index={index} />
          ))}
          {currentTool && <ToolExecution tool={currentTool} />}
        </>
      )}
    </div>
  );
}
