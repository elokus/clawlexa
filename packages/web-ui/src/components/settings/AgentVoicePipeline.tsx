// ═══════════════════════════════════════════════════════════════════════════
// AgentVoicePipeline - Per-agent voice pipeline config with override support
// Shows effective values (global + overrides). Edits write to profileOverrides.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { useConfigStore, getPathValue, getEffectiveAgentConfig, updateAgentOverride, isAgentOverridden, clearAgentOverride } from '../../stores/config-store';
import { SettingsSection, SettingsField } from './SettingsSection';
import { VoiceSelector } from '../voice-config/VoiceSelector';
import { fetchVoices, type VoiceMeta, type VoiceCatalog, type ProviderVoiceEntry } from '../../lib/voice-config-api';

// ─── Helpers ───────────────────────────────────────────────────────────

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asModelList(catalog: VoiceCatalog | null, key: string | undefined): string[] {
  if (!catalog || !key) return [];
  return catalog.providerCatalog[key]?.models ?? [];
}

function asVoiceList(catalog: VoiceCatalog | null, key: string | undefined): ProviderVoiceEntry[] {
  if (!catalog || !key) return [];
  return catalog.providerCatalog[key]?.voices ?? [];
}

function withCurrent(options: string[], current: string): string[] {
  if (!current) return options;
  return options.includes(current) ? options : [current, ...options];
}

// ─── Reset Button ──────────────────────────────────────────────────────

function ResetButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      className="agent-pipeline-reset"
      onClick={onClick}
      title="Reset to global default"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export function AgentVoicePipeline({ agentName }: { agentName: string }) {
  const config = useConfigStore((s) => s.config);
  const catalog = useConfigStore((s) => s.catalog);
  const manifest = catalog?.manifest;

  // Voice library for clone selector
  const [voices, setVoices] = useState<VoiceMeta[]>([]);
  useEffect(() => {
    fetchVoices().then(setVoices).catch(() => {});
  }, []);

  const effective = getEffectiveAgentConfig(config, agentName);
  const authProfileNames = catalog?.authProfileNames ?? [];

  const handleOverride = useCallback(
    (path: string, value: unknown) => {
      updateAgentOverride(agentName, path, value);
    },
    [agentName]
  );

  const handleClear = useCallback(
    (path: string) => {
      clearAgentOverride(agentName, path);
    },
    [agentName]
  );

  const isOverridden = useCallback(
    (path: string) => isAgentOverridden(config, agentName, path),
    [config, agentName]
  );

  if (!config || !effective) return null;

  const isDecomposed = effective.mode === 'decomposed';
  const stages = manifest?.decomposedStages ?? [];
  const realtimeProviders = manifest?.realtimeProviders ?? [];

  return (
    <div className="agent-voice-pipeline">
      <style>{`
        .agent-voice-pipeline {
          margin-top: 4px;
        }
        .agent-pipeline-field-wrap {
          position: relative;
        }
        .agent-pipeline-reset {
          position: absolute;
          top: 0;
          right: 0;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--color-amber);
          cursor: pointer;
          opacity: 0.7;
          padding: 0;
          min-width: auto;
          min-height: auto;
        }
        .agent-pipeline-reset:hover {
          opacity: 1;
        }
        .agent-pipeline-overridden {
          border-left: 2px solid var(--color-amber);
          padding-left: 8px;
        }
        .agent-pipeline-inherited select,
        .agent-pipeline-inherited input {
          opacity: 0.6;
        }
        .voice-clone-select-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .voice-clone-select-row select {
          flex: 1;
        }
        .voice-clone-hint {
          font-family: var(--font-sans);
          font-size: 11px;
          color: var(--muted-foreground);
          margin-top: 4px;
        }
      `}</style>

      {/* Mode Override */}
      <SettingsSection
        title="Voice Pipeline"
        description={`Voice configuration for ${agentName}. Inherited values are dimmed; overrides are highlighted.`}
        columns={3}
      >
        <div className={`agent-pipeline-field-wrap ${isOverridden('mode') ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}>
          <ResetButton visible={isOverridden('mode')} onClick={() => handleClear('mode')} />
          <SettingsField label="Mode">
            <select
              value={effective.mode}
              onChange={(e) => handleOverride('mode', e.target.value)}
            >
              <option value="voice-to-voice">voice-to-voice</option>
              <option value="decomposed">decomposed</option>
            </select>
          </SettingsField>
        </div>

        {!isDecomposed && (
          <div className={`agent-pipeline-field-wrap ${isOverridden('voiceToVoice.provider') ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}>
            <ResetButton visible={isOverridden('voiceToVoice.provider')} onClick={() => handleClear('voiceToVoice.provider')} />
            <SettingsField label="Provider">
              <select
                value={effective.voiceToVoice.provider}
                onChange={(e) => handleOverride('voiceToVoice.provider', e.target.value)}
              >
                {realtimeProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </SettingsField>
          </div>
        )}

        {!isDecomposed && (
          <div className={`agent-pipeline-field-wrap ${isOverridden('voiceToVoice.voice') ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}>
            <ResetButton visible={isOverridden('voiceToVoice.voice')} onClick={() => handleClear('voiceToVoice.voice')} />
            <SettingsField label="Voice">
              <input
                type="text"
                value={effective.voiceToVoice.voice}
                onChange={(e) => handleOverride('voiceToVoice.voice', e.target.value)}
              />
            </SettingsField>
          </div>
        )}
      </SettingsSection>

      {/* Decomposed Stages */}
      {isDecomposed && stages.map((stage) => {
        const stageKey = stage.id as 'stt' | 'llm' | 'tts';
        const effectiveStage = effective.decomposed[stageKey];
        const providerValue = 'provider' in effectiveStage ? effectiveStage.provider : '';
        const modelValue = 'model' in effectiveStage ? effectiveStage.model : '';

        const selectedProviderManifest = stage.providers.find((p) => p.id === providerValue) ?? stage.providers[0];
        const modelOptions = selectedProviderManifest?.modelCatalogKey
          ? withCurrent(asModelList(catalog, selectedProviderManifest.modelCatalogKey), modelValue)
          : [];
        const voiceOptions = selectedProviderManifest?.voiceCatalogKey
          ? asVoiceList(catalog, selectedProviderManifest.voiceCatalogKey)
          : [];
        const hasVoiceCatalog = Boolean(selectedProviderManifest?.voiceCatalogKey) && voiceOptions.length > 0;

        const stageLabel = stage.id === 'stt'
          ? 'Speech-To-Text (STT)'
          : stage.id === 'llm'
            ? 'Language Model (LLM)'
            : 'Text-To-Speech (TTS)';

        const isLocalTts = stageKey === 'tts' && providerValue === 'local';
        const ttsVoiceRef = stageKey === 'tts' ? (effectiveStage as typeof effective.decomposed.tts).voiceRef : undefined;

        return (
          <SettingsSection key={stage.id} title={stageLabel} columns={3}>
            {/* Provider */}
            <div className={`agent-pipeline-field-wrap ${isOverridden(`decomposed.${stageKey}.provider`) ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}>
              <ResetButton visible={isOverridden(`decomposed.${stageKey}.provider`)} onClick={() => handleClear(`decomposed.${stageKey}.provider`)} />
              <SettingsField label="Provider">
                <select
                  value={providerValue}
                  onChange={(e) => handleOverride(`decomposed.${stageKey}.provider`, e.target.value)}
                >
                  {stage.providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </SettingsField>
            </div>

            {/* Model */}
            {stage.voicePath && hasVoiceCatalog ? (
              <div className={`agent-pipeline-field-wrap ${isOverridden(`decomposed.${stageKey}.voice`) ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}>
                <ResetButton visible={isOverridden(`decomposed.${stageKey}.voice`)} onClick={() => handleClear(`decomposed.${stageKey}.voice`)} />
                <VoiceSelector
                  label="Voice / Model"
                  voices={voiceOptions}
                  value={(effectiveStage as typeof effective.decomposed.tts).voice ?? modelValue}
                  onChange={(voiceId) => {
                    handleOverride(`decomposed.${stageKey}.model`, voiceId);
                    handleOverride(`decomposed.${stageKey}.voice`, voiceId);
                  }}
                  languageFilter={config.voice.language}
                />
              </div>
            ) : (
              <div className={`agent-pipeline-field-wrap ${isOverridden(`decomposed.${stageKey}.model`) ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}>
                <ResetButton visible={isOverridden(`decomposed.${stageKey}.model`)} onClick={() => handleClear(`decomposed.${stageKey}.model`)} />
                <SettingsField label="Model">
                  {modelOptions.length > 0 ? (
                    <select
                      value={modelValue}
                      onChange={(e) => handleOverride(`decomposed.${stageKey}.model`, e.target.value)}
                    >
                      {modelOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={modelValue}
                      onChange={(e) => handleOverride(`decomposed.${stageKey}.model`, e.target.value)}
                    />
                  )}
                </SettingsField>
              </div>
            )}

            {/* Auth Profile */}
            <div className={`agent-pipeline-field-wrap ${isOverridden(`decomposed.${stageKey}.authProfile`) ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}>
              <ResetButton visible={isOverridden(`decomposed.${stageKey}.authProfile`)} onClick={() => handleClear(`decomposed.${stageKey}.authProfile`)} />
              <SettingsField label="Credentials" hint="Select which API key profile to use.">
                <select
                  value={effectiveStage.authProfile ?? ''}
                  onChange={(e) => handleOverride(`decomposed.${stageKey}.authProfile`, e.target.value || undefined)}
                >
                  <option value="">(provider default)</option>
                  {authProfileNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </SettingsField>
            </div>

            {/* Voice Clone Selector (TTS + local provider only) */}
            {isLocalTts && (
              <div
                className={`agent-pipeline-field-wrap ${isOverridden('decomposed.tts.voiceRef') ? 'agent-pipeline-overridden' : 'agent-pipeline-inherited'}`}
                style={{ gridColumn: '1 / -1' }}
              >
                <ResetButton visible={isOverridden('decomposed.tts.voiceRef')} onClick={() => handleClear('decomposed.tts.voiceRef')} />
                <SettingsField label="Voice Clone" hint="Select a voice from the library for voice cloning (Qwen TTS).">
                  <div className="voice-clone-select-row">
                    <select
                      value={ttsVoiceRef ?? ''}
                      onChange={(e) => handleOverride('decomposed.tts.voiceRef', e.target.value || undefined)}
                    >
                      <option value="">(none — use base model voice)</option>
                      {voices.map((v) => (
                        <option key={v.label} value={v.label}>
                          {v.label} ({v.language})
                        </option>
                      ))}
                    </select>
                  </div>
                  {voices.length === 0 && (
                    <div className="voice-clone-hint">
                      No voices in library. Go to Settings &gt; Voices to create one.
                    </div>
                  )}
                </SettingsField>
              </div>
            )}
          </SettingsSection>
        );
      })}
    </div>
  );
}
