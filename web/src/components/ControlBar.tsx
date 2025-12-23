/**
 * ControlBar - Compact bottom bar with profile selector, mic button, and voice indicator.
 *
 * Redesigned for conversation-first layout:
 * - Horizontal layout fits at bottom of screen
 * - Profile pills on left, mic button center, status on right
 * - Integrated voice indicator shows state
 */

import type { ProfileId } from '../hooks/useAudioSession';
import type { AgentState } from '../types';
import { VoiceIndicator } from './VoiceIndicator';
import { RecordButton } from './RecordButton';

interface ControlBarProps {
  activeProfile: ProfileId;
  onProfileChange: (profile: ProfileId) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  isInitializing?: boolean;
  error?: string | null;
  disabled?: boolean;
  isMaster?: boolean;
  onRequestMaster?: () => void;
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
  const profiles: { id: ProfileId; name: string; short: string }[] = [
    { id: 'jarvis', name: 'JARVIS', short: 'JAR' },
    { id: 'marvin', name: 'MARVIN', short: 'MAR' },
  ];

  const canTakeControl = agentState !== 'thinking' && agentState !== 'speaking';

  const stateLabels: Record<AgentState, string> = {
    idle: 'READY',
    listening: 'LISTENING',
    thinking: 'PROCESSING',
    speaking: 'SPEAKING',
  };

  return (
    <>
      <style>{`
        .control-bar-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(10, 10, 18, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid var(--color-border);
        }

        /* Left section - Profile pills */
        .cb-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .profile-pill {
          padding: 6px 12px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 20px;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.1em;
          color: var(--color-text-dim);
          cursor: pointer;
          transition: all 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .profile-pill:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .profile-pill.active {
          background: linear-gradient(135deg, var(--color-cyan-dim), transparent);
          border-color: var(--color-cyan);
          color: var(--color-cyan);
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
        }

        .profile-pill:not(.active):not(:disabled):hover {
          border-color: var(--color-text-ghost);
          color: var(--color-text-normal);
        }

        .cb-divider {
          width: 1px;
          height: 20px;
          background: var(--color-border);
          margin: 0 4px;
        }

        /* Center section - Mic button + indicator */
        .cb-center {
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
        }

        .mic-btn-compact {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: 2px solid var(--color-border);
          background: linear-gradient(145deg, var(--color-surface), var(--color-abyss));
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s var(--ease-out);
          -webkit-tap-highlight-color: transparent;
          position: relative;
        }

        .mic-btn-compact:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .mic-btn-compact:not(:disabled):hover {
          transform: scale(1.05);
          border-color: var(--color-cyan);
        }

        .mic-btn-compact:not(:disabled):active {
          transform: scale(0.95);
        }

        .mic-btn-compact.recording {
          border-color: var(--color-rose);
          background: linear-gradient(145deg, rgba(251, 113, 133, 0.15), var(--color-abyss));
          box-shadow: 0 0 20px rgba(251, 113, 133, 0.3);
        }

        .mic-btn-compact.initializing {
          border-color: var(--color-amber);
        }

        .mic-btn-compact svg {
          width: 22px;
          height: 22px;
          color: var(--color-text-dim);
          transition: all 0.2s ease;
        }

        .mic-btn-compact.recording svg {
          color: var(--color-rose);
        }

        .mic-btn-compact.initializing svg {
          color: var(--color-amber);
          animation: pulse-spin 1s ease-in-out infinite;
        }

        @keyframes pulse-spin {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Recording ring animation */
        .recording-ring-compact {
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          border: 2px solid var(--color-rose);
          opacity: 0;
          animation: ring-expand-compact 1.2s ease-out infinite;
        }

        @keyframes ring-expand-compact {
          0% { transform: scale(0.9); opacity: 0.6; }
          100% { transform: scale(1.3); opacity: 0; }
        }

        /* Take control button (for replicas) */
        .take-control-compact {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: 2px dashed rgba(251, 191, 36, 0.4);
          background: linear-gradient(145deg, rgba(251, 191, 36, 0.08), transparent);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          cursor: pointer;
          transition: all 0.2s var(--ease-out);
        }

        .take-control-compact:not(:disabled):hover {
          border-color: rgba(251, 191, 36, 0.7);
          background: linear-gradient(145deg, rgba(251, 191, 36, 0.15), transparent);
        }

        .take-control-compact:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .take-control-compact svg {
          width: 18px;
          height: 18px;
          color: rgb(251, 191, 36);
        }

        .take-control-compact span {
          font-family: var(--font-mono);
          font-size: 7px;
          color: rgb(251, 191, 36);
          letter-spacing: 0.05em;
        }

        /* Right section - Status */
        .cb-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
          min-width: 80px;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.08em;
        }

        .status-badge.master {
          background: rgba(34, 197, 94, 0.12);
          border: 1px solid rgba(34, 197, 94, 0.3);
          color: rgb(34, 197, 94);
        }

        .status-badge.replica {
          background: rgba(251, 191, 36, 0.12);
          border: 1px solid rgba(251, 191, 36, 0.3);
          color: rgb(251, 191, 36);
        }

        .status-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
        }

        .status-badge.master .status-dot {
          animation: dot-pulse 2s ease-in-out infinite;
        }

        @keyframes dot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .state-label {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          letter-spacing: 0.05em;
        }

        .state-label.error {
          color: var(--color-rose);
        }

        /* Mobile adjustments */
        @media (max-width: 480px) {
          .control-bar-bottom {
            padding: 10px 12px;
            gap: 8px;
          }

          .profile-pill {
            padding: 5px 10px;
            font-size: 9px;
          }

          .mic-btn-compact {
            width: 48px;
            height: 48px;
          }

          .mic-btn-compact svg {
            width: 20px;
            height: 20px;
          }

          .cb-right {
            min-width: 64px;
          }
        }
      `}</style>

      <div className="control-bar-bottom">
        {/* Left - Profile selector + Record button */}
        <div className="cb-left">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`profile-pill ${activeProfile === profile.id ? 'active' : ''}`}
              onClick={() => onProfileChange(profile.id)}
              disabled={isRecording || disabled}
            >
              {profile.name}
            </button>
          ))}
          <div className="cb-divider" />
          <RecordButton />
        </div>

        {/* Center - Mic button + Voice indicator */}
        <div className="cb-center">
          <VoiceIndicator state={agentState} size="md" />

          {isMaster ? (
            <div style={{ position: 'relative' }}>
              {isRecording && <div className="recording-ring-compact" />}
              <button
                type="button"
                className={`mic-btn-compact ${isRecording ? 'recording' : ''} ${isInitializing ? 'initializing' : ''}`}
                onClick={onToggleRecording}
                disabled={disabled || isInitializing}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                {isRecording ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="take-control-compact"
              onClick={onRequestMaster}
              disabled={!canTakeControl || disabled}
              aria-label="Take control"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
                <path d="M10 19v-6.8a1.5 1.5 0 0 1 3 0v1.3" />
                <path d="M13 17v-2.5a1.5 1.5 0 0 1 3 0V17" />
                <path d="M16 17v-1.5a1.5 1.5 0 0 1 3 0V19a4 4 0 0 1-4 4h-2.5" />
              </svg>
              <span>CTRL</span>
            </button>
          )}
        </div>

        {/* Right - Status */}
        <div className="cb-right">
          <div className={`status-badge ${isMaster ? 'master' : 'replica'}`}>
            <span className="status-dot" />
            <span>{isMaster ? 'MASTER' : 'REPLICA'}</span>
          </div>
          <span className={`state-label ${error ? 'error' : ''}`}>
            {error || stateLabels[agentState]}
          </span>
        </div>
      </div>
    </>
  );
}
