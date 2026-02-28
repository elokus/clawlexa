import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  fetchEffectiveVoiceConfig,
  fetchVoiceCatalog,
  type VoiceCatalog,
  type VoiceConfigDocument,
  type ProviderConfigSchema,
  type RuntimeFieldBinding,
  type RuntimeRealtimeProviderManifest,
  type RuntimeDecomposedStageManifest,
  type ProviderVoiceEntry,
} from '../lib/voice-config-api';
import { ConfigDialog, ConfigField, ConfigSection } from './ui/config-dialog';
import { ProviderSettingsSection } from './voice-config/ProviderSettingsSection';
import { VoiceSelector } from './voice-config/VoiceSelector';

interface VoiceRuntimePanelProps {
  config: VoiceConfigDocument | null;
  setConfig: (config: VoiceConfigDocument) => void;
  save: () => Promise<void>;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

function withCurrent(options: string[], current: string): string[] {
  if (!current) return options;
  return options.includes(current) ? options : [current, ...options];
}

function parseNumeric(value: string, fallback: number, min?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (typeof min === 'number') return Math.max(min, parsed);
  return parsed;
}

function pickMatchingOrFirst(options: string[], current: string, fallback = ''): string {
  if (options.length === 0) return fallback;
  return options.includes(current) ? current : options[0]!;
}

function getPathValue(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split('.');
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function setPathValue<T extends object>(obj: T, path: string, value: unknown): T {
  const segments = path.split('.');
  if (segments.length === 0) return obj;

  const root = { ...(obj as Record<string, unknown>) };
  let cursor: Record<string, unknown> = root;
  let source: unknown = obj;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    const sourceObj = source && typeof source === 'object'
      ? (source as Record<string, unknown>)
      : undefined;
    const sourceNext = sourceObj?.[segment];

    const next = sourceNext && typeof sourceNext === 'object' && !Array.isArray(sourceNext)
      ? { ...(sourceNext as Record<string, unknown>) }
      : {};

    cursor[segment] = next;
    cursor = next;
    source = sourceNext;
  }

  cursor[segments[segments.length - 1]!] = value;
  return root as T;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asVoiceList(catalog: VoiceCatalog | null, key: string | undefined): ProviderVoiceEntry[] {
  if (!catalog || !key) return [];
  return catalog.providerCatalog[key]?.voices ?? [];
}

function asModelList(catalog: VoiceCatalog | null, key: string | undefined): string[] {
  if (!catalog || !key) return [];
  return catalog.providerCatalog[key]?.models ?? [];
}

function AuthProfileSelect({
  value,
  onChange,
  profileNames,
  placeholder,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  profileNames: string[];
  placeholder?: string;
}) {
  return (
    <ConfigField label="Auth Profile Override" hint="Optional. Leave blank to use provider default.">
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{placeholder ?? '(provider default)'}</option>
        {profileNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </ConfigField>
  );
}

function renderRuntimeField(args: {
  field: RuntimeFieldBinding;
  value: unknown;
  language: string;
  catalog: VoiceCatalog | null;
  authProfileNames: string[];
  onChange: (value: unknown) => void;
}) {
  const { field, value, language, catalog, authProfileNames, onChange } = args;
  const current = asString(value);

  if (field.kind === 'model') {
    const options = withCurrent(asModelList(catalog, field.catalogKey), current);
    return (
      <ConfigField label={field.label}>
        <select value={current} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </ConfigField>
    );
  }

  if (field.kind === 'voice') {
    const voices = asVoiceList(catalog, field.catalogKey);
    return (
      <VoiceSelector
        label={field.label}
        voices={voices}
        value={current}
        onChange={(voiceId) => onChange(voiceId)}
        languageFilter={language}
      />
    );
  }

  if (field.kind === 'auth') {
    return (
      <AuthProfileSelect
        value={current || undefined}
        onChange={(next) => onChange(next)}
        profileNames={authProfileNames}
      />
    );
  }

  if (field.kind === 'select') {
    return (
      <ConfigField label={field.label}>
        <select value={current} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </ConfigField>
    );
  }

  return (
    <ConfigField label={field.label}>
      <input
        value={current}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </ConfigField>
  );
}

function stageDescription(stage: RuntimeDecomposedStageManifest): string {
  if (stage.id === 'stt') return 'Transcribes user audio input before LLM routing.';
  if (stage.id === 'llm') return 'Runs reasoning and tool logic on each completed transcript turn.';
  return 'Synthesizes assistant responses back to audio.';
}

export function VoiceRuntimePanel({
  config,
  setConfig,
  save,
  loading,
  saving,
  error,
}: VoiceRuntimePanelProps) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [effectiveSummary, setEffectiveSummary] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchVoiceCatalog();
        if (!cancelled) {
          setCatalog(next);
          setCatalogError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setCatalogError((err as Error).message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      try {
        const [jarvis, marvin] = await Promise.all([
          fetchEffectiveVoiceConfig('jarvis'),
          fetchEffectiveVoiceConfig('marvin'),
        ]);
        if (cancelled) return;
        setEffectiveSummary({
          jarvis: `${jarvis.mode} | ${jarvis.provider} | voice=${jarvis.voice}`,
          marvin: `${marvin.mode} | ${marvin.provider} | voice=${marvin.voice}`,
        });
      } catch {
        if (cancelled) return;
        setEffectiveSummary({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const manifest = catalog?.manifest;
  const modeOptions = manifest?.modes ?? ['voice-to-voice', 'decomposed'];
  const realtimeProviderPath = manifest?.realtimeProviderPath ?? 'voice.voiceToVoice.provider';
  const realtimeProviders = manifest?.realtimeProviders ?? [];

  const selectedRealtimeProviderId = config
    ? asString(getPathValue(config, realtimeProviderPath), config.voice.voiceToVoice.provider)
    : '';
  const selectedRealtimeProvider =
    realtimeProviders.find((provider) => provider.id === selectedRealtimeProviderId) ??
    realtimeProviders[0];

  const isDecomposed = config?.voice.mode === 'decomposed';
  const activeProviderKey = isDecomposed
    ? 'decomposed'
    : selectedRealtimeProvider?.id ?? selectedRealtimeProviderId;

  const providerSettings = config?.voice.providerSettings?.[activeProviderKey] ?? {};
  const activeSchema = catalog?.providerSchemas?.[activeProviderKey] as ProviderConfigSchema | undefined;
  const authProfileNames = catalog?.authProfileNames ?? [];

  const updatePath = useCallback(
    (path: string, value: unknown) => {
      if (!config) return;
      setConfig(setPathValue(config, path, value));
    },
    [config, setConfig]
  );

  const updateMany = useCallback(
    (updates: Array<{ path: string; value: unknown }>) => {
      if (!config) return;
      let next = config;
      for (const update of updates) {
        next = setPathValue(next, update.path, update.value);
      }
      setConfig(next);
    },
    [config, setConfig]
  );

  const updateTurn = (patch: Partial<VoiceConfigDocument['voice']['turn']>) => {
    if (!config) return;
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        turn: {
          ...config.voice.turn,
          ...patch,
        },
      },
    });
  };

  const updateLlmCompletion = (
    patch: Partial<VoiceConfigDocument['voice']['turn']['llmCompletion']>
  ) => {
    if (!config) return;
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        turn: {
          ...config.voice.turn,
          llmCompletion: {
            ...config.voice.turn.llmCompletion,
            ...patch,
          },
        },
      },
    });
  };

  const updateProviderSetting = useCallback(
    (key: string, value: unknown) => {
      if (!config) return;
      const currentSettings = config.voice.providerSettings ?? {};
      const currentProvider = currentSettings[activeProviderKey] ?? {};
      setConfig({
        ...config,
        voice: {
          ...config.voice,
          providerSettings: {
            ...currentSettings,
            [activeProviderKey]: {
              ...currentProvider,
              [key]: value,
            },
          },
        },
      });
    },
    [activeProviderKey, config, setConfig]
  );

  const runtimeSummary = useMemo(() => {
    if (!config) {
      return loading
        ? 'Loading voice runtime configuration...'
        : error || 'Voice runtime configuration unavailable.';
    }

    if (isDecomposed) {
      const parts = (manifest?.decomposedStages ?? []).map((stage) => {
        const provider = asString(getPathValue(config, stage.providerPath), 'n/a');
        const model = asString(getPathValue(config, stage.modelPath), 'n/a');
        return `${stage.id.toUpperCase()} ${provider}:${model}`;
      });
      return `Decomposed • ${parts.join(' -> ')}`;
    }

    if (!selectedRealtimeProvider) {
      return `Realtime • ${selectedRealtimeProviderId}`;
    }

    const fieldSummary = selectedRealtimeProvider.fields
      .filter((field) => field.kind === 'model' || field.kind === 'voice' || field.kind === 'string' || field.kind === 'select')
      .slice(0, 2)
      .map((field) => `${field.label} ${asString(getPathValue(config, field.path), 'n/a')}`)
      .join(' • ');

    return fieldSummary
      ? `Realtime • ${selectedRealtimeProvider.id} • ${fieldSummary}`
      : `Realtime • ${selectedRealtimeProvider.id}`;
  }, [
    config,
    error,
    isDecomposed,
    loading,
    manifest?.decomposedStages,
    selectedRealtimeProvider,
    selectedRealtimeProviderId,
  ]);

  const overridesText = config
    ? Object.entries(config.voice.profileOverrides)
        .map(([name, override]) => {
          const parts = [override.mode, override.provider, override.voice].filter(Boolean);
          return parts.length ? `${name}: ${parts.join(' / ')}` : null;
        })
        .filter(Boolean)
        .join(' | ')
    : '';

  const handleRealtimeProviderChange = (nextProviderId: string) => {
    if (!config) return;
    const provider = realtimeProviders.find((entry) => entry.id === nextProviderId);
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
        continue;
      }

      const voiceOptions = asVoiceList(catalog, field.catalogKey).map((voice) => voice.id);
      const next = pickMatchingOrFirst(voiceOptions, current, current);
      if (next) updates.push({ path: field.path, value: next });
    }

    updateMany(updates);
  };

  const handleDecomposedProviderChange = (stage: RuntimeDecomposedStageManifest, nextProviderId: string) => {
    if (!config) return;
    const provider = stage.providers.find((entry) => entry.id === nextProviderId);
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
      const voiceOptions = asVoiceList(catalog, provider.voiceCatalogKey).map((voice) => voice.id);
      const currentVoice = asString(getPathValue(config, stage.voicePath));
      const nextVoice = pickMatchingOrFirst(voiceOptions, currentVoice, currentVoice);
      if (nextVoice) {
        updates.push({ path: stage.voicePath, value: nextVoice });
        updates.push({ path: stage.modelPath, value: nextVoice });
      }
    }

    updateMany(updates);
  };

  const handleSave = () => {
    void (async () => {
      try {
        await save();
        setOpen(false);
      } catch {
        // Save errors are surfaced through the existing error state.
      }
    })();
  };

  const statusMessage = error || catalogError || 'Saved settings apply when you start the next voice session.';

  if (!config) {
    return (
      <div className="px-3.5 py-2.5 border-t border-border font-mono text-xs text-muted-foreground bg-card">
        {loading ? 'Loading voice runtime configuration...' : error || 'Voice runtime configuration unavailable.'}
      </div>
    );
  }

  return (
    <>
      <div className="border-t border-border bg-card px-3.5 py-2.5 flex items-center justify-between gap-3.5 max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5">
        <div className="min-w-0 grid gap-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Voice Runtime</div>
          <div className="font-mono text-xs text-muted-foreground leading-snug truncate max-sm:whitespace-normal max-sm:overflow-visible">{runtimeSummary}</div>
        </div>
        <button
          type="button"
          className="shrink-0 px-3 py-2 border border-primary/40 bg-primary/10 text-primary font-mono text-xs rounded-lg hover:border-primary/70 hover:bg-primary/20 transition-colors max-sm:w-full"
          onClick={() => setOpen(true)}
        >
          Configure Runtime
        </button>
      </div>

      <ConfigDialog
        open={open}
        title="Voice Runtime Configuration"
        subtitle="Switch between realtime voice-to-voice and decomposed STT -> LLM -> TTS pipelines with provider-native model lists."
        statusText={statusMessage}
        statusTone={error || catalogError ? 'error' : 'neutral'}
        saving={saving}
        saveDisabled={saving || loading}
        onClose={() => setOpen(false)}
        onSave={handleSave}
      >
        <ConfigSection
          title="Runtime Route"
          description="Pick the global runtime mode and base language for the active voice layer."
          columns={3}
        >
          <ConfigField label="Mode">
            <select
              value={config.voice.mode}
              onChange={(event) => {
                updatePath('voice.mode', event.target.value);
              }}
            >
              {modeOptions.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </ConfigField>

          {!isDecomposed ? (
            <ConfigField label="Provider">
              <select
                value={selectedRealtimeProvider?.id ?? selectedRealtimeProviderId}
                onChange={(event) => {
                  handleRealtimeProviderChange(event.target.value);
                }}
              >
                {realtimeProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </ConfigField>
          ) : (
            <ConfigField label="Pipeline">
              <input value="stt -> llm -> tts" readOnly />
            </ConfigField>
          )}

          <ConfigField label="Language" hint="ISO language tag used as default hint for STT/runtime.">
            <input
              value={config.voice.language}
              onChange={(event) => {
                updatePath('voice.language', event.target.value);
              }}
            />
          </ConfigField>
        </ConfigSection>

        {!isDecomposed && selectedRealtimeProvider && (
          <ConfigSection
            title="Realtime Provider Settings"
            description="Rendered from runtime manifest + provider catalog."
            columns={3}
          >
            {selectedRealtimeProvider.fields.map((field) => {
              const value = getPathValue(config, field.path);
              return (
                <div key={field.path}>
                  {renderRuntimeField({
                    field,
                    value,
                    language: config.voice.language,
                    catalog,
                    authProfileNames,
                    onChange: (nextValue) => updatePath(field.path, nextValue),
                  })}
                </div>
              );
            })}
          </ConfigSection>
        )}

        {isDecomposed && (manifest?.decomposedStages ?? []).map((stage) => {
          const selectedProviderId = asString(getPathValue(config, stage.providerPath));
          const selectedProvider =
            stage.providers.find((provider) => provider.id === selectedProviderId) ??
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

          return (
            <ConfigSection
              key={stage.id}
              title={stage.label}
              description={stageDescription(stage)}
              columns={3}
            >
              <ConfigField label="Provider">
                <select
                  value={selectedProvider?.id ?? selectedProviderId}
                  onChange={(event) => {
                    handleDecomposedProviderChange(stage, event.target.value);
                  }}
                >
                  {stage.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </ConfigField>

              {stage.voicePath ? (
                <>
                  <AuthProfileSelect
                    value={asString(getPathValue(config, stage.authPath), '') || undefined}
                    onChange={(next) => updatePath(stage.authPath, next)}
                    profileNames={authProfileNames}
                  />
                  <VoiceSelector
                    label="Voice / Model"
                    voices={voiceOptions}
                    value={asString(getPathValue(config, stage.voicePath), asString(getPathValue(config, stage.modelPath)))}
                    onChange={(voiceId) => {
                      const voicePath = stage.voicePath as string;
                      updateMany([
                        { path: stage.modelPath, value: voiceId },
                        { path: voicePath, value: voiceId },
                      ]);
                    }}
                    languageFilter={config.voice.language}
                  />
                </>
              ) : (
                <>
                  <ConfigField label="Model">
                    <select
                      value={asString(getPathValue(config, stage.modelPath))}
                      onChange={(event) => updatePath(stage.modelPath, event.target.value)}
                    >
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </ConfigField>
                  <AuthProfileSelect
                    value={asString(getPathValue(config, stage.authPath), '') || undefined}
                    onChange={(next) => updatePath(stage.authPath, next)}
                    profileNames={authProfileNames}
                  />
                </>
              )}
            </ConfigSection>
          );
        })}

        {activeSchema && (
          <ProviderSettingsSection
            schema={activeSchema}
            values={providerSettings}
            onChange={updateProviderSetting}
            group="vad"
            title="Voice Activity Detection"
            description={`VAD settings for ${activeSchema.displayName}. These are passed directly to the provider.`}
          />
        )}

        {isDecomposed && (
          <ConfigSection
            title="Turn Detection"
            description="Local RMS-based turn detection and LLM completion fallbacks for decomposed mode."
            columns={3}
          >
            <ConfigField label="Strategy">
              <select
                value={config.voice.turn.strategy}
                onChange={(event) => {
                  updateTurn({
                    strategy: event.target.value as VoiceConfigDocument['voice']['turn']['strategy'],
                  });
                }}
              >
                <option value="provider-native">provider-native</option>
                <option value="layered">layered</option>
              </select>
            </ConfigField>

            <ConfigField label="Silence Threshold (ms)">
              <input
                type="number"
                value={config.voice.turn.silenceMs}
                onChange={(event) => {
                  updateTurn({
                    silenceMs: parseNumeric(event.target.value, config.voice.turn.silenceMs, 0),
                  });
                }}
              />
            </ConfigField>

            <ConfigField label="Minimum Speech (ms)">
              <input
                type="number"
                value={config.voice.turn.minSpeechMs}
                onChange={(event) => {
                  updateTurn({
                    minSpeechMs: parseNumeric(event.target.value, config.voice.turn.minSpeechMs, 0),
                  });
                }}
              />
            </ConfigField>

            <ConfigField label="Minimum RMS">
              <input
                type="number"
                step="0.01"
                value={config.voice.turn.minRms}
                onChange={(event) => {
                  updateTurn({
                    minRms: parseNumeric(event.target.value, config.voice.turn.minRms),
                  });
                }}
              />
            </ConfigField>

            <ConfigField label="LLM Completion Marker">
              <select
                value={config.voice.turn.llmCompletion.enabled ? 'enabled' : 'disabled'}
                onChange={(event) => {
                  updateLlmCompletion({
                    enabled: event.target.value === 'enabled',
                  });
                }}
              >
                <option value="disabled">disabled</option>
                <option value="enabled">enabled</option>
              </select>
            </ConfigField>

            <ConfigField label="Short Timeout (ms)">
              <input
                type="number"
                value={config.voice.turn.llmCompletion.shortTimeoutMs}
                onChange={(event) => {
                  updateLlmCompletion({
                    shortTimeoutMs: parseNumeric(
                      event.target.value,
                      config.voice.turn.llmCompletion.shortTimeoutMs,
                      0
                    ),
                  });
                }}
              />
            </ConfigField>

            <ConfigField label="Long Timeout (ms)">
              <input
                type="number"
                value={config.voice.turn.llmCompletion.longTimeoutMs}
                onChange={(event) => {
                  updateLlmCompletion({
                    longTimeoutMs: parseNumeric(
                      event.target.value,
                      config.voice.turn.llmCompletion.longTimeoutMs,
                      0
                    ),
                  });
                }}
              />
            </ConfigField>

            <ConfigField label="Short Reprompt" fullWidth>
              <textarea
                value={config.voice.turn.llmCompletion.shortReprompt}
                onChange={(event) => {
                  updateLlmCompletion({
                    shortReprompt: event.target.value,
                  });
                }}
              />
            </ConfigField>

            <ConfigField label="Long Reprompt" fullWidth>
              <textarea
                value={config.voice.turn.llmCompletion.longReprompt}
                onChange={(event) => {
                  updateLlmCompletion({
                    longReprompt: event.target.value,
                  });
                }}
              />
            </ConfigField>
          </ConfigSection>
        )}

        {activeSchema && (
          <ProviderSettingsSection
            schema={activeSchema}
            values={providerSettings}
            onChange={updateProviderSetting}
            group="advanced"
          />
        )}

        <ConfigSection
          title="Profile Resolution"
          description="Shows the effective runtime per wake-word profile and any static overrides."
          columns={1}
        >
          <p className="font-mono text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
            Jarvis: {effectiveSummary.jarvis || 'loading...'}
            {'\n'}
            Marvin: {effectiveSummary.marvin || 'loading...'}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
            {overridesText ? `Profile overrides: ${overridesText}` : 'Profile overrides: none'}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Runtime config UI is rendered from runtime manifest/catalog metadata. Provider protocol logic stays in voice-runtime.
          </p>
        </ConfigSection>
      </ConfigDialog>
    </>
  );
}
