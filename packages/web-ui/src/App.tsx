// ═══════════════════════════════════════════════════════════════════════════
// VΞRTΞX Voice Interface - Morphic Stage Layout
// 3-column stage-based interface with shared element transitions
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useConnectionState, useVoiceState, useUnifiedSessionsStore } from './stores';
import { useAudioSession } from './hooks/useAudioSession';
import { navigate, navigateToSettings, useRouter, useUrlSessionSync } from './hooks/useRouter';
import { StageOrchestrator } from './components/layout/StageOrchestrator';
import { ControlBar } from './components/ControlBar';
import { AudioControllerContext } from './contexts/audio-context';

export function App() {
  const { sendFocusSession } = useWebSocket();
  const { connected } = useConnectionState();
  const { voiceState, voiceProfile } = useVoiceState();
  const audioSession = useAudioSession();

  // Track focused session and sync to backend + URL
  const focusedSessionId = useUnifiedSessionsStore((s) => s.focusedSessionId);
  const focusSession = useUnifiedSessionsStore((s) => s.focusSession);
  const clearFocusedSession = useUnifiedSessionsStore((s) => s.clearFocusedSession);
  const prevFocusedRef = useRef<string | null>(null);

  // Sync URL ↔ focusedSessionId (two-way binding)
  useUrlSessionSync(focusedSessionId, focusSession);

  // Sync URL → activeView for settings routes
  const { path: routePath } = useRouter();
  const setActiveView = useUnifiedSessionsStore((s) => s.setActiveView);
  useEffect(() => {
    if (routePath === '/settings') {
      setActiveView('settings');
    } else {
      // When navigating away from settings, restore sessions view
      const currentView = useUnifiedSessionsStore.getState().activeView;
      if (currentView === 'settings') {
        setActiveView('sessions');
      }
    }
  }, [routePath, setActiveView]);

  useEffect(() => {
    // Only sync if focus actually changed and we're connected
    if (connected && focusedSessionId !== prevFocusedRef.current) {
      prevFocusedRef.current = focusedSessionId;
      sendFocusSession(focusedSessionId);
    }
  }, [focusedSessionId, connected, sendFocusSession]);

  const handleReconnect = () => {
    clearFocusedSession();
    navigate('/', true);
    // Force full app reset after backend restarts to avoid stale in-memory UI state.
    window.location.replace('/');
  };

  const stateConfig = {
    idle: { color: 'rgba(110, 110, 136, 0.8)', glow: 'transparent' },
    listening: { color: '#38bdf8', glow: '#38bdf8' },
    thinking: { color: '#a78bfa', glow: '#a78bfa' },
    speaking: { color: '#34d399', glow: '#34d399' },
  };

  const currentState = stateConfig[voiceState] || stateConfig.idle;

  return (
    <AudioControllerContext.Provider value={audioSession.audioControllerRef}>
        <div className="vertex-app">
      <style>{`
        /* ═══════════════════════════════════════════════════════════════════
           MORPHIC STAGE LAYOUT
           ═══════════════════════════════════════════════════════════════════ */
        .vertex-app {
          display: flex;
          flex-direction: column;
          height: 100vh;
          height: 100dvh;
          width: 100vw;
          overflow: hidden;
          position: relative;
          z-index: 10;
          background: linear-gradient(165deg,
            var(--color-void) 0%,
            var(--color-abyss) 40%,
            var(--color-deep) 100%
          );
        }

        /* ═══════════════════════════════════════════════════════════════════
           COMPACT HEADER
           ═══════════════════════════════════════════════════════════════════ */
        .header-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          background: rgba(10, 10, 18, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
          z-index: 100;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .brand-icon {
          width: 24px;
          height: 24px;
          position: relative;
        }

        .brand-icon svg {
          width: 100%;
          height: 100%;
          color: ${currentState.color};
          filter: drop-shadow(0 0 6px ${currentState.glow});
          transition: all 0.4s var(--ease-out);
        }

        .brand-text {
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.2em;
          color: var(--color-text-bright);
        }

        .header-status {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .header-settings-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          padding: 0;
          background: none;
          border: 1px solid transparent;
          border-radius: 6px;
          color: var(--color-text-ghost);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .header-settings-btn:hover {
          color: var(--color-text-dim);
          border-color: rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
        }

        .header-settings-btn svg {
          width: 16px;
          height: 16px;
        }

        .connection-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          background: rgba(22, 22, 34, 0.8);
          border: 1px solid ${connected ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 113, 133, 0.3)'};
          border-radius: 12px;
          font-family: var(--font-mono);
          font-size: 9px;
        }

        .connection-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          box-shadow: 0 0 8px ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          ${!connected ? 'animation: pulse-glow 1.5s ease-in-out infinite;' : ''}
        }

        .connection-label {
          color: ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .profile-tag {
          padding: 3px 8px;
          background: linear-gradient(135deg, var(--color-amber-dim), transparent);
          border: 1px solid rgba(245, 158, 11, 0.25);
          border-radius: 4px;
          font-family: var(--font-display);
          font-size: 9px;
          color: var(--color-amber);
          letter-spacing: 0.1em;
        }

        /* ═══════════════════════════════════════════════════════════════════
           MAIN CONTENT - Stage Orchestrator
           ═══════════════════════════════════════════════════════════════════ */
        .main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
          min-height: 0;
        }

        .stage-wrapper {
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        /* ═══════════════════════════════════════════════════════════════════
           BOTTOM CONTROL BAR
           ═══════════════════════════════════════════════════════════════════ */
        .bottom-controls {
          flex-shrink: 0;
          background: rgba(10, 10, 18, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid var(--color-border);
          padding-bottom: env(safe-area-inset-bottom);
        }

        /* ═══════════════════════════════════════════════════════════════════
           DISCONNECT OVERLAY
           ═══════════════════════════════════════════════════════════════════ */
        .disconnect-overlay {
          position: fixed;
          inset: 0;
          background: rgba(5, 5, 10, 0.97);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
          z-index: 300;
          backdrop-filter: blur(10px);
          padding: 32px;
        }

        .disconnect-icon {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: linear-gradient(145deg, var(--color-surface), var(--color-abyss));
          border: 2px solid var(--color-rose);
          box-shadow: 0 0 30px rgba(251, 113, 133, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: disconnect-pulse 2s ease-in-out infinite;
        }

        @keyframes disconnect-pulse {
          0%, 100% { box-shadow: 0 0 30px rgba(251, 113, 133, 0.25); }
          50% { box-shadow: 0 0 50px rgba(251, 113, 133, 0.4); }
        }

        .disconnect-icon svg {
          width: 36px;
          height: 36px;
          color: var(--color-rose);
        }

        .disconnect-title {
          font-family: var(--font-display);
          font-size: 14px;
          letter-spacing: 0.2em;
          color: var(--color-text-bright);
        }

        .disconnect-message {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          text-align: center;
          line-height: 1.8;
        }

        .reconnect-btn {
          margin-top: 8px;
          padding: 12px 32px;
          background: transparent;
          border: 1px solid var(--color-cyan);
          border-radius: 24px;
          color: var(--color-cyan);
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.15em;
          cursor: pointer;
          transition: all 0.25s var(--ease-out);
        }

        .reconnect-btn:hover {
          background: rgba(56, 189, 248, 0.1);
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
        }

        .reconnect-btn:active {
          transform: scale(0.95);
          background: var(--color-cyan);
          color: var(--color-void);
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* Safe area for notched devices */
        @supports (padding-top: env(safe-area-inset-top)) {
          .header-bar {
            padding-top: max(10px, env(safe-area-inset-top));
          }
        }
      `}</style>

      {/* Header */}
      <header className="header-bar">
        <div className="brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </div>
          <span className="brand-text">VΞRTΞX</span>
        </div>

        <div className="header-status">
          <button
            type="button"
            className="header-settings-btn"
            title="Settings"
            onClick={() => navigateToSettings()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </button>
          <div className="connection-badge">
            <span className="connection-dot" />
            <span className="connection-label">{connected ? 'Live' : 'Off'}</span>
          </div>
          {voiceProfile && <span className="profile-tag">{voiceProfile}</span>}
        </div>
      </header>

      {/* Main Content - Stage Orchestrator */}
      <div className="main-content">
        <div className="stage-wrapper">
          <StageOrchestrator />
        </div>

        {/* Bottom Control Bar */}
        <div className="bottom-controls">
          <ControlBar
            activeProfile={audioSession.activeProfile}
            onProfileChange={audioSession.setActiveProfile}
            isRecording={audioSession.isRecording}
            onToggleRecording={audioSession.toggleSession}
            isInitializing={audioSession.isInitializing}
            error={audioSession.error}
            disabled={!connected}
            isMaster={audioSession.isMaster}
            onRequestMaster={audioSession.requestMaster}
            agentState={voiceState}
            serviceActive={audioSession.serviceActive}
            audioMode={audioSession.audioMode}
            onToggleService={audioSession.toggleService}
            onSetAudioMode={audioSession.setAudioMode}
          />
        </div>
      </div>

      {/* Disconnect Overlay */}
      {!connected && (
        <div className="disconnect-overlay">
          <div className="disconnect-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <div className="disconnect-title">CONNECTION LOST</div>
          <div className="disconnect-message">
            Establishing uplink to VERTEX core...<br/>
            Target: marlon.local
          </div>
          <button className="reconnect-btn" onClick={handleReconnect} type="button">
            RECONNECT
          </button>
        </div>
      )}
        </div>
    </AudioControllerContext.Provider>
  );
}

