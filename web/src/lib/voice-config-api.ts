const API_BASE = process.env.PUBLIC_API_URL || '';

export type VoiceMode = 'voice-to-voice' | 'decomposed';

export interface VoiceConfigDocument {
  voice: {
    mode: VoiceMode;
    language: string;
    profileOverrides: Record<string, { mode?: VoiceMode; voice?: string; provider?: string }>;
    voiceToVoice: {
      provider: 'openai-realtime' | 'gemini-live' | 'ultravox-realtime';
      model: string;
      voice: string;
      authProfile?: string;
      ultravoxModel: string;
      geminiModel: string;
      geminiVoice: string;
    };
    decomposed: {
      stt: { provider: 'deepgram' | 'openai'; model: string; language: string; authProfile?: string };
      llm: { provider: 'openai' | 'openrouter'; model: string; authProfile?: string };
      tts: { provider: 'deepgram' | 'openai'; model: string; voice: string; authProfile?: string };
    };
    turn: {
      strategy: 'provider-native' | 'layered';
      silenceMs: number;
      minSpeechMs: number;
      minRms: number;
      llmCompletion: {
        enabled: boolean;
        shortTimeoutMs: number;
        longTimeoutMs: number;
        shortReprompt: string;
        longReprompt: string;
      };
    };
  };
}

export interface AuthProfilesDocument {
  profiles: Record<string, {
    provider: 'openai' | 'openrouter' | 'google' | 'deepgram' | 'ultravox';
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
  defaults: Partial<Record<'openai' | 'openrouter' | 'google' | 'deepgram' | 'ultravox', string>>;
}

export interface VoiceCatalog {
  openai: {
    realtimeModels: string[];
    textModels: string[];
    voices: string[];
  };
  deepgram: {
    sttModels: string[];
    ttsVoices: string[];
  };
  ultravox: {
    models: string[];
    voices: Array<{ voiceId: string; name: string; primaryLanguage?: string }>;
  };
  gemini: {
    models: string[];
    voices: string[];
  };
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
  provider?: 'openai' | 'openrouter' | 'google' | 'deepgram' | 'ultravox';
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
