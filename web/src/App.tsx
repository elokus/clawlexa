// ═══════════════════════════════════════════════════════════════════════════
// VΞRTΞX Voice Interface - Conversation-First Layout
// Full-height conversation panel + compact bottom controls
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentStore } from './stores/agent';
import { useAudioSession } from './hooks/useAudioSession';
import { ConversationStream } from './components/ConversationStream';
import { CommandPanel } from './components/CommandPanel';
import { ControlBar } from './components/ControlBar';

type MobileView = 'conversation' | 'command';

export function App() {
  const { reconnect } = useWebSocket();
  const { connected, state, profile, messages, events, currentTool, loadMockConversation, clearMessages, clearEvents } = useAgentStore();
  const audioSession = useAudioSession();
  const [activeTab, setActiveTab] = useState<'sessions' | 'agent' | 'tools' | 'events'>('events');
  const [mobileView, setMobileView] = useState<MobileView>('conversation');
  const [showCommandSheet, setShowCommandSheet] = useState(false);

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  useEffect(() => {
    if (isDemoMode) {
      loadMockConversation();
    }
  }, [isDemoMode, loadMockConversation]);

  // Handle swipe gestures for mobile navigation
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const minSwipeDistance = 50;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && mobileView === 'conversation') {
      setShowCommandSheet(true);
    }
    if (isRightSwipe && showCommandSheet) {
      setShowCommandSheet(false);
    }
  }, [touchStart, touchEnd, mobileView, showCommandSheet]);

  const stateConfig = {
    idle: { color: 'rgba(110, 110, 136, 0.8)', glow: 'transparent' },
    listening: { color: '#38bdf8', glow: '#38bdf8' },
    thinking: { color: '#a78bfa', glow: '#a78bfa' },
    speaking: { color: '#34d399', glow: '#34d399' },
  };

  const currentState = stateConfig[state] || stateConfig.idle;

  return (
    <div
      className="vertex-app"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <style>{`
        /* ═══════════════════════════════════════════════════════════════════
           CONVERSATION-FIRST LAYOUT
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
           MAIN CONTENT - Desktop: side-by-side, Mobile: stack
           ═══════════════════════════════════════════════════════════════════ */
        .main-content {
          flex: 1;
          display: flex;
          overflow: hidden;
          position: relative;
          min-height: 0;
        }

        /* ═══════════════════════════════════════════════════════════════════
           LEFT PANEL - Full-height conversation
           ═══════════════════════════════════════════════════════════════════ */
        .conversation-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          background: rgba(5, 5, 10, 0.4);
        }

        @media (max-width: 768px) {
          .conversation-panel {
            display: ${mobileView === 'conversation' ? 'flex' : 'none'};
          }
        }

        /* Conversation area - takes all available space */
        .conversation-area {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          position: relative;
        }

        .conversation-scroll {
          height: 100%;
          overflow-y: auto;
          padding: 16px 20px;
          -webkit-overflow-scrolling: touch;
        }

        @media (min-width: 769px) {
          .conversation-scroll {
            padding: 20px 24px;
          }
        }

        /* Clear button floating */
        .clear-float-btn {
          position: absolute;
          top: 12px;
          right: 16px;
          z-index: 20;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          background: rgba(15, 15, 26, 0.9);
          backdrop-filter: blur(10px);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
          opacity: 0.7;
        }

        .clear-float-btn:hover {
          opacity: 1;
          border-color: var(--color-rose);
          color: var(--color-rose);
        }

        .clear-float-btn svg {
          width: 12px;
          height: 12px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           COMMAND PANEL - Right sidebar
           ═══════════════════════════════════════════════════════════════════ */
        .command-panel {
          width: 340px;
          flex-shrink: 0;
          background: var(--color-deep);
          border-left: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
        }

        @media (max-width: 768px) {
          .command-panel {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            width: 100%;
            height: 70vh;
            transform: translateY(${showCommandSheet ? '0' : '100%'});
            transition: transform 0.35s var(--ease-out);
            border-top-left-radius: 20px;
            border-top-right-radius: 20px;
            border-left: none;
            border-top: 1px solid var(--color-border);
            box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
            z-index: 200;
          }
        }

        .sheet-handle {
          display: none;
          width: 36px;
          height: 4px;
          background: var(--color-text-ghost);
          border-radius: 2px;
          margin: 10px auto;
          cursor: pointer;
        }

        @media (max-width: 768px) {
          .sheet-handle {
            display: block;
          }
        }

        /* ═══════════════════════════════════════════════════════════════════
           MOBILE BOTTOM NAV
           ═══════════════════════════════════════════════════════════════════ */
        .mobile-nav {
          display: none;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(10, 10, 18, 0.98);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid var(--color-border);
          padding-bottom: env(safe-area-inset-bottom);
          z-index: 150;
        }

        @media (max-width: 768px) {
          .mobile-nav {
            display: block;
          }
        }

        .mobile-nav-inner {
          display: flex;
          justify-content: space-around;
          align-items: center;
          padding: 6px 12px;
        }

        .nav-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          padding: 8px 16px;
          background: transparent;
          border: none;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .nav-btn svg {
          width: 20px;
          height: 20px;
        }

        .nav-btn.active {
          color: var(--color-cyan);
        }

        .nav-btn.active svg {
          filter: drop-shadow(0 0 6px var(--color-cyan));
        }

        .nav-badge {
          position: absolute;
          top: 2px;
          right: 8px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--color-cyan);
          border-radius: 8px;
          font-size: 9px;
          font-weight: 600;
          color: var(--color-void);
          display: flex;
          align-items: center;
          justify-content: center;
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
          <div className="connection-badge">
            <span className="connection-dot" />
            <span className="connection-label">{connected ? 'Live' : 'Off'}</span>
          </div>
          {profile && <span className="profile-tag">{profile}</span>}
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Left: Conversation Panel */}
        <div className="conversation-panel">
          {/* Conversation area */}
          <div className="conversation-area">
            {messages.length > 0 && (
              <button
                className="clear-float-btn"
                onClick={clearMessages}
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
                CLEAR
              </button>
            )}
            <div className="conversation-scroll">
              <ConversationStream messages={messages} currentTool={currentTool} />
            </div>
          </div>

          {/* Bottom Control Bar - Desktop only (mobile uses nav) */}
          <div className="desktop-only">
            <ControlBar
              activeProfile={audioSession.activeProfile}
              onProfileChange={audioSession.setActiveProfile}
              isRecording={audioSession.isRecording}
              onToggleRecording={audioSession.toggleSession}
              isInitializing={audioSession.isInitializing}
              error={audioSession.error}
              disabled={!connected || isDemoMode}
              isMaster={audioSession.isMaster}
              onRequestMaster={audioSession.requestMaster}
              agentState={state}
            />
          </div>
        </div>

        {/* Right: Command Panel */}
        <aside className="command-panel">
          <div className="sheet-handle" onClick={() => setShowCommandSheet(false)} />
          <CommandPanel
            events={events}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onClearEvents={clearEvents}
          />
        </aside>
      </div>

      {/* Mobile Bottom Navigation with integrated controls */}
      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          {/* Control Bar for mobile */}
          <ControlBar
            activeProfile={audioSession.activeProfile}
            onProfileChange={audioSession.setActiveProfile}
            isRecording={audioSession.isRecording}
            onToggleRecording={audioSession.toggleSession}
            isInitializing={audioSession.isInitializing}
            error={audioSession.error}
            disabled={!connected || isDemoMode}
            isMaster={audioSession.isMaster}
            onRequestMaster={audioSession.requestMaster}
            agentState={state}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: '8px' }}>
          <button
            className={`nav-btn ${showCommandSheet ? 'active' : ''}`}
            onClick={() => setShowCommandSheet(!showCommandSheet)}
            type="button"
            style={{ position: 'relative' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M9 9h6M9 15h6"/>
            </svg>
            EVENTS
            {events.length > 0 && (
              <span className="nav-badge">{events.length > 99 ? '99+' : events.length}</span>
            )}
          </button>
        </div>
      </nav>

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
          <button className="reconnect-btn" onClick={reconnect} type="button">
            RECONNECT
          </button>
        </div>
      )}
    </div>
  );
}
