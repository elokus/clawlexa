const API_BASE = process.env.PUBLIC_API_URL || '';

export type VoiceMode = 'voice-to-voice' | 'decomposed';

// Provider config schema types (mirrored from @voiceclaw/voice-runtime)
export type ConfigFieldType = 'select' | 'number' | 'boolean' | 'string' | 'range';

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigFieldDescriptor {
  key: string;
  label: string;
  type: ConfigFieldType;
  group: 'vad' | 'advanced' | 'audio';
  description?: string;
  options?: ConfigFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number | boolean;
  dependsOn?: { field: string; value: string | boolean };
}

export interface ProviderVoiceEntry {
  id: string;
  name: string;
  language?: string;
  gender?: string;
}

export interface ProviderConfigSchema {
  providerId: string;
  displayName: string;
  fields: ConfigFieldDescriptor[];
  voices?: ProviderVoiceEntry[];
}

export interface VoiceConfigDocument {
  voice: {
    mode: VoiceMode;
    language: string;
    profileOverrides: Record<string, { mode?: VoiceMode; voice?: string; provider?: string }>;
    voiceToVoice: {
      provider: string;
      [key: string]: unknown;
    };
    decomposed: {
      stt: { provider: string; [key: string]: unknown };
      llm: { provider: string; [key: string]: unknown };
      tts: { provider: string; [key: string]: unknown };
    };
    turn: {
      strategy: 'provider-native' | 'layered';
      silenceMs: number;
      minSpeechMs: number;
      minRms: number;
      spokenHighlightMsPerWord: number;
      spokenHighlightPunctuationPauseMs: number;
      preferProviderTimestamps: boolean;
      llmCompletion: {
        enabled: boolean;
        shortTimeoutMs: number;
        longTimeoutMs: number;
        shortReprompt: string;
        longReprompt: string;
      };
    };
    providerSettings?: Record<string, Record<string, unknown>>;
  };
}

export interface AuthProfilesDocument {
  profiles: Record<string, {
    provider: string;
    type: 'api-key' | 'oauth';
    enabled: boolean;
    apiKey?: string;
    oauth?: {
      clientId?: string;
      clientSecret?: string;
      refreshToken?: string;
      scopes?: string[];
    };
  }>;
  defaults: Partial<Record<string, string>>;
}

export interface RuntimeCatalogEntry {
  models?: string[];
  voices?: ProviderVoiceEntry[];
}

export interface RuntimeFieldBinding {
  path: string;
  label: string;
  kind: 'model' | 'voice' | 'auth' | 'string' | 'select';
  catalogKey?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface RuntimeRealtimeProviderManifest {
  id: string;
  label: string;
  fields: RuntimeFieldBinding[];
}

export interface RuntimeDecomposedStageProviderManifest {
  id: string;
  label: string;
  modelCatalogKey?: string;
  voiceCatalogKey?: string;
}

export interface RuntimeDecomposedStageManifest {
  id: 'stt' | 'llm' | 'tts';
  label: string;
  providerPath: string;
  modelPath: string;
  voicePath?: string;
  authPath: string;
  providers: RuntimeDecomposedStageProviderManifest[];
}

export interface RuntimeConfigManifest {
  modes: VoiceMode[];
  realtimeProviderPath: string;
  realtimeProviders: RuntimeRealtimeProviderManifest[];
  decomposedStages: RuntimeDecomposedStageManifest[];
}

export interface VoiceCatalog {
  manifest: RuntimeConfigManifest;
  providerCatalog: Record<string, RuntimeCatalogEntry>;
  providerSchemas?: Record<string, ProviderConfigSchema>;
  authProfileNames?: string[];
}

export async function fetchVoiceConfig(): Promise<VoiceConfigDocument> {
  const res = await fetch(`${API_BASE}/api/config/voice`);
  if (!res.ok) {
    throw new Error(`Failed to fetch voice config: ${res.status}`);
  }
  const payload = await res.json() as { config: VoiceConfigDocument };
  return payload.config;
}

export async function fetchVoiceCatalog(): Promise<VoiceCatalog> {
  const res = await fetch(`${API_BASE}/api/config/voice/catalog`);
  if (!res.ok) {
    throw new Error(`Failed to fetch voice catalog: ${res.status}`);
  }
  return res.json();
}

export async function saveVoiceConfig(config: VoiceConfigDocument): Promise<VoiceConfigDocument> {
  const res = await fetch(`${API_BASE}/api/config/voice`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to save voice config (${res.status}): ${text}`);
  }
  const payload = await res.json() as { config: VoiceConfigDocument };
  return payload.config;
}

export async function fetchEffectiveVoiceConfig(
  profile: string
): Promise<{
  profile: string;
  mode: string;
  provider: string;
  language: string;
  voice: string;
  model: string;
  decomposed: { stt: string; llm: string; tts: string };
  auth: Record<string, string>;
  turn: VoiceConfigDocument['voice']['turn'];
}> {
  const res = await fetch(
    `${API_BASE}/api/config/voice/effective?profile=${encodeURIComponent(profile)}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch effective voice config (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchAuthProfiles(redacted = false): Promise<AuthProfilesDocument> {
  const url = new URL(`${API_BASE}/api/config/auth-profiles`, window.location.origin);
  if (redacted) {
    url.searchParams.set('redacted', 'true');
  }

  const res = await fetch(url.pathname + url.search);
  if (!res.ok) {
    throw new Error(`Failed to fetch auth profiles: ${res.status}`);
  }
  const payload = await res.json() as { config: AuthProfilesDocument };
  return payload.config;
}

export async function saveAuthProfiles(config: AuthProfilesDocument): Promise<AuthProfilesDocument> {
  const res = await fetch(`${API_BASE}/api/config/auth-profiles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to save auth profiles (${res.status}): ${text}`);
  }
  const payload = await res.json() as { config: AuthProfilesDocument };
  return payload.config;
}

export async function testAuthProfile(input: {
  provider?: string;
  authProfileId?: string;
}): Promise<{ provider: string; ok: boolean; status: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/config/auth-profiles/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const payload = await res.json() as {
    provider: string;
    ok: boolean;
    status: number;
    message: string;
    error?: string;
  };

  if (!res.ok && !payload.provider) {
    throw new Error(payload.error || `Auth profile test failed (${res.status})`);
  }

  return {
    provider: payload.provider,
    ok: payload.ok,
    status: payload.status,
    message: payload.message,
  };
}
