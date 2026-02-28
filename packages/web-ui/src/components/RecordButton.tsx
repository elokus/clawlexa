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

const API_BASE = '/api/recording';

export function RecordButton() {
  const [status, setStatus] = useState<RecordingStatus>({ recording: false, eventCount: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportedScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status.recording) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/status`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch { /* ignore */ }
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
      await fetch(`${API_BASE}/stop`, { method: 'POST' });
      const name = prompt('Scenario name:', 'Marvin CLI Session') || 'recorded-scenario';
      const description = prompt('Description:', 'Captured real conversation') || '';
      const res = await fetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, saveToFile: true }),
      });
      if (res.ok) {
        const scenario = await res.json();
        setLastExport(scenario);
        setStatus({ recording: false, eventCount: 0 });
        await navigator.clipboard.writeText(JSON.stringify(scenario, null, 2));
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
      <div className="flex items-center gap-2">
        {status.recording ? (
          <button
            type="button"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-mono font-medium transition-colors ${
              isExporting
                ? 'border-orange-500/40 text-orange-500 cursor-wait'
                : 'border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20'
            }`}
            onClick={stopAndExport}
            disabled={isExporting}
          >
            <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
            <span>REC</span>
            <span className="tabular-nums min-w-[24px] text-right">{status.eventCount}</span>
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            onClick={startRecording}
          >
            <span className="w-2 h-2 rounded-full bg-current" />
            <span>Capture</span>
          </button>
        )}

        {error && <span className="text-[10px] font-mono text-red-500">{error}</span>}
      </div>

      {lastExport && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 bg-card border border-green-500/30 rounded-xl shadow-lg z-[1000] animate-in slide-in-from-bottom-4">
          <div>
            <div className="text-sm font-medium text-green-600 dark:text-green-400">
              Captured: {lastExport.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {lastExport.events.length} events — copied to clipboard
            </div>
          </div>
          <button
            type="button"
            className="px-2 py-1 border border-green-500/30 rounded text-xs font-mono text-green-600 dark:text-green-400 hover:bg-green-500/10 transition-colors"
            onClick={downloadJson}
          >
            Download
          </button>
          <button
            type="button"
            className="px-1.5 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setLastExport(null)}
          >
            &times;
          </button>
        </div>
      )}
    </>
  );
}
