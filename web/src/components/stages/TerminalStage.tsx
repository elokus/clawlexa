// ═══════════════════════════════════════════════════════════════════════════
// Terminal Stage - Retro-futuristic HUD with CRT scanlines
// Obsidian Glass / Minority Report aesthetic
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useSessionsStore } from '../../stores/sessions';
import { useStageStore } from '../../stores/stage';
import type { StageItem, SessionStatus } from '../../types';

interface TerminalStageProps {
  stage: StageItem;
}

const STATUS_CONFIG: Record<SessionStatus, { label: string; color: string; pulse: boolean }> = {
  pending: { label: 'INIT', color: 'var(--color-amber)', pulse: true },
  running: { label: 'EXEC', color: 'var(--color-cyan)', pulse: true },
  waiting_for_input: { label: 'AWAIT', color: 'var(--color-violet)', pulse: true },
  finished: { label: 'DONE', color: 'var(--color-emerald)', pulse: false },
  error: { label: 'FAIL', color: 'var(--color-rose)', pulse: false },
  cancelled: { label: 'HALT', color: 'var(--color-text-dim)', pulse: false },
};

export function TerminalStage({ stage }: TerminalStageProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');

  const sessionId = stage.data?.sessionId;
  const sessions = useSessionsStore((s) => s.sessions);
  const sessionEvents = useSessionsStore((s) => s.sessionEvents);
  const backgroundStage = useStageStore((s) => s.backgroundStage);

  // Find the session data
  const session = sessions.find((s) => s.id === sessionId);
  const events = sessionId ? sessionEvents[sessionId] || [] : [];

  // Fetch events when mounted
  useEffect(() => {
    if (sessionId) {
      useSessionsStore.getState().fetchSessionEvents(sessionId);
    }
  }, [sessionId]);

  // Auto-scroll on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const status = session?.status || 'pending';
  const statusConfig = STATUS_CONFIG[status];

  // Format output events into terminal content
  const terminalContent = events
    .filter((e) => e.event_type === 'output')
    .map((e) => {
      const payload = e.payload as { output?: string } | null;
      return payload?.output || '';
    })
    .join('');

  const handleMinimize = () => {
    if (sessionId) {
      backgroundStage(stage.id);
    }
  };

  const handleSendInput = () => {
    if (!input.trim() || !sessionId) return;
    // TODO: Send input to session via WebSocket
    console.log(`[Terminal] Send input to ${sessionId}:`, input);
    setInput('');
  };

  return (
    <motion.div
      className="terminal-stage obsidian-glass crt-flicker"
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
        .terminal-stage {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-radius: 16px;
          overflow: hidden;
          position: relative;
        }

        /* ═══════════════════════════════════════════════════════════════════
           HUD HEADER - Ship console aesthetic
           ═══════════════════════════════════════════════════════════════════ */

        .terminal-hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          background: linear-gradient(
            180deg,
            rgba(8, 8, 12, 0.9) 0%,
            rgba(5, 5, 8, 0.85) 100%
          );
          border-bottom: 1px solid rgba(56, 189, 248, 0.15);
          position: relative;
        }

        /* Decorative corner accents */
        .terminal-hud-header::before,
        .terminal-hud-header::after {
          content: '';
          position: absolute;
          width: 20px;
          height: 20px;
          border: 1px solid rgba(56, 189, 248, 0.2);
        }

        .terminal-hud-header::before {
          top: 8px;
          left: 8px;
          border-right: none;
          border-bottom: none;
        }

        .terminal-hud-header::after {
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
          background: rgba(56, 189, 248, 0.08);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 8px;
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 16px;
          box-shadow: 0 0 16px rgba(56, 189, 248, 0.15);
        }

        .hud-meta {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .hud-id {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.1em;
          color: var(--color-text-ghost);
          text-transform: uppercase;
        }

        .hud-goal {
          font-family: var(--font-ui);
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-bright);
          max-width: 360px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .hud-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           STATUS BADGE - Glowing indicator
           ═══════════════════════════════════════════════════════════════════ */

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
          border-color: rgba(56, 189, 248, 0.3);
          color: var(--color-cyan);
          background: rgba(56, 189, 248, 0.05);
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.1);
        }

        /* ═══════════════════════════════════════════════════════════════════
           TERMINAL BODY - CRT display area
           ═══════════════════════════════════════════════════════════════════ */

        .terminal-body-wrapper {
          flex: 1;
          position: relative;
          overflow: hidden;
        }

        .terminal-body {
          height: 100%;
          overflow-y: auto;
          padding: 20px;
          font-family: var(--font-mono);
          font-size: 13px;
          line-height: 1.7;
          color: var(--color-cyan);
          white-space: pre-wrap;
          word-break: break-word;
          position: relative;
          z-index: 1;
        }

        /* Terminal text glow */
        .terminal-body {
          text-shadow:
            0 0 1px var(--color-cyan),
            0 0 3px rgba(56, 189, 248, 0.3);
        }

        .terminal-body::-webkit-scrollbar {
          width: 6px;
        }

        .terminal-body::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }

        .terminal-body::-webkit-scrollbar-thumb {
          background: rgba(56, 189, 248, 0.2);
          border-radius: 3px;
        }

        .terminal-body::-webkit-scrollbar-thumb:hover {
          background: rgba(56, 189, 248, 0.35);
        }

        .terminal-empty {
          color: var(--color-text-ghost);
          font-style: italic;
          text-shadow: none;
          opacity: 0.6;
        }

        /* Cursor blink */
        .terminal-cursor {
          display: inline-block;
          width: 8px;
          height: 16px;
          background: var(--color-cyan);
          margin-left: 4px;
          animation: cursor-blink 1s step-end infinite;
          box-shadow: 0 0 8px var(--color-cyan);
        }

        @keyframes cursor-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }

        /* ═══════════════════════════════════════════════════════════════════
           INPUT FOOTER
           ═══════════════════════════════════════════════════════════════════ */

        .terminal-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          background: linear-gradient(
            180deg,
            rgba(5, 5, 8, 0.85) 0%,
            rgba(8, 8, 12, 0.9) 100%
          );
          border-top: 1px solid rgba(56, 189, 248, 0.15);
        }

        .terminal-prompt {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--color-cyan);
          text-shadow: 0 0 4px var(--color-cyan);
        }

        .terminal-input {
          flex: 1;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid rgba(56, 189, 248, 0.15);
          background: rgba(0, 0, 0, 0.4);
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 13px;
          outline: none;
          transition: all 0.2s ease;
          text-shadow: 0 0 2px var(--color-cyan);
        }

        .terminal-input:focus {
          border-color: rgba(56, 189, 248, 0.4);
          box-shadow: 0 0 16px rgba(56, 189, 248, 0.1);
        }

        .terminal-input::placeholder {
          color: var(--color-text-ghost);
          text-shadow: none;
        }

        .terminal-send {
          padding: 10px 18px;
          border-radius: 8px;
          border: 1px solid rgba(56, 189, 248, 0.25);
          background: rgba(56, 189, 248, 0.1);
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
          text-shadow: 0 0 4px var(--color-cyan);
        }

        .terminal-send:hover:not(:disabled) {
          background: rgba(56, 189, 248, 0.18);
          box-shadow: 0 0 16px rgba(56, 189, 248, 0.2);
        }

        .terminal-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          text-shadow: none;
        }

        /* ═══════════════════════════════════════════════════════════════════
           RESPONSIVE
           ═══════════════════════════════════════════════════════════════════ */

        @media (max-width: 768px) {
          .terminal-hud-header {
            padding: 12px 14px;
          }

          .terminal-hud-header::before,
          .terminal-hud-header::after {
            display: none;
          }

          .hud-goal {
            max-width: 200px;
            font-size: 13px;
          }

          .terminal-body {
            padding: 16px;
            font-size: 12px;
          }
        }
      `}</style>

      {/* CRT Scanline Overlay */}
      <div className="crt-overlay" />

      {/* HUD Header */}
      <div className="terminal-hud-header">
        <div className="hud-left">
          <div className="hud-icon">▣</div>
          <div className="hud-meta">
            <span className="hud-id">Session {sessionId?.slice(0, 8) || '--------'}</span>
            <span className="hud-goal">{session?.goal || stage.title}</span>
          </div>
        </div>
        <div className="hud-right">
          <div className="hud-status">
            <span className={`status-indicator ${statusConfig.pulse ? 'pulse' : ''}`} />
            {statusConfig.label}
          </div>
          <button className="hud-btn" onClick={handleMinimize}>
            MINIMIZE
          </button>
        </div>
      </div>

      {/* Terminal Body with CRT effect */}
      <div className="terminal-body-wrapper">
        <div className="terminal-body" ref={scrollRef}>
          {terminalContent || (
            <span className="terminal-empty">Awaiting output stream...</span>
          )}
          {status === 'running' && <span className="terminal-cursor" />}
        </div>
      </div>

      {/* Input Footer - only when waiting for input */}
      {status === 'waiting_for_input' && (
        <div className="terminal-footer">
          <span className="terminal-prompt">&gt;</span>
          <input
            type="text"
            className="terminal-input"
            placeholder="Enter response..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendInput()}
            autoFocus
          />
          <button
            className="terminal-send"
            onClick={handleSendInput}
            disabled={!input.trim()}
          >
            SEND
          </button>
        </div>
      )}
    </motion.div>
  );
}
