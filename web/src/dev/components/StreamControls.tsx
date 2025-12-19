// ═══════════════════════════════════════════════════════════════════════════
// Stream Controls - Playback controls and backend toggle
// ═══════════════════════════════════════════════════════════════════════════

import type { PlaybackState } from '../hooks/useStreamSimulator';
import type { StreamScenario } from '../registry';

interface StreamControlsProps {
  state: PlaybackState;
  currentIndex: number;
  totalEvents: number;
  speed: number;
  useBackend: boolean;
  backendAvailable: boolean | null;
  scenarios: StreamScenario[];
  selectedScenarioId: string;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onStep: () => void;
  onSpeedChange: (speed: number) => void;
  onBackendToggle: (use: boolean) => void;
  onScenarioChange: (id: string) => void;
}

export function StreamControls({
  state,
  currentIndex,
  totalEvents,
  speed,
  useBackend,
  backendAvailable,
  scenarios,
  selectedScenarioId,
  onPlay,
  onPause,
  onReset,
  onStep,
  onSpeedChange,
  onBackendToggle,
  onScenarioChange,
}: StreamControlsProps) {
  const progress = totalEvents > 0 ? (currentIndex / totalEvents) * 100 : 0;
  const isPlaying = state === 'playing';
  const isFinished = state === 'finished';

  return (
    <div className="stream-controls">
      <style>{`
        .stream-controls {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
        }

        .controls-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .controls-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .control-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-text-normal);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .control-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08);
          border-color: var(--color-cyan);
        }

        .control-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .control-btn.primary {
          background: rgba(56, 189, 248, 0.15);
          border-color: var(--color-cyan);
          color: var(--color-cyan);
        }

        .control-btn svg {
          width: 14px;
          height: 14px;
        }

        .progress-section {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .progress-bar {
          flex: 1;
          height: 4px;
          background: var(--color-border);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: var(--color-cyan);
          transition: width 0.1s ease;
        }

        .progress-text {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          min-width: 60px;
          text-align: right;
        }

        .speed-select {
          padding: 4px 8px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--color-border);
          border-radius: 4px;
          color: var(--color-text-normal);
          font-family: var(--font-mono);
          font-size: 10px;
          cursor: pointer;
        }

        .speed-select:hover {
          border-color: var(--color-cyan);
        }

        .scenario-select {
          flex: 1;
          max-width: 300px;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--color-border);
          border-radius: 4px;
          color: var(--color-text-normal);
          font-family: var(--font-mono);
          font-size: 11px;
          cursor: pointer;
        }

        .scenario-select:hover {
          border-color: var(--color-cyan);
        }

        .divider {
          width: 1px;
          height: 24px;
          background: var(--color-border);
        }

        .backend-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .toggle-label {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
        }

        .toggle-switch {
          position: relative;
          width: 40px;
          height: 20px;
          background: var(--color-border);
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .toggle-switch.active {
          background: var(--color-cyan);
        }

        .toggle-switch.disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .toggle-knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          background: white;
          border-radius: 50%;
          transition: transform 0.2s ease;
        }

        .toggle-switch.active .toggle-knob {
          transform: translateX(20px);
        }

        .backend-status {
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: var(--font-mono);
          font-size: 9px;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-dot.available {
          background: var(--color-emerald);
          box-shadow: 0 0 6px var(--color-emerald);
        }

        .status-dot.unavailable {
          background: var(--color-rose);
        }

        .status-dot.checking {
          background: var(--color-amber);
          animation: pulse 1s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Scenario selector and backend toggle */}
      <div className="controls-row">
        <select
          className="scenario-select"
          value={selectedScenarioId}
          onChange={(e) => onScenarioChange(e.target.value)}
          disabled={isPlaying}
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="divider" />

        <div className="backend-toggle">
          <span className="toggle-label">Use Backend</span>
          <div
            className={`toggle-switch ${useBackend ? 'active' : ''} ${backendAvailable === false ? 'disabled' : ''}`}
            onClick={() => backendAvailable !== false && onBackendToggle(!useBackend)}
            onKeyDown={(e) => e.key === 'Enter' && backendAvailable !== false && onBackendToggle(!useBackend)}
            role="switch"
            aria-checked={useBackend}
            tabIndex={0}
          >
            <div className="toggle-knob" />
          </div>
          <div className="backend-status">
            <span
              className={`status-dot ${
                backendAvailable === null
                  ? 'checking'
                  : backendAvailable
                    ? 'available'
                    : 'unavailable'
              }`}
            />
            <span style={{ color: backendAvailable ? 'var(--color-emerald)' : 'var(--color-text-ghost)' }}>
              {backendAvailable === null ? 'Checking...' : backendAvailable ? 'Available' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Playback controls */}
      <div className="controls-row">
        <div className="controls-group">
          {/* Play/Pause */}
          <button
            type="button"
            className={`control-btn ${!isPlaying && !isFinished ? 'primary' : ''}`}
            onClick={isPlaying ? onPause : onPlay}
            disabled={isFinished && currentIndex >= totalEvents}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Step */}
          <button
            type="button"
            className="control-btn"
            onClick={onStep}
            disabled={isPlaying || isFinished}
            title="Step"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 5v14l8-7z" />
              <rect x="15" y="5" width="3" height="14" rx="1" />
            </svg>
          </button>

          {/* Reset */}
          <button
            type="button"
            className="control-btn"
            onClick={onReset}
            disabled={state === 'idle' && currentIndex === 0}
            title="Reset"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64" />
              <path d="M3 3v6h6" />
            </svg>
          </button>
        </div>

        {/* Progress */}
        <div className="progress-section">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-text">
            {currentIndex} / {totalEvents}
          </span>
        </div>

        {/* Speed */}
        <select
          className="speed-select"
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          disabled={useBackend}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
          <option value={10}>10x</option>
        </select>
      </div>
    </div>
  );
}
