import { useEffect, useMemo, useState } from 'react';
import {
  fetchEffectiveVoiceConfig,
  fetchVoiceCatalog,
  type VoiceCatalog,
  type VoiceConfigDocument,
} from '../lib/voice-config-api';
import { ConfigDialog, ConfigField, ConfigSection } from './ui/config-dialog';

interface VoiceRuntimePanelProps {
  config: VoiceConfigDocument | null;
  setConfig: (config: VoiceConfigDocument) => void;
  save: () => Promise<void>;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const OPENAI_TRANSCRIBE_MODELS = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe'];
const OPENROUTER_LLM_MODELS = ['openai/gpt-4.1', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash'];

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
  return options.includes(current) ? current : options[0];
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
  const currentVoice = config?.voice.voiceToVoice.voice ?? '';

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

  const ultravoxVoiceOptions = useMemo(() => {
    const voices = catalog?.ultravox.voices ?? [];
    if (!currentVoice) return voices;
    const hasCurrent = voices.some((voice) => voice.voiceId === currentVoice);
    return hasCurrent ? voices : [{ voiceId: currentVoice, name: currentVoice }, ...voices];
  }, [catalog?.ultravox.voices, currentVoice]);

  if (!config) {
    return (
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--color-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--color-text-dim)',
          background: 'rgba(8, 10, 16, 0.94)',
        }}
      >
        {loading ? 'Loading voice runtime configuration...' : error || 'Voice runtime configuration unavailable.'}
      </div>
    );
  }

  const isDecomposed = config.voice.mode === 'decomposed';
  const provider = config.voice.voiceToVoice.provider;
  const realtimeModel = config.voice.voiceToVoice.model;
  const realtimeVoice = config.voice.voiceToVoice.voice;

  const openAIRealtimeModels = withCurrent(catalog?.openai.realtimeModels ?? [], realtimeModel);
  const openAIVoices = withCurrent(catalog?.openai.voices ?? [], realtimeVoice);
  const openAITextModels = withCurrent(catalog?.openai.textModels ?? [], config.voice.decomposed.llm.model);
  const deepgramSttModels = withCurrent(catalog?.deepgram.sttModels ?? [], config.voice.decomposed.stt.model);
  const deepgramTtsVoices = withCurrent(catalog?.deepgram.ttsVoices ?? [], config.voice.decomposed.tts.model);
  const ultravoxModels = withCurrent(catalog?.ultravox.models ?? [], config.voice.voiceToVoice.ultravoxModel);
  const geminiModels = withCurrent(catalog?.gemini.models ?? [], config.voice.voiceToVoice.geminiModel);
  const geminiVoices = withCurrent(catalog?.gemini.voices ?? [], config.voice.voiceToVoice.geminiVoice);

  const overridesText = Object.entries(config.voice.profileOverrides)
    .map(([name, override]) => {
      const parts = [override.mode, override.provider, override.voice].filter(Boolean);
      return parts.length ? `${name}: ${parts.join(' / ')}` : null;
    })
    .filter(Boolean)
    .join(' | ');

  const updateVoiceToVoice = (patch: Partial<VoiceConfigDocument['voice']['voiceToVoice']>) => {
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        voiceToVoice: {
          ...config.voice.voiceToVoice,
          ...patch,
        },
      },
    });
  };

  const updateStt = (patch: Partial<VoiceConfigDocument['voice']['decomposed']['stt']>) => {
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        decomposed: {
          ...config.voice.decomposed,
          stt: {
            ...config.voice.decomposed.stt,
            ...patch,
          },
        },
      },
    });
  };

  const updateLlm = (patch: Partial<VoiceConfigDocument['voice']['decomposed']['llm']>) => {
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        decomposed: {
          ...config.voice.decomposed,
          llm: {
            ...config.voice.decomposed.llm,
            ...patch,
          },
        },
      },
    });
  };

  const updateTts = (patch: Partial<VoiceConfigDocument['voice']['decomposed']['tts']>) => {
    setConfig({
      ...config,
      voice: {
        ...config.voice,
        decomposed: {
          ...config.voice.decomposed,
          tts: {
            ...config.voice.decomposed.tts,
            ...patch,
          },
        },
      },
    });
  };

  const updateTurn = (patch: Partial<VoiceConfigDocument['voice']['turn']>) => {
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

  const realtimeSummary = (() => {
    if (provider === 'openai-realtime') {
      return `${provider} • model ${realtimeModel} • voice ${realtimeVoice}`;
    }
    if (provider === 'ultravox-realtime') {
      return `${provider} • model ${config.voice.voiceToVoice.ultravoxModel} • voice ${realtimeVoice}`;
    }
    if (provider === 'gemini-live') {
      return `${provider} • model ${config.voice.voiceToVoice.geminiModel} • voice ${config.voice.voiceToVoice.geminiVoice}`;
    }
    return `${provider} • server ${config.voice.voiceToVoice.pipecatServerUrl} • transport ${config.voice.voiceToVoice.pipecatTransport}`;
  })();

  const runtimeSummary = isDecomposed
    ? `Decomposed • STT ${config.voice.decomposed.stt.provider}:${config.voice.decomposed.stt.model} -> LLM ${config.voice.decomposed.llm.provider}:${config.voice.decomposed.llm.model} -> TTS ${config.voice.decomposed.tts.provider}:${config.voice.decomposed.tts.model}`
    : `Realtime • ${realtimeSummary}`;

  const handleProviderChange = (
    nextProvider: VoiceConfigDocument['voice']['voiceToVoice']['provider']
  ) => {
    const currentVoiceToVoice = config.voice.voiceToVoice;

    if (nextProvider === 'openai-realtime') {
      const openAiModels = catalog?.openai.realtimeModels ?? [];
      const openAiVoices = catalog?.openai.voices ?? [];
      updateVoiceToVoice({
        provider: nextProvider,
        model: pickMatchingOrFirst(openAiModels, currentVoiceToVoice.model, currentVoiceToVoice.model),
        voice: pickMatchingOrFirst(openAiVoices, currentVoiceToVoice.voice, openAiVoices[0] ?? ''),
      });
      return;
    }

    if (nextProvider === 'ultravox-realtime') {
      const ultravoxModelOptions = catalog?.ultravox.models ?? [];
      const ultravoxVoiceIds = (catalog?.ultravox.voices ?? []).map((voice) => voice.voiceId);
      updateVoiceToVoice({
        provider: nextProvider,
        ultravoxModel: pickMatchingOrFirst(
          ultravoxModelOptions,
          currentVoiceToVoice.ultravoxModel,
          currentVoiceToVoice.ultravoxModel
        ),
        voice: pickMatchingOrFirst(ultravoxVoiceIds, currentVoiceToVoice.voice, ultravoxVoiceIds[0] ?? ''),
      });
      return;
    }

    if (nextProvider === 'pipecat-rtvi') {
      const openAiModels = catalog?.openai.realtimeModels ?? [];
      const openAiVoices = catalog?.openai.voices ?? [];
      updateVoiceToVoice({
        provider: nextProvider,
        model: pickMatchingOrFirst(openAiModels, currentVoiceToVoice.model, currentVoiceToVoice.model),
        voice: pickMatchingOrFirst(openAiVoices, currentVoiceToVoice.voice, currentVoiceToVoice.voice),
      });
      return;
    }

    const geminiModelOptions = catalog?.gemini.models ?? [];
    const geminiVoiceOptions = catalog?.gemini.voices ?? [];
    const nextGeminiVoice = pickMatchingOrFirst(
      geminiVoiceOptions,
      currentVoiceToVoice.geminiVoice,
      geminiVoiceOptions[0] ?? currentVoiceToVoice.geminiVoice
    );
    updateVoiceToVoice({
      provider: nextProvider,
      geminiModel: pickMatchingOrFirst(
        geminiModelOptions,
        currentVoiceToVoice.geminiModel,
        currentVoiceToVoice.geminiModel
      ),
      geminiVoice: nextGeminiVoice,
      voice: nextGeminiVoice,
    });
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

  return (
    <>
      <style>{`
        .voice-runtime-strip {
          border-top: 1px solid var(--color-border);
          background: rgba(7, 10, 16, 0.94);
          padding: 10px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .voice-runtime-strip-main {
          min-width: 0;
          display: grid;
          gap: 4px;
        }

        .voice-runtime-strip-title {
          font-family: var(--font-display);
          font-size: 11px;
          color: var(--color-text-normal);
          letter-spacing: 0.11em;
          text-transform: uppercase;
        }

        .voice-runtime-strip-summary {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-dim);
          line-height: 1.45;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .voice-runtime-open-btn {
          min-width: unset;
          min-height: unset;
          border: 1px solid rgba(56, 189, 248, 0.36);
          background: rgba(56, 189, 248, 0.1);
          color: var(--color-cyan);
          font-family: var(--font-mono);
          font-size: 12px;
          letter-spacing: 0.02em;
          border-radius: 8px;
          padding: 8px 12px;
          flex-shrink: 0;
          transition: border-color 0.2s ease, background 0.2s ease;
        }

        .voice-runtime-open-btn:hover {
          border-color: rgba(56, 189, 248, 0.72);
          background: rgba(56, 189, 248, 0.18);
        }

        .voice-runtime-info {
          margin: 0;
          font-family: var(--font-ui);
          font-size: 12px;
          color: var(--color-text-ghost);
          line-height: 1.5;
        }

        @media (max-width: 920px) {
          .voice-runtime-strip {
            align-items: stretch;
            flex-direction: column;
            gap: 10px;
          }

          .voice-runtime-open-btn {
            width: 100%;
          }

          .voice-runtime-strip-summary {
            white-space: normal;
            overflow: visible;
          }
        }
      `}</style>

      <div className="voice-runtime-strip">
        <div className="voice-runtime-strip-main">
          <div className="voice-runtime-strip-title">Voice Runtime</div>
          <div className="voice-runtime-strip-summary">{runtimeSummary}</div>
        </div>
        <button type="button" className="voice-runtime-open-btn" onClick={() => setOpen(true)}>
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
                setConfig({
                  ...config,
                  voice: {
                    ...config.voice,
                    mode: event.target.value as VoiceConfigDocument['voice']['mode'],
                  },
                });
              }}
            >
              <option value="voice-to-voice">voice-to-voice</option>
              <option value="decomposed">decomposed</option>
            </select>
          </ConfigField>

          {!isDecomposed ? (
            <ConfigField label="Provider">
              <select
                value={config.voice.voiceToVoice.provider}
                onChange={(event) => {
                  handleProviderChange(
                    event.target.value as VoiceConfigDocument['voice']['voiceToVoice']['provider']
                  );
                }}
              >
                <option value="openai-realtime">openai-realtime</option>
                <option value="ultravox-realtime">ultravox-realtime</option>
                <option value="gemini-live">gemini-live</option>
                <option value="pipecat-rtvi">pipecat-rtvi</option>
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
                setConfig({
                  ...config,
                  voice: {
                    ...config.voice,
                    language: event.target.value,
                  },
                });
              }}
            />
          </ConfigField>
        </ConfigSection>

        {!isDecomposed && (
          <ConfigSection
            title="Realtime Provider Settings"
            description="Use the original model and voice options from the selected realtime provider endpoint."
            columns={3}
          >
            {provider === 'openai-realtime' && (
              <>
                <ConfigField label="OpenAI Realtime Model">
                  <select
                    value={config.voice.voiceToVoice.model}
                    onChange={(event) => updateVoiceToVoice({ model: event.target.value })}
                  >
                    {openAIRealtimeModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </ConfigField>

                <ConfigField label="OpenAI Voice">
                  <select
                    value={config.voice.voiceToVoice.voice}
                    onChange={(event) => updateVoiceToVoice({ voice: event.target.value })}
                  >
                    {openAIVoices.map((voice) => (
                      <option key={voice} value={voice}>
                        {voice}
                      </option>
                    ))}
                  </select>
                </ConfigField>

                <ConfigField label="Auth Profile Override" hint="Optional. Leave blank to use provider default.">
                  <input
                    value={config.voice.voiceToVoice.authProfile || ''}
                    placeholder="openai-default"
                    onChange={(event) => updateVoiceToVoice({ authProfile: event.target.value || undefined })}
                  />
                </ConfigField>
              </>
            )}

            {provider === 'ultravox-realtime' && (
              <>
                <ConfigField label="Ultravox Model">
                  <select
                    value={config.voice.voiceToVoice.ultravoxModel}
                    onChange={(event) => updateVoiceToVoice({ ultravoxModel: event.target.value })}
                  >
                    {ultravoxModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </ConfigField>

                <ConfigField label="Ultravox Voice">
                  <select
                    value={config.voice.voiceToVoice.voice}
                    onChange={(event) => updateVoiceToVoice({ voice: event.target.value })}
                  >
                    {ultravoxVoiceOptions.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.name}
                        {voice.primaryLanguage ? ` (${voice.primaryLanguage})` : ''}
                      </option>
                    ))}
                  </select>
                </ConfigField>

                <ConfigField label="Auth Profile Override" hint="Optional. Leave blank to use provider default.">
                  <input
                    value={config.voice.voiceToVoice.authProfile || ''}
                    placeholder="ultravox-default"
                    onChange={(event) => updateVoiceToVoice({ authProfile: event.target.value || undefined })}
                  />
                </ConfigField>
              </>
            )}

            {provider === 'gemini-live' && (
              <>
                <ConfigField label="Gemini Live Model">
                  <select
                    value={config.voice.voiceToVoice.geminiModel}
                    onChange={(event) => updateVoiceToVoice({ geminiModel: event.target.value })}
                  >
                    {geminiModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </ConfigField>

                <ConfigField label="Gemini Voice">
                  <select
                    value={config.voice.voiceToVoice.geminiVoice}
                    onChange={(event) =>
                      updateVoiceToVoice({
                        geminiVoice: event.target.value,
                        voice: event.target.value,
                      })
                    }
                  >
                    {geminiVoices.map((voice) => (
                      <option key={voice} value={voice}>
                        {voice}
                      </option>
                    ))}
                  </select>
                </ConfigField>

                <ConfigField label="Auth Profile Override" hint="Optional. Leave blank to use provider default.">
                  <input
                    value={config.voice.voiceToVoice.authProfile || ''}
                    placeholder="google-default"
                    onChange={(event) => updateVoiceToVoice({ authProfile: event.target.value || undefined })}
                  />
                </ConfigField>
              </>
            )}

            {provider === 'pipecat-rtvi' && (
              <>
                <ConfigField label="Pipecat Server URL">
                  <input
                    value={config.voice.voiceToVoice.pipecatServerUrl}
                    onChange={(event) => updateVoiceToVoice({ pipecatServerUrl: event.target.value })}
                    placeholder="ws://localhost:7860"
                  />
                </ConfigField>

                <ConfigField label="Pipecat Transport">
                  <select
                    value={config.voice.voiceToVoice.pipecatTransport}
                    onChange={(event) =>
                      updateVoiceToVoice({
                        pipecatTransport: event.target.value as VoiceConfigDocument['voice']['voiceToVoice']['pipecatTransport'],
                      })
                    }
                  >
                    <option value="websocket">websocket</option>
                    <option value="webrtc">webrtc</option>
                  </select>
                </ConfigField>

                <ConfigField label="Pipecat Bot ID" hint="Optional bot selector for RTVI server.">
                  <input
                    value={config.voice.voiceToVoice.pipecatBotId || ''}
                    onChange={(event) => updateVoiceToVoice({ pipecatBotId: event.target.value || undefined })}
                    placeholder="voice-bot-1"
                  />
                </ConfigField>

                <ConfigField label="Bootstrap Model">
                  <select
                    value={config.voice.voiceToVoice.model}
                    onChange={(event) => updateVoiceToVoice({ model: event.target.value })}
                  >
                    {openAIRealtimeModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </ConfigField>

                <ConfigField label="Bootstrap Voice">
                  <input
                    value={config.voice.voiceToVoice.voice}
                    onChange={(event) => updateVoiceToVoice({ voice: event.target.value })}
                    placeholder="echo"
                  />
                </ConfigField>
              </>
            )}
          </ConfigSection>
        )}

        {isDecomposed && (
          <>
            <ConfigSection
              title="Speech-To-Text (STT)"
              description="Transcribes user audio input before LLM routing."
              columns={3}
            >
              <ConfigField label="Provider">
                <select
                  value={config.voice.decomposed.stt.provider}
                  onChange={(event) => {
                    updateStt({
                      provider: event.target.value as VoiceConfigDocument['voice']['decomposed']['stt']['provider'],
                    });
                  }}
                >
                  <option value="deepgram">deepgram</option>
                  <option value="openai">openai</option>
                </select>
              </ConfigField>

              <ConfigField label="Model">
                <select
                  value={config.voice.decomposed.stt.model}
                  onChange={(event) => updateStt({ model: event.target.value })}
                >
                  {(config.voice.decomposed.stt.provider === 'deepgram'
                    ? deepgramSttModels
                    : withCurrent(OPENAI_TRANSCRIBE_MODELS, config.voice.decomposed.stt.model)
                  ).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </ConfigField>

              <ConfigField label="Auth Profile Override" hint="Optional. Leave blank to use provider default.">
                <input
                  value={config.voice.decomposed.stt.authProfile || ''}
                  placeholder="deepgram-default"
                  onChange={(event) => updateStt({ authProfile: event.target.value || undefined })}
                />
              </ConfigField>
            </ConfigSection>

            <ConfigSection
              title="Language Model (LLM)"
              description="Runs reasoning and tool logic on each completed transcript turn."
              columns={3}
            >
              <ConfigField label="Provider">
                <select
                  value={config.voice.decomposed.llm.provider}
                  onChange={(event) => {
                    updateLlm({
                      provider: event.target.value as VoiceConfigDocument['voice']['decomposed']['llm']['provider'],
                    });
                  }}
                >
                  <option value="openai">openai</option>
                  <option value="openrouter">openrouter</option>
                </select>
              </ConfigField>

              <ConfigField label="Model">
                <select
                  value={config.voice.decomposed.llm.model}
                  onChange={(event) => updateLlm({ model: event.target.value })}
                >
                  {(config.voice.decomposed.llm.provider === 'openai'
                    ? openAITextModels
                    : withCurrent(OPENROUTER_LLM_MODELS, config.voice.decomposed.llm.model)
                  ).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </ConfigField>

              <ConfigField label="Auth Profile Override" hint="Optional. Leave blank to use provider default.">
                <input
                  value={config.voice.decomposed.llm.authProfile || ''}
                  placeholder="openai-default"
                  onChange={(event) => updateLlm({ authProfile: event.target.value || undefined })}
                />
              </ConfigField>
            </ConfigSection>

            <ConfigSection
              title="Text-To-Speech (TTS)"
              description="Synthesizes assistant responses back to audio."
              columns={3}
            >
              <ConfigField label="Provider">
                <select
                  value={config.voice.decomposed.tts.provider}
                  onChange={(event) => {
                    updateTts({
                      provider: event.target.value as VoiceConfigDocument['voice']['decomposed']['tts']['provider'],
                    });
                  }}
                >
                  <option value="deepgram">deepgram</option>
                  <option value="openai">openai</option>
                </select>
              </ConfigField>

              <ConfigField label="Voice / Model">
                <select
                  value={config.voice.decomposed.tts.model}
                  onChange={(event) => {
                    updateTts({
                      model: event.target.value,
                      voice: event.target.value,
                    });
                  }}
                >
                  {(config.voice.decomposed.tts.provider === 'deepgram'
                    ? deepgramTtsVoices
                    : openAIVoices
                  ).map((voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ))}
                </select>
              </ConfigField>

              <ConfigField label="Auth Profile Override" hint="Optional. Leave blank to use provider default.">
                <input
                  value={config.voice.decomposed.tts.authProfile || ''}
                  placeholder="deepgram-default"
                  onChange={(event) => updateTts({ authProfile: event.target.value || undefined })}
                />
              </ConfigField>
            </ConfigSection>
          </>
        )}

        <ConfigSection
          title="Turn Detection"
          description="Tune speech turn completion and optional LLM completion fallbacks."
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

        <ConfigSection
          title="Profile Resolution"
          description="Shows the effective runtime per wake-word profile and any static overrides."
          columns={1}
        >
          <p className="cfg-key-value">
            Jarvis: {effectiveSummary.jarvis || 'loading...'}
            {'\n'}
            Marvin: {effectiveSummary.marvin || 'loading...'}
          </p>
          <p className="cfg-key-value">
            {overridesText ? `Profile overrides: ${overridesText}` : 'Profile overrides: none'}
          </p>
          <p className="voice-runtime-info">
            Realtime provider configuration maps to adapter providerConfig at session creation time.
          </p>
        </ConfigSection>
      </ConfigDialog>
    </>
  );
}
