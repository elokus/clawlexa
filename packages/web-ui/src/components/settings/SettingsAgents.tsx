// ═══════════════════════════════════════════════════════════════════════════
// Settings: Agents - Profile management, prompts, tools, wake words
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useConfigStore } from '../../stores/config-store';
import { useUnifiedSessionsStore, usePromptsState } from '../../stores';
import { SettingsSection, SettingsField } from './SettingsSection';

export function SettingsAgents() {
  const config = useConfigStore((s) => s.config);
  const updatePath = useConfigStore((s) => s.updatePath);
  const effectiveConfigs = useConfigStore((s) => s.effectiveConfigs);

  // Load prompts data
  const loadPrompts = useUnifiedSessionsStore((s) => s.loadPrompts);
  const { prompts, promptsLoading } = usePromptsState();

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  if (!config) return null;

  const profiles = Object.entries(config.voice.profileOverrides);
  const voiceProfiles = prompts.filter((p) => p.type === 'voice');

  return (
    <>
      <style>{`
        .agent-profile-card {
          background: rgba(5, 5, 12, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          padding: 20px 24px;
          margin-bottom: 12px;
        }

        .agent-profile-header {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 16px;
        }

        .agent-profile-name {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--color-text-bright);
          text-transform: capitalize;
        }

        .agent-profile-meta {
          font-family: var(--font-ui);
          font-size: 12px;
          color: var(--color-text-dim);
          line-height: 1.4;
        }

        .agent-profile-fields {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        .agent-profile-effective {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          line-height: 1.6;
        }

        @media (max-width: 900px) {
          .agent-profile-fields {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 600px) {
          .agent-profile-fields {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <SettingsSection
        title="Voice Profiles"
        description="Each profile defines a voice agent with its own wake word, prompt, voice, and tool set."
        columns={1}
      >
        {voiceProfiles.length === 0 && !promptsLoading && (
          <div style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            No voice profiles found. Profiles are defined in packages/voice-agent/prompts/.
          </div>
        )}

        {voiceProfiles.map((profile) => {
          const override = config.voice.profileOverrides[profile.id] ?? {};
          const effective = effectiveConfigs[profile.id];

          return (
            <div key={profile.id} className="agent-profile-card">
              <div className="agent-profile-header">
                <span className="agent-profile-name">{profile.name}</span>
                <span className="agent-profile-meta">{profile.description}</span>
              </div>

              <div className="agent-profile-fields">
                <SettingsField label="Voice Override">
                  <input
                    type="text"
                    value={override.voice ?? ''}
                    placeholder="(use default)"
                    onChange={(e) =>
                      updatePath(
                        `voice.profileOverrides.${profile.id}.voice`,
                        e.target.value || undefined
                      )
                    }
                  />
                </SettingsField>

                <SettingsField label="Mode Override">
                  <select
                    value={override.mode ?? ''}
                    onChange={(e) =>
                      updatePath(
                        `voice.profileOverrides.${profile.id}.mode`,
                        e.target.value || undefined
                      )
                    }
                  >
                    <option value="">(use default)</option>
                    <option value="voice-to-voice">voice-to-voice</option>
                    <option value="decomposed">decomposed</option>
                  </select>
                </SettingsField>

                <SettingsField label="Provider Override">
                  <input
                    type="text"
                    value={override.provider ?? ''}
                    placeholder="(use default)"
                    onChange={(e) =>
                      updatePath(
                        `voice.profileOverrides.${profile.id}.provider`,
                        e.target.value || undefined
                      )
                    }
                  />
                </SettingsField>
              </div>

              {effective && (
                <div className="agent-profile-effective">
                  Effective: {effective.mode} | {effective.provider} | voice={effective.voice} | model={effective.model}
                </div>
              )}
            </div>
          );
        })}

        {/* Show raw overrides for profiles not in prompts */}
        {profiles
          .filter(([name]) => !voiceProfiles.some((p) => p.id === name))
          .map(([name, override]) => (
            <div key={name} className="agent-profile-card">
              <div className="agent-profile-header">
                <span className="agent-profile-name">{name}</span>
                <span className="agent-profile-meta">Override only (no prompt found)</span>
              </div>
              <div className="agent-profile-fields">
                <SettingsField label="Voice Override">
                  <input
                    type="text"
                    value={override.voice ?? ''}
                    placeholder="(use default)"
                    onChange={(e) =>
                      updatePath(`voice.profileOverrides.${name}.voice`, e.target.value || undefined)
                    }
                  />
                </SettingsField>
                <SettingsField label="Mode Override">
                  <select
                    value={override.mode ?? ''}
                    onChange={(e) =>
                      updatePath(`voice.profileOverrides.${name}.mode`, e.target.value || undefined)
                    }
                  >
                    <option value="">(use default)</option>
                    <option value="voice-to-voice">voice-to-voice</option>
                    <option value="decomposed">decomposed</option>
                  </select>
                </SettingsField>
              </div>
            </div>
          ))}
      </SettingsSection>
    </>
  );
}
