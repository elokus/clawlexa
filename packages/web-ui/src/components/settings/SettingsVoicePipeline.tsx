// ═══════════════════════════════════════════════════════════════════════════
// Settings: Voice Pipeline - Mode, provider, model, voice selection
// Ported from VoiceRuntimePanel.tsx lines 603-804
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback } from 'react';
import { useConfigStore, getPathValue } from '../../stores/config-store';
import { SettingsSection, SettingsField, AdvancedToggle } from './SettingsSection';
import { VoiceSelector } from '../voice-config/VoiceSelector';
import type {
  VoiceCatalog,
  RuntimeDecomposedStageManifest,
  ProviderVoiceEntry,
} from '../../lib/voice-config-api';

// ─── Helpers ───────────────────────────────────────────────────────────

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function withCurrent(options: string[], current: string): string[] {
  if (!current) return options;
  return options.includes(current) ? options : [current, ...options];
}

function pickMatchingOrFirst(options: string[], current: string, fallback = ''): string {
  if (options.length === 0) return fallback;
  return options.includes(current) ? current : options[0]!;
}

function asVoiceList(catalog: VoiceCatalog | null, key: string | undefined): ProviderVoiceEntry[] {
  if (!catalog || !key) return [];
  return catalog.providerCatalog[key]?.voices ?? [];
}

function asModelList(catalog: VoiceCatalog | null, key: string | undefined): string[] {
  if (!catalog || !key) return [];
  return catalog.providerCatalog[key]?.models ?? [];
}

function stageDescription(stage: RuntimeDecomposedStageManifest): string {
  if (stage.id === 'stt') return 'Transcribes user audio input before LLM routing.';
  if (stage.id === 'llm') return 'Runs reasoning and tool logic on each completed transcript turn.';
  return 'Synthesizes assistant responses back to audio.';
}

function AuthProfileSelect({
  value,
  onChange,
  profileNames,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  profileNames: string[];
}) {
  return (
    <SettingsField label="Credentials" hint="Select which API key profile to use. Leave blank for provider default.">
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">(provider default)</option>
        {profileNames.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </SettingsField>
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export function SettingsVoicePipeline() {
  const config = useConfigStore((s) => s.config);
  const catalog = useConfigStore((s) => s.catalog);
  const catalogError = useConfigStore((s) => s.catalogError);
  const updatePath = useConfigStore((s) => s.updatePath);
  const updateMany = useConfigStore((s) => s.updateMany);
  const advancedVisible = useConfigStore((s) => s.advancedVisible['voice-pipeline']);
  const toggleAdvanced = useConfigStore((s) => s.toggleAdvanced);

  const manifest = catalog?.manifest;
  const modeOptions = manifest?.modes ?? ['voice-to-voice', 'realtime-text-tts', 'decomposed'];
  const realtimeProviderPath = manifest?.realtimeProviderPath ?? 'voice.voiceToVoice.provider';
  const realtimeProviders = manifest?.realtimeProviders ?? [];

  const isDecomposed = config?.voice.mode === 'decomposed';
  const isRealtimeTextTts = config?.voice.mode === 'realtime-text-tts';
  const isPipelineMode = isDecomposed || isRealtimeTextTts;

  const selectedRealtimeProviderId = config
    ? isRealtimeTextTts
      ? 'openai-realtime'
      : asString(getPathValue(config, realtimeProviderPath), config.voice.voiceToVoice.provider)
    : '';
  const selectedRealtimeProvider =
    realtimeProviders.find((p) => p.id === selectedRealtimeProviderId) ??
    realtimeProviders[0];
  const authProfileNames = catalog?.authProfileNames ?? [];

  const visibleStages = isDecomposed
    ? manifest?.decomposedStages ?? []
    : isRealtimeTextTts
      ? (manifest?.decomposedStages ?? []).filter((stage) => stage.id === 'tts')
      : [];

  const handleRealtimeProviderChange = useCallback(
    (nextProviderId: string) => {
      if (!config) return;
      const provider = realtimeProviders.find((p) => p.id === nextProviderId);
      if (!provider) {
        updatePath(realtimeProviderPath, nextProviderId);
        return;
      }

      const updates: Array<{ path: string; value: unknown }> = [
        { path: realtimeProviderPath, value: nextProviderId },
      ];

      for (const field of provider.fields) {
        if (field.kind !== 'model' && field.kind !== 'voice') continue;
        const current = asString(getPathValue(config, field.path));

        if (field.kind === 'model') {
          const options = asModelList(catalog, field.catalogKey);
          const next = pickMatchingOrFirst(options, current, current);
          if (next) updates.push({ path: field.path, value: next });
        } else {
          const voiceOptions = asVoiceList(catalog, field.catalogKey).map((v) => v.id);
          const next = pickMatchingOrFirst(voiceOptions, current, current);
          if (next) updates.push({ path: field.path, value: next });
        }
      }

      updateMany(updates);
    },
    [config, catalog, realtimeProviders, realtimeProviderPath, updatePath, updateMany]
  );

  const handleDecomposedProviderChange = useCallback(
    (stage: RuntimeDecomposedStageManifest, nextProviderId: string) => {
      if (!config) return;
      const provider = stage.providers.find((p) => p.id === nextProviderId);
      const updates: Array<{ path: string; value: unknown }> = [
        { path: stage.providerPath, value: nextProviderId },
      ];

      if (provider?.modelCatalogKey) {
        const modelOptions = asModelList(catalog, provider.modelCatalogKey);
        const currentModel = asString(getPathValue(config, stage.modelPath));
        const nextModel = pickMatchingOrFirst(modelOptions, currentModel, currentModel);
        if (nextModel) updates.push({ path: stage.modelPath, value: nextModel });
      }

      if (provider?.voiceCatalogKey && stage.voicePath) {
        const voiceOptions = asVoiceList(catalog, provider.voiceCatalogKey).map((v) => v.id);
        const currentVoice = asString(getPathValue(config, stage.voicePath));
        const nextVoice = pickMatchingOrFirst(voiceOptions, currentVoice, currentVoice);
        if (nextVoice) {
          updates.push({ path: stage.voicePath, value: nextVoice });
          updates.push({ path: stage.modelPath, value: nextVoice });
        }
      }

      updateMany(updates);
    },
    [config, catalog, updateMany]
  );

  const handleModeChange = useCallback(
    (nextMode: string) => {
      if (!config) return;
      const updates: Array<{ path: string; value: unknown }> = [
        { path: 'voice.mode', value: nextMode },
      ];

      if (nextMode === 'realtime-text-tts') {
        const openaiProvider = realtimeProviders.find((provider) => provider.id === 'openai-realtime');
        updates.push({ path: realtimeProviderPath, value: 'openai-realtime' });
        if (openaiProvider) {
          for (const field of openaiProvider.fields) {
            if (field.kind !== 'model' && field.kind !== 'voice') continue;
            const current = asString(getPathValue(config, field.path));
            if (field.kind === 'model') {
              const options = asModelList(catalog, field.catalogKey);
              const next = pickMatchingOrFirst(options, current, current);
              if (next) updates.push({ path: field.path, value: next });
            } else {
              const voiceOptions = asVoiceList(catalog, field.catalogKey).map((voice) => voice.id);
              const next = pickMatchingOrFirst(voiceOptions, current, current);
              if (next) updates.push({ path: field.path, value: next });
            }
          }
        }
      }

      updateMany(updates);
    },
    [config, catalog, realtimeProviders, realtimeProviderPath, updateMany]
  );

  if (!config) return null;

  if (catalogError) {
    return (
      <SettingsSection title="Error" columns={1}>
        <div style={{ color: 'var(--color-rose)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Failed to load provider catalog: {catalogError}
        </div>
      </SettingsSection>
    );
  }

  return (
    <>
      {/* Mode & Provider */}
      <SettingsSection
        title="Runtime Route"
        description="Pick the global runtime mode and base language for the active voice layer."
        columns={3}
      >
        <SettingsField label="Mode">
          <select
            value={config.voice.mode}
            onChange={(e) => handleModeChange(e.target.value)}
          >
            {modeOptions.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
        </SettingsField>

        {!isPipelineMode ? (
          <SettingsField label="Provider">
            <select
              value={selectedRealtimeProvider?.id ?? selectedRealtimeProviderId}
              onChange={(e) => handleRealtimeProviderChange(e.target.value)}
            >
              {realtimeProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </SettingsField>
        ) : (
          <SettingsField label="Pipeline">
            <input
              value={
                isDecomposed
                  ? 'stt -> llm -> tts'
                  : 'realtime(stt+vad+llm) -> tts'
              }
              readOnly
            />
          </SettingsField>
        )}

        <SettingsField label="Language" hint="ISO language tag for STT/runtime.">
          <input
            type="text"
            value={config.voice.language}
            onChange={(e) => updatePath('voice.language', e.target.value)}
          />
        </SettingsField>
      </SettingsSection>

      {/* Realtime Provider Fields */}
      {!isDecomposed && selectedRealtimeProvider && (
        <SettingsSection
          title="Provider Settings"
          description={`Model, voice, and auth for ${selectedRealtimeProvider.label}.`}
          columns={3}
        >
          {selectedRealtimeProvider.fields.map((field) => {
            const value = getPathValue(config, field.path);
            const current = asString(value);

            if (field.kind === 'model') {
              const options = withCurrent(asModelList(catalog, field.catalogKey), current);
              return (
                <SettingsField key={field.path} label={field.label}>
                  <select value={current} onChange={(e) => updatePath(field.path, e.target.value)}>
                    {options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </SettingsField>
              );
            }

            if (field.kind === 'voice') {
              const voices = asVoiceList(catalog, field.catalogKey);
              return (
                <VoiceSelector
                  key={field.path}
                  label={field.label}
                  voices={voices}
                  value={current}
                  onChange={(voiceId) => updatePath(field.path, voiceId)}
                  languageFilter={config.voice.language}
                />
              );
            }

            if (field.kind === 'auth') {
              return (
                <AuthProfileSelect
                  key={field.path}
                  value={current || undefined}
                  onChange={(next) => updatePath(field.path, next)}
                  profileNames={authProfileNames}
                />
              );
            }

            if (field.kind === 'select') {
              return (
                <SettingsField key={field.path} label={field.label}>
                  <select value={current} onChange={(e) => updatePath(field.path, e.target.value)}>
                    {(field.options ?? []).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </SettingsField>
              );
            }

            return (
              <SettingsField key={field.path} label={field.label}>
                <input
                  type="text"
                  value={current}
                  placeholder={field.placeholder}
                  onChange={(e) => updatePath(field.path, e.target.value)}
                />
              </SettingsField>
            );
          })}
        </SettingsSection>
      )}

      {/* Decomposed Stage Cards */}
      {visibleStages.map((stage) => {
        const selectedProviderId = asString(getPathValue(config, stage.providerPath));
        const selectedProvider =
          stage.providers.find((p) => p.id === selectedProviderId) ??
          stage.providers[0];
        const modelOptions = selectedProvider?.modelCatalogKey
          ? withCurrent(
            asModelList(catalog, selectedProvider.modelCatalogKey),
            asString(getPathValue(config, stage.modelPath))
          )
          : [];
        const voiceOptions = selectedProvider?.voiceCatalogKey
          ? asVoiceList(catalog, selectedProvider.voiceCatalogKey)
          : [];
        const supportsVoiceCatalog = Boolean(selectedProvider?.voiceCatalogKey);
        const hasVoiceOptions = voiceOptions.length > 0;

        return (
          <SettingsSection
            key={stage.id}
            title={stage.label}
            description={stageDescription(stage)}
            columns={3}
          >
            <SettingsField label="Provider">
              <select
                value={selectedProvider?.id ?? selectedProviderId}
                onChange={(e) => handleDecomposedProviderChange(stage, e.target.value)}
              >
                {stage.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
            </SettingsField>

            {stage.voicePath ? (
              <>
                <AuthProfileSelect
                  value={asString(getPathValue(config, stage.authPath), '') || undefined}
                  onChange={(next) => updatePath(stage.authPath, next)}
                  profileNames={authProfileNames}
                />
                {supportsVoiceCatalog && hasVoiceOptions ? (
                  <VoiceSelector
                    label="Voice / Model"
                    voices={voiceOptions}
                    value={asString(getPathValue(config, stage.voicePath), asString(getPathValue(config, stage.modelPath)))}
                    onChange={(voiceId) => {
                      updateMany([
                        { path: stage.modelPath, value: voiceId },
                        { path: stage.voicePath as string, value: voiceId },
                      ]);
                    }}
                    languageFilter={config.voice.language}
                  />
                ) : (
                  <>
                    {modelOptions.length > 0 ? (
                      <SettingsField label="Model">
                        <select
                          value={asString(getPathValue(config, stage.modelPath))}
                          onChange={(e) => updatePath(stage.modelPath, e.target.value)}
                        >
                          {modelOptions.map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      </SettingsField>
                    ) : (
                      <SettingsField label="Model">
                        <input
                          type="text"
                          value={asString(getPathValue(config, stage.modelPath))}
                          onChange={(e) => updatePath(stage.modelPath, e.target.value)}
                        />
                      </SettingsField>
                    )}
                    <SettingsField label="Voice">
                      <input
                        type="text"
                        value={asString(getPathValue(config, stage.voicePath), '')}
                        onChange={(e) => updatePath(stage.voicePath as string, e.target.value)}
                      />
                    </SettingsField>
                  </>
                )}
              </>
            ) : (
              <>
                {modelOptions.length > 0 ? (
                  <SettingsField label="Model">
                    <select
                      value={asString(getPathValue(config, stage.modelPath))}
                      onChange={(e) => updatePath(stage.modelPath, e.target.value)}
                    >
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </SettingsField>
                ) : (
                  <SettingsField label="Model">
                    <input
                      type="text"
                      value={asString(getPathValue(config, stage.modelPath))}
                      onChange={(e) => updatePath(stage.modelPath, e.target.value)}
                    />
                  </SettingsField>
                )}
                <AuthProfileSelect
                  value={asString(getPathValue(config, stage.authPath), '') || undefined}
                  onChange={(next) => updatePath(stage.authPath, next)}
                  profileNames={authProfileNames}
                />
              </>
            )}
          </SettingsSection>
        );
      })}

      <AdvancedToggle
        visible={advancedVisible}
        onToggle={() => toggleAdvanced('voice-pipeline')}
      />

      {advancedVisible && (
        <SettingsSection
          title="Pipeline Info"
          description="Runtime config is rendered from backend manifest and catalog metadata."
          columns={1}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            {isPipelineMode
              ? `Pipeline: ${visibleStages.map((s) => s.id.toUpperCase()).join(' -> ')}`
              : `Provider: ${selectedRealtimeProvider?.id ?? 'unknown'}`
            }
            {'\n'}Manifest providers: {realtimeProviders.map((p) => p.id).join(', ')}
          </div>
        </SettingsSection>
      )}
    </>
  );
}
