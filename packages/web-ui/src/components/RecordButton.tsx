/**
 * RecordButton - Capture WebSocket events for demo scenarios.
 *
 * Records all events from a real conversation to create authentic
 * demo scenarios with real timing data.
 */

import { useState, useEffect, useCallback } from 'react';

interface RecordingStatus {
  recording: boolean;
  eventCount: number;
}

interface ExportedScenario {
  id: string;
  name: string;
  description: string;
  capturedAt: string;
  events: unknown[];
}

// Use relative URLs - dev server proxy handles it in dev, same origin in prod
const API_BASE = '/api/recording';

export function RecordButton() {
  const [status, setStatus] = useState<RecordingStatus>({ recording: false, eventCount: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportedScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll status while recording
  useEffect(() => {
    if (!status.recording) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/status`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {
        // Ignore polling errors
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [status.recording]);

  const startRecording = useCallback(async () => {
    setError(null);
    setLastExport(null);
    try {
      const res = await fetch(`${API_BASE}/start`, { method: 'POST' });
      if (res.ok) {
        setStatus({ recording: true, eventCount: 0 });
      } else {
        setError('Failed to start recording');
      }
    } catch (err) {
      setError('Connection error');
      console.error('[RecordButton] Start error:', err);
    }
  }, []);

  const stopAndExport = useCallback(async () => {
    setIsExporting(true);
    setError(null);
    try {
      // Stop recording
      await fetch(`${API_BASE}/stop`, { method: 'POST' });

      // Prompt for scenario name
      const name = prompt('Scenario name:', 'Marvin CLI Session') || 'recorded-scenario';
      const description = prompt('Description:', 'Captured real conversation') || '';

      // Export
      const res = await fetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, saveToFile: true }),
      });

      if (res.ok) {
        const scenario = await res.json();
        setLastExport(scenario);
        setStatus({ recording: false, eventCount: 0 });

        // Also copy JSON to clipboard
        await navigator.clipboard.writeText(JSON.stringify(scenario, null, 2));
        console.log('[RecordButton] Scenario exported and copied to clipboard');
      } else {
        setError('Export failed');
      }
    } catch (err) {
      setError('Export error');
      console.error('[RecordButton] Export error:', err);
    } finally {
      setIsExporting(false);
    }
  }, []);

  const downloadJson = useCallback(() => {
    if (!lastExport) return;

    const blob = new Blob([JSON.stringify(lastExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lastExport.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lastExport]);

  return (
    <>
      <style>{`
        .record-btn-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .record-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 20px;
          border: 1px solid var(--color-border);
          background: transparent;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .record-btn:hover {
          border-color: var(--color-text-ghost);
          color: var(--color-text-normal);
        }

        .record-btn.recording {
          border-color: var(--color-rose);
          background: rgba(244, 63, 94, 0.1);
          color: var(--color-rose);
        }

        .record-btn.recording:hover {
          background: rgba(244, 63, 94, 0.2);
        }

        .record-btn.exporting {
          border-color: var(--color-amber);
          color: var(--color-amber);
          cursor: wait;
        }

        .record-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
        }

        .record-btn.recording .record-dot {
          animation: record-pulse 1s ease-in-out infinite;
        }

        @keyframes record-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        .record-count {
          font-variant-numeric: tabular-nums;
          min-width: 24px;
          text-align: right;
        }

        .export-toast {
          position: fixed;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--color-surface);
          border: 1px solid var(--color-emerald);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          animation: toast-in 0.3s ease;
        }

        @keyframes toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        .export-toast-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-emerald);
        }

        .export-toast-count {
          color: var(--color-text-dim);
        }

        .export-toast-btn {
          padding: 4px 8px;
          border: 1px solid var(--color-emerald);
          border-radius: 4px;
          background: transparent;
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-emerald);
          cursor: pointer;
        }

        .export-toast-btn:hover {
          background: rgba(52, 211, 153, 0.1);
        }

        .export-toast-close {
          padding: 2px 6px;
          border: none;
          background: transparent;
          color: var(--color-text-ghost);
          cursor: pointer;
          font-size: 14px;
        }

        .record-error {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-rose);
        }
      `}</style>

      <div className="record-btn-container">
        {status.recording ? (
          <button
            type="button"
            className={`record-btn recording ${isExporting ? 'exporting' : ''}`}
            onClick={stopAndExport}
            disabled={isExporting}
          >
            <span className="record-dot" />
            <span>REC</span>
            <span className="record-count">{status.eventCount}</span>
          </button>
        ) : (
          <button
            type="button"
            className="record-btn"
            onClick={startRecording}
          >
            <span className="record-dot" />
            <span>CAPTURE</span>
          </button>
        )}

        {error && <span className="record-error">{error}</span>}
      </div>

      {lastExport && (
        <div className="export-toast">
          <div>
            <div className="export-toast-text">
              Captured: {lastExport.name}
            </div>
            <div className="export-toast-count">
              {lastExport.events.length} events - copied to clipboard
            </div>
          </div>
          <button type="button" className="export-toast-btn" onClick={downloadJson}>
            Download
          </button>
          <button
            type="button"
            className="export-toast-close"
            onClick={() => setLastExport(null)}
          >
            &times;
          </button>
        </div>
      )}
    </>
  );
}
