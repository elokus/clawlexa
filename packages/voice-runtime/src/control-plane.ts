import { DecomposedAdapter } from './adapters/decomposed-adapter.js';
import { GeminiLiveAdapter } from './adapters/gemini-live-adapter.js';
import { OpenAISdkAdapter } from './adapters/openai-sdk-adapter.js';
import { PipecatRtviAdapter } from './adapters/pipecat-rtvi-adapter.js';
import { UltravoxWsAdapter } from './adapters/ultravox-ws-adapter.js';
import {
  createDefaultRuntimeAuthProfiles as createCoreDefaultRuntimeAuthProfiles,
  fetchRuntimeProviderCatalog as fetchCoreRuntimeProviderCatalog,
  fetchRuntimeProviderCatalogFromAuthProfiles as fetchCoreRuntimeProviderCatalogFromAuthProfiles,
  resolveRuntimeAuthKeySet as resolveCoreRuntimeAuthKeySet,
  resolveRuntimeApiKey as resolveCoreRuntimeApiKey,
  runtimeAuthKeySetToProviderMap as coreRuntimeAuthKeySetToProviderMap,
  testRuntimeProviderCredentials as testCoreRuntimeProviderCredentials,
  RUNTIME_AUTH_PROVIDERS as CORE_RUNTIME_AUTH_PROVIDERS,
  type RuntimeAuthKeyByProvider as CoreRuntimeAuthKeyByProvider,
  type RuntimeAuthKeySet as CoreRuntimeAuthKeySet,
  type RuntimeAuthProfile as CoreRuntimeAuthProfile,
  type RuntimeAuthProfilesDocument as CoreRuntimeAuthProfilesDocument,
  type RuntimeAuthProvider as CoreRuntimeAuthProvider,
  type RuntimeCatalogEntry as CoreRuntimeCatalogEntry,
  type RuntimeProviderCatalog as CoreRuntimeProviderCatalog,
} from '@voiceclaw/ai-core/voice/auth-catalog';
import type { VoiceBenchmarkThresholds } from './benchmarks/voice-benchmark.js';
import { parseProviderConfig } from './provider-config.js';
import type { ProviderRegistration } from './runtime/voice-runtime.js';
import type {
  ProviderConfigSchema,
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

export const RUNTIME_STT_PROVIDERS = ['deepgram', 'openai', 'local'] as const;
export type RuntimeSttProvider = (typeof RUNTIME_STT_PROVIDERS)[number];

export const RUNTIME_LLM_PROVIDERS = [
  'openai',
  'openrouter',
  'anthropic',
  'google',
] as const;
export type RuntimeLlmProvider = (typeof RUNTIME_LLM_PROVIDERS)[number];

export const RUNTIME_TTS_PROVIDERS = [
  'deepgram',
  'openai',
  'cartesia',
  'fish',
  'rime',
  'google-chirp',
  'kokoro',
  'pocket-tts',
  'local',
] as const;
export type RuntimeTtsProvider = (typeof RUNTIME_TTS_PROVIDERS)[number];

export const RUNTIME_AUTH_PROVIDERS = CORE_RUNTIME_AUTH_PROVIDERS;
export type RuntimeAuthProvider = CoreRuntimeAuthProvider;

export type RuntimeProviderName = RuntimeVoiceToVoiceProvider | 'decomposed';

export interface RuntimeProfileOverride {
  mode?: RuntimeVoiceMode;
  voice?: string;
  provider?: RuntimeVoiceToVoiceProvider;
  decomposed?: {
    stt?: { provider?: RuntimeSttProvider; model?: string; language?: string; authProfile?: string };
    llm?: { provider?: RuntimeLlmProvider; model?: string; authProfile?: string };
    tts?: { provider?: RuntimeTtsProvider; model?: string; voice?: string; authProfile?: string; voiceRef?: string };
  };
  voiceToVoice?: {
    provider?: RuntimeVoiceToVoiceProvider;
    model?: string;
    voice?: string;
  };
}

export interface RuntimeVoiceConfigDocument {
  voice: {
    mode: RuntimeVoiceMode;
    language: string;
    profileOverrides: Record<string, RuntimeProfileOverride>;
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
        voiceRef?: string;
      };
    };
    turn: {
      strategy: 'provider-native' | 'layered';
      silenceMs: number;
      minSpeechMs: number;
      minRms: number;
      bargeInEnabled: boolean;
      speechStartDebounceMs: number;
      vadEngine: 'rms' | 'rnnoise' | 'webrtc-vad';
      neuralFilterEnabled: boolean;
      rnnoiseSpeechThreshold: number;
      rnnoiseEchoSpeechThresholdBoost: number;
      webrtcVadMode: 0 | 1 | 2 | 3;
      webrtcVadSpeechRatioThreshold: number;
      webrtcVadEchoSpeechRatioBoost: number;
      assistantOutputMinRms: number;
      assistantOutputSilenceMs: number;
      spokenStreamEnabled: boolean;
      wordAlignmentEnabled: boolean;
      spokenHighlightMsPerWord: number;
      spokenHighlightPunctuationPauseMs: number;
      preferProviderTimestamps: boolean;
      customSttMode: 'provider' | 'custom' | 'hybrid';
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

export type RuntimeAuthProfile = CoreRuntimeAuthProfile;
export type RuntimeAuthProfilesDocument = CoreRuntimeAuthProfilesDocument;
export type RuntimeAuthKeySet = CoreRuntimeAuthKeySet;
export type RuntimeAuthKeyByProvider = CoreRuntimeAuthKeyByProvider;

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
  decomposedTtsVoiceRef?: string;
  auth: RuntimeAuthKeySet;
  turn: {
    strategy: 'provider-native' | 'layered';
    silenceMs: number;
    minSpeechMs: number;
    minRms: number;
    bargeInEnabled: boolean;
    speechStartDebounceMs: number;
    vadEngine: 'rms' | 'rnnoise' | 'webrtc-vad';
    neuralFilterEnabled: boolean;
    rnnoiseSpeechThreshold: number;
    rnnoiseEchoSpeechThresholdBoost: number;
    webrtcVadMode: 0 | 1 | 2 | 3;
    webrtcVadSpeechRatioThreshold: number;
    webrtcVadEchoSpeechRatioBoost: number;
    assistantOutputMinRms: number;
    assistantOutputSilenceMs: number;
    spokenStreamEnabled: boolean;
    wordAlignmentEnabled: boolean;
    spokenHighlightMsPerWord: number;
    spokenHighlightPunctuationPauseMs: number;
    preferProviderTimestamps: boolean;
    customSttMode: 'provider' | 'custom' | 'hybrid';
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
  decomposedTtsVoiceRef?: string;
  turn: RuntimeResolvedConfig['turn'];
  providerSettings: Record<string, unknown>;
  auth: RuntimeAuthKeySet;
  tools?: ToolDefinition[];
  toolHandler?: ToolCallHandler;
}

export type RuntimeCatalogEntry = CoreRuntimeCatalogEntry;
export type RuntimeProviderCatalog = CoreRuntimeProviderCatalog;

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
        bargeInEnabled: (env.VOICE_BARGE_IN_ENABLED ?? 'true') === 'true',
        speechStartDebounceMs: parseInt(env.VOICE_SPEECH_START_DEBOUNCE_MS ?? '140', 10),
        vadEngine:
          env.VOICE_TURN_VAD_ENGINE === 'rms'
            ? 'rms'
            : env.VOICE_TURN_VAD_ENGINE === 'rnnoise'
              ? 'rnnoise'
              : 'webrtc-vad',
        neuralFilterEnabled: (env.VOICE_NEURAL_FILTER_ENABLED ?? 'true') === 'true',
        rnnoiseSpeechThreshold: parseFloat(env.VOICE_RNNOISE_SPEECH_THRESHOLD ?? '0.62'),
        rnnoiseEchoSpeechThresholdBoost: parseFloat(
          env.VOICE_RNNOISE_ECHO_THRESHOLD_BOOST ?? '0.12'
        ),
        webrtcVadMode: (() => {
          const value = parseInt(env.VOICE_WEBRTC_VAD_MODE ?? '3', 10);
          if (value === 0 || value === 1 || value === 2 || value === 3) {
            return value;
          }
          return 3;
        })(),
        webrtcVadSpeechRatioThreshold: parseFloat(
          env.VOICE_WEBRTC_VAD_SPEECH_RATIO_THRESHOLD ?? '0.7'
        ),
        webrtcVadEchoSpeechRatioBoost: parseFloat(
          env.VOICE_WEBRTC_VAD_ECHO_RATIO_BOOST ?? '0.15'
        ),
        assistantOutputMinRms: parseFloat(env.VOICE_ASSISTANT_OUTPUT_MIN_RMS ?? '0.008'),
        assistantOutputSilenceMs: parseInt(env.VOICE_ASSISTANT_OUTPUT_SILENCE_MS ?? '350', 10),
        spokenStreamEnabled: (env.VOICE_SPOKEN_STREAM_ENABLED ?? 'false') === 'true',
        wordAlignmentEnabled: (env.VOICE_WORD_ALIGNMENT_ENABLED ?? 'false') === 'true',
        spokenHighlightMsPerWord: parseInt(
          env.VOICE_SPOKEN_HIGHLIGHT_MS_PER_WORD ?? '340',
          10
        ),
        spokenHighlightPunctuationPauseMs: parseInt(
          env.VOICE_SPOKEN_HIGHLIGHT_PUNCTUATION_PAUSE_MS ?? '120',
          10
        ),
        preferProviderTimestamps:
          (env.VOICE_PREFER_PROVIDER_TIMESTAMPS ?? 'true') === 'true',
        customSttMode:
          env.VOICE_CUSTOM_STT_MODE === 'custom' || env.VOICE_CUSTOM_STT_MODE === 'hybrid'
            ? env.VOICE_CUSTOM_STT_MODE
            : 'provider',
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
  return createCoreDefaultRuntimeAuthProfiles();
}

export function resolveRuntimeApiKey(
  provider: RuntimeAuthProvider,
  options: {
    authProfileId?: string;
    authProfiles: RuntimeAuthProfilesDocument;
    env?: Record<string, string | undefined>;
  }
): string {
  return resolveCoreRuntimeApiKey(provider, options);
}

export function resolveRuntimeAuthKeySet(input: {
  authProfiles: RuntimeAuthProfilesDocument;
  env?: Record<string, string | undefined>;
}): RuntimeAuthKeySet {
  return resolveCoreRuntimeAuthKeySet(input);
}

export function runtimeAuthKeySetToProviderMap(
  auth: RuntimeAuthKeySet
): RuntimeAuthKeyByProvider {
  return coreRuntimeAuthKeySetToProviderMap(auth);
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

  const v2vOverride = override.voiceToVoice ?? {};
  const configuredProvider =
    override.provider ?? v2vOverride.provider ?? input.voiceConfig.voice.voiceToVoice.provider;
  const provider = env.VOICE_PROVIDER
    ? normalizeRuntimeProvider(env.VOICE_PROVIDER)
    : mode === 'decomposed'
      ? 'decomposed'
      : configuredProvider;

  // Deep-merge decomposed overrides: profile override > global config
  const dOverride = override.decomposed ?? {};
  const mergedDecomposed = {
    stt: {
      provider: dOverride.stt?.provider ?? input.voiceConfig.voice.decomposed.stt.provider,
      model: dOverride.stt?.model ?? input.voiceConfig.voice.decomposed.stt.model,
      language: dOverride.stt?.language ?? input.voiceConfig.voice.decomposed.stt.language,
      authProfile: dOverride.stt?.authProfile ?? input.voiceConfig.voice.decomposed.stt.authProfile,
    },
    llm: {
      provider: dOverride.llm?.provider ?? input.voiceConfig.voice.decomposed.llm.provider,
      model: dOverride.llm?.model ?? input.voiceConfig.voice.decomposed.llm.model,
      authProfile: dOverride.llm?.authProfile ?? input.voiceConfig.voice.decomposed.llm.authProfile,
    },
    tts: {
      provider: dOverride.tts?.provider ?? input.voiceConfig.voice.decomposed.tts.provider,
      model: dOverride.tts?.model ?? input.voiceConfig.voice.decomposed.tts.model,
      voice: dOverride.tts?.voice ?? input.voiceConfig.voice.decomposed.tts.voice,
      authProfile: dOverride.tts?.authProfile ?? input.voiceConfig.voice.decomposed.tts.authProfile,
      voiceRef: dOverride.tts?.voiceRef ?? input.voiceConfig.voice.decomposed.tts.voiceRef,
    },
  };

  let voice: string;
  if (mode === 'decomposed') {
    voice =
      override.voice ??
      mergedDecomposed.tts.voice ??
      input.profileVoice;
  } else if (provider === 'gemini-live') {
    voice = override.voice ?? v2vOverride.voice ?? input.voiceConfig.voice.voiceToVoice.geminiVoice;
  } else {
    voice =
      override.voice ??
      v2vOverride.voice ??
      input.voiceConfig.voice.voiceToVoice.voice ??
      input.profileVoice;
  }

  const voiceToVoiceAuthProfile = input.voiceConfig.voice.voiceToVoice.authProfile;
  const decomposedLlmAuthProfile = mergedDecomposed.llm.authProfile;
  const decomposedSttAuthProfile = mergedDecomposed.stt.authProfile;
  const decomposedTtsAuthProfile = mergedDecomposed.tts.authProfile;
  const decomposedLlmProvider = mergedDecomposed.llm.provider;
  const decomposedTtsProvider = mergedDecomposed.tts.provider;
  const decomposedTtsUsesOpenAi = decomposedTtsProvider === 'openai';
  const decomposedTtsUsesGoogle = decomposedTtsProvider === 'google-chirp';
  const decomposedTtsUsesDeepgram = decomposedTtsProvider === 'deepgram';
  const decomposedTtsUsesCartesia = decomposedTtsProvider === 'cartesia';
  const decomposedTtsUsesFish = decomposedTtsProvider === 'fish';
  const decomposedTtsUsesRime = decomposedTtsProvider === 'rime';

  const openaiApiKey = resolveRuntimeApiKey('openai', {
    authProfileId:
      mode === 'decomposed'
        ? decomposedLlmProvider === 'openai'
          ? decomposedLlmAuthProfile
          : decomposedTtsUsesOpenAi
            ? decomposedTtsAuthProfile
            : undefined
        : provider === 'openai-realtime'
          ? voiceToVoiceAuthProfile
          : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const openrouterApiKey = resolveRuntimeApiKey('openrouter', {
    authProfileId:
      mode === 'decomposed' && decomposedLlmProvider === 'openrouter'
        ? decomposedLlmAuthProfile
        : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const anthropicApiKey = resolveRuntimeApiKey('anthropic', {
    authProfileId:
      mode === 'decomposed' && decomposedLlmProvider === 'anthropic'
        ? decomposedLlmAuthProfile
        : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const googleApiKey =
    resolveRuntimeApiKey('google', {
      authProfileId:
        provider === 'gemini-live'
          ? voiceToVoiceAuthProfile
          : mode === 'decomposed' && decomposedLlmProvider === 'google'
            ? decomposedLlmAuthProfile
            : mode === 'decomposed' && decomposedTtsUsesGoogle
              ? decomposedTtsAuthProfile
              : undefined,
      authProfiles: input.authProfiles,
      env,
    }) ||
    resolveRuntimeApiKey('gemini', {
      authProfileId:
        provider === 'gemini-live'
          ? voiceToVoiceAuthProfile
          : mode === 'decomposed' && decomposedLlmProvider === 'google'
            ? decomposedLlmAuthProfile
            : mode === 'decomposed' && decomposedTtsUsesGoogle
              ? decomposedTtsAuthProfile
              : undefined,
      authProfiles: input.authProfiles,
      env,
    });
  const deepgramApiKey = resolveRuntimeApiKey('deepgram', {
    authProfileId: decomposedTtsUsesDeepgram
      ? decomposedTtsAuthProfile ?? decomposedSttAuthProfile
      : decomposedSttAuthProfile,
    authProfiles: input.authProfiles,
    env,
  });
  const cartesiaApiKey = resolveRuntimeApiKey('cartesia', {
    authProfileId:
      mode === 'decomposed' && decomposedTtsUsesCartesia
        ? decomposedTtsAuthProfile
        : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const fishAudioApiKey = resolveRuntimeApiKey('fish', {
    authProfileId:
      mode === 'decomposed' && decomposedTtsUsesFish
        ? decomposedTtsAuthProfile
        : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const rimeApiKey = resolveRuntimeApiKey('rime', {
    authProfileId:
      mode === 'decomposed' && decomposedTtsUsesRime
        ? decomposedTtsAuthProfile
        : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const ultravoxApiKey = resolveRuntimeApiKey('ultravox', {
    authProfileId: provider === 'ultravox-realtime' ? voiceToVoiceAuthProfile : undefined,
    authProfiles: input.authProfiles,
    env,
  });
  const openclawToken = resolveRuntimeApiKey('openclaw', {
    authProfiles: input.authProfiles,
    env,
  });

  return {
    mode,
    provider,
    language: input.voiceConfig.voice.language,
    voice,
    model: v2vOverride.model ?? (input.voiceConfig.voice.voiceToVoice.model || input.fallbackModel),
    geminiModel: input.voiceConfig.voice.voiceToVoice.geminiModel,
    geminiVoice: input.voiceConfig.voice.voiceToVoice.geminiVoice,
    ultravoxModel: input.voiceConfig.voice.voiceToVoice.ultravoxModel,
    pipecatServerUrl: input.voiceConfig.voice.voiceToVoice.pipecatServerUrl,
    pipecatTransport: input.voiceConfig.voice.voiceToVoice.pipecatTransport,
    pipecatBotId: input.voiceConfig.voice.voiceToVoice.pipecatBotId,
    decomposedSttProvider: mergedDecomposed.stt.provider,
    decomposedSttModel: mergedDecomposed.stt.model,
    decomposedLlmProvider: mergedDecomposed.llm.provider,
    decomposedLlmModel: mergedDecomposed.llm.model,
    decomposedTtsProvider: mergedDecomposed.tts.provider,
    decomposedTtsModel: mergedDecomposed.tts.model,
    decomposedTtsVoice: mergedDecomposed.tts.voice,
    decomposedTtsVoiceRef: mergedDecomposed.tts.voiceRef,
    auth: {
      openaiApiKey,
      openrouterApiKey,
      anthropicApiKey,
      googleApiKey,
      deepgramApiKey,
      cartesiaApiKey,
      fishAudioApiKey,
      rimeApiKey,
      ultravoxApiKey,
      openclawToken,
    },
    turn: {
      strategy: input.voiceConfig.voice.turn.strategy,
      silenceMs: input.voiceConfig.voice.turn.silenceMs,
      minSpeechMs: input.voiceConfig.voice.turn.minSpeechMs,
      minRms: input.voiceConfig.voice.turn.minRms,
      bargeInEnabled: input.voiceConfig.voice.turn.bargeInEnabled,
      speechStartDebounceMs: input.voiceConfig.voice.turn.speechStartDebounceMs,
      vadEngine: input.voiceConfig.voice.turn.vadEngine,
      neuralFilterEnabled: input.voiceConfig.voice.turn.neuralFilterEnabled,
      rnnoiseSpeechThreshold: input.voiceConfig.voice.turn.rnnoiseSpeechThreshold,
      rnnoiseEchoSpeechThresholdBoost:
        input.voiceConfig.voice.turn.rnnoiseEchoSpeechThresholdBoost,
      webrtcVadMode: input.voiceConfig.voice.turn.webrtcVadMode,
      webrtcVadSpeechRatioThreshold:
        input.voiceConfig.voice.turn.webrtcVadSpeechRatioThreshold,
      webrtcVadEchoSpeechRatioBoost:
        input.voiceConfig.voice.turn.webrtcVadEchoSpeechRatioBoost,
      assistantOutputMinRms: input.voiceConfig.voice.turn.assistantOutputMinRms,
      assistantOutputSilenceMs: input.voiceConfig.voice.turn.assistantOutputSilenceMs,
      spokenStreamEnabled: input.voiceConfig.voice.turn.spokenStreamEnabled,
      wordAlignmentEnabled: input.voiceConfig.voice.turn.wordAlignmentEnabled,
      spokenHighlightMsPerWord: input.voiceConfig.voice.turn.spokenHighlightMsPerWord,
      spokenHighlightPunctuationPauseMs:
        input.voiceConfig.voice.turn.spokenHighlightPunctuationPauseMs,
      preferProviderTimestamps:
        input.voiceConfig.voice.turn.preferProviderTimestamps,
      customSttMode: input.voiceConfig.voice.turn.customSttMode,
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
      anthropicApiKey: input.auth.anthropicApiKey,
      googleApiKey: input.auth.googleApiKey,
      deepgramApiKey: input.auth.deepgramApiKey,
      cartesiaApiKey: input.auth.cartesiaApiKey,
      fishAudioApiKey: input.auth.fishAudioApiKey,
      rimeApiKey: input.auth.rimeApiKey,
      sttProvider: input.decomposedSttProvider,
      sttModel: input.decomposedSttModel,
      llmProvider: input.decomposedLlmProvider,
      llmModel: input.decomposedLlmModel,
      ttsProvider: input.decomposedTtsProvider,
      ttsModel: input.decomposedTtsModel,
      ttsVoice: input.decomposedTtsVoice,
      voiceRef: input.decomposedTtsVoiceRef,
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
    turn: {
      spokenHighlightMsPerWord: input.turn.spokenHighlightMsPerWord,
      spokenHighlightPunctuationPauseMs: input.turn.spokenHighlightPunctuationPauseMs,
      preferProviderTimestamps: input.turn.preferProviderTimestamps,
    },
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

export async function fetchRuntimeProviderCatalog(input: {
  openaiApiKey: string;
  deepgramApiKey: string;
  cartesiaApiKey?: string;
  fishAudioApiKey?: string;
  rimeApiKey?: string;
  ultravoxApiKey: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
}): Promise<RuntimeProviderCatalog> {
  const providerSchemas: Record<string, ProviderConfigSchema> = {};
  const adapters = getBuiltInProviderRegistry().map((registration) => ({
    key: registration.label,
    schema: registration.createAdapter().configSchema?.(),
  }));
  for (const entry of adapters) {
    if (entry.schema) providerSchemas[entry.key] = entry.schema;
  }

  return fetchCoreRuntimeProviderCatalog({
    openaiApiKey: input.openaiApiKey,
    deepgramApiKey: input.deepgramApiKey,
    cartesiaApiKey: input.cartesiaApiKey,
    fishAudioApiKey: input.fishAudioApiKey,
    rimeApiKey: input.rimeApiKey,
    ultravoxApiKey: input.ultravoxApiKey,
    anthropicApiKey: input.anthropicApiKey,
    googleApiKey: input.googleApiKey,
    providerSchemas,
  });
}

export async function fetchRuntimeProviderCatalogFromAuthProfiles(input: {
  authProfiles: RuntimeAuthProfilesDocument;
  env?: Record<string, string | undefined>;
}): Promise<RuntimeProviderCatalog> {
  const providerSchemas: Record<string, ProviderConfigSchema> = {};
  const adapters = getBuiltInProviderRegistry().map((registration) => ({
    key: registration.label,
    schema: registration.createAdapter().configSchema?.(),
  }));
  for (const entry of adapters) {
    if (entry.schema) providerSchemas[entry.key] = entry.schema;
  }

  return fetchCoreRuntimeProviderCatalogFromAuthProfiles({
    authProfiles: input.authProfiles,
    env: input.env,
    providerSchemas,
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
          {
            id: 'local',
            label: 'local',
            modelCatalogKey: 'local-stt',
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
          {
            id: 'anthropic',
            label: 'anthropic',
            modelCatalogKey: 'anthropic-llm',
          },
          {
            id: 'google',
            label: 'google',
            modelCatalogKey: 'google-llm',
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
          {
            id: 'cartesia',
            label: 'cartesia',
            voiceCatalogKey: 'cartesia-tts',
          },
          {
            id: 'fish',
            label: 'fish',
            voiceCatalogKey: 'fish-tts',
          },
          {
            id: 'rime',
            label: 'rime',
            voiceCatalogKey: 'rime-tts',
          },
          {
            id: 'google-chirp',
            label: 'google-chirp',
            voiceCatalogKey: 'google-chirp-tts',
          },
          {
            id: 'kokoro',
            label: 'kokoro',
            voiceCatalogKey: 'kokoro-tts',
          },
          {
            id: 'pocket-tts',
            label: 'pocket-tts',
            voiceCatalogKey: 'pocket-tts',
          },
          {
            id: 'local',
            label: 'local',
            modelCatalogKey: 'local-tts',
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
  return testCoreRuntimeProviderCredentials(provider, apiKey);
}
