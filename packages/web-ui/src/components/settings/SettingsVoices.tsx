import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchVoices,
  deleteVoiceApi,
  designVoice,
  voiceAudioUrl,
  type VoiceMeta,
} from '../../lib/voice-config-api';
import { SettingsSection, SettingsField } from './SettingsSection';

// ─── Voice Card ─────────────────────────────────────────────────────────────

interface VoiceCardProps {
  voice: VoiceMeta;
  isActive: boolean;
  onActivate: (label: string) => void;
  onDelete: (label: string) => void;
  deleting: string | null;
}

function VoiceCard({ voice, isActive, onActivate, onDelete, deleting }: VoiceCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = useCallback(() => {
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
      return;
    }
    const audio = new Audio(voiceAudioUrl(voice.label));
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audio.play();
    setPlaying(true);
  }, [playing, voice.label]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const isDeleting = deleting === voice.label;

  return (
    <div className={`voice-card ${isActive ? 'active' : ''}`}>
      <div className="voice-card-header">
        <div className="voice-card-label">{voice.label}</div>
        <div className="voice-card-badges">
          <span className="voice-badge lang">{voice.language}</span>
          {isActive && <span className="voice-badge active-badge">active</span>}
        </div>
      </div>

      {voice.instruct && (
        <div className="voice-card-instruct">{voice.instruct}</div>
      )}

      <div className="voice-card-meta">
        <span>ref: {voice.refText.length > 60 ? voice.refText.slice(0, 60) + '...' : voice.refText}</span>
      </div>

      <div className="voice-card-actions">
        <button
          type="button"
          className="voice-btn play"
          onClick={togglePlay}
          title={playing ? 'Stop' : 'Play reference'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {playing ? (
              <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
            ) : (
              <polygon points="5 3 19 12 5 21 5 3" />
            )}
          </svg>
        </button>
        {!isActive && (
          <button
            type="button"
            className="voice-btn activate"
            onClick={() => onActivate(voice.label)}
          >
            Set Active
          </button>
        )}
        <button
          type="button"
          className="voice-btn delete"
          onClick={() => onDelete(voice.label)}
          disabled={isDeleting}
        >
          {isDeleting ? '...' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

// ─── Voice Design Form ──────────────────────────────────────────────────────

interface DesignFormState {
  label: string;
  instruct: string;
  text: string;
  language: string;
  seed: string;
}

const INITIAL_DESIGN_FORM: DesignFormState = {
  label: '',
  instruct: '',
  text: '',
  language: 'German',
  seed: '42',
};

// ─── Main Component ─────────────────────────────────────────────────────────

export function SettingsVoices() {
  const [voices, setVoices] = useState<VoiceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Design form
  const [form, setForm] = useState<DesignFormState>(INITIAL_DESIGN_FORM);
  const [designing, setDesigning] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);

  const loadVoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchVoices();
      setVoices(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  const handleDelete = useCallback(
    async (label: string) => {
      setDeleting(label);
      try {
        await deleteVoiceApi(label);
        await loadVoices();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDeleting(null);
      }
    },
    [loadVoices]
  );

  const handleDesign = useCallback(async () => {
    if (!form.label.trim() || !form.instruct.trim() || !form.text.trim()) {
      setDesignError('Label, instruct description, and reference text are required.');
      return;
    }
    setDesigning(true);
    setDesignError(null);
    try {
      await designVoice({
        label: form.label.trim(),
        instruct: form.instruct.trim(),
        text: form.text.trim(),
        language: form.language || 'German',
        seed: parseInt(form.seed, 10) || 42,
      });
      setForm(INITIAL_DESIGN_FORM);
      await loadVoices();
    } catch (err) {
      setDesignError((err as Error).message);
    } finally {
      setDesigning(false);
    }
  }, [form, loadVoices]);

  const updateField = (key: keyof DesignFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="settings-voices">
      <style>{`
        .settings-voices {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* ─── Voice Cards ─── */

        .voice-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        }

        .voice-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: border-color 0.15s ease;
        }

        .voice-card.active {
          border-color: color-mix(in oklch, var(--color-cyan) 40%, var(--border));
        }

        .voice-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .voice-card-label {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 600;
          color: var(--foreground);
        }

        .voice-card-badges {
          display: flex;
          gap: 4px;
        }

        .voice-badge {
          padding: 1px 7px;
          border-radius: 4px;
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .voice-badge.lang {
          background: color-mix(in oklch, var(--color-violet) 15%, transparent);
          color: var(--color-violet);
        }

        .voice-badge.active-badge {
          background: color-mix(in oklch, var(--color-cyan) 15%, transparent);
          color: var(--color-cyan);
        }

        .voice-card-instruct {
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--muted-foreground);
          font-style: italic;
          line-height: 1.4;
        }

        .voice-card-meta {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted-foreground);
          line-height: 1.4;
        }

        .voice-card-actions {
          display: flex;
          gap: 6px;
          margin-top: 4px;
        }

        .voice-btn {
          padding: 4px 10px;
          border-radius: 5px;
          font-family: var(--font-sans);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--border);
          background: var(--input);
          color: var(--foreground);
          transition: all 0.12s ease;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .voice-btn:hover {
          background: var(--accent);
        }

        .voice-btn.play {
          padding: 4px 8px;
        }

        .voice-btn.activate {
          color: var(--color-cyan);
          border-color: color-mix(in oklch, var(--color-cyan) 30%, var(--border));
        }

        .voice-btn.activate:hover {
          background: color-mix(in oklch, var(--color-cyan) 10%, var(--input));
        }

        .voice-btn.delete {
          color: var(--color-rose);
          border-color: color-mix(in oklch, var(--color-rose) 20%, var(--border));
        }

        .voice-btn.delete:hover {
          background: color-mix(in oklch, var(--color-rose) 10%, var(--input));
        }

        .voice-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ─── Design form ─── */

        .design-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 4px;
        }

        .design-btn {
          padding: 8px 18px;
          border-radius: 6px;
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          background: var(--color-cyan);
          color: var(--color-void);
          transition: opacity 0.15s ease;
        }

        .design-btn:hover {
          opacity: 0.85;
        }

        .design-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .design-error {
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--color-rose);
        }

        .design-progress {
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--color-amber);
        }

        /* ─── Empty / Loading ─── */

        .voice-empty {
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--muted-foreground);
          text-align: center;
          padding: 32px 0;
        }

        .voice-error {
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--color-rose);
          padding: 8px 0;
        }
      `}</style>

      {/* Voice Library */}
      <SettingsSection
        title="Voice Library"
        description="Saved voice clone references. Assign voices to agents in Settings > Agents."
      >
        <div className="voice-grid" style={{ gridColumn: '1 / -1' }}>
          {loading ? (
            <div className="voice-empty">Loading voices...</div>
          ) : error ? (
            <div className="voice-error">{error}</div>
          ) : voices.length === 0 ? (
            <div className="voice-empty">No voices yet. Use Voice Design below to create one.</div>
          ) : (
            voices.map((v) => (
              <VoiceCard
                key={v.label}
                voice={v}
                isActive={false}
                onActivate={() => {}}
                onDelete={handleDelete}
                deleting={deleting}
              />
            ))
          )}
        </div>
      </SettingsSection>

      {/* Voice Design */}
      <SettingsSection
        title="Voice Design"
        description="Generate a new voice from a natural language description using the VoiceDesign model."
        columns={2}
      >
        <SettingsField label="Label" hint="Unique name for this voice (e.g. cheerful-aria)">
          <input
            type="text"
            value={form.label}
            onChange={(e) => updateField('label', e.target.value)}
            placeholder="cheerful-aria"
          />
        </SettingsField>

        <SettingsField label="Language">
          <select
            value={form.language}
            onChange={(e) => updateField('language', e.target.value)}
          >
            <option value="German">German</option>
            <option value="English">English</option>
            <option value="French">French</option>
            <option value="Spanish">Spanish</option>
            <option value="Chinese">Chinese</option>
            <option value="Japanese">Japanese</option>
            <option value="Korean">Korean</option>
          </select>
        </SettingsField>

        <SettingsField
          label="Voice Description"
          hint="Describe the voice you want to create."
          fullWidth
        >
          <textarea
            value={form.instruct}
            onChange={(e) => updateField('instruct', e.target.value)}
            placeholder="A cheerful and energetic female voice with a warm, friendly tone..."
            rows={3}
          />
        </SettingsField>

        <SettingsField
          label="Reference Text"
          hint="Text to speak with the generated voice (used as clone reference)."
          fullWidth
        >
          <textarea
            value={form.text}
            onChange={(e) => updateField('text', e.target.value)}
            placeholder="Hallo, ich bin dein neuer Sprachassistent..."
            rows={2}
          />
        </SettingsField>

        <SettingsField label="Seed" hint="Random seed for reproducible voice generation.">
          <input
            type="number"
            value={form.seed}
            onChange={(e) => updateField('seed', e.target.value)}
          />
        </SettingsField>

        <div className="settings-field" style={{ justifyContent: 'flex-end' }}>
          <div className="design-actions">
            <button
              type="button"
              className="design-btn"
              onClick={handleDesign}
              disabled={designing}
            >
              {designing ? 'Generating...' : 'Generate Voice'}
            </button>
            {designing && (
              <span className="design-progress">This may take 10-30 seconds...</span>
            )}
            {designError && <span className="design-error">{designError}</span>}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
