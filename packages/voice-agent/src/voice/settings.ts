import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

export type VoiceMode = 'voice-to-voice' | 'decomposed';
export type VoiceToVoiceProvider =
  | 'openai-realtime'
  | 'gemini-live'
  | 'ultravox-realtime'
  | 'pipecat-rtvi';
export type SttProvider = 'deepgram' | 'openai';
export type LlmProvider = 'openai' | 'openrouter';
export type TtsProvider = 'deepgram' | 'openai';
export type AuthProvider = 'openai' | 'openrouter' | 'google' | 'deepgram' | 'ultravox';

export interface VoiceConfigDocument {
  voice: {
    mode: VoiceMode;
    language: string;
    profileOverrides: Record<string, {
      mode?: VoiceMode;
      voice?: string;
      provider?: VoiceToVoiceProvider;
    }>;
    voiceToVoice: {
      provider: VoiceToVoiceProvider;
      model: string;
      voice: string;
      authProfile?: string;
      ultravoxModel: string;
      geminiModel: string;
      geminiVoice: string;
      pipecatServerUrl: string;
      pipecatTransport: 'websocket' | 'webrtc';
      pipecatBotId?: string;
    };
    decomposed: {
      stt: {
        provider: SttProvider;
        model: string;
        language: string;
        authProfile?: string;
      };
      llm: {
        provider: LlmProvider;
        model: string;
        authProfile?: string;
      };
      tts: {
        provider: TtsProvider;
        model: string;
        voice: string;
        authProfile?: string;
      };
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

export interface AuthProfile {
  provider: AuthProvider;
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

export interface AuthProfilesDocument {
  profiles: Record<string, AuthProfile>;
  defaults: Partial<Record<AuthProvider, string>>;
}

const voiceConfigSchema: z.ZodType<VoiceConfigDocument> = z.object({
  voice: z.object({
    mode: z.enum(['voice-to-voice', 'decomposed']),
    language: z.string(),
    profileOverrides: z.record(
      z.string(),
      z.object({
        mode: z.enum(['voice-to-voice', 'decomposed']).optional(),
        voice: z.string().optional(),
        provider: z
          .enum(['openai-realtime', 'gemini-live', 'ultravox-realtime', 'pipecat-rtvi'])
          .optional(),
      })
    ),
    voiceToVoice: z.object({
      provider: z.enum(['openai-realtime', 'gemini-live', 'ultravox-realtime', 'pipecat-rtvi']),
      model: z.string(),
      voice: z.string(),
      authProfile: z.string().optional(),
      ultravoxModel: z.string(),
      geminiModel: z.string(),
      geminiVoice: z.string(),
      pipecatServerUrl: z.string(),
      pipecatTransport: z.enum(['websocket', 'webrtc']),
      pipecatBotId: z.string().optional(),
    }),
    decomposed: z.object({
      stt: z.object({
        provider: z.enum(['deepgram', 'openai']),
        model: z.string(),
        language: z.string(),
        authProfile: z.string().optional(),
      }),
      llm: z.object({
        provider: z.enum(['openai', 'openrouter']),
        model: z.string(),
        authProfile: z.string().optional(),
      }),
      tts: z.object({
        provider: z.enum(['deepgram', 'openai']),
        model: z.string(),
        voice: z.string(),
        authProfile: z.string().optional(),
      }),
    }),
    turn: z.object({
      strategy: z.enum(['provider-native', 'layered']),
      silenceMs: z.number().int().positive(),
      minSpeechMs: z.number().int().positive(),
      minRms: z.number().positive(),
      llmCompletion: z.object({
        enabled: z.boolean(),
        shortTimeoutMs: z.number().int().positive(),
        longTimeoutMs: z.number().int().positive(),
        shortReprompt: z.string(),
        longReprompt: z.string(),
      }),
    }),
  }),
});

const authProfilesSchema: z.ZodType<AuthProfilesDocument> = z.object({
  profiles: z.record(
    z.string(),
    z.object({
      provider: z.enum(['openai', 'openrouter', 'google', 'deepgram', 'ultravox']),
      type: z.enum(['api-key', 'oauth']),
      enabled: z.boolean(),
      apiKey: z.string().optional(),
      oauth: z
        .object({
          clientId: z.string().optional(),
          clientSecret: z.string().optional(),
          refreshToken: z.string().optional(),
          scopes: z.array(z.string()).optional(),
        })
        .optional(),
    })
  ),
  defaults: z
    .object({
      openai: z.string().optional(),
      openrouter: z.string().optional(),
      google: z.string().optional(),
      deepgram: z.string().optional(),
      ultravox: z.string().optional(),
    })
    .partial(),
});

const DEFAULT_VOICE_CONFIG: VoiceConfigDocument = {
  voice: {
    mode: 'voice-to-voice',
    language: process.env.VOICE_LANGUAGE ?? 'de',
    profileOverrides: {},
    voiceToVoice: {
      provider: 'openai-realtime',
      model: process.env.VOICE_REALTIME_MODEL ?? 'gpt-realtime-mini-2025-10-06',
      voice: 'echo',
      ultravoxModel: process.env.ULTRAVOX_MODEL ?? 'fixie-ai/ultravox-70B',
      geminiModel: process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-preview',
      geminiVoice: process.env.GEMINI_VOICE ?? 'Puck',
      pipecatServerUrl: process.env.PIPECAT_RTVI_SERVER_URL ?? 'ws://localhost:7860',
      pipecatTransport: process.env.PIPECAT_RTVI_TRANSPORT === 'webrtc' ? 'webrtc' : 'websocket',
      pipecatBotId: process.env.PIPECAT_BOT_ID,
    },
    decomposed: {
      stt: {
        provider: 'deepgram',
        model: process.env.DECOMPOSED_STT_MODEL ?? 'nova-3',
        language: process.env.VOICE_LANGUAGE ?? 'de',
      },
      llm: {
        provider: 'openai',
        model: process.env.DECOMPOSED_LLM_MODEL ?? 'gpt-4.1',
      },
      tts: {
        provider: 'deepgram',
        model: process.env.DECOMPOSED_TTS_MODEL ?? 'aura-2-thalia-en',
        voice: process.env.DECOMPOSED_TTS_VOICE ?? 'aura-2-thalia-en',
      },
    },
    turn: {
      strategy: 'layered',
      silenceMs: parseInt(process.env.VOICE_TURN_SILENCE_MS ?? '700', 10),
      minSpeechMs: parseInt(process.env.VOICE_TURN_MIN_SPEECH_MS ?? '350', 10),
      minRms: parseFloat(process.env.VOICE_TURN_MIN_RMS ?? '0.015'),
      llmCompletion: {
        enabled: (process.env.VOICE_LLM_COMPLETION_ENABLED ?? 'false') === 'true',
        shortTimeoutMs: parseInt(process.env.VOICE_LLM_SHORT_TIMEOUT_MS ?? '5000', 10),
        longTimeoutMs: parseInt(process.env.VOICE_LLM_LONG_TIMEOUT_MS ?? '10000', 10),
        shortReprompt:
          process.env.VOICE_LLM_SHORT_REPROMPT ??
          'Kannst du den Gedanken bitte noch vervollständigen?',
        longReprompt:
          process.env.VOICE_LLM_LONG_REPROMPT ??
          'Ich bin noch da. Sag einfach weiter, wenn du bereit bist.',
      },
    },
  },
};

const DEFAULT_AUTH_PROFILES: AuthProfilesDocument = {
  profiles: {},
  defaults: {},
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_DIR = process.env.VOICE_CONFIG_DIR ?? path.join(REPO_ROOT, '.voiceclaw');
const VOICE_CONFIG_PATH = process.env.VOICE_CONFIG_PATH ?? path.join(CONFIG_DIR, 'voice.config.json');
const AUTH_PROFILES_PATH = process.env.AUTH_PROFILES_PATH ?? path.join(CONFIG_DIR, 'auth-profiles.json');

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readJson(pathname: string): unknown {
  try {
    if (!fs.existsSync(pathname)) return null;
    const content = fs.readFileSync(pathname, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read JSON file ${pathname}: ${(error as Error).message}`);
  }
}

function writeJson(pathname: string, value: unknown): void {
  ensureConfigDir();
  fs.writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

type JsonObject = Record<string, unknown>;

function deepMerge<T extends JsonObject>(base: T, patch: Partial<T>): T {
  const result: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    const existing = result[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(existing as JsonObject, value as JsonObject);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

function parseVoiceConfig(value: unknown): VoiceConfigDocument {
  if (!value) {
    return DEFAULT_VOICE_CONFIG;
  }

  // Merge user file over defaults before schema validation.
  const merged = deepMerge(DEFAULT_VOICE_CONFIG as unknown as JsonObject, value as JsonObject);
  const parsed = voiceConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Invalid voice.config.json: ${parsed.error.message}`);
  }
  return parsed.data;
}

function parseAuthProfiles(value: unknown): AuthProfilesDocument {
  if (!value) {
    return DEFAULT_AUTH_PROFILES;
  }

  const merged = deepMerge(DEFAULT_AUTH_PROFILES as unknown as JsonObject, value as JsonObject);
  const parsed = authProfilesSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Invalid auth-profiles.json: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function getVoiceConfigPath(): string {
  return VOICE_CONFIG_PATH;
}

export function getAuthProfilesPath(): string {
  return AUTH_PROFILES_PATH;
}

export function loadVoiceConfig(): VoiceConfigDocument {
  const raw = readJson(VOICE_CONFIG_PATH);
  return parseVoiceConfig(raw);
}

export function saveVoiceConfig(config: VoiceConfigDocument): VoiceConfigDocument {
  const parsed = parseVoiceConfig(config);
  writeJson(VOICE_CONFIG_PATH, parsed);
  return parsed;
}

export function loadAuthProfiles(): AuthProfilesDocument {
  const raw = readJson(AUTH_PROFILES_PATH);
  return parseAuthProfiles(raw);
}

export function saveAuthProfiles(config: AuthProfilesDocument): AuthProfilesDocument {
  const parsed = parseAuthProfiles(config);
  writeJson(AUTH_PROFILES_PATH, parsed);
  return parsed;
}

export function resolveApiKey(
  provider: AuthProvider,
  options: { authProfileId?: string; authProfiles?: AuthProfilesDocument } = {}
): string {
  const authProfiles = options.authProfiles ?? loadAuthProfiles();

  const profileId = options.authProfileId ?? authProfiles.defaults[provider];
  if (profileId) {
    const profile = authProfiles.profiles[profileId];
    if (profile && profile.enabled && profile.type === 'api-key' && profile.apiKey) {
      return profile.apiKey;
    }
  }

  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY ?? '';
    case 'openrouter':
      return process.env.OPEN_ROUTER_API_KEY ?? '';
    case 'google':
      return process.env.GOOGLE_API_KEY ?? '';
    case 'deepgram':
      return process.env.DEEPGRAM_API_KEY ?? '';
    case 'ultravox':
      return process.env.ULTRAVOX_API_KEY ?? '';
    default:
      return '';
  }
}

export function redactAuthProfiles(doc: AuthProfilesDocument): AuthProfilesDocument {
  const redactedProfiles: AuthProfilesDocument['profiles'] = {};
  for (const [id, profile] of Object.entries(doc.profiles)) {
    redactedProfiles[id] = {
      ...profile,
      apiKey: profile.apiKey ? `***${profile.apiKey.slice(-4)}` : undefined,
      oauth: profile.oauth
        ? {
            ...profile.oauth,
            clientSecret: profile.oauth.clientSecret ? '***' : undefined,
            refreshToken: profile.oauth.refreshToken ? '***' : undefined,
          }
        : undefined,
    };
  }

  return {
    profiles: redactedProfiles,
    defaults: { ...doc.defaults },
  };
}

export function ensureDefaultConfigFiles(): void {
  ensureConfigDir();

  if (!fs.existsSync(VOICE_CONFIG_PATH)) {
    writeJson(VOICE_CONFIG_PATH, DEFAULT_VOICE_CONFIG);
  }

  if (!fs.existsSync(AUTH_PROFILES_PATH)) {
    writeJson(AUTH_PROFILES_PATH, DEFAULT_AUTH_PROFILES);
  }
}
