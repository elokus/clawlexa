import { useState, useRef, useEffect } from 'react';
import { useVoiceState, useUnifiedSessionsStore } from '../../stores';
import { useConfigStore } from '../../stores/config-store';
import { useAudioAnalysis } from '../../hooks/useAudioAnalysis';
import { Ferrofluid, type OrbStyle } from '../3d/Ferrofluid';

const stateLabels: Record<string, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Processing',
  speaking: 'Speaking',
};

const STYLE_OPTIONS: { value: OrbStyle; label: string }[] = [
  { value: 'matte', label: 'Matte' },
  { value: 'frosted', label: 'Frosted Glass' },
  { value: 'wireframe', label: 'Wireframe' },
  { value: 'ferrofluid', label: 'Metallic' },
];

const STORAGE_KEY = 'voiceclaw:orb-style';

function loadStyle(): OrbStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && STYLE_OPTIONS.some((o) => o.value === stored)) return stored as OrbStyle;
  } catch { /* noop */ }
  return 'matte';
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Strip provider/org prefix and size/quant suffixes for compact display */
function shortModel(full: string): string {
  const name = full.split('/').pop() || full;
  if (name.length <= 18) return name;
  // Trim quantisation / size suffixes: "-12Hz-0.6B-Base-4bit" etc.
  const m = name.match(/^([A-Za-z0-9]+-[A-Za-z0-9]+)/);
  return m ? m[1] : name.slice(0, 18);
}

const TOOLTIP_CLS =
  'absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-md border border-border bg-popover shadow-lg text-[9px] font-mono leading-relaxed opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50';

// ─── Model Info with hover tooltip ───────────────────────────────

const DEFAULT_PROFILE = 'jarvis';

function ModelInfo({ voiceProfile }: { voiceProfile: string | null }) {
  const profile = voiceProfile || DEFAULT_PROFILE;
  const effectiveConfig = useConfigStore(
    (s) => s.effectiveConfigs[profile] ?? null,
  );
  const loadEffectiveConfig = useConfigStore((s) => s.loadEffectiveConfig);

  // Stable scalar selector for TTS voice — avoids new-object-per-render loop
  const ttsVoice = useConfigStore((s) => {
    const cfg = s.config;
    if (!cfg) return '';
    const key = profile.toLowerCase();
    const override = cfg.voice.profileOverrides[key];
    const d = override?.decomposed;
    return d?.tts?.voiceRef ?? d?.tts?.voice
      ?? cfg.voice.decomposed.tts.voiceRef ?? cfg.voice.decomposed.tts.voice
      ?? '';
  });

  // Load effective config once per profile (not on every render)
  const needsLoad = useRef(profile);
  useEffect(() => {
    if (needsLoad.current !== profile || !effectiveConfig) {
      needsLoad.current = profile;
      loadEffectiveConfig(profile);
    }
  }, [profile, effectiveConfig, loadEffectiveConfig]);

  // Load full config once for TTS voice info
  const loadConfig = useConfigStore((s) => s.loadConfig);
  const configLoaded = useRef(false);
  useEffect(() => {
    if (!configLoaded.current) {
      configLoaded.current = true;
      loadConfig();
    }
  }, [loadConfig]);

  if (!effectiveConfig) {
    return <span className="text-muted-foreground/25">...</span>;
  }

  const { mode, model, voice, decomposed } = effectiveConfig;

  // ── Decomposed: ASR · LLM · TTS ──
  if (mode === 'decomposed') {
    return (
      <span className="inline-flex items-center gap-1">
        <span>ASR · LLM · TTS</span>
        <span className="relative group/tip">
          <InfoIcon />
          <div className={TOOLTIP_CLS}>
            <Row label="ASR" value={decomposed.stt} />
            <Row label="LLM" value={decomposed.llm} />
            <Row label="TTS" value={decomposed.tts} />
            {(ttsVoice || voice) && <Sep />}
            {ttsVoice && <Row label="Voice" value={ttsVoice} />}
            {voice && !ttsVoice && <Row label="Voice" value={voice} />}
          </div>
        </span>
      </span>
    );
  }

  // ── Realtime-text-tts: realtime model + external TTS ──
  if (mode === 'realtime-text-tts') {
    const ttsShort = shortModel(decomposed.tts);
    return (
      <span className="inline-flex items-center gap-1">
        <span>{model} · {ttsShort}</span>
        <span className="relative group/tip">
          <InfoIcon />
          <div className={TOOLTIP_CLS}>
            <Row label="Realtime" value={model} />
            <Row label="TTS" value={decomposed.tts} />
            {(ttsVoice || voice) && <Sep />}
            {voice && <Row label="Voice" value={voice} />}
            {ttsVoice && <Row label="TTS Voice" value={ttsVoice} />}
          </div>
        </span>
      </span>
    );
  }

  // ── Voice-to-voice: single model ──
  return (
    <span className="inline-flex items-center gap-1">
      <span>{model}</span>
      {voice && (
        <span className="relative group/tip">
          <InfoIcon />
          <div className={TOOLTIP_CLS}>
            <Row label="Voice" value={voice} />
          </div>
        </span>
      )}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground/50 mr-1.5">{label}</span>
      <span className="text-foreground/70">{value}</span>
    </div>
  );
}

function Sep() {
  return <div className="my-0.5 border-t border-border/40" />;
}

function InfoIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors cursor-help"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function VoiceOrbCard() {
  const { voiceState, voiceProfile } = useVoiceState();
  const sessionName = useUnifiedSessionsStore((s) => s.sessionTree?.name);
  const { micBands, speakerBands } = useAudioAnalysis();

  const [orbStyle, setOrbStyle] = useState<OrbStyle>(loadStyle);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleStyleChange = (style: OrbStyle) => {
    setOrbStyle(style);
    try { localStorage.setItem(STORAGE_KEY, style); } catch { /* noop */ }
    setMenuOpen(false);
  };

  const profileName = voiceProfile || 'Voice Agent';
  const displayName = profileName.charAt(0).toUpperCase() + profileName.slice(1);

  return (
    <div className="voice-orb-card relative">
      <div className="flex justify-center py-2">
        <Ferrofluid
          state={voiceState}
          micBands={micBands}
          speakerBands={speakerBands}
          style={orbStyle}
        />
      </div>
      <div className="px-3 pb-3 text-center">
        <div className="text-[11px] font-medium text-foreground/70">
          {displayName}
          <span className="text-muted-foreground/40 font-normal"> · </span>
          <span className="text-muted-foreground/50 font-normal">{stateLabels[voiceState]}</span>
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">
          <ModelInfo voiceProfile={voiceProfile} />
          {sessionName && <span className="text-muted-foreground/25"> · {sessionName}</span>}
        </div>
      </div>

      {/* Style selector */}
      <div ref={menuRef} className="absolute bottom-2 right-2">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1 rounded-md text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-muted/50 transition-colors"
          title="Change visualization style"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute bottom-full right-0 mb-1 py-1 min-w-[130px] rounded-lg border border-border bg-popover shadow-lg z-50">
            {STYLE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => handleStyleChange(value)}
                className={`w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent transition-colors flex items-center gap-2 ${
                  orbStyle === value ? 'text-foreground font-medium' : 'text-muted-foreground'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    orbStyle === value ? 'bg-primary' : 'bg-transparent'
                  }`}
                />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
