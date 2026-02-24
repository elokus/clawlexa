import type {
  DecomposedProviderConfig,
  GeminiProviderConfig,
  OpenAIProviderConfig,
  PipecatProviderConfig,
  UltravoxProviderConfig,
  VoiceProviderId,
} from './types.js';

export interface ProviderConfigById {
  'openai-sdk': OpenAIProviderConfig;
  'openai-ws': OpenAIProviderConfig;
  'ultravox-ws': UltravoxProviderConfig;
  'gemini-live': GeminiProviderConfig;
  decomposed: DecomposedProviderConfig;
  'pipecat-rtvi': PipecatProviderConfig;
}

const OPENAI_TURN_DETECTIONS = ['server_vad', 'semantic_vad'] as const;
const GEMINI_API_VERSIONS = ['v1alpha', 'v1beta'] as const;
const GEMINI_VAD_MODES = ['server', 'manual'] as const;
const GEMINI_SPEECH_SENSITIVITIES = ['high', 'low'] as const;
const PIPECAT_TRANSPORTS = ['websocket', 'webrtc'] as const;
const PIPECAT_AUDIO_INPUT_ENCODINGS = ['binary-pcm16', 'client-message-base64'] as const;
const DECOMPOSED_STT_PROVIDERS = ['openai', 'deepgram'] as const;
const DECOMPOSED_LLM_PROVIDERS = [
  'openai',
  'openrouter',
  'anthropic',
  'google',
] as const;
const DECOMPOSED_TTS_PROVIDERS = ['openai', 'deepgram'] as const;
const DECOMPOSED_TTS_TRANSPORTS = ['websocket'] as const;
const DECOMPOSED_CUSTOM_STT_MODES = ['provider', 'custom', 'hybrid'] as const;
const DECOMPOSED_VAD_ENGINES = ['rms', 'rnnoise', 'webrtc-vad'] as const;

type UnknownObject = Record<string, unknown>;

function isObject(value: unknown): value is UnknownObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toObject(raw: unknown, path: string): UnknownObject {
  if (raw === undefined) return {};
  if (!isObject(raw)) {
    throw new Error(`${path} must be an object`);
  }
  return raw;
}

function optionalString(object: UnknownObject, key: string, path: string): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${path}.${key} must be a string`);
  }
  return value;
}

function optionalBoolean(object: UnknownObject, key: string, path: string): boolean | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${path}.${key} must be a boolean`);
  }
  return value;
}

function optionalPositiveNumber(
  object: UnknownObject,
  key: string,
  path: string
): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path}.${key} must be a positive number`);
  }
  return value;
}

function optionalNonNegativeNumber(
  object: UnknownObject,
  key: string,
  path: string
): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path}.${key} must be a non-negative number`);
  }
  return value;
}

function optionalUnitIntervalNumber(
  object: UnknownObject,
  key: string,
  path: string
): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path}.${key} must be a number between 0 and 1`);
  }
  return value;
}

function optionalIntegerRange(
  object: UnknownObject,
  key: string,
  path: string,
  min: number,
  max: number
): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`${path}.${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalEnum<TValue extends string>(
  object: UnknownObject,
  key: string,
  path: string,
  allowed: readonly TValue[]
): TValue | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as TValue)) {
    throw new Error(`${path}.${key} must be one of: ${allowed.join(', ')}`);
  }
  return value as TValue;
}

function parseModelRef(
  raw: unknown,
  path: string
): { provider: string; model: string; voice?: string } {
  const object = toObject(raw, path);
  const provider = optionalString(object, 'provider', path);
  const model = optionalString(object, 'model', path);
  if (!provider || !model) {
    throw new Error(`${path}.provider and ${path}.model are required`);
  }
  return {
    provider,
    model,
    voice: optionalString(object, 'voice', path),
  };
}

export function parseOpenAIProviderConfig(raw: unknown): OpenAIProviderConfig {
  const object = toObject(raw, 'providerConfig');
  return {
    ...object,
    apiKey: optionalString(object, 'apiKey', 'providerConfig'),
    language: optionalString(object, 'language', 'providerConfig'),
    transcriptionModel: optionalString(object, 'transcriptionModel', 'providerConfig'),
    turnDetection: optionalEnum(
      object,
      'turnDetection',
      'providerConfig',
      OPENAI_TURN_DETECTIONS
    ),
  };
}

export function parseUltravoxProviderConfig(raw: unknown): UltravoxProviderConfig {
  const object = toObject(raw, 'providerConfig');
  return {
    ...object,
    apiKey: optionalString(object, 'apiKey', 'providerConfig'),
    apiBaseUrl: optionalString(object, 'apiBaseUrl', 'providerConfig'),
    model: optionalString(object, 'model', 'providerConfig'),
    voice: optionalString(object, 'voice', 'providerConfig'),
    clientBufferSizeMs: optionalPositiveNumber(object, 'clientBufferSizeMs', 'providerConfig'),
    inputSampleRate: optionalPositiveNumber(object, 'inputSampleRate', 'providerConfig'),
    outputSampleRate: optionalPositiveNumber(object, 'outputSampleRate', 'providerConfig'),
  };
}

export function parseGeminiProviderConfig(raw: unknown): GeminiProviderConfig {
  const object = toObject(raw, 'providerConfig');
  const vadMode =
    optionalEnum(object, 'vadMode', 'providerConfig', GEMINI_VAD_MODES) ??
    optionalEnum(object, 'vad.mode', 'providerConfig', GEMINI_VAD_MODES);
  const vadSilenceDurationMs = optionalPositiveNumber(
    object,
    'vad.silenceDurationMs',
    'providerConfig'
  );
  const vadPrefixPaddingMs = optionalNonNegativeNumber(
    object,
    'vad.prefixPaddingMs',
    'providerConfig'
  );
  const vadThreshold = optionalPositiveNumber(object, 'vad.threshold', 'providerConfig');
  const vadStartOfSpeechSensitivity = optionalEnum(
    object,
    'vad.startOfSpeechSensitivity',
    'providerConfig',
    GEMINI_SPEECH_SENSITIVITIES
  );
  const vadEndOfSpeechSensitivity = optionalEnum(
    object,
    'vad.endOfSpeechSensitivity',
    'providerConfig',
    GEMINI_SPEECH_SENSITIVITIES
  );

  return {
    ...object,
    apiKey: optionalString(object, 'apiKey', 'providerConfig'),
    endpoint: optionalString(object, 'endpoint', 'providerConfig'),
    apiVersion: optionalEnum(object, 'apiVersion', 'providerConfig', GEMINI_API_VERSIONS),
    vadMode,
    vadSilenceDurationMs,
    vadPrefixPaddingMs,
    vadThreshold,
    vadStartOfSpeechSensitivity,
    vadEndOfSpeechSensitivity,
    enableInputTranscription: optionalBoolean(
      object,
      'enableInputTranscription',
      'providerConfig'
    ),
    enableOutputTranscription: optionalBoolean(
      object,
      'enableOutputTranscription',
      'providerConfig'
    ),
    noInterruption: optionalBoolean(object, 'noInterruption', 'providerConfig'),
    contextWindowCompressionTokens: optionalPositiveNumber(
      object,
      'contextWindowCompressionTokens',
      'providerConfig'
    ),
    proactivity: optionalBoolean(object, 'proactivity', 'providerConfig'),
    sessionResumptionHandle: optionalString(object, 'sessionResumptionHandle', 'providerConfig'),
    useEphemeralToken: optionalBoolean(object, 'useEphemeralToken', 'providerConfig'),
  };
}

function parseDecomposedTurnConfig(raw: unknown): DecomposedProviderConfig['turn'] | undefined {
  const object = toObject(raw, 'providerConfig.turn');
  if (Object.keys(object).length === 0) return undefined;

  return {
    silenceMs: optionalPositiveNumber(object, 'silenceMs', 'providerConfig.turn'),
    minSpeechMs: optionalPositiveNumber(object, 'minSpeechMs', 'providerConfig.turn'),
    minRms: optionalNonNegativeNumber(object, 'minRms', 'providerConfig.turn'),
    bargeInEnabled: optionalBoolean(object, 'bargeInEnabled', 'providerConfig.turn'),
    speechStartDebounceMs: optionalNonNegativeNumber(
      object,
      'speechStartDebounceMs',
      'providerConfig.turn'
    ),
    vadEngine: optionalEnum(
      object,
      'vadEngine',
      'providerConfig.turn',
      DECOMPOSED_VAD_ENGINES
    ),
    neuralFilterEnabled: optionalBoolean(
      object,
      'neuralFilterEnabled',
      'providerConfig.turn'
    ),
    rnnoiseSpeechThreshold: optionalUnitIntervalNumber(
      object,
      'rnnoiseSpeechThreshold',
      'providerConfig.turn'
    ),
    rnnoiseEchoSpeechThresholdBoost: optionalUnitIntervalNumber(
      object,
      'rnnoiseEchoSpeechThresholdBoost',
      'providerConfig.turn'
    ),
    webrtcVadMode: optionalIntegerRange(
      object,
      'webrtcVadMode',
      'providerConfig.turn',
      0,
      3
    ) as 0 | 1 | 2 | 3 | undefined,
    webrtcVadSpeechRatioThreshold: optionalUnitIntervalNumber(
      object,
      'webrtcVadSpeechRatioThreshold',
      'providerConfig.turn'
    ),
    webrtcVadEchoSpeechRatioBoost: optionalUnitIntervalNumber(
      object,
      'webrtcVadEchoSpeechRatioBoost',
      'providerConfig.turn'
    ),
    assistantOutputMinRms: optionalNonNegativeNumber(
      object,
      'assistantOutputMinRms',
      'providerConfig.turn'
    ),
    assistantOutputSilenceMs: optionalPositiveNumber(
      object,
      'assistantOutputSilenceMs',
      'providerConfig.turn'
    ),
    spokenStreamEnabled: optionalBoolean(
      object,
      'spokenStreamEnabled',
      'providerConfig.turn'
    ),
    wordAlignmentEnabled: optionalBoolean(
      object,
      'wordAlignmentEnabled',
      'providerConfig.turn'
    ),
    llmCompletionEnabled: optionalBoolean(
      object,
      'llmCompletionEnabled',
      'providerConfig.turn'
    ),
    llmShortTimeoutMs: optionalPositiveNumber(
      object,
      'llmShortTimeoutMs',
      'providerConfig.turn'
    ),
    llmLongTimeoutMs: optionalPositiveNumber(
      object,
      'llmLongTimeoutMs',
      'providerConfig.turn'
    ),
    llmShortReprompt: optionalString(object, 'llmShortReprompt', 'providerConfig.turn'),
    llmLongReprompt: optionalString(object, 'llmLongReprompt', 'providerConfig.turn'),
  };
}

export function parseDecomposedProviderConfig(raw: unknown): DecomposedProviderConfig {
  const object = toObject(raw, 'providerConfig');
  return {
    ...object,
    openaiApiKey: optionalString(object, 'openaiApiKey', 'providerConfig'),
    openrouterApiKey: optionalString(object, 'openrouterApiKey', 'providerConfig'),
    anthropicApiKey: optionalString(object, 'anthropicApiKey', 'providerConfig'),
    googleApiKey: optionalString(object, 'googleApiKey', 'providerConfig'),
    deepgramApiKey: optionalString(object, 'deepgramApiKey', 'providerConfig'),
    customSttMode: optionalEnum(
      object,
      'customSttMode',
      'providerConfig',
      DECOMPOSED_CUSTOM_STT_MODES
    ),
    sttProvider: optionalEnum(object, 'sttProvider', 'providerConfig', DECOMPOSED_STT_PROVIDERS),
    sttModel: optionalString(object, 'sttModel', 'providerConfig'),
    llmProvider: optionalEnum(object, 'llmProvider', 'providerConfig', DECOMPOSED_LLM_PROVIDERS),
    llmModel: optionalString(object, 'llmModel', 'providerConfig'),
    ttsProvider: optionalEnum(object, 'ttsProvider', 'providerConfig', DECOMPOSED_TTS_PROVIDERS),
    ttsModel: optionalString(object, 'ttsModel', 'providerConfig'),
    ttsVoice: optionalString(object, 'ttsVoice', 'providerConfig'),
    deepgramTtsTransport: optionalEnum(
      object,
      'deepgramTtsTransport',
      'providerConfig',
      DECOMPOSED_TTS_TRANSPORTS
    ),
    deepgramTtsWsUrl: optionalString(object, 'deepgramTtsWsUrl', 'providerConfig'),
    deepgramTtsPunctuationChunkingEnabled: optionalBoolean(
      object,
      'deepgramTtsPunctuationChunkingEnabled',
      'providerConfig'
    ),
    turn: parseDecomposedTurnConfig(object.turn),
  };
}

export function parsePipecatProviderConfig(raw: unknown): PipecatProviderConfig {
  const object = toObject(raw, 'providerConfig');
  const pipelineObject = object.pipeline;
  const pipeline = pipelineObject
    ? (() => {
        const parsed = toObject(pipelineObject, 'providerConfig.pipeline');
        const llm = parseModelRef(parsed.llm, 'providerConfig.pipeline.llm');
        return {
          stt: parsed.stt ? parseModelRef(parsed.stt, 'providerConfig.pipeline.stt') : undefined,
          llm,
          tts: parsed.tts ? parseModelRef(parsed.tts, 'providerConfig.pipeline.tts') : undefined,
        };
      })()
    : undefined;

  return {
    ...object,
    serverUrl: optionalString(object, 'serverUrl', 'providerConfig'),
    transport:
      optionalEnum(object, 'transport', 'providerConfig', PIPECAT_TRANSPORTS) ?? 'websocket',
    inputSampleRate: optionalPositiveNumber(object, 'inputSampleRate', 'providerConfig'),
    outputSampleRate: optionalPositiveNumber(object, 'outputSampleRate', 'providerConfig'),
    audioInputEncoding: optionalEnum(
      object,
      'audioInputEncoding',
      'providerConfig',
      PIPECAT_AUDIO_INPUT_ENCODINGS
    ),
    audioInputMessageType: optionalString(object, 'audioInputMessageType', 'providerConfig'),
    readyTimeoutMs: optionalPositiveNumber(object, 'readyTimeoutMs', 'providerConfig'),
    reconnect: optionalBoolean(object, 'reconnect', 'providerConfig'),
    clientVersion: optionalString(object, 'clientVersion', 'providerConfig'),
    autoToolExecution: optionalBoolean(object, 'autoToolExecution', 'providerConfig'),
    bootstrapMessageType: optionalString(object, 'bootstrapMessageType', 'providerConfig'),
    keepAliveIntervalMs: optionalPositiveNumber(
      object,
      'keepAliveIntervalMs',
      'providerConfig'
    ),
    pingMessageType: optionalString(object, 'pingMessageType', 'providerConfig'),
    pipeline,
    botId: optionalString(object, 'botId', 'providerConfig'),
  };
}

export function parseProviderConfig<TProvider extends VoiceProviderId>(
  provider: TProvider,
  raw: unknown
): ProviderConfigById[TProvider] {
  if (provider === 'openai-sdk' || provider === 'openai-ws') {
    return parseOpenAIProviderConfig(raw) as ProviderConfigById[TProvider];
  }
  if (provider === 'ultravox-ws') {
    return parseUltravoxProviderConfig(raw) as ProviderConfigById[TProvider];
  }
  if (provider === 'gemini-live') {
    return parseGeminiProviderConfig(raw) as ProviderConfigById[TProvider];
  }
  if (provider === 'decomposed') {
    return parseDecomposedProviderConfig(raw) as ProviderConfigById[TProvider];
  }
  if (provider === 'pipecat-rtvi') {
    return parsePipecatProviderConfig(raw) as ProviderConfigById[TProvider];
  }

  const unknownProvider: never = provider;
  throw new Error(`Unsupported provider: ${String(unknownProvider)}`);
}
