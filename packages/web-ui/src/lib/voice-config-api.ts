import type {
  ConfigFieldDescriptor,
  ConfigFieldOption,
  ConfigFieldType,
  ProviderConfigSchema,
  ProviderVoiceEntry,
  RuntimeAuthProfilesDocument as AuthProfilesDocument,
  RuntimeCatalogEntry,
  RuntimeConfigManifest,
  RuntimeDecomposedStageManifest,
  RuntimeDecomposedStageProviderManifest,
  RuntimeFieldBinding,
  RuntimeRealtimeProviderManifest,
  RuntimeVoiceConfigDocument as VoiceConfigDocument,
  RuntimeVoiceMode as VoiceMode,
} from '@voiceclaw/voice-runtime';

export type {
  ConfigFieldDescriptor,
  ConfigFieldOption,
  ConfigFieldType,
  ProviderConfigSchema,
  ProviderVoiceEntry,
  AuthProfilesDocument,
  RuntimeCatalogEntry,
  RuntimeConfigManifest,
  RuntimeDecomposedStageManifest,
  RuntimeDecomposedStageProviderManifest,
  RuntimeFieldBinding,
  RuntimeRealtimeProviderManifest,
  VoiceConfigDocument,
  VoiceMode,
};

const API_BASE = process.env.PUBLIC_API_URL || '';

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

// ─── Voice Library API ─────────────────────────────────────────────────────

export interface VoiceMeta {
  label: string;
  refText: string;
  language: string;
  instruct?: string;
  model?: string;
  seed?: number;
  createdAt: string;
}

export async function fetchVoices(): Promise<VoiceMeta[]> {
  const res = await fetch(`${API_BASE}/api/config/voices`);
  if (!res.ok) {
    throw new Error(`Failed to fetch voices: ${res.status}`);
  }
  const payload = await res.json() as { voices: VoiceMeta[] };
  return payload.voices;
}

export async function createVoice(data: {
  label: string;
  refText: string;
  language: string;
  instruct?: string;
  model?: string;
  seed?: number;
  wavBase64: string;
}): Promise<VoiceMeta> {
  const res = await fetch(`${API_BASE}/api/config/voices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create voice (${res.status}): ${text}`);
  }
  const payload = await res.json() as { voice: VoiceMeta };
  return payload.voice;
}

export async function deleteVoiceApi(label: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/config/voices/${encodeURIComponent(label)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete voice (${res.status}): ${text}`);
  }
}

export function voiceAudioUrl(label: string): string {
  return `${API_BASE}/api/config/voices/${encodeURIComponent(label)}/audio`;
}

export async function designVoice(data: {
  label: string;
  instruct: string;
  text: string;
  language?: string;
  seed?: number;
  temperature?: number;
  model?: string;
}): Promise<VoiceMeta> {
  const res = await fetch(`${API_BASE}/api/config/voices/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to design voice (${res.status}): ${text}`);
  }
  const payload = await res.json() as { voice: VoiceMeta };
  return payload.voice;
}

// ─── Auth Profile API ─────────────────────────────────────────────────────

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
