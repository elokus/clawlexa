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
  pending: { label: 'Init', color: 'text-orange-500', pulse: true },
  running: { label: 'Running', color: 'text-blue-500', pulse: true },
  waiting_for_input: { label: 'Awaiting', color: 'text-purple-500', pulse: true },
  finished: { label: 'Done', color: 'text-green-500', pulse: false },
  error: { label: 'Error', color: 'text-red-500', pulse: false },
  cancelled: { label: 'Cancelled', color: 'text-muted-foreground', pulse: false },
};

const TERMINAL_STATUS_CONFIG: Record<TerminalStatus, { label: string; color: string }> = {
  connecting: { label: 'Connecting', color: 'text-orange-500' },
  connected: { label: 'Connected', color: 'text-green-500' },
  disconnected: { label: 'Offline', color: 'text-muted-foreground' },
  error: { label: 'Error', color: 'text-red-500' },
};

export function TerminalStage({ stage }: TerminalStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const sessionId = stage.data?.sessionId;
  const sessions = useSessions();
  const minimizeTree = useUnifiedSessionsStore((s) => s.minimizeTree);

  const session = sessionId ? sessions.get(sessionId) : undefined;
  const sessionStatus = session?.status || 'pending';
  const sessionStatusConfig = SESSION_STATUS_CONFIG[sessionStatus as SessionStatus];
  const terminalStatusConfig = TERMINAL_STATUS_CONFIG[terminalStatus];

  const handleStatusChange = useCallback((status: TerminalStatus, error?: string) => {
    setTerminalStatus(status);
    setErrorMessage(error || null);
  }, []);

  const handleExit = useCallback((code: number) => {
    setExitCode(code);
  }, []);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;
    const client = getTerminalClient(sessionId, {
      fontSize: 13,
      onStatusChange: handleStatusChange,
      onExit: handleExit,
    });
    clientRef.current = client;
    client.connect(sessionId, containerRef.current).catch((error) => {
      console.error('[TerminalStage] Failed to connect:', error);
    });
    return () => {
      releaseTerminalClient(sessionId);
      clientRef.current = null;
    };
  }, [sessionId, handleStatusChange, handleExit]);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      if (clientRef.current && containerRef.current) {
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
    return () => resizeObserver.disconnect();
  }, []);

  const handleMinimize = () => {
    if (sessionId) minimizeTree();
  };

  const handleReconnect = () => {
    if (sessionId && containerRef.current) {
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
      className="flex flex-col h-full overflow-hidden bg-background relative"
      layoutId={`stage-${stage.id}`}
      initial={{ opacity: 0, scale: 0.98, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -8 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-base text-blue-500">▣</span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              Session {sessionId?.slice(0, 8) || '--------'}
            </span>
            <span className="text-sm font-medium text-foreground max-w-[360px] truncate">
              {session?.goal || stage.title}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-[10px] font-mono font-medium ${terminalStatusConfig.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full bg-current ${terminalStatus === 'connecting' ? 'animate-pulse' : ''}`} />
            {terminalStatusConfig.label}
          </div>
          <div className={`flex items-center gap-1.5 text-[10px] font-mono font-medium ${sessionStatusConfig.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full bg-current ${sessionStatusConfig.pulse ? 'animate-pulse' : ''}`} />
            {sessionStatusConfig.label}
          </div>
          <button
            className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={handleMinimize}
          >
            Minimize
          </button>
        </div>
      </div>

      {/* Terminal Container */}
      <div className="flex-1 relative overflow-hidden bg-[#1a1a1e] dark:bg-[#0d0d0f]" ref={containerRef}>
        {terminalStatus === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm z-10 gap-4">
            <div className="text-4xl text-muted-foreground/40">◎</div>
            <div className="text-sm text-muted-foreground">Connecting to session...</div>
          </div>
        )}

        {terminalStatus === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm z-10 gap-4">
            <div className="text-4xl text-muted-foreground/40">⚠</div>
            <div className="text-sm text-muted-foreground">{errorMessage || 'Connection error'}</div>
            <button
              className="mt-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              onClick={handleReconnect}
            >
              Reconnect
            </button>
          </div>
        )}

        {terminalStatus === 'disconnected' && exitCode === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm z-10 gap-4">
            <div className="text-4xl text-muted-foreground/40">◇</div>
            <div className="text-sm text-muted-foreground">Disconnected from session</div>
            <button
              className="mt-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              onClick={handleReconnect}
            >
              Reconnect
            </button>
          </div>
        )}

        {exitCode !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm z-10 gap-4">
            <div className="text-4xl text-muted-foreground/40">{exitCode === 0 ? '✓' : '✗'}</div>
            <div className="text-sm text-muted-foreground">
              Session ended{exitCode !== 0 ? ` (exit code: ${exitCode})` : ''}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
