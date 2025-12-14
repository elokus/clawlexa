/**
 * ControlBar - Profile selector and microphone button for voice sessions.
 *
 * Provides:
 * - Profile toggle (Jarvis / Marvin)
 * - Mic button to start/stop recording
 * - Visual feedback for recording state
 */

import type { ProfileId } from '../hooks/useAudioSession';

interface ControlBarProps {
  activeProfile: ProfileId;
  onProfileChange: (profile: ProfileId) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  isInitializing?: boolean;
  error?: string | null;
  disabled?: boolean;
}

export function ControlBar({
  activeProfile,
  onProfileChange,
  isRecording,
  onToggleRecording,
  isInitializing = false,
  error = null,
  disabled = false,
}: ControlBarProps) {
  const profiles: { id: ProfileId; name: string; description: string }[] = [
    { id: 'jarvis', name: 'JARVIS', description: 'General Assistant' },
    { id: 'marvin', name: 'MARVIN', description: 'Developer Mode' },
  ];

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
      `}</style>

      <div className="control-bar">
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

        {/* Mic Button */}
        <div className="mic-container">
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
        </div>

        {/* Status Text */}
        <div className={`status-text ${error ? 'error' : ''} ${isRecording ? 'recording' : ''}`}>
          {error ? (
            error
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
