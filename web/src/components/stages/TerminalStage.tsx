// ═══════════════════════════════════════════════════════════════════════════
// Terminal Stage - Real PTY terminal with ghostty-web
// Obsidian Glass / Minority Report aesthetic
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useUnifiedSessionsStore, useSessions, type SessionState } from '../../stores';
import { getTerminalClient, releaseTerminalClient } from '../../lib/terminal-client';
import type { TerminalClient, TerminalStatus } from '../../lib/terminal-client';
import type { StageItem, SessionStatus } from '../../types';

interface TerminalStageProps {
  stage: StageItem;
}

const SESSION_STATUS_CONFIG: Record<SessionStatus, { label: string; color: string; pulse: boolean }> = {
  pending: { label: 'INIT', color: 'var(--color-amber)', pulse: true },
  running: { label: 'EXEC', color: 'var(--color-cyan)', pulse: true },
  waiting_for_input: { label: 'AWAIT', color: 'var(--color-violet)', pulse: true },
  finished: { label: 'DONE', color: 'var(--color-emerald)', pulse: false },
  error: { label: 'FAIL', color: 'var(--color-rose)', pulse: false },
  cancelled: { label: 'HALT', color: 'var(--color-text-dim)', pulse: false },
};

const TERMINAL_STATUS_CONFIG: Record<TerminalStatus, { label: string; color: string }> = {
  connecting: { label: 'LINK', color: 'var(--color-amber)' },
  connected: { label: 'LIVE', color: 'var(--color-emerald)' },
  disconnected: { label: 'OFFLINE', color: 'var(--color-text-dim)' },
  error: { label: 'ERROR', color: 'var(--color-rose)' },
};

export function TerminalStage({ stage }: TerminalStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const sessionId = stage.data?.sessionId;
  const sessions = useSessionsStore((s) => s.sessions);
  const backgroundStage = useStageStore((s) => s.backgroundStage);

  // Find the session data
  const session = sessions.find((s) => s.id === sessionId);
  const sessionStatus = session?.status || 'pending';
  const sessionStatusConfig = SESSION_STATUS_CONFIG[sessionStatus];
  const terminalStatusConfig = TERMINAL_STATUS_CONFIG[terminalStatus];

  // Handle status changes from terminal client
  const handleStatusChange = useCallback((status: TerminalStatus, error?: string) => {
    setTerminalStatus(status);
    if (error) {
      setErrorMessage(error);
    } else {
      setErrorMessage(null);
    }
  }, []);

  // Handle session exit
  const handleExit = useCallback((code: number) => {
    setExitCode(code);
  }, []);

  // Connect to terminal on mount (uses singleton per sessionId)
  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    // Get or reuse existing client for this session
    const client = getTerminalClient(sessionId, {
      fontSize: 13,
      onStatusChange: handleStatusChange,
      onExit: handleExit,
    });

    clientRef.current = client;

    // Connect to the session (no-op if already connected)
    client.connect(sessionId, containerRef.current).catch((error) => {
      console.error('[TerminalStage] Failed to connect:', error);
    });

    // Cleanup on unmount - release reference (singleton handles actual cleanup)
    return () => {
      releaseTerminalClient(sessionId);
      clientRef.current = null;
    };
  }, [sessionId, handleStatusChange, handleExit]);

  // Handle resize using ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (clientRef.current && containerRef.current) {
        // Calculate cols/rows based on container size
        // Approximate character dimensions for 13px font
        const charWidth = 8;
        const charHeight = 17;
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;

        const cols = Math.floor(containerWidth / charWidth);
        const rows = Math.floor(containerHeight / charHeight);

        if (cols > 0 && rows > 0) {
          clientRef.current.resize(cols, rows);
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleMinimize = () => {
    if (sessionId) {
      backgroundStage(stage.id);
    }
  };

  const handleReconnect = () => {
    if (sessionId && containerRef.current) {
      // Get client (may be existing or new after disconnect)
      const client = getTerminalClient(sessionId, {
        fontSize: 13,
        onStatusChange: handleStatusChange,
        onExit: handleExit,
      });
      clientRef.current = client;
      client.connect(sessionId, containerRef.current).catch((error) => {
        console.error('[TerminalStage] Reconnect failed:', error);
      });
    }
  };

  return (
    <motion.div
      className="terminal-stage obsidian-glass"
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
          z-index: 10;
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
           STATUS BADGES
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
        }

        .hud-status.session-status {
          background: ${sessionStatusConfig.color}12;
          color: ${sessionStatusConfig.color};
          border: 1px solid ${sessionStatusConfig.color}35;
          box-shadow: 0 0 12px ${sessionStatusConfig.color}20;
        }

        .hud-status.terminal-status {
          background: ${terminalStatusConfig.color}12;
          color: ${terminalStatusConfig.color};
          border: 1px solid ${terminalStatusConfig.color}35;
        }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          box-shadow: 0 0 8px currentColor;
        }

        .status-indicator.pulse {
          animation: status-glow 1.5s ease-in-out infinite;
        }

        @keyframes status-glow {
          0%, 100% {
            opacity: 1;
            box-shadow: 0 0 8px currentColor;
          }
          50% {
            opacity: 0.5;
            box-shadow: 0 0 16px currentColor;
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
           TERMINAL CONTAINER
           ═══════════════════════════════════════════════════════════════════ */

        .terminal-container {
          flex: 1;
          position: relative;
          overflow: hidden;
          background: #05050a;
        }

        .terminal-container :global(.ghostty-terminal) {
          width: 100%;
          height: 100%;
          padding: 16px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           OVERLAY STATES
           ═══════════════════════════════════════════════════════════════════ */

        .terminal-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(5, 5, 10, 0.9);
          backdrop-filter: blur(8px);
          z-index: 5;
          gap: 16px;
        }

        .overlay-icon {
          font-size: 48px;
          color: var(--color-text-ghost);
        }

        .overlay-message {
          font-family: var(--font-mono);
          font-size: 14px;
          color: var(--color-text-dim);
          text-align: center;
          max-width: 300px;
        }

        .overlay-btn {
          margin-top: 8px;
          padding: 10px 20px;
          border-radius: 8px;
          border: 1px solid var(--color-cyan-dim);
          background: rgba(56, 189, 248, 0.1);
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .overlay-btn:hover {
          background: rgba(56, 189, 248, 0.2);
          box-shadow: 0 0 16px rgba(56, 189, 248, 0.2);
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
        }
      `}</style>

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
          <div className="hud-status terminal-status">
            <span className={`status-indicator ${terminalStatus === 'connecting' ? 'pulse' : ''}`} />
            {terminalStatusConfig.label}
          </div>
          <div className="hud-status session-status">
            <span className={`status-indicator ${sessionStatusConfig.pulse ? 'pulse' : ''}`} />
            {sessionStatusConfig.label}
          </div>
          <button className="hud-btn" onClick={handleMinimize}>
            MINIMIZE
          </button>
        </div>
      </div>

      {/* Terminal Container */}
      <div className="terminal-container" ref={containerRef}>
        {/* Connecting overlay */}
        {terminalStatus === 'connecting' && (
          <div className="terminal-overlay">
            <div className="overlay-icon">◎</div>
            <div className="overlay-message">Connecting to session...</div>
          </div>
        )}

        {/* Error overlay */}
        {terminalStatus === 'error' && (
          <div className="terminal-overlay">
            <div className="overlay-icon">⚠</div>
            <div className="overlay-message">{errorMessage || 'Connection error'}</div>
            <button className="overlay-btn" onClick={handleReconnect}>
              RECONNECT
            </button>
          </div>
        )}

        {/* Disconnected overlay */}
        {terminalStatus === 'disconnected' && exitCode === null && (
          <div className="terminal-overlay">
            <div className="overlay-icon">◇</div>
            <div className="overlay-message">Disconnected from session</div>
            <button className="overlay-btn" onClick={handleReconnect}>
              RECONNECT
            </button>
          </div>
        )}

        {/* Session ended overlay */}
        {exitCode !== null && (
          <div className="terminal-overlay">
            <div className="overlay-icon">{exitCode === 0 ? '✓' : '✗'}</div>
            <div className="overlay-message">
              Session ended{exitCode !== 0 ? ` (exit code: ${exitCode})` : ''}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
