import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  createDefaultRuntimeAuthProfiles,
  createDefaultRuntimeVoiceConfig,
  resolveRuntimeApiKey,
  RUNTIME_AUTH_PROVIDERS,
  RUNTIME_LLM_PROVIDERS,
  RUNTIME_STT_PROVIDERS,
  RUNTIME_TTS_PROVIDERS,
  RUNTIME_VOICE_MODES,
  RUNTIME_VOICE_TO_VOICE_PROVIDERS,
  type RuntimeAuthProfile as AuthProfile,
  type RuntimeAuthProfilesDocument as AuthProfilesDocument,
  type RuntimeAuthProvider as AuthProvider,
  type RuntimeLlmProvider as LlmProvider,
  type RuntimeSttProvider as SttProvider,
  type RuntimeTtsProvider as TtsProvider,
  type RuntimeVoiceConfigDocument as VoiceConfigDocument,
  type RuntimeVoiceMode as VoiceMode,
  type RuntimeVoiceToVoiceProvider as VoiceToVoiceProvider,
} from '@voiceclaw/voice-runtime';

export type {
  VoiceMode,
  VoiceToVoiceProvider,
  SttProvider,
  LlmProvider,
  TtsProvider,
  AuthProvider,
  VoiceConfigDocument,
  AuthProfile,
  AuthProfilesDocument,
};

const voiceConfigSchema: z.ZodType<VoiceConfigDocument> = z.object({
  voice: z.object({
    mode: z.enum(RUNTIME_VOICE_MODES),
    language: z.string(),
    profileOverrides: z.record(
      z.string(),
      z.object({
        mode: z.enum(RUNTIME_VOICE_MODES).optional(),
        voice: z.string().optional(),
        provider: z.enum(RUNTIME_VOICE_TO_VOICE_PROVIDERS).optional(),
      })
    ),
    voiceToVoice: z.object({
      provider: z.enum(RUNTIME_VOICE_TO_VOICE_PROVIDERS),
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
        provider: z.enum(RUNTIME_STT_PROVIDERS),
        model: z.string(),
        language: z.string(),
        authProfile: z.string().optional(),
      }),
      llm: z.object({
        provider: z.enum(RUNTIME_LLM_PROVIDERS),
        model: z.string(),
        authProfile: z.string().optional(),
      }),
      tts: z.object({
        provider: z.enum(RUNTIME_TTS_PROVIDERS),
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
      spokenStreamEnabled: z.boolean(),
      wordAlignmentEnabled: z.boolean(),
      customSttMode: z.enum(['provider', 'custom', 'hybrid']),
      llmCompletion: z.object({
        enabled: z.boolean(),
        shortTimeoutMs: z.number().int().positive(),
        longTimeoutMs: z.number().int().positive(),
        shortReprompt: z.string(),
        longReprompt: z.string(),
      }),
    }),
    providerSettings: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  }),
});

const authProfilesSchema: z.ZodType<AuthProfilesDocument> = z.object({
  profiles: z.record(
    z.string(),
    z.object({
      provider: z.enum(RUNTIME_AUTH_PROVIDERS),
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
  defaults: z.record(z.string(), z.string()).default({}),
});

const DEFAULT_VOICE_CONFIG: VoiceConfigDocument = createDefaultRuntimeVoiceConfig(process.env);

const DEFAULT_AUTH_PROFILES: AuthProfilesDocument = createDefaultRuntimeAuthProfiles();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
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
  return resolveRuntimeApiKey(provider, {
    authProfileId: options.authProfileId,
    authProfiles,
    env: process.env,
  });
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
