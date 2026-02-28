// ═══════════════════════════════════════════════════════════════════════════
// Settings: Audio & VAD - Turn detection, voice activity detection
// Ported from VoiceRuntimePanel.tsx lines 806-998
// ═══════════════════════════════════════════════════════════════════════════

import { useConfigStore } from '../../stores/config-store';
import { SettingsSection, SettingsField, AdvancedToggle } from './SettingsSection';
import { ProviderSettingsSection } from '../voice-config/ProviderSettingsSection';
import type { ProviderConfigSchema, VoiceConfigDocument } from '../../lib/voice-config-api';

function parseNumeric(value: string, fallback: number, min?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (typeof min === 'number') return Math.max(min, parsed);
  return parsed;
}

export function SettingsAudio() {
  const config = useConfigStore((s) => s.config);
  const catalog = useConfigStore((s) => s.catalog);
  const setConfig = useConfigStore((s) => s.setConfig);
  const advancedVisible = useConfigStore((s) => s.advancedVisible.audio);
  const toggleAdvanced = useConfigStore((s) => s.toggleAdvanced);

  if (!config) return null;

  const isDecomposed = config.voice.mode === 'decomposed';
  const activeProviderKey = isDecomposed
    ? 'decomposed'
    : config.voice.voiceToVoice.provider;
  const providerSettings = config.voice.providerSettings?.[activeProviderKey] ?? {};
  const activeSchema = catalog?.providerSchemas?.[activeProviderKey] as ProviderConfigSchema | undefined;

  const updateTurn = (patch: Partial<VoiceConfigDocument['voice']['turn']>) => {
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        turn: { ...config.voice.turn, ...patch },
      },
    });
  };

  const updateProviderSetting = (key: string, value: unknown) => {
    const currentSettings = config.voice.providerSettings ?? {};
    const currentProvider = currentSettings[activeProviderKey] ?? {};
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        providerSettings: {
          ...currentSettings,
          [activeProviderKey]: { ...currentProvider, [key]: value },
        },
      },
    });
  };

  return (
    <>
      {/* Basic Turn Detection */}
      <SettingsSection
        title="Turn Detection"
        description="Controls when the system considers the user's speech turn complete."
        columns={3}
      >
        <SettingsField label="Strategy">
          <select
            value={config.voice.turn.strategy}
            onChange={(e) =>
              updateTurn({ strategy: e.target.value as 'provider-native' | 'layered' })
            }
          >
            <option value="provider-native">provider-native</option>
            <option value="layered">layered</option>
          </select>
        </SettingsField>

        <SettingsField label="Silence Threshold (ms)" hint="Duration of silence before finalizing a turn.">
          <input
            type="number"
            value={config.voice.turn.silenceMs}
            onChange={(e) =>
              updateTurn({ silenceMs: parseNumeric(e.target.value, config.voice.turn.silenceMs, 0) })
            }
          />
        </SettingsField>

        <SettingsField label="Minimum Speech (ms)" hint="Minimum speech duration before a turn is considered valid.">
          <input
            type="number"
            value={config.voice.turn.minSpeechMs}
            onChange={(e) =>
              updateTurn({ minSpeechMs: parseNumeric(e.target.value, config.voice.turn.minSpeechMs, 0) })
            }
          />
        </SettingsField>
      </SettingsSection>

      {/* Provider-specific VAD fields from schema */}
      {activeSchema && (
        <ProviderSettingsSection
          schema={activeSchema}
          values={providerSettings}
          onChange={updateProviderSetting}
          group="vad"
          title="Voice Activity Detection"
          description={`VAD settings for ${activeSchema.displayName}. Passed directly to the provider.`}
        />
      )}

      <AdvancedToggle
        visible={advancedVisible}
        onToggle={() => toggleAdvanced('audio')}
      />

      {advancedVisible && (
        <>
          {/* Advanced Turn Detection */}
          {isDecomposed && (
            <SettingsSection
              title="Advanced Turn Detection"
              description="Fine-grained turn detection parameters for decomposed mode."
              columns={3}
            >
              <SettingsField label="Minimum RMS" hint="Volume threshold for speech detection.">
                <input
                  type="number"
                  step="0.001"
                  value={config.voice.turn.minRms}
                  onChange={(e) =>
                    updateTurn({ minRms: parseNumeric(e.target.value, config.voice.turn.minRms) })
                  }
                />
              </SettingsField>
            </SettingsSection>
          )}

          {/* LLM Completion Marker */}
          {isDecomposed && (
            <SettingsSection
              title="LLM Completion Marker"
              description="When enabled, uses LLM-based detection to determine if the user has finished speaking."
              columns={3}
            >
              <SettingsField label="Enabled">
                <select
                  value={config.voice.turn.llmCompletion.enabled ? 'enabled' : 'disabled'}
                  onChange={(e) =>
                    updateTurn({
                      llmCompletion: {
                        ...config.voice.turn.llmCompletion,
                        enabled: e.target.value === 'enabled',
                      },
                    })
                  }
                >
                  <option value="disabled">disabled</option>
                  <option value="enabled">enabled</option>
                </select>
              </SettingsField>

              <SettingsField label="Short Timeout (ms)">
                <input
                  type="number"
                  value={config.voice.turn.llmCompletion.shortTimeoutMs}
                  onChange={(e) =>
                    updateTurn({
                      llmCompletion: {
                        ...config.voice.turn.llmCompletion,
                        shortTimeoutMs: parseNumeric(e.target.value, config.voice.turn.llmCompletion.shortTimeoutMs, 0),
                      },
                    })
                  }
                />
              </SettingsField>

              <SettingsField label="Long Timeout (ms)">
                <input
                  type="number"
                  value={config.voice.turn.llmCompletion.longTimeoutMs}
                  onChange={(e) =>
                    updateTurn({
                      llmCompletion: {
                        ...config.voice.turn.llmCompletion,
                        longTimeoutMs: parseNumeric(e.target.value, config.voice.turn.llmCompletion.longTimeoutMs, 0),
                      },
                    })
                  }
                />
              </SettingsField>

              <SettingsField label="Short Reprompt" fullWidth>
                <textarea
                  value={config.voice.turn.llmCompletion.shortReprompt}
                  onChange={(e) =>
                    updateTurn({
                      llmCompletion: {
                        ...config.voice.turn.llmCompletion,
                        shortReprompt: e.target.value,
                      },
                    })
                  }
                />
              </SettingsField>

              <SettingsField label="Long Reprompt" fullWidth>
                <textarea
                  value={config.voice.turn.llmCompletion.longReprompt}
                  onChange={(e) =>
                    updateTurn({
                      llmCompletion: {
                        ...config.voice.turn.llmCompletion,
                        longReprompt: e.target.value,
                      },
                    })
                  }
                />
              </SettingsField>
            </SettingsSection>
          )}

          {/* Provider advanced fields */}
          {activeSchema && (
            <ProviderSettingsSection
              schema={activeSchema}
              values={providerSettings}
              onChange={updateProviderSetting}
              group="advanced"
            />
          )}
        </>
      )}
    </>
  );
}
