import { DecomposedAdapter } from './adapters/decomposed-adapter.js';
import { GeminiLiveAdapter } from './adapters/gemini-live-adapter.js';
import { OpenAISdkAdapter } from './adapters/openai-sdk-adapter.js';
import { PipecatRtviAdapter } from './adapters/pipecat-rtvi-adapter.js';
import { UltravoxWsAdapter } from './adapters/ultravox-ws-adapter.js';
import type { VoiceBenchmarkThresholds } from './benchmarks/voice-benchmark.js';
import { parseProviderConfig } from './provider-config.js';
import type { ProviderRegistration } from './runtime/voice-runtime.js';
import type {
  ProviderConfigSchema,
  ProviderVoiceEntry,
  SessionInput,
  ToolCallHandler,
  ToolDefinition,
  VoiceProviderId,
} from './types.js';

export const RUNTIME_VOICE_MODES = ['voice-to-voice', 'decomposed'] as const;
export type RuntimeVoiceMode = (typeof RUNTIME_VOICE_MODES)[number];

export const RUNTIME_VOICE_TO_VOICE_PROVIDERS = [
  'openai-realtime',
  'gemini-live',
  'ultravox-realtime',
  'pipecat-rtvi',
] as const;
export type RuntimeVoiceToVoiceProvider =
  (typeof RUNTIME_VOICE_TO_VOICE_PROVIDERS)[number];

export const RUNTIME_STT_PROVIDERS = ['deepgram', 'openai'] as const;
export type RuntimeSttProvider = (typeof RUNTIME_STT_PROVIDERS)[number];

export const RUNTIME_LLM_PROVIDERS = ['openai', 'openrouter'] as const;
export type RuntimeLlmProvider = (typeof RUNTIME_LLM_PROVIDERS)[number];

export const RUNTIME_TTS_PROVIDERS = ['deepgram', 'openai'] as const;
export type RuntimeTtsProvider = (typeof RUNTIME_TTS_PROVIDERS)[number];

export const RUNTIME_AUTH_PROVIDERS = [
  'openai',
  'openrouter',
  'google',
  'gemini',
  'deepgram',
  'ultravox',
] as const;
export type RuntimeAuthProvider = (typeof RUNTIME_AUTH_PROVIDERS)[number];

export type RuntimeProviderName = RuntimeVoiceToVoiceProvider | 'decomposed';

export interface RuntimeVoiceConfigDocument {
  voice: {
    mode: RuntimeVoiceMode;
    language: string;
    profileOverrides: Record<
      string,
      {
        mode?: RuntimeVoiceMode;
        voice?: string;
        provider?: RuntimeVoiceToVoiceProvider;
      }
    >;
    voiceToVoice: {
      provider: RuntimeVoiceToVoiceProvider;
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
        provider: RuntimeSttProvider;
        model: string;
        language: string;
        authProfile?: string;
      };
      llm: {
        provider: RuntimeLlmProvider;
        model: string;
        authProfile?: string;
      };
      tts: {
        provider: RuntimeTtsProvider;
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
    providerSettings?: Record<string, Record<string, unknown>>;
  };
}

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
  googleApiKey: string;
  deepgramApiKey: string;
  ultravoxApiKey: string;
}

export type RuntimeAuthKeyByProvider = Record<RuntimeAuthProvider, string>;

export interface RuntimeResolvedConfig {
  mode: RuntimeVoiceMode;
  provider: RuntimeProviderName;
  language: string;
  voice: string;
  model: string;
  geminiModel: string;
  geminiVoice: string;
  ultravoxModel: string;
  pipecatServerUrl: string;
  pipecatTransport: 'websocket' | 'webrtc';
  pipecatBotId?: string;
  decomposedSttProvider: RuntimeSttProvider;
  decomposedSttModel: string;
  decomposedLlmProvider: RuntimeLlmProvider;
  decomposedLlmModel: string;
  decomposedTtsProvider: RuntimeTtsProvider;
  decomposedTtsModel: string;
  decomposedTtsVoice: string;
  auth: RuntimeAuthKeySet;
  turn: {
    strategy: 'provider-native' | 'layered';
    silenceMs: number;
    minSpeechMs: number;
    minRms: number;
    llmCompletionEnabled: boolean;
    llmShortTimeoutMs: number;
    llmLongTimeoutMs: number;
    llmShortReprompt: string;
    llmLongReprompt: string;
  };
  providerSettings: Record<string, unknown>;
}

export interface RuntimeSessionInputBuildInput {
  instructions: string;
  language: string;
  voice: string;
  provider: RuntimeProviderName;
  model: string;
  geminiModel: string;
  ultravoxModel: string;
  pipecatServerUrl: string;
  pipecatTransport: 'websocket' | 'webrtc';
  pipecatBotId?: string;
  decomposedSttProvider: RuntimeSttProvider;
  decomposedSttModel: string;
  decomposedLlmProvider: RuntimeLlmProvider;
  decomposedLlmModel: string;
  decomposedTtsProvider: RuntimeTtsProvider;
  decomposedTtsModel: string;
  decomposedTtsVoice: string;
  turn: RuntimeResolvedConfig['turn'];
  providerSettings: Record<string, unknown>;
  auth: RuntimeAuthKeySet;
  tools?: ToolDefinition[];
  toolHandler?: ToolCallHandler;
}

export interface RuntimeCatalogEntry {
  models?: string[];
  voices?: ProviderVoiceEntry[];
}

export interface RuntimeProviderCatalog {
  entries: Record<string, RuntimeCatalogEntry>;
  providerSchemas: Record<string, ProviderConfigSchema>;
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
  id: RuntimeVoiceToVoiceProvider;
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
  modes: RuntimeVoiceMode[];
  realtimeProviderPath: string;
  realtimeProviders: RuntimeRealtimeProviderManifest[];
  decomposedStages: RuntimeDecomposedStageManifest[];
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
];

const DEFAULT_RUNTIME_BENCHMARK_THRESHOLDS: Record<
  RuntimeProviderName,
  VoiceBenchmarkThresholds
> = {
  'openai-realtime': {
    maxFirstAudioLatencyMs: 1_200,
    maxP95ChunkGapMs: 240,
    maxChunkGapMs: 500,
    maxRealtimeFactor: 1.25,
    maxInterruptionP95Ms: 180,
  },
  'ultravox-realtime': {
    maxFirstAudioLatencyMs: 1_800,
    maxP95ChunkGapMs: 360,
    maxChunkGapMs: 700,
    maxRealtimeFactor: 1.45,
    maxInterruptionP95Ms: 260,
  },
  'gemini-live': {
    maxFirstAudioLatencyMs: 1_600,
    maxP95ChunkGapMs: 320,
    maxChunkGapMs: 650,
    maxRealtimeFactor: 1.4,
    maxInterruptionP95Ms: 240,
  },
  'pipecat-rtvi': {
    maxFirstAudioLatencyMs: 2_000,
    maxP95ChunkGapMs: 420,
    maxChunkGapMs: 850,
    maxRealtimeFactor: 1.55,
    maxInterruptionP95Ms: 320,
  },
  decomposed: {
    maxFirstAudioLatencyMs: 2_200,
    maxP95ChunkGapMs: 450,
    maxChunkGapMs: 900,
    maxRealtimeFactor: 1.7,
    maxInterruptionP95Ms: 320,
  },
};

export function createDefaultRuntimeVoiceConfig(
  env: Record<string, string | undefined> = process.env
): RuntimeVoiceConfigDocument {
  const voiceLanguage = env.VOICE_LANGUAGE ?? 'de';
  return {
    voice: {
      mode: 'voice-to-voice',
      language: voiceLanguage,
      profileOverrides: {},
      voiceToVoice: {
        provider: 'openai-realtime',
        model: env.VOICE_REALTIME_MODEL ?? 'gpt-realtime-mini-2025-10-06',
        voice: 'echo',
        ultravoxModel: env.ULTRAVOX_MODEL ?? 'fixie-ai/ultravox-70B',
        geminiModel:
          env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-latest',
        geminiVoice: env.GEMINI_VOICE ?? 'Puck',
        pipecatServerUrl: env.PIPECAT_RTVI_SERVER_URL ?? 'ws://localhost:7860',
        pipecatTransport:
          env.PIPECAT_RTVI_TRANSPORT === 'webrtc' ? 'webrtc' : 'websocket',
        pipecatBotId: env.PIPECAT_BOT_ID,
      },
      decomposed: {
        stt: {
          provider: 'deepgram',
          model: env.DECOMPOSED_STT_MODEL ?? 'nova-3',
          language: voiceLanguage,
        },
        llm: {
          provider: 'openai',
          model: env.DECOMPOSED_LLM_MODEL ?? 'gpt-4.1',
        },
        tts: {
          provider: 'deepgram',
          model: env.DECOMPOSED_TTS_MODEL ?? 'aura-2-thalia-en',
          voice: env.DECOMPOSED_TTS_VOICE ?? 'aura-2-thalia-en',
        },
      },
      turn: {
        strategy: 'layered',
        silenceMs: parseInt(env.VOICE_TURN_SILENCE_MS ?? '700', 10),
        minSpeechMs: parseInt(env.VOICE_TURN_MIN_SPEECH_MS ?? '350', 10),
        minRms: parseFloat(env.VOICE_TURN_MIN_RMS ?? '0.015'),
        llmCompletion: {
          enabled: (env.VOICE_LLM_COMPLETION_ENABLED ?? 'false') === 'true',
          shortTimeoutMs: parseInt(env.VOICE_LLM_SHORT_TIMEOUT_MS ?? '5000', 10),
          longTimeoutMs: parseInt(env.VOICE_LLM_LONG_TIMEOUT_MS ?? '10000', 10),
          shortReprompt:
            env.VOICE_LLM_SHORT_REPROMPT ??
            'Kannst du den Gedanken bitte noch vervollständigen?',
          longReprompt:
            env.VOICE_LLM_LONG_REPROMPT ??
            'Ich bin noch da. Sag einfach weiter, wenn du bereit bist.',
        },
      },
    },
  };
}

export function getDefaultRuntimeBenchmarkThresholds(
  provider: RuntimeProviderName
): VoiceBenchmarkThresholds {
  return { ...DEFAULT_RUNTIME_BENCHMARK_THRESHOLDS[provider] };
}

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
  if (provider === 'openrouter') return env.OPEN_ROUTER_API_KEY ?? '';
  if (provider === 'google' || provider === 'gemini') {
    return env.GOOGLE_API_KEY ?? '';
  }
  if (provider === 'deepgram') return env.DEEPGRAM_API_KEY ?? '';
  if (provider === 'ultravox') return env.ULTRAVOX_API_KEY ?? '';
  return '';
}

export function resolveRuntimeAuthKeySet(input: {
  authProfiles: RuntimeAuthProfilesDocument;
  env?: Record<string, string | undefined>;
}): RuntimeAuthKeySet {
  return {
    openaiApiKey: resolveRuntimeApiKey('openai', input),
    openrouterApiKey: resolveRuntimeApiKey('openrouter', input),
    googleApiKey:
      resolveRuntimeApiKey('google', input) || resolveRuntimeApiKey('gemini', input),
    deepgramApiKey: resolveRuntimeApiKey('deepgram', input),
    ultravoxApiKey: resolveRuntimeApiKey('ultravox', input),
  };
}

export function runtimeAuthKeySetToProviderMap(
  auth: RuntimeAuthKeySet
): RuntimeAuthKeyByProvider {
  return {
    openai: auth.openaiApiKey,
    openrouter: auth.openrouterApiKey,
    google: auth.googleApiKey,
    gemini: auth.googleApiKey,
    deepgram: auth.deepgramApiKey,
    ultravox: auth.ultravoxApiKey,
  };
}

export function normalizeRuntimeMode(
  value: string | undefined
): RuntimeVoiceMode {
  return value === 'decomposed' ? 'decomposed' : 'voice-to-voice';
}

export function normalizeRuntimeProvider(
  value: string | undefined
): RuntimeProviderName {
  if (value === 'gemini-live') return 'gemini-live';
  if (value === 'ultravox-realtime') return 'ultravox-realtime';
  if (value === 'pipecat-rtvi') return 'pipecat-rtvi';
  if (value === 'decomposed') return 'decomposed';
  return 'openai-realtime';
}

export function resolveRuntimeConfigFromDocuments(input: {
  profileName: string;
  profileVoice: string;
  fallbackModel: string;
  voiceConfig: RuntimeVoiceConfigDocument;
  authProfiles: RuntimeAuthProfilesDocument;
  env?: Record<string, string | undefined>;
}): RuntimeResolvedConfig {
  const env = input.env ?? process.env;
  const profileKey = input.profileName.toLowerCase();
  const override = input.voiceConfig.voice.profileOverrides[profileKey] ?? {};

  const mode = env.VOICE_MODE
    ? normalizeRuntimeMode(env.VOICE_MODE)
    : override.mode ?? input.voiceConfig.voice.mode;

  const configuredProvider =
    override.provider ?? input.voiceConfig.voice.voiceToVoice.provider;
  const provider = env.VOICE_PROVIDER
    ? normalizeRuntimeProvider(env.VOICE_PROVIDER)
    : mode === 'decomposed'
      ? 'decomposed'
      : configuredProvider;

  let voice: string;
  if (mode === 'decomposed') {
    voice =
      override.voice ??
      input.voiceConfig.voice.decomposed.tts.voice ??
      input.profileVoice;
  } else if (provider === 'gemini-live') {
    voice = override.voice ?? input.voiceConfig.voice.voiceToVoice.geminiVoice;
  } else {
    voice =
      override.voice ??
      input.voiceConfig.voice.voiceToVoice.voice ??
      input.profileVoice;
  }

  const voiceToVoiceAuthProfile = input.voiceConfig.voice.voiceToVoice.authProfile;
  const decomposedLlmAuthProfile = input.voiceConfig.voice.decomposed.llm.authProfile;
  const decomposedSttAuthProfile = input.voiceConfig.voice.decomposed.stt.authProfile;
  const decomposedTtsAuthProfile = input.voiceConfig.voice.decomposed.tts.authProfile;

  const openaiApiKey = resolveRuntimeApiKey('openai', {
    authProfileId:
      mode === 'decomposed'
        ? decomposedLlmAuthProfile
        : provider === 'openai-realtime'
          ? voiceToVoiceAuthProfile
          : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const openrouterApiKey = resolveRuntimeApiKey('openrouter', {
    authProfileId: decomposedLlmAuthProfile,
    authProfiles: input.authProfiles,
    env,
  });
  const googleApiKey =
    resolveRuntimeApiKey('google', {
      authProfileId: provider === 'gemini-live' ? voiceToVoiceAuthProfile : undefined,
      authProfiles: input.authProfiles,
      env,
    }) ||
    resolveRuntimeApiKey('gemini', {
      authProfileId: provider === 'gemini-live' ? voiceToVoiceAuthProfile : undefined,
      authProfiles: input.authProfiles,
      env,
    });
  const deepgramApiKey = resolveRuntimeApiKey('deepgram', {
    authProfileId: decomposedSttAuthProfile ?? decomposedTtsAuthProfile,
    authProfiles: input.authProfiles,
    env,
  });
  const ultravoxApiKey = resolveRuntimeApiKey('ultravox', {
    authProfileId: provider === 'ultravox-realtime' ? voiceToVoiceAuthProfile : undefined,
    authProfiles: input.authProfiles,
    env,
  });

  return {
    mode,
    provider,
    language: input.voiceConfig.voice.language,
    voice,
    model: input.voiceConfig.voice.voiceToVoice.model || input.fallbackModel,
    geminiModel: input.voiceConfig.voice.voiceToVoice.geminiModel,
    geminiVoice: input.voiceConfig.voice.voiceToVoice.geminiVoice,
    ultravoxModel: input.voiceConfig.voice.voiceToVoice.ultravoxModel,
    pipecatServerUrl: input.voiceConfig.voice.voiceToVoice.pipecatServerUrl,
    pipecatTransport: input.voiceConfig.voice.voiceToVoice.pipecatTransport,
    pipecatBotId: input.voiceConfig.voice.voiceToVoice.pipecatBotId,
    decomposedSttProvider: input.voiceConfig.voice.decomposed.stt.provider,
    decomposedSttModel: input.voiceConfig.voice.decomposed.stt.model,
    decomposedLlmProvider: input.voiceConfig.voice.decomposed.llm.provider,
    decomposedLlmModel: input.voiceConfig.voice.decomposed.llm.model,
    decomposedTtsProvider: input.voiceConfig.voice.decomposed.tts.provider,
    decomposedTtsModel: input.voiceConfig.voice.decomposed.tts.model,
    decomposedTtsVoice: input.voiceConfig.voice.decomposed.tts.voice,
    auth: {
      openaiApiKey,
      openrouterApiKey,
      googleApiKey,
      deepgramApiKey,
      ultravoxApiKey,
    },
    turn: {
      strategy: input.voiceConfig.voice.turn.strategy,
      silenceMs: input.voiceConfig.voice.turn.silenceMs,
      minSpeechMs: input.voiceConfig.voice.turn.minSpeechMs,
      minRms: input.voiceConfig.voice.turn.minRms,
      llmCompletionEnabled: input.voiceConfig.voice.turn.llmCompletion.enabled,
      llmShortTimeoutMs: input.voiceConfig.voice.turn.llmCompletion.shortTimeoutMs,
      llmLongTimeoutMs: input.voiceConfig.voice.turn.llmCompletion.longTimeoutMs,
      llmShortReprompt: input.voiceConfig.voice.turn.llmCompletion.shortReprompt,
      llmLongReprompt: input.voiceConfig.voice.turn.llmCompletion.longReprompt,
    },
    providerSettings: input.voiceConfig.voice.providerSettings?.[provider] ?? {},
  };
}

export function runtimeProviderToSessionProvider(
  provider: RuntimeProviderName
): VoiceProviderId {
  if (provider === 'ultravox-realtime') return 'ultravox-ws';
  if (provider === 'gemini-live') return 'gemini-live';
  if (provider === 'pipecat-rtvi') return 'pipecat-rtvi';
  if (provider === 'decomposed') return 'decomposed';
  return 'openai-sdk';
}

function modelForRuntimeProvider(input: RuntimeSessionInputBuildInput): string {
  if (input.provider === 'ultravox-realtime') return input.ultravoxModel;
  if (input.provider === 'gemini-live') return input.geminiModel;
  if (input.provider === 'decomposed') return input.decomposedLlmModel;
  return input.model;
}

function providerConfigForRuntime(input: RuntimeSessionInputBuildInput): unknown {
  const ps = input.providerSettings;

  if (input.provider === 'ultravox-realtime') {
    return {
      ...ps,
      apiKey: input.auth.ultravoxApiKey,
      model: input.ultravoxModel,
      voice: input.voice,
    };
  }

  if (input.provider === 'gemini-live') {
    return {
      enableInputTranscription: true,
      enableOutputTranscription: true,
      contextWindowCompressionTokens: 10000,
      proactivity: false,
      ...ps,
      apiKey: input.auth.googleApiKey,
      noInterruption:
        ps.noInterruption === 'true' || ps.noInterruption === true
          ? true
          : ps.noInterruption === 'false'
            ? false
            : undefined,
    };
  }

  if (input.provider === 'decomposed') {
    return {
      ...ps,
      openaiApiKey: input.auth.openaiApiKey,
      openrouterApiKey: input.auth.openrouterApiKey,
      deepgramApiKey: input.auth.deepgramApiKey,
      sttProvider: input.decomposedSttProvider,
      sttModel: input.decomposedSttModel,
      llmProvider: input.decomposedLlmProvider,
      llmModel: input.decomposedLlmModel,
      ttsProvider: input.decomposedTtsProvider,
      ttsModel: input.decomposedTtsModel,
      ttsVoice: input.decomposedTtsVoice,
      turn: input.turn,
    };
  }

  if (input.provider === 'pipecat-rtvi') {
    return {
      ...ps,
      serverUrl: input.pipecatServerUrl,
      transport: input.pipecatTransport,
      botId: input.pipecatBotId,
      inputSampleRate: 24000,
      outputSampleRate: 24000,
      autoToolExecution: true,
    };
  }

  return {
    ...ps,
    apiKey: input.auth.openaiApiKey,
    language: input.language,
    turnDetection: (ps.turnDetection as string) ?? 'semantic_vad',
  };
}

function buildVadFromProviderSettings(
  provider: RuntimeProviderName,
  providerSettings: Record<string, unknown>
): SessionInput['vad'] | undefined {
  if (provider !== 'openai-realtime') return undefined;
  const turnDetection = (providerSettings.turnDetection as string) ?? 'semantic_vad';
  return {
    mode: turnDetection === 'server_vad' ? 'server' : 'semantic',
    silenceDurationMs: providerSettings['vad.silenceDurationMs'] as
      | number
      | undefined,
    threshold: providerSettings['vad.threshold'] as number | undefined,
    eagerness: providerSettings['vad.eagerness'] as
      | 'low'
      | 'medium'
      | 'high'
      | 'auto'
      | undefined,
    prefixPaddingMs: providerSettings['vad.prefixPaddingMs'] as
      | number
      | undefined,
  };
}

export function resolveRuntimeSessionInput(
  input: RuntimeSessionInputBuildInput
): SessionInput {
  const provider = runtimeProviderToSessionProvider(input.provider);
  const providerConfig = parseProviderConfig(
    provider,
    providerConfigForRuntime(input)
  );
  const vad = buildVadFromProviderSettings(input.provider, input.providerSettings);

  return {
    provider,
    instructions: input.instructions,
    voice: input.voice,
    model: modelForRuntimeProvider(input),
    language: input.language,
    tools: input.tools,
    toolHandler: input.toolHandler,
    providerConfig,
    ...(vad ? { vad } : {}),
  };
}

export function getBuiltInProviderRegistry(): ProviderRegistration[] {
  return [
    {
      id: 'openai-sdk',
      label: 'openai-realtime',
      createAdapter: () => new OpenAISdkAdapter(),
    },
    {
      id: 'ultravox-ws',
      label: 'ultravox-realtime',
      createAdapter: () => new UltravoxWsAdapter(),
    },
    {
      id: 'gemini-live',
      label: 'gemini-live',
      createAdapter: () => new GeminiLiveAdapter(),
    },
    {
      id: 'decomposed',
      label: 'decomposed',
      createAdapter: () => new DecomposedAdapter(),
    },
    {
      id: 'pipecat-rtvi',
      label: 'pipecat-rtvi',
      createAdapter: () => new PipecatRtviAdapter(),
    },
  ];
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
  const fallback = { models: DEFAULT_ULTRAVOX_MODELS, voices: [] as Array<{
    voiceId: string;
    name: string;
    primaryLanguage?: string;
  }> };

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

export async function fetchRuntimeProviderCatalog(input: {
  openaiApiKey: string;
  deepgramApiKey: string;
  ultravoxApiKey: string;
}): Promise<RuntimeProviderCatalog> {
  const [openai, deepgram, ultravox] = await Promise.all([
    fetchOpenAICatalog(input.openaiApiKey),
    fetchDeepgramCatalog(input.deepgramApiKey),
    fetchUltravoxCatalog(input.ultravoxApiKey),
  ]);

  const providerSchemas: Record<string, ProviderConfigSchema> = {};
  const adapters = getBuiltInProviderRegistry().map((registration) => ({
    key: registration.label,
    schema: registration.createAdapter().configSchema?.(),
  }));
  for (const entry of adapters) {
    if (entry.schema) providerSchemas[entry.key] = entry.schema;
  }

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
      'openai-llm': {
        models: openai.textModels,
      },
      'openrouter-llm': {
        models: DEFAULT_OPENROUTER_LLM_MODELS,
      },
      'openai-tts': {
        voices: openaiVoices,
      },
      'deepgram-tts': {
        voices: deepgram.ttsVoices.map((voiceId) => ({
          id: voiceId,
          name: voiceId,
        })),
      },
    },
    providerSchemas,
  };
}

export async function fetchRuntimeProviderCatalogFromAuthProfiles(input: {
  authProfiles: RuntimeAuthProfilesDocument;
  env?: Record<string, string | undefined>;
}): Promise<RuntimeProviderCatalog> {
  const authKeys = resolveRuntimeAuthKeySet({
    authProfiles: input.authProfiles,
    env: input.env,
  });
  return fetchRuntimeProviderCatalog({
    openaiApiKey: authKeys.openaiApiKey,
    deepgramApiKey: authKeys.deepgramApiKey,
    ultravoxApiKey: authKeys.ultravoxApiKey,
  });
}

export function getRuntimeConfigManifest(): RuntimeConfigManifest {
  return {
    modes: [...RUNTIME_VOICE_MODES],
    realtimeProviderPath: 'voice.voiceToVoice.provider',
    realtimeProviders: [
      {
        id: 'openai-realtime',
        label: 'openai-realtime',
        fields: [
          {
            path: 'voice.voiceToVoice.model',
            label: 'Model',
            kind: 'model',
            catalogKey: 'openai-realtime',
          },
          {
            path: 'voice.voiceToVoice.voice',
            label: 'Voice',
            kind: 'voice',
            catalogKey: 'openai-realtime',
          },
          {
            path: 'voice.voiceToVoice.authProfile',
            label: 'Auth Profile Override',
            kind: 'auth',
          },
        ],
      },
      {
        id: 'ultravox-realtime',
        label: 'ultravox-realtime',
        fields: [
          {
            path: 'voice.voiceToVoice.ultravoxModel',
            label: 'Model',
            kind: 'model',
            catalogKey: 'ultravox-realtime',
          },
          {
            path: 'voice.voiceToVoice.voice',
            label: 'Voice',
            kind: 'voice',
            catalogKey: 'ultravox-realtime',
          },
          {
            path: 'voice.voiceToVoice.authProfile',
            label: 'Auth Profile Override',
            kind: 'auth',
          },
        ],
      },
      {
        id: 'gemini-live',
        label: 'gemini-live',
        fields: [
          {
            path: 'voice.voiceToVoice.geminiModel',
            label: 'Model',
            kind: 'model',
            catalogKey: 'gemini-live',
          },
          {
            path: 'voice.voiceToVoice.geminiVoice',
            label: 'Voice',
            kind: 'voice',
            catalogKey: 'gemini-live',
          },
          {
            path: 'voice.voiceToVoice.authProfile',
            label: 'Auth Profile Override',
            kind: 'auth',
          },
        ],
      },
      {
        id: 'pipecat-rtvi',
        label: 'pipecat-rtvi',
        fields: [
          {
            path: 'voice.voiceToVoice.pipecatServerUrl',
            label: 'Pipecat Server URL',
            kind: 'string',
            placeholder: 'ws://localhost:7860',
          },
          {
            path: 'voice.voiceToVoice.pipecatTransport',
            label: 'Pipecat Transport',
            kind: 'select',
            options: [
              { value: 'websocket', label: 'websocket' },
              { value: 'webrtc', label: 'webrtc' },
            ],
          },
          {
            path: 'voice.voiceToVoice.pipecatBotId',
            label: 'Pipecat Bot ID',
            kind: 'string',
            placeholder: 'voice-bot-1',
          },
          {
            path: 'voice.voiceToVoice.model',
            label: 'Bootstrap Model',
            kind: 'model',
            catalogKey: 'openai-realtime',
          },
          {
            path: 'voice.voiceToVoice.voice',
            label: 'Bootstrap Voice',
            kind: 'voice',
            catalogKey: 'openai-realtime',
          },
          {
            path: 'voice.voiceToVoice.authProfile',
            label: 'Auth Profile Override',
            kind: 'auth',
          },
        ],
      },
    ],
    decomposedStages: [
      {
        id: 'stt',
        label: 'Speech-To-Text (STT)',
        providerPath: 'voice.decomposed.stt.provider',
        modelPath: 'voice.decomposed.stt.model',
        authPath: 'voice.decomposed.stt.authProfile',
        providers: [
          {
            id: 'deepgram',
            label: 'deepgram',
            modelCatalogKey: 'deepgram-stt',
          },
          {
            id: 'openai',
            label: 'openai',
            modelCatalogKey: 'openai-stt',
          },
        ],
      },
      {
        id: 'llm',
        label: 'Language Model (LLM)',
        providerPath: 'voice.decomposed.llm.provider',
        modelPath: 'voice.decomposed.llm.model',
        authPath: 'voice.decomposed.llm.authProfile',
        providers: [
          {
            id: 'openai',
            label: 'openai',
            modelCatalogKey: 'openai-llm',
          },
          {
            id: 'openrouter',
            label: 'openrouter',
            modelCatalogKey: 'openrouter-llm',
          },
        ],
      },
      {
        id: 'tts',
        label: 'Text-To-Speech (TTS)',
        providerPath: 'voice.decomposed.tts.provider',
        modelPath: 'voice.decomposed.tts.model',
        voicePath: 'voice.decomposed.tts.voice',
        authPath: 'voice.decomposed.tts.authProfile',
        providers: [
          {
            id: 'deepgram',
            label: 'deepgram',
            voiceCatalogKey: 'deepgram-tts',
          },
          {
            id: 'openai',
            label: 'openai',
            voiceCatalogKey: 'openai-tts',
          },
        ],
      },
    ],
  };
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
