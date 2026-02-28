import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  benchmarkLocalTts,
  downloadLocalModel,
  fetchLocalModelCatalog,
  fetchLocalModelState,
  loadLocalModel,
  synthesizeLocalTtsSample,
  type LocalModelCatalogEntry,
  type LocalModelCatalogResponse,
  type LocalTtsBenchmarkResponse,
} from '../../lib/local-inference-api';
import { SettingsSection, SettingsField } from './SettingsSection';

const DEFAULT_TEST_TEXT =
  'Hello, this is a local text to speech benchmark for interval and quantization tuning.';

function formatModelSize(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'n/a';
  return `${value.toFixed(2)} GB`;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

async function playPcm16Mono(pcm: ArrayBuffer, sampleRate: number): Promise<void> {
  if (!pcm.byteLength) return;
  const context = new AudioContext({ sampleRate });
  if (context.state === 'suspended') {
    await context.resume();
  }

  const pcm16 = new Int16Array(pcm);
  const samples = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i += 1) {
    samples[i] = pcm16[i]! / 32768;
  }

  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);

  await new Promise<void>((resolve) => {
    source.onended = () => resolve();
    source.start(0);
  });

  await context.close();
}

interface ModelCardProps {
  entry: LocalModelCatalogEntry;
  actionBusy: string | null;
  onDownload: (entry: LocalModelCatalogEntry) => Promise<void>;
  onLoad: (entry: LocalModelCatalogEntry) => Promise<void>;
}

function ModelCard({ entry, actionBusy, onDownload, onLoad }: ModelCardProps) {
  const actionId = `${entry.kind}:${entry.canonical_model_id}`;
  const isBusy = actionBusy === actionId;
  const canLoad = entry.installed;

  return (
    <div className={`models-card ${entry.loaded ? 'loaded' : ''}`}>
      <div className="models-card-header">
        <div className="models-card-title">{entry.label}</div>
        <div className={`models-badge ${entry.loaded ? 'loaded' : entry.installed ? 'installed' : 'missing'}`}>
          {entry.loaded ? 'loaded' : entry.installed ? 'installed' : 'missing'}
        </div>
      </div>

      <div className="models-card-meta">
        <span>{entry.family}</span>
        <span>{entry.quantization}</span>
        <span>{formatModelSize(entry.estimated_size_gb)}</span>
      </div>

      <div className="models-card-id">{entry.model_id}</div>
      {entry.aliases && entry.aliases.length > 0 && (
        <div className="models-card-aliases">aliases: {entry.aliases.join(', ')}</div>
      )}
      {entry.notes && <div className="models-card-notes">{entry.notes}</div>}

      <div className="models-card-actions">
        {!entry.installed ? (
          <button
            type="button"
            className="models-btn models-btn-primary"
            disabled={isBusy}
            onClick={() => void onDownload(entry)}
          >
            {isBusy ? 'Downloading...' : 'Download'}
          </button>
        ) : (
          <button
            type="button"
            className="models-btn models-btn-secondary"
            disabled={isBusy}
            onClick={() => void onLoad(entry)}
          >
            {isBusy ? 'Loading...' : 'Load'}
          </button>
        )}
        <button
          type="button"
          className="models-btn models-btn-ghost"
          disabled={isBusy || !canLoad}
          onClick={() => void onDownload(entry)}
          title="Re-download / update cache"
        >
          Update
        </button>
      </div>
    </div>
  );
}

export function SettingsModels() {
  const [catalog, setCatalog] = useState<LocalModelCatalogResponse | null>(null);
  const [stateLoading, setStateLoading] = useState(true);
  const [stateError, setStateError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [selectedTtsModel, setSelectedTtsModel] = useState('');
  const [playgroundText, setPlaygroundText] = useState(DEFAULT_TEST_TEXT);
  const [playgroundVoice, setPlaygroundVoice] = useState('af_heart');
  const [playgroundLanguage, setPlaygroundLanguage] = useState('German');
  const [playgroundStream, setPlaygroundStream] = useState(true);
  const [playgroundInterval, setPlaygroundInterval] = useState(1.0);
  const [benchmarkRuns, setBenchmarkRuns] = useState(1);

  const [benchmarking, setBenchmarking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<LocalTtsBenchmarkResponse | null>(null);
  const latestBenchmarkModelRef = useRef<string>('');

  const ttsModels = catalog?.tts ?? [];
  const sttModels = catalog?.stt ?? [];
  const selectedTtsEntry = useMemo(
    () => ttsModels.find((model) => model.canonical_model_id === selectedTtsModel) ?? null,
    [ttsModels, selectedTtsModel]
  );

  const refreshCatalog = useCallback(async () => {
    setStateLoading(true);
    setStateError(null);
    try {
      const [nextCatalog] = await Promise.all([fetchLocalModelCatalog(), fetchLocalModelState()]);
      setCatalog(nextCatalog);
      setSelectedTtsModel((current) => {
        if (current && nextCatalog.tts.some((model) => model.canonical_model_id === current)) {
          return current;
        }
        return (
          nextCatalog.loaded.tts ??
          nextCatalog.tts.find((model) => model.loaded)?.canonical_model_id ??
          nextCatalog.tts[0]?.canonical_model_id ??
          ''
        );
      });
    } catch (error) {
      setStateError((error as Error).message);
    } finally {
      setStateLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const runModelAction = useCallback(
    async (entry: LocalModelCatalogEntry, mode: 'download' | 'load') => {
      setPlaygroundError(null);
      const actionId = `${entry.kind}:${entry.canonical_model_id}`;
      setActionBusy(actionId);
      try {
        if (mode === 'download') {
          await downloadLocalModel({
            kind: entry.kind,
            model: entry.canonical_model_id,
            preload: false,
          });
        } else {
          await loadLocalModel({
            kind: entry.kind,
            model: entry.canonical_model_id,
            warmup: true,
          });
        }
        await refreshCatalog();
      } catch (error) {
        setPlaygroundError((error as Error).message);
      } finally {
        setActionBusy(null);
      }
    },
    [refreshCatalog]
  );

  const runBenchmark = useCallback(async () => {
    if (!selectedTtsModel) return;
    setBenchmarking(true);
    setPlaygroundError(null);
    try {
      const result = await benchmarkLocalTts({
        model: selectedTtsModel,
        text: playgroundText.trim() || DEFAULT_TEST_TEXT,
        voice: playgroundVoice.trim() || undefined,
        language: playgroundLanguage.trim() || undefined,
        stream: playgroundStream,
        streaming_interval: playgroundInterval,
        runs: benchmarkRuns,
      });
      latestBenchmarkModelRef.current = result.canonical_model_id;
      setBenchmarkResult(result);
      await refreshCatalog();
    } catch (error) {
      setPlaygroundError((error as Error).message);
    } finally {
      setBenchmarking(false);
    }
  }, [
    selectedTtsModel,
    playgroundText,
    playgroundVoice,
    playgroundLanguage,
    playgroundStream,
    playgroundInterval,
    benchmarkRuns,
    refreshCatalog,
  ]);

  const playTestSentence = useCallback(async () => {
    if (!selectedTtsModel) return;
    setPlaying(true);
    setPlaygroundError(null);
    try {
      const { pcm, sampleRate } = await synthesizeLocalTtsSample({
        model: selectedTtsModel,
        input: playgroundText.trim() || DEFAULT_TEST_TEXT,
        voice: playgroundVoice.trim() || undefined,
        language: playgroundLanguage.trim() || undefined,
        stream: playgroundStream,
        streaming_interval: playgroundInterval,
      });
      await playPcm16Mono(pcm, sampleRate);
      await refreshCatalog();
    } catch (error) {
      setPlaygroundError((error as Error).message);
    } finally {
      setPlaying(false);
    }
  }, [
    selectedTtsModel,
    playgroundText,
    playgroundVoice,
    playgroundLanguage,
    playgroundStream,
    playgroundInterval,
    refreshCatalog,
  ]);

  if (stateLoading) {
    return <div className="settings-loading">Loading local model control plane...</div>;
  }

  if (stateError) {
    return (
      <SettingsSection title="Model Control Error" columns={1}>
        <div style={{ color: 'var(--color-rose)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {stateError}
        </div>
      </SettingsSection>
    );
  }

  return (
    <>
      <style>{`
        .models-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 12px;
        }

        .models-card {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--card);
          padding: 14px 14px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .models-card.loaded {
          border-color: var(--color-green-muted);
          background: color-mix(in oklch, var(--color-green) 6%, var(--card));
        }

        .models-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .models-card-title {
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 600;
          color: var(--foreground);
        }

        .models-badge {
          font-family: var(--font-mono);
          font-size: 10px;
          border-radius: 999px;
          padding: 2px 8px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border: 1px solid transparent;
        }

        .models-badge.loaded {
          color: var(--color-green);
          border-color: var(--color-green-muted);
        }

        .models-badge.installed {
          color: var(--color-blue);
          border-color: var(--color-blue-muted);
        }

        .models-badge.missing {
          color: var(--muted-foreground);
          border-color: var(--border);
        }

        .models-card-meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted-foreground);
          text-transform: uppercase;
        }

        .models-card-id {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted-foreground);
          word-break: break-all;
        }

        .models-card-aliases,
        .models-card-notes {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted-foreground);
          line-height: 1.5;
        }

        .models-card-actions {
          display: flex;
          gap: 8px;
          margin-top: 2px;
        }

        .models-btn {
          border: 1px solid var(--border);
          background: var(--secondary);
          color: var(--foreground);
          border-radius: 6px;
          padding: 6px 10px;
          font-family: var(--font-sans);
          font-size: 11px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .models-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .models-btn-primary {
          border-color: var(--color-blue-muted);
          color: var(--color-blue);
        }

        .models-btn-primary:hover:not(:disabled) {
          background: color-mix(in oklch, var(--color-blue) 10%, var(--secondary));
        }

        .models-btn-secondary {
          border-color: var(--color-green-muted);
          color: var(--color-green);
        }

        .models-btn-secondary:hover:not(:disabled) {
          background: color-mix(in oklch, var(--color-green) 10%, var(--secondary));
        }

        .models-btn-ghost:hover:not(:disabled) {
          background: var(--accent);
        }

        .models-playground-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .models-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px;
          margin-top: 10px;
        }

        .models-metric {
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px;
          background: var(--secondary);
        }

        .models-metric-label {
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground);
          margin-bottom: 4px;
        }

        .models-metric-value {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 600;
          color: var(--foreground);
        }

        .models-guidance {
          margin-top: 10px;
          border: 1px solid var(--color-blue-muted);
          border-radius: 8px;
          padding: 10px 12px;
          background: color-mix(in oklch, var(--color-blue) 5%, var(--card));
        }

        .models-guidance-summary {
          font-family: var(--font-sans);
          font-size: 11px;
          color: var(--foreground);
          margin-bottom: 6px;
        }

        .models-guidance-list {
          margin: 0;
          padding-left: 16px;
          color: var(--muted-foreground);
          font-family: var(--font-sans);
          font-size: 11px;
          line-height: 1.6;
        }

        .models-error {
          margin-top: 10px;
          color: var(--color-red);
          font-family: var(--font-sans);
          font-size: 12px;
        }
      `}</style>

      <SettingsSection
        title="Local STT Models"
        description="Download and load local speech-to-text models without restarting the runtime."
        columns={1}
      >
        <div className="models-grid">
          {sttModels.map((entry) => (
            <ModelCard
              key={entry.canonical_model_id}
              entry={entry}
              actionBusy={actionBusy}
              onDownload={(item) => runModelAction(item, 'download')}
              onLoad={(item) => runModelAction(item, 'load')}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Local TTS Models"
        description="Control quantization variants and keep only models you actually want resident."
        columns={1}
      >
        <div className="models-grid">
          {ttsModels.map((entry) => (
            <ModelCard
              key={entry.canonical_model_id}
              entry={entry}
              actionBusy={actionBusy}
              onDownload={(item) => runModelAction(item, 'download')}
              onLoad={(item) => runModelAction(item, 'load')}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="TTS Playground"
        description="Stream a test sentence, benchmark TTFB/RTF, and tune streaming interval and quant model."
        columns={2}
      >
        <SettingsField label="Model">
          <select
            value={selectedTtsModel}
            onChange={(e) => setSelectedTtsModel(e.target.value)}
          >
            {ttsModels.map((model) => (
              <option key={model.canonical_model_id} value={model.canonical_model_id}>
                {model.label} {model.loaded ? '(loaded)' : model.installed ? '(installed)' : '(missing)'}
              </option>
            ))}
          </select>
        </SettingsField>

        <SettingsField label="Voice" hint="Kokoro voice id or VoiceDesign prompt anchor.">
          <input
            type="text"
            value={playgroundVoice}
            onChange={(e) => setPlaygroundVoice(e.target.value)}
            placeholder={selectedTtsEntry?.default_voice ?? 'af_heart'}
          />
        </SettingsField>

        <SettingsField label="Language">
          <input
            type="text"
            value={playgroundLanguage}
            onChange={(e) => setPlaygroundLanguage(e.target.value)}
            placeholder="German"
          />
        </SettingsField>

        <SettingsField label="Benchmark Runs" hint="More runs smooths variance.">
          <input
            type="number"
            min={1}
            max={5}
            value={benchmarkRuns}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              setBenchmarkRuns(Number.isFinite(next) ? Math.max(1, Math.min(5, next)) : 1);
            }}
          />
        </SettingsField>

        <SettingsField label="Stream TTS">
          <select
            value={playgroundStream ? 'true' : 'false'}
            onChange={(e) => setPlaygroundStream(e.target.value === 'true')}
          >
            <option value="true">enabled</option>
            <option value="false">disabled</option>
          </select>
        </SettingsField>

        <SettingsField label="Streaming Interval (s)">
          <input
            type="number"
            min={0.2}
            max={4}
            step={0.1}
            value={playgroundInterval}
            onChange={(e) => {
              const next = Number.parseFloat(e.target.value);
              setPlaygroundInterval(Number.isFinite(next) ? Math.max(0.2, Math.min(4, next)) : 1.0);
            }}
          />
        </SettingsField>

        <SettingsField label="Test Sentence" fullWidth>
          <textarea
            value={playgroundText}
            onChange={(e) => setPlaygroundText(e.target.value)}
            placeholder={DEFAULT_TEST_TEXT}
          />
        </SettingsField>

        <div className="models-playground-actions">
          <button
            type="button"
            className="models-btn models-btn-secondary"
            disabled={benchmarking || !selectedTtsModel}
            onClick={() => void runBenchmark()}
          >
            {benchmarking ? 'Benchmarking...' : 'Run Benchmark'}
          </button>

          <button
            type="button"
            className="models-btn models-btn-primary"
            disabled={playing || !selectedTtsModel}
            onClick={() => void playTestSentence()}
          >
            {playing ? 'Playing...' : 'Play Test Sentence'}
          </button>
        </div>

        {playgroundError && <div className="models-error">{playgroundError}</div>}

        {benchmarkResult && (
          <>
            <div className="models-metrics-grid">
              <div className="models-metric">
                <div className="models-metric-label">Model</div>
                <div className="models-metric-value">
                  {benchmarkResult.canonical_model_id === latestBenchmarkModelRef.current ? 'current' : 'stale'}
                </div>
              </div>
              <div className="models-metric">
                <div className="models-metric-label">TTFB</div>
                <div className="models-metric-value">{formatNumber(benchmarkResult.aggregate.ttfb_ms)} ms</div>
              </div>
              <div className="models-metric">
                <div className="models-metric-label">Total Synth</div>
                <div className="models-metric-value">{formatNumber(benchmarkResult.aggregate.total_ms)} ms</div>
              </div>
              <div className="models-metric">
                <div className="models-metric-label">Audio Length</div>
                <div className="models-metric-value">{formatNumber(benchmarkResult.aggregate.audio_ms)} ms</div>
              </div>
              <div className="models-metric">
                <div className="models-metric-label">RTF</div>
                <div className="models-metric-value">{formatNumber(benchmarkResult.aggregate.rtf, 3)}</div>
              </div>
              <div className="models-metric">
                <div className="models-metric-label">Stream Interval</div>
                <div className="models-metric-value">
                  {benchmarkResult.streaming.interval != null
                    ? `${formatNumber(benchmarkResult.streaming.interval)} s`
                    : 'n/a'}
                </div>
              </div>
            </div>

            <div className="models-guidance">
              <div className="models-guidance-summary">{benchmarkResult.guidance.summary}</div>
              <ul className="models-guidance-list">
                {benchmarkResult.guidance.recommended_streaming_interval != null && (
                  <li>
                    Recommended interval: {benchmarkResult.guidance.recommended_streaming_interval.toFixed(2)} s
                  </li>
                )}
                {benchmarkResult.guidance.recommended_quant_model && (
                  <li>Recommended quant/model: {benchmarkResult.guidance.recommended_quant_model}</li>
                )}
                {benchmarkResult.guidance.tips.map((tip, index) => (
                  <li key={`${tip}-${index}`}>{tip}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </SettingsSection>
    </>
  );
}
