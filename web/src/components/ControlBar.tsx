/**
 * ControlBar - Profile selector and microphone button for voice sessions.
 *
 * Provides:
 * - Profile toggle (Jarvis / Marvin)
 * - Mic button to start/stop recording
 * - Visual feedback for recording state
 * - Master/Replica indicator and control transfer
 */

import type { ProfileId } from '../hooks/useAudioSession';
import type { AgentState } from '../types';

interface ControlBarProps {
  activeProfile: ProfileId;
  onProfileChange: (profile: ProfileId) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  isInitializing?: boolean;
  error?: string | null;
  disabled?: boolean;
  /** Whether this client is the master (handles audio I/O) */
  isMaster?: boolean;
  /** Request to become the master client */
  onRequestMaster?: () => void;
  /** Current agent state (for disabling take control during activity) */
  agentState?: AgentState;
}

export function ControlBar({
  activeProfile,
  onProfileChange,
  isRecording,
  onToggleRecording,
  isInitializing = false,
  error = null,
  disabled = false,
  isMaster = true,
  onRequestMaster,
  agentState = 'idle',
}: ControlBarProps) {
  const profiles: { id: ProfileId; name: string; description: string }[] = [
    { id: 'jarvis', name: 'JARVIS', description: 'General Assistant' },
    { id: 'marvin', name: 'MARVIN', description: 'Developer Mode' },
  ];

  // Can take control when agent is not actively processing
  const canTakeControl = agentState !== 'thinking' && agentState !== 'speaking';

  return (
    <>
      <style>{`
        .control-bar {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          padding: 20px;
        }

        /* Profile Selector */
        .profile-selector {
          display: flex;
          gap: 8px;
          background: rgba(22, 22, 34, 0.8);
          padding: 6px;
          border-radius: 12px;
          border: 1px solid var(--color-border);
        }

        .profile-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 10px 20px;
          background: transparent;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .profile-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .profile-btn.active {
          background: linear-gradient(145deg, var(--color-cyan-dim), transparent);
          border: 1px solid var(--color-cyan);
        }

        .profile-btn:not(.active):not(:disabled):hover {
          background: rgba(56, 189, 248, 0.1);
        }

        .profile-name {
          font-family: var(--font-display);
          font-size: 12px;
          letter-spacing: 0.15em;
          color: var(--color-text-bright);
        }

        .profile-btn.active .profile-name {
          color: var(--color-cyan);
          text-shadow: 0 0 10px var(--color-cyan);
        }

        .profile-desc {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          letter-spacing: 0.05em;
        }

        /* Mic Button */
        .mic-container {
          position: relative;
        }

        .mic-btn {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          border: 2px solid var(--color-border);
          background: linear-gradient(145deg, var(--color-surface), var(--color-abyss));
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s var(--ease-out);
          -webkit-tap-highlight-color: transparent;
          position: relative;
          overflow: hidden;
        }

        .mic-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .mic-btn:not(:disabled):hover {
          transform: scale(1.05);
          border-color: var(--color-cyan);
        }

        .mic-btn:not(:disabled):active {
          transform: scale(0.95);
        }

        .mic-btn.recording {
          border-color: var(--color-rose);
          background: linear-gradient(145deg, rgba(251, 113, 133, 0.2), var(--color-abyss));
          animation: pulse-recording 1.5s ease-in-out infinite;
        }

        .mic-btn.initializing {
          border-color: var(--color-amber);
          animation: pulse-init 0.8s ease-in-out infinite;
        }

        @keyframes pulse-recording {
          0%, 100% { box-shadow: 0 0 20px rgba(251, 113, 133, 0.3); }
          50% { box-shadow: 0 0 40px rgba(251, 113, 133, 0.6); }
        }

        @keyframes pulse-init {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }

        .mic-btn svg {
          width: 28px;
          height: 28px;
          color: var(--color-text-dim);
          transition: all 0.2s ease;
        }

        .mic-btn.recording svg {
          color: var(--color-rose);
        }

        .mic-btn.initializing svg {
          color: var(--color-amber);
        }

        /* Recording ring effect */
        .recording-ring {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          border: 2px solid var(--color-rose);
          opacity: 0;
          animation: ring-expand 1.5s ease-out infinite;
        }

        @keyframes ring-expand {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        /* Status text */
        .status-text {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          text-align: center;
          letter-spacing: 0.05em;
          min-height: 16px;
        }

        .status-text.error {
          color: var(--color-rose);
        }

        .status-text.recording {
          color: var(--color-rose);
        }

        /* Master/Replica indicator */
        .master-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.1em;
        }

        .master-indicator.is-master {
          background: rgba(34, 197, 94, 0.15);
          border: 1px solid rgba(34, 197, 94, 0.4);
          color: rgb(34, 197, 94);
        }

        .master-indicator.is-replica {
          background: rgba(251, 191, 36, 0.15);
          border: 1px solid rgba(251, 191, 36, 0.4);
          color: rgb(251, 191, 36);
        }

        .master-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }

        .master-indicator.is-master .master-dot {
          animation: pulse-master 2s ease-in-out infinite;
        }

        @keyframes pulse-master {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Take Control button */
        .take-control-btn {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          border: 2px dashed rgba(251, 191, 36, 0.5);
          background: linear-gradient(145deg, rgba(251, 191, 36, 0.1), transparent);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 2px;
          cursor: pointer;
          transition: all 0.3s var(--ease-out);
          -webkit-tap-highlight-color: transparent;
        }

        .take-control-btn:not(:disabled):hover {
          transform: scale(1.05);
          border-color: rgba(251, 191, 36, 0.8);
          background: linear-gradient(145deg, rgba(251, 191, 36, 0.2), transparent);
        }

        .take-control-btn:not(:disabled):active {
          transform: scale(0.95);
        }

        .take-control-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .take-control-btn svg {
          width: 24px;
          height: 24px;
          color: rgb(251, 191, 36);
        }

        .take-control-label {
          font-family: var(--font-mono);
          font-size: 8px;
          color: rgb(251, 191, 36);
          letter-spacing: 0.05em;
        }
      `}</style>

      <div className="control-bar">
        {/* Master/Replica Indicator */}
        <div className={`master-indicator ${isMaster ? 'is-master' : 'is-replica'}`}>
          <span className="master-dot" />
          <span>{isMaster ? 'MASTER' : 'REPLICA'}</span>
        </div>

        {/* Profile Selector */}
        <div className="profile-selector">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`profile-btn ${activeProfile === profile.id ? 'active' : ''}`}
              onClick={() => onProfileChange(profile.id)}
              disabled={isRecording || disabled}
            >
              <span className="profile-name">{profile.name}</span>
              <span className="profile-desc">{profile.description}</span>
            </button>
          ))}
        </div>

        {/* Mic Button or Take Control Button */}
        <div className="mic-container">
          {isMaster ? (
            <>
              {isRecording && <div className="recording-ring" />}
              <button
                type="button"
                className={`mic-btn ${isRecording ? 'recording' : ''} ${isInitializing ? 'initializing' : ''}`}
                onClick={onToggleRecording}
                disabled={disabled || isInitializing}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                {isRecording ? (
                  // Stop icon
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  // Mic icon
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="take-control-btn"
              onClick={onRequestMaster}
              disabled={!canTakeControl || disabled}
              aria-label="Take control"
            >
              {/* Hand/pointer icon */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
                <path d="M10 19v-6.8a1.5 1.5 0 0 1 1.5-1.5 1.5 1.5 0 0 1 1.5 1.5v1.3" />
                <path d="M13 17v-2.5a1.5 1.5 0 0 1 3 0V17" />
                <path d="M16 17v-1.5a1.5 1.5 0 0 1 3 0V19a4 4 0 0 1-4 4h-2.5" />
              </svg>
              <span className="take-control-label">CONTROL</span>
            </button>
          )}
        </div>

        {/* Status Text */}
        <div className={`status-text ${error ? 'error' : ''} ${isRecording ? 'recording' : ''}`}>
          {error ? (
            error
          ) : !isMaster ? (
            canTakeControl ? 'TAP TO TAKE CONTROL' : 'AGENT BUSY'
          ) : isInitializing ? (
            'INITIALIZING...'
          ) : isRecording ? (
            'TAP TO STOP'
          ) : (
            'TAP TO SPEAK'
          )}
        </div>
      </div>
    </>
  );
}
