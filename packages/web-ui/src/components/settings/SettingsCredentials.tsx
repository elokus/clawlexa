// ═══════════════════════════════════════════════════════════════════════════
// Settings: Credentials - Auth profile management
// ═══════════════════════════════════════════════════════════════════════════

import { useConfigStore } from '../../stores/config-store';
import { SettingsSection, SettingsField } from './SettingsSection';

export function SettingsCredentials() {
  const authProfiles = useConfigStore((s) => s.authProfiles);
  const authLoading = useConfigStore((s) => s.authLoading);
  const authError = useConfigStore((s) => s.authError);
  const setAuthProfiles = useConfigStore((s) => s.setAuthProfiles);
  const testAuth = useConfigStore((s) => s.testAuth);
  const authTestResults = useConfigStore((s) => s.authTestResults);

  if (authLoading) {
    return <div className="settings-loading">Loading credentials...</div>;
  }

  if (authError) {
    return (
      <SettingsSection title="Error" columns={1}>
        <div style={{ color: 'var(--color-rose)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {authError}
        </div>
      </SettingsSection>
    );
  }

  if (!authProfiles) return null;

  const profileEntries = Object.entries(authProfiles.profiles);

  const updateProfile = (profileId: string, key: string, value: unknown) => {
    const profile = authProfiles.profiles[profileId];
    if (!profile) return;
    setAuthProfiles({
      ...authProfiles,
      profiles: {
        ...authProfiles.profiles,
        [profileId]: { ...profile, [key]: value },
      },
    });
  };

  const updateDefault = (provider: string, profileId: string | undefined) => {
    const next = { ...authProfiles.defaults };
    if (profileId) {
      next[provider] = profileId;
    } else {
      delete next[provider];
    }
    setAuthProfiles({ ...authProfiles, defaults: next });
  };

  // Collect unique providers from profiles
  const providers = [...new Set(profileEntries.map(([, p]) => p.provider))].sort();

  return (
    <>
      <style>{`
        .credential-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 20px 24px;
          margin-bottom: 12px;
        }

        .credential-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .credential-name {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 500;
          color: var(--foreground);
        }

        .credential-provider-badge {
          font-family: var(--font-mono);
          font-size: 11px;
          padding: 3px 10px;
          background: color-mix(in oklch, var(--color-blue) 8%, transparent);
          border: 1px solid var(--color-blue-muted);
          border-radius: 4px;
          color: var(--color-blue);
        }

        .credential-fields {
          display: grid;
          grid-template-columns: 2fr 1fr auto;
          gap: 16px;
          align-items: end;
        }

        .credential-test-btn {
          padding: 9px 18px;
          background: color-mix(in oklch, var(--color-green) 8%, transparent);
          border: 1px solid var(--color-green-muted);
          border-radius: 6px;
          color: var(--color-green);
          font-family: var(--font-sans);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .credential-test-btn:hover:not(:disabled) {
          background: color-mix(in oklch, var(--color-green) 14%, transparent);
        }

        .credential-test-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .credential-test-result {
          margin-top: 10px;
          font-family: var(--font-sans);
          font-size: 12px;
          padding: 8px 12px;
          border-radius: 6px;
        }

        .credential-test-result.success {
          color: var(--color-green);
          background: color-mix(in oklch, var(--color-green) 6%, transparent);
        }

        .credential-test-result.error {
          color: var(--color-red);
          background: color-mix(in oklch, var(--color-red) 6%, transparent);
        }

        @media (max-width: 800px) {
          .credential-fields {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <SettingsSection
        title="Auth Profiles"
        description="API keys and credentials for voice providers. Keys are redacted for display."
        columns={1}
      >
        {profileEntries.length === 0 && (
          <div style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            No auth profiles configured. Add profiles in .voiceclaw/auth-profiles.json.
          </div>
        )}

        {profileEntries.map(([id, profile]) => {
          const testResult = authTestResults[id];
          const isTesting = testResult === 'testing';

          return (
            <div key={id} className="credential-card">
              <div className="credential-header">
                <span className="credential-name">{id}</span>
                <span className="credential-provider-badge">{profile.provider}</span>
              </div>

              <div className="credential-fields">
                <SettingsField label="API Key">
                  <input
                    type="password"
                    value={profile.apiKey ?? ''}
                    placeholder="(redacted)"
                    onChange={(e) => updateProfile(id, 'apiKey', e.target.value)}
                  />
                </SettingsField>

                <SettingsField label="Enabled">
                  <select
                    value={profile.enabled ? 'true' : 'false'}
                    onChange={(e) => updateProfile(id, 'enabled', e.target.value === 'true')}
                  >
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </SettingsField>

                <button
                  type="button"
                  className="credential-test-btn"
                  disabled={isTesting}
                  onClick={() => void testAuth(id, profile.provider)}
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>
              </div>

              {testResult && testResult !== 'testing' && (
                <div className={`credential-test-result ${testResult.ok ? 'success' : 'error'}`}>
                  {testResult.ok ? 'Connected successfully' : testResult.message}
                </div>
              )}
            </div>
          );
        })}
      </SettingsSection>

      {providers.length > 0 && (
        <SettingsSection
          title="Default Profiles"
          description="Set the default auth profile for each provider."
          columns={2}
        >
          {providers.map((provider) => {
            const matchingProfiles = profileEntries
              .filter(([, p]) => p.provider === provider)
              .map(([id]) => id);

            return (
              <SettingsField key={provider} label={provider}>
                <select
                  value={authProfiles.defaults[provider] ?? ''}
                  onChange={(e) => updateDefault(provider, e.target.value || undefined)}
                >
                  <option value="">(none)</option>
                  {matchingProfiles.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </SettingsField>
            );
          })}
        </SettingsSection>
      )}
    </>
  );
}
