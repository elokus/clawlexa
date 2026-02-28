// ═══════════════════════════════════════════════════════════════════════════
// Settings: System - Word timestamps, profile resolution, debug info
// ═══════════════════════════════════════════════════════════════════════════

import { useConfigStore } from '../../stores/config-store';
import { SettingsSection, SettingsField } from './SettingsSection';

function parseNumeric(value: string, fallback: number, min?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (typeof min === 'number') return Math.max(min, parsed);
  return parsed;
}

export function SettingsSystem() {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const effectiveConfigs = useConfigStore((s) => s.effectiveConfigs);

  if (!config) return null;

  const updateTurn = (patch: Partial<typeof config.voice.turn>) => {
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        turn: { ...config.voice.turn, ...patch },
      },
    });
  };

  return (
    <>
      {/* Synthetic Word Timestamps */}
      <SettingsSection
        title="Synthetic Word Timestamps"
        description="Controls timing for synthetic word timestamps when the TTS provider does not supply word-level timing."
        columns={2}
      >
        <SettingsField
          label="Prefer provider timestamps"
          hint="Use word timestamps from the TTS provider when available."
          fullWidth
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.voice.turn.preferProviderTimestamps ?? true}
              onChange={(e) => updateTurn({ preferProviderTimestamps: e.target.checked })}
              style={{ accentColor: 'var(--color-cyan)' }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-normal)' }}>
              When off, always uses synthetic timestamps.
            </span>
          </label>
        </SettingsField>

        <SettingsField label="Speed (ms/word)" hint="Milliseconds per word for synthetic highlighting.">
          <input
            type="number"
            value={config.voice.turn.spokenHighlightMsPerWord}
            onChange={(e) =>
              updateTurn({
                spokenHighlightMsPerWord: parseNumeric(e.target.value, config.voice.turn.spokenHighlightMsPerWord, 1),
              })
            }
          />
        </SettingsField>

        <SettingsField label="Punctuation Pause (ms)" hint="Additional pause at punctuation marks.">
          <input
            type="number"
            value={config.voice.turn.spokenHighlightPunctuationPauseMs}
            onChange={(e) =>
              updateTurn({
                spokenHighlightPunctuationPauseMs: parseNumeric(
                  e.target.value,
                  config.voice.turn.spokenHighlightPunctuationPauseMs,
                  0
                ),
              })
            }
          />
        </SettingsField>
      </SettingsSection>

      {/* Profile Resolution */}
      <SettingsSection
        title="Profile Resolution"
        description="Shows the effective runtime configuration per wake-word profile after applying all overrides."
        columns={1}
      >
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--color-text-normal)',
          lineHeight: 1.8,
          whiteSpace: 'pre-wrap',
        }}>
          {Object.entries(effectiveConfigs).map(([profile, eff]) => (
            <div key={profile} style={{ marginBottom: 6 }}>
              <span style={{ color: 'var(--color-text-bright)', fontWeight: 600, textTransform: 'capitalize' }}>
                {profile}:
              </span>{' '}
              {eff.mode} | {eff.provider} | voice={eff.voice} | model={eff.model}
            </div>
          ))}
          {Object.keys(effectiveConfigs).length === 0 && 'Loading...'}
        </div>
      </SettingsSection>

      {/* Config Info */}
      <SettingsSection
        title="Configuration Files"
        description="Location of configuration files on disk."
        columns={1}
      >
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--color-text-dim)',
          lineHeight: 1.8,
        }}>
          <div>Voice config: .voiceclaw/voice.config.json</div>
          <div>Auth profiles: .voiceclaw/auth-profiles.json</div>
          <div>
            Profile overrides:{' '}
            {Object.keys(config.voice.profileOverrides).length > 0
              ? Object.entries(config.voice.profileOverrides)
                  .map(([name, o]) => {
                    const parts = [o.mode, o.provider, o.voice].filter(Boolean);
                    return parts.length ? `${name}: ${parts.join(' / ')}` : null;
                  })
                  .filter(Boolean)
                  .join(' | ')
              : 'none'}
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
