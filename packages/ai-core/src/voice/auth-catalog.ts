import type { ProviderConfigSchema, ProviderVoiceEntry } from './types.js';

export const RUNTIME_AUTH_PROVIDERS = [
  'openai',
  'openrouter',
  'anthropic',
  'google',
  'gemini',
  'deepgram',
  'cartesia',
  'fish',
  'rime',
  'ultravox',
  'openclaw',
] as const;

export type RuntimeAuthProvider = (typeof RUNTIME_AUTH_PROVIDERS)[number];

export interface RuntimeAuthProfile {
  provider: RuntimeAuthProvider;
  type: 'api-key' | 'oauth';
  enabled: boolean;
  apiKey?: string;
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    scopes?: string[];
  };
}

export interface RuntimeAuthProfilesDocument {
  profiles: Record<string, RuntimeAuthProfile>;
  defaults: Partial<Record<RuntimeAuthProvider, string>>;
}

export interface RuntimeAuthKeySet {
  openaiApiKey: string;
  openrouterApiKey: string;
  anthropicApiKey: string;
  googleApiKey: string;
  deepgramApiKey: string;
  cartesiaApiKey: string;
  fishAudioApiKey: string;
  rimeApiKey: string;
  ultravoxApiKey: string;
  openclawToken: string;
}

export type RuntimeAuthKeyByProvider = Record<RuntimeAuthProvider, string>;

export interface RuntimeCatalogEntry {
  models?: string[];
  voices?: ProviderVoiceEntry[];
}

export interface RuntimeProviderCatalog {
  entries: Record<string, RuntimeCatalogEntry>;
  providerSchemas: Record<string, ProviderConfigSchema>;
}

const DEFAULT_OPENAI_REALTIME_MODELS = [
  'gpt-realtime-mini-2025-10-06',
  'gpt-realtime',
];
const DEFAULT_OPENAI_TEXT_MODELS = ['gpt-4.1', 'gpt-4o-mini'];
const DEFAULT_OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
];
const DEFAULT_DEEPGRAM_STT_MODELS = ['nova-3', 'nova-2'];
const DEFAULT_DEEPGRAM_TTS_VOICES = [
  'aura-2-thalia-en',
  'aura-2-luna-en',
  'aura-2-cora-en',
];
const DEFAULT_CARTESIA_TTS_VOICES = ['f9836c6e-a0bd-460e-9d3c-f7299fa60f94'];
const DEFAULT_FISH_TTS_VOICES = ['fish_default'];
const DEFAULT_RIME_TTS_VOICES = ['alloy'];
const DEFAULT_GOOGLE_CHIRP_TTS_VOICES = [
  'en-US-Chirp3-HD-Charon',
  'en-US-Chirp3-HD-Leda',
  'en-US-Chirp3-HD-Puck',
];
const DEFAULT_KOKORO_TTS_VOICES = ['af_nicole', 'af_bella'];
const DEFAULT_POCKET_TTS_VOICES = ['alba', 'marius', 'javert'];
const DEFAULT_LOCAL_STT_MODELS = ['mlx-community/parakeet-tdt-0.6b-v3'];
const DEFAULT_LOCAL_TTS_MODELS = [
  'qwen3-0.6b',
  'qwen3-1.7b',
  'qwen3-1.7b-vd',
  'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16',
  'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit',
  'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16',
  'mlx-community/Kokoro-82M-bf16',
];
const DEFAULT_ULTRAVOX_MODELS = ['ultravox-v0.7'];
const DEFAULT_GEMINI_MODELS = ['gemini-2.5-flash-native-audio-preview'];
const DEFAULT_GEMINI_VOICES = [
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Aoede',
  'Leda',
  'Orus',
  'Zephyr',
];
const DEFAULT_OPENAI_TRANSCRIBE_MODELS = [
  'gpt-4o-mini-transcribe',
  'gpt-4o-transcribe',
];
const DEFAULT_OPENROUTER_LLM_MODELS = [
  'openai/gpt-4.1',
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash',
  'anthropic/claude-sonnet-4',
];
const DEFAULT_ANTHROPIC_LLM_MODELS = [
  'claude-sonnet-4-5',
  'claude-opus-4-1',
  'claude-haiku-4-5',
];
const DEFAULT_GOOGLE_LLM_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
];

export function createDefaultRuntimeAuthProfiles(): RuntimeAuthProfilesDocument {
  return { profiles: {}, defaults: {} };
}

export function resolveRuntimeApiKey(
  provider: RuntimeAuthProvider,
  options: {
    authProfileId?: string;
    authProfiles: RuntimeAuthProfilesDocument;
    env?: Record<string, string | undefined>;
  }
): string {
  const authProfiles = options.authProfiles;
  const env = options.env ?? process.env;
  const profileId = options.authProfileId ?? authProfiles.defaults[provider];
  if (profileId) {
    const profile = authProfiles.profiles[profileId];
    if (profile?.enabled && profile.type === 'api-key' && profile.apiKey) {
      return profile.apiKey;
    }
  }

  if (provider === 'openai') return env.OPENAI_API_KEY ?? '';
  if (provider === 'openrouter') {
    return env.OPEN_ROUTER_API_KEY ?? env.OPENROUTER_API_KEY ?? '';
  }
  if (provider === 'anthropic') return env.ANTHROPIC_API_KEY ?? '';
  if (provider === 'google' || provider === 'gemini') {
    return env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY ?? '';
  }
  if (provider === 'deepgram') return env.DEEPGRAM_API_KEY ?? '';
  if (provider === 'cartesia') return env.CARTESIA_API_KEY ?? '';
  if (provider === 'fish') {
    return env.FISH_AUDIO_API_KEY ?? env.FISH_API_KEY ?? '';
  }
  if (provider === 'rime') return env.RIME_API_KEY ?? '';
  if (provider === 'ultravox') return env.ULTRAVOX_API_KEY ?? '';
  if (provider === 'openclaw') return env.OPENCLAW_TOKEN ?? '';
  return '';
}

export function resolveRuntimeAuthKeySet(input: {
  authProfiles: RuntimeAuthProfilesDocument;
  env?: Record<string, string | undefined>;
}): RuntimeAuthKeySet {
  return {
    openaiApiKey: resolveRuntimeApiKey('openai', input),
    openrouterApiKey: resolveRuntimeApiKey('openrouter', input),
    anthropicApiKey: resolveRuntimeApiKey('anthropic', input),
    googleApiKey:
      resolveRuntimeApiKey('google', input) || resolveRuntimeApiKey('gemini', input),
    deepgramApiKey: resolveRuntimeApiKey('deepgram', input),
    cartesiaApiKey: resolveRuntimeApiKey('cartesia', input),
    fishAudioApiKey: resolveRuntimeApiKey('fish', input),
    rimeApiKey: resolveRuntimeApiKey('rime', input),
    ultravoxApiKey: resolveRuntimeApiKey('ultravox', input),
    openclawToken: resolveRuntimeApiKey('openclaw', input),
  };
}

export function runtimeAuthKeySetToProviderMap(
  auth: RuntimeAuthKeySet
): RuntimeAuthKeyByProvider {
  return {
    openai: auth.openaiApiKey,
    openrouter: auth.openrouterApiKey,
    anthropic: auth.anthropicApiKey,
    google: auth.googleApiKey,
    gemini: auth.googleApiKey,
    deepgram: auth.deepgramApiKey,
    cartesia: auth.cartesiaApiKey,
    fish: auth.fishAudioApiKey,
    rime: auth.rimeApiKey,
    ultravox: auth.ultravoxApiKey,
    openclaw: auth.openclawToken,
  };
}

function mapSchemaVoices(
  voices: string[],
  schemaVoices?: ProviderVoiceEntry[]
): ProviderVoiceEntry[] {
  if (schemaVoices && schemaVoices.length > 0) {
    return voices.map((voiceId) => {
      const schemaMatch = schemaVoices.find((voice) => voice.id === voiceId);
      return schemaMatch ?? { id: voiceId, name: voiceId, language: 'multi' };
    });
  }
  return voices.map((voiceId) => ({ id: voiceId, name: voiceId, language: 'multi' }));
}

function extractTrailingLanguageTag(value: string): string | undefined {
  const match = value.match(/(?:^|[-_])([a-z]{2}(?:-[a-z]{2})?)$/i);
  if (!match?.[1]) return undefined;
  return match[1].toLowerCase();
}

function prettifyDeepgramVoiceName(voiceId: string): string {
  const auraMatch = voiceId.match(
    /^aura(?:-\d+)?-([a-z0-9-]+)-[a-z]{2}(?:-[a-z]{2})?$/i
  );
  if (!auraMatch?.[1]) return voiceId;

  return auraMatch[1]
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function mapDeepgramTtsVoices(voiceIds: string[]): ProviderVoiceEntry[] {
  return voiceIds.map((voiceId) => ({
    id: voiceId,
    name: prettifyDeepgramVoiceName(voiceId),
    language: extractTrailingLanguageTag(voiceId),
  }));
}

async function fetchOpenAICatalog(apiKey: string): Promise<{
  realtimeModels: string[];
  textModels: string[];
  voices: string[];
}> {
  const fallback = {
    realtimeModels: DEFAULT_OPENAI_REALTIME_MODELS,
    textModels: DEFAULT_OPENAI_TEXT_MODELS,
    voices: DEFAULT_OPENAI_VOICES,
  };

  if (!apiKey) return fallback;

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return fallback;

    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    const ids = (payload.data ?? []).map((item) => item.id ?? '').filter(Boolean);
    const realtimeModels = ids.filter((id) => id.includes('realtime')).sort();
    const textModels = ids
      .filter((id) => id.startsWith('gpt-4') || id.startsWith('gpt-5'))
      .slice(0, 80)
      .sort();

    return {
      realtimeModels:
        realtimeModels.length > 0 ? realtimeModels : fallback.realtimeModels,
      textModels: textModels.length > 0 ? textModels : fallback.textModels,
      voices: fallback.voices,
    };
  } catch {
    return fallback;
  }
}

async function fetchDeepgramCatalog(apiKey: string): Promise<{
  sttModels: string[];
  ttsVoices: string[];
}> {
  const fallback = {
    sttModels: DEFAULT_DEEPGRAM_STT_MODELS,
    ttsVoices: DEFAULT_DEEPGRAM_TTS_VOICES,
  };

  if (!apiKey) return fallback;

  try {
    const response = await fetch('https://api.deepgram.com/v1/models', {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!response.ok) return fallback;

    const payload = (await response.json()) as {
      stt?: Array<{ canonical_name?: string; streaming?: boolean }>;
      tts?: Array<{ canonical_name?: string }>;
    };

    const sttModels = Array.from(
      new Set(
        (payload.stt ?? [])
          .filter((model) => model.streaming)
          .map((model) => model.canonical_name ?? '')
          .filter(Boolean)
      )
    ).sort();
    const ttsVoices = Array.from(
      new Set(
        (payload.tts ?? [])
          .map((model) => model.canonical_name ?? '')
          .filter(Boolean)
      )
    ).sort();

    return {
      sttModels: sttModels.length > 0 ? sttModels : fallback.sttModels,
      ttsVoices: ttsVoices.length > 0 ? ttsVoices : fallback.ttsVoices,
    };
  } catch {
    return fallback;
  }
}

async function fetchUltravoxCatalog(apiKey: string): Promise<{
  models: string[];
  voices: Array<{ voiceId: string; name: string; primaryLanguage?: string }>;
}> {
  const fallback = {
    models: DEFAULT_ULTRAVOX_MODELS,
    voices: [] as Array<{
      voiceId: string;
      name: string;
      primaryLanguage?: string;
    }>,
  };

  if (!apiKey) return fallback;

  try {
    const modelRes = await fetch('https://api.ultravox.ai/api/models', {
      headers: { 'X-API-Key': apiKey },
    });
    const voiceRes = await fetch('https://api.ultravox.ai/api/voices', {
      headers: { 'X-API-Key': apiKey },
    });

    let models = fallback.models;
    if (modelRes.ok) {
      const modelPayload = (await modelRes.json()) as {
        results?: Array<{ name?: string }>;
      };
      const discovered = (modelPayload.results ?? [])
        .map((entry) => entry.name ?? '')
        .filter(Boolean)
        .sort();
      if (discovered.length > 0) models = discovered;
    }

    let voices = fallback.voices;
    if (voiceRes.ok) {
      const voicePayload = (await voiceRes.json()) as {
        results?: Array<{ voiceId?: string; name?: string; primaryLanguage?: string }>;
      };
      voices = (voicePayload.results ?? [])
        .filter((voice) => voice.voiceId && voice.name)
        .map((voice) => ({
          voiceId: voice.voiceId as string,
          name: voice.name as string,
          primaryLanguage: voice.primaryLanguage,
        }));
    }

    return { models, voices };
  } catch {
    return fallback;
  }
}

async function fetchAnthropicCatalog(apiKey: string): Promise<{ models: string[] }> {
  const fallback = {
    models: DEFAULT_ANTHROPIC_LLM_MODELS,
  };

  if (!apiKey) return fallback;

  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) return fallback;

    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    const models = (payload.data ?? [])
      .map((entry) => entry.id ?? '')
      .filter(Boolean)
      .sort();

    return {
      models: models.length > 0 ? models : fallback.models,
    };
  } catch {
    return fallback;
  }
}

async function fetchGoogleLlmCatalog(apiKey: string): Promise<{ models: string[] }> {
  const fallback = {
    models: DEFAULT_GOOGLE_LLM_MODELS,
  };

  if (!apiKey) return fallback;

  try {
    const url = new URL(
      'https://generativelanguage.googleapis.com/v1beta/models'
    );
    url.searchParams.set('key', apiKey);
    const response = await fetch(url);
    if (!response.ok) return fallback;

    const payload = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };

    const models = (payload.models ?? [])
      .map((entry) => entry.name ?? '')
      .filter((name) => name.startsWith('models/'))
      .map((name) => name.replace(/^models\//, ''))
      .filter((name) => name.startsWith('gemini-'))
      .sort();

    return {
      models: models.length > 0 ? models : fallback.models,
    };
  } catch {
    return fallback;
  }
}

export async function fetchRuntimeProviderCatalog(input: {
  openaiApiKey: string;
  deepgramApiKey: string;
  cartesiaApiKey?: string;
  fishAudioApiKey?: string;
  rimeApiKey?: string;
  ultravoxApiKey: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  providerSchemas?: Record<string, ProviderConfigSchema>;
}): Promise<RuntimeProviderCatalog> {
  const [openai, deepgram, ultravox, anthropic, google] = await Promise.all([
    fetchOpenAICatalog(input.openaiApiKey),
    fetchDeepgramCatalog(input.deepgramApiKey),
    fetchUltravoxCatalog(input.ultravoxApiKey),
    fetchAnthropicCatalog(input.anthropicApiKey ?? ''),
    fetchGoogleLlmCatalog(input.googleApiKey ?? ''),
  ]);

  const providerSchemas = input.providerSchemas ?? {};

  const openaiVoices = mapSchemaVoices(
    openai.voices,
    providerSchemas['openai-realtime']?.voices
  );
  const geminiVoices =
    providerSchemas['gemini-live']?.voices ??
    DEFAULT_GEMINI_VOICES.map((voiceId) => ({
      id: voiceId,
      name: voiceId,
      language: 'multi',
    }));
  const ultravoxVoices = ultravox.voices.map((voice) => ({
    id: voice.voiceId,
    name: voice.name,
    language: voice.primaryLanguage,
  }));

  return {
    entries: {
      'openai-realtime': {
        models: openai.realtimeModels,
        voices: openaiVoices,
      },
      'ultravox-realtime': {
        models: ultravox.models,
        voices: ultravoxVoices,
      },
      'gemini-live': {
        models: DEFAULT_GEMINI_MODELS,
        voices: geminiVoices,
      },
      'openai-stt': {
        models: DEFAULT_OPENAI_TRANSCRIBE_MODELS,
      },
      'deepgram-stt': {
        models: deepgram.sttModels,
      },
      'local-stt': {
        models: DEFAULT_LOCAL_STT_MODELS,
      },
      'openai-llm': {
        models: openai.textModels,
      },
      'openrouter-llm': {
        models: DEFAULT_OPENROUTER_LLM_MODELS,
      },
      'anthropic-llm': {
        models: anthropic.models,
      },
      'google-llm': {
        models: google.models,
      },
      'openai-tts': {
        voices: openaiVoices,
      },
      'deepgram-tts': {
        voices: mapDeepgramTtsVoices(deepgram.ttsVoices),
      },
      'cartesia-tts': {
        voices: mapSchemaVoices(
          DEFAULT_CARTESIA_TTS_VOICES,
          providerSchemas.decomposed?.voices
        ),
      },
      'fish-tts': {
        voices: mapSchemaVoices(DEFAULT_FISH_TTS_VOICES, providerSchemas.decomposed?.voices),
      },
      'rime-tts': {
        voices: mapSchemaVoices(DEFAULT_RIME_TTS_VOICES, providerSchemas.decomposed?.voices),
      },
      'google-chirp-tts': {
        voices: mapSchemaVoices(
          DEFAULT_GOOGLE_CHIRP_TTS_VOICES,
          providerSchemas.decomposed?.voices
        ),
      },
      'kokoro-tts': {
        voices: mapSchemaVoices(DEFAULT_KOKORO_TTS_VOICES, providerSchemas.decomposed?.voices),
      },
      'pocket-tts': {
        voices: mapSchemaVoices(DEFAULT_POCKET_TTS_VOICES, providerSchemas.decomposed?.voices),
      },
      'local-tts': {
        models: DEFAULT_LOCAL_TTS_MODELS,
      },
      'openclaw-llm': {
        models: ['openclaw-channel'],
      },
    },
    providerSchemas,
  };
}

export async function fetchRuntimeProviderCatalogFromAuthProfiles(input: {
  authProfiles: RuntimeAuthProfilesDocument;
  env?: Record<string, string | undefined>;
  providerSchemas?: Record<string, ProviderConfigSchema>;
}): Promise<RuntimeProviderCatalog> {
  const authKeys = resolveRuntimeAuthKeySet({
    authProfiles: input.authProfiles,
    env: input.env,
  });

  return fetchRuntimeProviderCatalog({
    openaiApiKey: authKeys.openaiApiKey,
    deepgramApiKey: authKeys.deepgramApiKey,
    cartesiaApiKey: authKeys.cartesiaApiKey,
    fishAudioApiKey: authKeys.fishAudioApiKey,
    rimeApiKey: authKeys.rimeApiKey,
    ultravoxApiKey: authKeys.ultravoxApiKey,
    anthropicApiKey: authKeys.anthropicApiKey,
    googleApiKey: authKeys.googleApiKey,
    providerSchemas: input.providerSchemas,
  });
}

export async function testRuntimeProviderCredentials(
  provider: RuntimeAuthProvider,
  apiKey: string
): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return {
        ok: res.ok,
        status: res.status,
        message: res.ok ? 'OpenAI credentials valid' : await res.text(),
      };
    }

    if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return {
        ok: res.ok,
        status: res.status,
        message: res.ok ? 'OpenRouter credentials valid' : await res.text(),
      };
    }

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      return {
        ok: res.ok,
        status: res.status,
        message: res.ok ? 'Anthropic credentials valid' : await res.text(),
      };
    }

    if (provider === 'google' || provider === 'gemini') {
      const url = new URL(
        'https://generativelanguage.googleapis.com/v1beta/models'
      );
      url.searchParams.set('key', apiKey);
      const res = await fetch(url);
      return {
        ok: res.ok,
        status: res.status,
        message: res.ok ? 'Google/Gemini credentials valid' : await res.text(),
      };
    }

    if (provider === 'deepgram') {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${apiKey}` },
      });
      return {
        ok: res.ok,
        status: res.status,
        message: res.ok ? 'Deepgram credentials valid' : await res.text(),
      };
    }

    if (provider === 'cartesia') {
      const url = new URL('https://api.cartesia.ai/tts/websocket');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('cartesia_version', '2025-04-16');
      const res = await fetch(url, { method: 'GET' });
      return {
        ok: res.ok || res.status === 426,
        status: res.status,
        message:
          res.ok || res.status === 426
            ? 'Cartesia credentials look valid (websocket endpoint reachable)'
            : await res.text(),
      };
    }

    if (provider === 'fish') {
      const res = await fetch('https://api.fish.audio/model', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return {
        ok: res.ok,
        status: res.status,
        message: res.ok ? 'Fish credentials valid' : await res.text(),
      };
    }

    if (provider === 'rime') {
      const res = await fetch('https://users.rime.ai/v1/voices', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return {
        ok: res.ok,
        status: res.status,
        message: res.ok ? 'Rime credentials valid' : await res.text(),
      };
    }

    if (provider === 'openclaw') {
      // OpenClaw uses a local token — just check it's not empty
      return {
        ok: !!apiKey,
        status: apiKey ? 200 : 401,
        message: apiKey ? 'OpenClaw token configured' : 'OpenClaw token not set',
      };
    }

    const res = await fetch('https://api.ultravox.ai/api/models', {
      headers: { 'X-API-Key': apiKey },
    });
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? 'Ultravox credentials valid' : await res.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      message: (error as Error).message,
    };
  }
}
