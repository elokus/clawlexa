// ═══════════════════════════════════════════════════════════════════════════
// VΞRTΞX Voice Interface - Indie Dark Game Aesthetic
// Layout: Left (Conversation Stream) | Right (Command Panel)
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentStore } from './stores/agent';
import { VoiceVisualizer } from './components/VoiceVisualizer';
import { ConversationStream } from './components/ConversationStream';
import { CommandPanel } from './components/CommandPanel';

export function App() {
  useWebSocket();

  const { connected, state, profile, messages, events, currentTool, loadMockConversation, clearMessages, clearEvents } = useAgentStore();
  const [activeTab, setActiveTab] = useState<'sessions' | 'tools' | 'events'>('events');

  // Check if we're in demo mode (no WS_URL set)
  const isDemoMode = !import.meta.env.VITE_WS_URL;

  // Load mock data only in demo mode
  useEffect(() => {
    if (isDemoMode) {
      loadMockConversation();
    }
  }, [isDemoMode, loadMockConversation]);

  const stateConfig = {
    idle: { label: 'STANDBY', color: 'var(--color-text-dim)', glow: 'transparent' },
    listening: { label: 'LISTENING', color: 'var(--color-cyan)', glow: 'var(--color-cyan)' },
    thinking: { label: 'PROCESSING', color: 'var(--color-violet)', glow: 'var(--color-violet)' },
    speaking: { label: 'SPEAKING', color: 'var(--color-emerald)', glow: 'var(--color-emerald)' },
  };

  const currentState = stateConfig[state] || stateConfig.idle;

  return (
    <div className="vertex-app">
      <style>{`
        .vertex-app {
          display: flex;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
          position: relative;
          z-index: 10;
        }

        /* ═══════════════════════════════════════════════════════════════════
           LEFT PANEL - Conversation Stream
           ═══════════════════════════════════════════════════════════════════ */
        .stream-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: linear-gradient(180deg, var(--color-abyss) 0%, var(--color-void) 100%);
          border-right: 1px solid var(--color-border);
        }

        /* Header Bar */
        .header-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background: var(--color-deep);
          border-bottom: 1px solid var(--color-border);
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-icon {
          width: 32px;
          height: 32px;
          position: relative;
        }

        .brand-icon svg {
          width: 100%;
          height: 100%;
          color: ${currentState.color};
          filter: drop-shadow(0 0 8px ${currentState.glow});
          transition: all 0.3s ease;
        }

        .brand-text {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.15em;
          color: var(--color-text-bright);
        }

        .brand-version {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          margin-left: 8px;
          padding: 2px 6px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
        }

        .status-cluster {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          font-family: var(--font-mono);
          font-size: 11px;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          background: ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          box-shadow: 0 0 8px ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          animation: ${connected ? 'none' : 'pulse-glow 1.5s ease-in-out infinite'};
        }

        .status-label {
          color: ${connected ? 'var(--color-emerald)' : 'var(--color-rose)'};
          text-transform: uppercase;
        }

        .state-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: var(--color-surface);
          border: 1px solid ${currentState.color}40;
          font-family: var(--font-mono);
          font-size: 11px;
        }

        .state-indicator {
          width: 8px;
          height: 8px;
          background: ${currentState.color};
          box-shadow: 0 0 12px ${currentState.glow};
          animation: ${state !== 'idle' ? 'pulse-glow 1.5s ease-in-out infinite' : 'none'};
        }

        .state-label {
          color: ${currentState.color};
          letter-spacing: 0.1em;
        }

        .profile-tag {
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--color-amber);
          padding: 4px 10px;
          background: var(--color-amber-dim);
          border: 1px solid var(--color-amber)40;
          letter-spacing: 0.1em;
        }

        /* Voice Section */
        .voice-section {
          padding: 24px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          background: var(--color-deep);
          border-bottom: 1px solid var(--color-border);
          position: relative;
        }

        /* Ambient glow behind visualizer */
        .voice-section::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 300px;
          height: 100px;
          background: radial-gradient(ellipse, ${currentState.glow}20 0%, transparent 70%);
          pointer-events: none;
          transition: all 0.5s ease;
        }

        .visualizer-frame {
          width: 100%;
          max-width: 500px;
          height: 80px;
          background: var(--color-abyss);
          border: 1px solid var(--color-border);
          position: relative;
          overflow: hidden;
          box-shadow:
            inset 0 0 30px rgba(0, 0, 0, 0.5),
            0 0 20px ${currentState.glow}15;
        }

        /* Corner brackets - top left */
        .corner-tl, .corner-tr, .corner-bl, .corner-br {
          position: absolute;
          width: 16px;
          height: 16px;
          pointer-events: none;
          z-index: 5;
        }

        .corner-tl {
          top: 0;
          left: 0;
          border-top: 2px solid ${currentState.color};
          border-left: 2px solid ${currentState.color};
          opacity: 0.7;
        }

        .corner-tr {
          top: 0;
          right: 0;
          border-top: 2px solid ${currentState.color};
          border-right: 2px solid ${currentState.color};
          opacity: 0.7;
        }

        .corner-bl {
          bottom: 0;
          left: 0;
          border-bottom: 2px solid ${currentState.color};
          border-left: 2px solid ${currentState.color};
          opacity: 0.7;
        }

        .corner-br {
          bottom: 0;
          right: 0;
          border-bottom: 2px solid ${currentState.color};
          border-right: 2px solid ${currentState.color};
          opacity: 0.7;
        }

        .state-display {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .state-text {
          font-family: var(--font-display);
          font-size: 12px;
          letter-spacing: 0.2em;
          color: ${currentState.color};
          text-shadow: 0 0 20px ${currentState.glow};
        }

        /* Conversation Area */
        .conversation-area {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 20px;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-display);
          font-size: 11px;
          letter-spacing: 0.15em;
          color: var(--color-text-dim);
        }

        .section-title svg {
          width: 12px;
          height: 12px;
          color: var(--color-cyan);
        }

        .message-counter {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          padding: 2px 8px;
          background: var(--color-abyss);
          border: 1px solid var(--color-border);
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
          padding: 4px 8px;
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .clear-btn:hover {
          border-color: var(--color-rose);
          color: var(--color-rose);
          background: rgba(251, 113, 133, 0.1);
        }

        .clear-btn svg {
          width: 10px;
          height: 10px;
          margin-right: 4px;
        }

        .conversation-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           RIGHT PANEL - Command Panel
           ═══════════════════════════════════════════════════════════════════ */
        .command-panel {
          width: 380px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          background: var(--color-deep);
          border-left: 1px solid var(--color-border);
          box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
        }

        /* Disconnect Overlay */
        .disconnect-overlay {
          position: absolute;
          inset: 0;
          background: rgba(5, 5, 10, 0.95);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
          z-index: 100;
          backdrop-filter: blur(4px);
        }

        .disconnect-icon {
          width: 64px;
          height: 64px;
          color: var(--color-rose);
          filter: drop-shadow(0 0 20px var(--color-rose));
          animation: pulse-glow 2s ease-in-out infinite;
        }

        .disconnect-title {
          font-family: var(--font-display);
          font-size: 16px;
          letter-spacing: 0.2em;
          color: var(--color-text-bright);
        }

        .disconnect-message {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-dim);
          text-align: center;
          max-width: 300px;
          line-height: 1.8;
        }

        .reconnect-btn {
          margin-top: 8px;
          padding: 12px 32px;
          background: transparent;
          border: 1px solid var(--color-cyan);
          color: var(--color-cyan);
          font-family: var(--font-display);
          font-size: 11px;
          letter-spacing: 0.15em;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;
        }

        .reconnect-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: var(--color-cyan);
          opacity: 0;
          transition: opacity 0.2s ease;
        }

        .reconnect-btn:hover {
          color: var(--color-void);
          text-shadow: none;
        }

        .reconnect-btn:hover::before {
          opacity: 1;
        }

        .reconnect-btn span {
          position: relative;
          z-index: 1;
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Left Panel - Conversation Stream */}
      <div className="stream-panel">
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
            <span className="brand-version">v2.1</span>
          </div>

          <div className="status-cluster">
            <div className="status-badge">
              <div className="status-dot" />
              <span className="status-label">{connected ? 'Online' : 'Offline'}</span>
            </div>

            <div className="state-badge">
              <div className="state-indicator" />
              <span className="state-label">{currentState.label}</span>
            </div>

            {profile && (
              <div className="profile-tag">{profile}</div>
            )}
          </div>
        </header>

        {/* Voice Visualizer */}
        <section className="voice-section">
          <div className="visualizer-frame">
            <div className="corner-tl" />
            <div className="corner-tr" />
            <div className="corner-bl" />
            <div className="corner-br" />
            <VoiceVisualizer state={state} />
          </div>
          <div className="state-display">
            <span className="state-text">{currentState.label}</span>
          </div>
        </section>

        {/* Conversation */}
        <section className="conversation-area">
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              TRANSMISSION LOG
            </div>
            <div className="section-actions">
              <span className="message-counter">{messages.length} ENTRIES</span>
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
        </section>
      </div>

      {/* Right Panel - Command Panel */}
      <aside className="command-panel">
        <CommandPanel
          events={events}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClearEvents={clearEvents}
        />
      </aside>

      {/* Disconnect Overlay */}
      {!connected && (
        <div className="disconnect-overlay">
          <svg className="disconnect-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <div className="disconnect-title">CONNECTION LOST</div>
          <div className="disconnect-message">
            Establishing uplink to VERTEX core...<br/>
            Target: marlon.local
          </div>
          <button className="reconnect-btn">
            <span>RECONNECT</span>
          </button>
        </div>
      )}
    </div>
  );
}
