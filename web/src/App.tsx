// ═══════════════════════════════════════════════════════════════════════════
// VΞRTΞX Voice Interface - Mobile-First Obsidian Glass Aesthetic
// Floating orb + gesture-driven navigation + immersive full-screen experience
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentStore } from './stores/agent';
import { VoiceVisualizer } from './components/VoiceVisualizer';
import { ConversationStream } from './components/ConversationStream';
import { CommandPanel } from './components/CommandPanel';

type MobileView = 'voice' | 'conversation' | 'command';

export function App() {
  const { reconnect } = useWebSocket();
  const { connected, state, profile, messages, events, currentTool, loadMockConversation, clearMessages, clearEvents } = useAgentStore();
  const [activeTab, setActiveTab] = useState<'sessions' | 'agent' | 'tools' | 'events'>('events');
  const [mobileView, setMobileView] = useState<MobileView>('voice');
  const [showCommandSheet, setShowCommandSheet] = useState(false);

  const isDemoMode = !import.meta.env.VITE_WS_URL;

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

    if (isLeftSwipe) {
      if (mobileView === 'voice') setMobileView('conversation');
      else if (mobileView === 'conversation') setShowCommandSheet(true);
    }
    if (isRightSwipe) {
      if (showCommandSheet) setShowCommandSheet(false);
      else if (mobileView === 'conversation') setMobileView('voice');
    }
  }, [touchStart, touchEnd, mobileView, showCommandSheet]);

  const stateConfig = {
    idle: { label: 'STANDBY', color: 'rgba(110, 110, 136, 0.8)', glow: 'transparent', ring: 'rgba(110, 110, 136, 0.3)' },
    listening: { label: 'LISTENING', color: '#38bdf8', glow: '#38bdf8', ring: 'rgba(56, 189, 248, 0.4)' },
    thinking: { label: 'PROCESSING', color: '#a78bfa', glow: '#a78bfa', ring: 'rgba(167, 139, 250, 0.4)' },
    speaking: { label: 'SPEAKING', color: '#34d399', glow: '#34d399', ring: 'rgba(52, 211, 153, 0.4)' },
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
           MOBILE-FIRST FOUNDATION
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
           COMPACT HEADER - Always visible, minimal height
           ═══════════════════════════════════════════════════════════════════ */
        .header-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: rgba(15, 15, 26, 0.9);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(56, 189, 248, 0.1);
          flex-shrink: 0;
          z-index: 100;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .brand-icon {
          width: 28px;
          height: 28px;
          position: relative;
        }

        .brand-icon svg {
          width: 100%;
          height: 100%;
          color: ${currentState.color};
          filter: drop-shadow(0 0 8px ${currentState.glow});
          transition: all 0.4s var(--ease-out);
        }

        .brand-text {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.2em;
          color: var(--color-text-bright);
        }

        .status-cluster {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(22, 22, 34, 0.8);
          border: 1px solid rgba(56, 189, 248, 0.15);
          border-radius: 20px;
          font-family: var(--font-mono);
          font-size: 10px;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          box-shadow: 0 0 10px ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          animation: ${connected ? 'none' : 'pulse-glow 1.5s ease-in-out infinite'};
        }

        .status-label {
          color: ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .profile-badge {
          padding: 4px 8px;
          background: linear-gradient(135deg, var(--color-amber-dim), transparent);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 4px;
          font-family: var(--font-display);
          font-size: 9px;
          color: var(--color-amber);
          letter-spacing: 0.1em;
        }

        /* ═══════════════════════════════════════════════════════════════════
           MAIN CONTENT AREA - Swipeable views on mobile
           ═══════════════════════════════════════════════════════════════════ */
        .main-content {
          flex: 1;
          display: flex;
          overflow: hidden;
          position: relative;
        }

        /* Mobile: Stack views, show one at a time */
        @media (max-width: 768px) {
          .main-content {
            flex-direction: column;
          }
        }

        /* ═══════════════════════════════════════════════════════════════════
           VOICE SECTION - Hero orb experience on mobile
           ═══════════════════════════════════════════════════════════════════ */
        .voice-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          position: relative;
          overflow: hidden;
        }

        @media (max-width: 768px) {
          .voice-section {
            flex: 1;
            display: ${mobileView === 'voice' ? 'flex' : 'none'};
            padding: 16px;
          }
        }

        @media (min-width: 769px) {
          .voice-section {
            padding: 32px 24px;
            border-bottom: 1px solid var(--color-border);
          }
        }

        /* Ambient background glow */
        .voice-section::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 400px;
          height: 400px;
          background: radial-gradient(
            circle,
            ${currentState.glow}15 0%,
            ${currentState.glow}08 30%,
            transparent 70%
          );
          pointer-events: none;
          transition: all 0.6s var(--ease-out);
        }

        /* Floating orb container */
        .orb-container {
          position: relative;
          width: min(300px, 70vw);
          height: min(300px, 70vw);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Outer ring - pulsing halo */
        .orb-ring {
          position: absolute;
          inset: -20px;
          border-radius: 50%;
          border: 2px solid ${currentState.ring};
          opacity: ${state === 'idle' ? 0.3 : 0.8};
          animation: ${state !== 'idle' ? 'ring-pulse 2s ease-in-out infinite' : 'none'};
          transition: all 0.4s ease;
        }

        .orb-ring-inner {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          border: 1px solid ${currentState.color}60;
          opacity: ${state === 'idle' ? 0.2 : 0.6};
        }

        @keyframes ring-pulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 0.4; }
        }

        /* Main orb - frosted glass effect */
        .orb-main {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: linear-gradient(
            145deg,
            rgba(22, 22, 34, 0.9) 0%,
            rgba(10, 10, 18, 0.95) 100%
          );
          border: 1px solid ${currentState.color}30;
          box-shadow:
            inset 0 -20px 40px rgba(0, 0, 0, 0.4),
            inset 0 20px 40px rgba(255, 255, 255, 0.02),
            0 0 60px ${currentState.glow}20,
            0 20px 40px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.4s var(--ease-out);
          -webkit-tap-highlight-color: transparent;
        }

        .orb-main:active {
          transform: scale(0.98);
        }

        /* Visualizer inside orb */
        .orb-visualizer {
          width: 80%;
          height: 50%;
          position: relative;
          z-index: 2;
        }

        /* Glossy highlight on orb */
        .orb-main::before {
          content: '';
          position: absolute;
          top: 5%;
          left: 15%;
          width: 50%;
          height: 30%;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.08) 0%,
            transparent 100%
          );
          border-radius: 50%;
          pointer-events: none;
        }

        /* State label below orb */
        .state-label-container {
          margin-top: 24px;
          text-align: center;
        }

        .state-text {
          font-family: var(--font-display);
          font-size: 14px;
          letter-spacing: 0.25em;
          color: ${currentState.color};
          text-shadow: 0 0 30px ${currentState.glow};
          margin-bottom: 8px;
        }

        .state-hint {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
          letter-spacing: 0.05em;
        }

        /* ═══════════════════════════════════════════════════════════════════
           CONVERSATION PANEL - Desktop: always visible, Mobile: swipe view
           ═══════════════════════════════════════════════════════════════════ */
        .conversation-panel {
          display: flex;
          flex-direction: column;
          background: rgba(10, 10, 18, 0.6);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        @media (max-width: 768px) {
          .conversation-panel {
            position: absolute;
            inset: 0;
            display: ${mobileView === 'conversation' ? 'flex' : 'none'};
            background: rgba(5, 5, 10, 0.95);
          }
        }

        @media (min-width: 769px) {
          .conversation-panel {
            flex: 1;
            border-right: 1px solid var(--color-border);
          }
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: rgba(22, 22, 34, 0.8);
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.15em;
          color: var(--color-text-dim);
        }

        .section-title svg {
          width: 14px;
          height: 14px;
          color: var(--color-cyan);
        }

        .message-counter {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          padding: 3px 8px;
          background: var(--color-abyss);
          border: 1px solid var(--color-border);
          border-radius: 4px;
        }

        .section-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .clear-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px 10px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .clear-btn:active {
          transform: scale(0.95);
        }

        .clear-btn:hover {
          border-color: var(--color-rose);
          color: var(--color-rose);
          background: rgba(251, 113, 133, 0.1);
        }

        .clear-btn svg {
          width: 12px;
          height: 12px;
          margin-right: 4px;
        }

        .conversation-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 12px 16px;
          -webkit-overflow-scrolling: touch;
        }

        /* ═══════════════════════════════════════════════════════════════════
           COMMAND PANEL - Desktop: sidebar, Mobile: bottom sheet
           ═══════════════════════════════════════════════════════════════════ */
        .command-panel {
          background: var(--color-deep);
        }

        @media (max-width: 768px) {
          .command-panel {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 70vh;
            transform: translateY(${showCommandSheet ? '0' : '100%'});
            transition: transform 0.4s var(--ease-out);
            border-top-left-radius: 20px;
            border-top-right-radius: 20px;
            box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
            z-index: 200;
          }
        }

        @media (min-width: 769px) {
          .command-panel {
            width: 360px;
            flex-shrink: 0;
            border-left: 1px solid var(--color-border);
          }
        }

        /* Bottom sheet handle */
        .sheet-handle {
          display: none;
          width: 40px;
          height: 4px;
          background: var(--color-text-ghost);
          border-radius: 2px;
          margin: 12px auto;
        }

        @media (max-width: 768px) {
          .sheet-handle {
            display: block;
          }
        }

        /* ═══════════════════════════════════════════════════════════════════
           MOBILE BOTTOM NAVIGATION
           ═══════════════════════════════════════════════════════════════════ */
        .mobile-nav {
          display: none;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(15, 15, 26, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid var(--color-border);
          padding: 8px 16px;
          padding-bottom: max(8px, env(safe-area-inset-bottom));
          z-index: 150;
        }

        @media (max-width: 768px) {
          .mobile-nav {
            display: flex;
            justify-content: space-around;
            align-items: center;
          }
        }

        .nav-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 8px 16px;
          background: transparent;
          border: none;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .nav-btn svg {
          width: 22px;
          height: 22px;
          transition: all 0.2s ease;
        }

        .nav-btn.active {
          color: var(--color-cyan);
        }

        .nav-btn.active svg {
          filter: drop-shadow(0 0 8px var(--color-cyan));
        }

        .nav-btn:active {
          transform: scale(0.9);
        }

        .nav-badge {
          position: absolute;
          top: 2px;
          right: 10px;
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
          gap: 24px;
          z-index: 300;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          padding: 32px;
        }

        .disconnect-orb {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: linear-gradient(145deg, var(--color-surface), var(--color-abyss));
          border: 2px solid var(--color-rose);
          box-shadow:
            0 0 40px rgba(251, 113, 133, 0.3),
            inset 0 -10px 20px rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: disconnect-pulse 2s ease-in-out infinite;
        }

        @keyframes disconnect-pulse {
          0%, 100% { box-shadow: 0 0 40px rgba(251, 113, 133, 0.3); }
          50% { box-shadow: 0 0 60px rgba(251, 113, 133, 0.5); }
        }

        .disconnect-orb svg {
          width: 48px;
          height: 48px;
          color: var(--color-rose);
        }

        .disconnect-title {
          font-family: var(--font-display);
          font-size: 16px;
          letter-spacing: 0.25em;
          color: var(--color-text-bright);
        }

        .disconnect-message {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-dim);
          text-align: center;
          max-width: 280px;
          line-height: 1.8;
        }

        .reconnect-btn {
          margin-top: 8px;
          padding: 14px 40px;
          background: transparent;
          border: 1px solid var(--color-cyan);
          border-radius: 30px;
          color: var(--color-cyan);
          font-family: var(--font-display);
          font-size: 11px;
          letter-spacing: 0.2em;
          cursor: pointer;
          transition: all 0.3s var(--ease-out);
          position: relative;
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
        }

        .reconnect-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, var(--color-cyan), transparent);
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .reconnect-btn:hover::before {
          opacity: 0.15;
        }

        .reconnect-btn:active {
          transform: scale(0.95);
          background: var(--color-cyan);
          color: var(--color-void);
        }

        .reconnect-btn span {
          position: relative;
          z-index: 1;
        }

        /* ═══════════════════════════════════════════════════════════════════
           DESKTOP LAYOUT OVERRIDES
           ═══════════════════════════════════════════════════════════════════ */
        @media (min-width: 769px) {
          .vertex-app {
            flex-direction: column; /* Keep column for header on top */
          }

          .main-content {
            flex-direction: row;
            flex: 1;
            min-height: 0; /* Critical for flex child scrolling */
          }

          .stream-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--color-border);
          }

          .mobile-nav {
            display: none;
          }

          /* Left panel structure for desktop */
          .desktop-left {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;
            min-height: 0; /* Critical for flex child scrolling */
          }

          /* Conversation panel needs flex: 1 and min-height: 0 to scroll properly */
          .conversation-panel {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
          }

          /* Command panel needs explicit height management */
          .command-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Safe area padding for notched devices */
        @supports (padding-top: env(safe-area-inset-top)) {
          .header-bar {
            padding-top: max(12px, env(safe-area-inset-top));
          }
        }
      `}</style>

      {/* Header - Always visible */}
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

        <div className="status-cluster">
          <div className="status-pill">
            <div className="status-dot" />
            <span className="status-label">{connected ? 'Live' : 'Off'}</span>
          </div>
          {profile && <span className="profile-badge">{profile}</span>}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Desktop: Left panel with voice + conversation */}
        <div className="desktop-left">
          {/* Voice Section - Hero orb on mobile */}
          <section className="voice-section">
            <div className="orb-container">
              <div className="orb-ring" />
              <div className="orb-ring-inner" />
              <div className="orb-main" onClick={() => mobileView === 'voice' && setMobileView('conversation')}>
                <div className="orb-visualizer">
                  <VoiceVisualizer state={state} />
                </div>
              </div>
            </div>
            <div className="state-label-container">
              <div className="state-text">{currentState.label}</div>
              <div className="state-hint">
                {state === 'idle' ? 'Say "Jarvis" or "Computer"' : 'Processing voice input...'}
              </div>
            </div>
          </section>

          {/* Conversation Panel */}
          <div className="conversation-panel">
            <div className="section-header">
              <div className="section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
                TRANSMISSION LOG
              </div>
              <div className="section-actions">
                <span className="message-counter">{messages.length}</span>
                {messages.length > 0 && (
                  <button className="clear-btn" onClick={clearMessages} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    CLEAR
                  </button>
                )}
              </div>
            </div>
            <div className="conversation-scroll">
              <ConversationStream messages={messages} currentTool={currentTool} />
            </div>
          </div>
        </div>

        {/* Command Panel - Sidebar on desktop, bottom sheet on mobile */}
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

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-nav">
        <button
          className={`nav-btn ${mobileView === 'voice' ? 'active' : ''}`}
          onClick={() => { setMobileView('voice'); setShowCommandSheet(false); }}
          type="button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" />
          </svg>
          VOICE
        </button>
        <button
          className={`nav-btn ${mobileView === 'conversation' ? 'active' : ''}`}
          onClick={() => { setMobileView('conversation'); setShowCommandSheet(false); }}
          type="button"
          style={{ position: 'relative' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          LOG
          {messages.length > 0 && <span className="nav-badge">{messages.length}</span>}
        </button>
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
          PANEL
          {events.length > 0 && <span className="nav-badge">{events.length > 99 ? '99+' : events.length}</span>}
        </button>
      </nav>

      {/* Disconnect Overlay */}
      {!connected && (
        <div className="disconnect-overlay">
          <div className="disconnect-orb">
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
            <span>RECONNECT</span>
          </button>
        </div>
      )}
    </div>
  );
}
