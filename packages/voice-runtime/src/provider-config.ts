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
const PIPECAT_TRANSPORTS = ['websocket', 'webrtc'] as const;
const PIPECAT_AUDIO_INPUT_ENCODINGS = ['binary-pcm16', 'client-message-base64'] as const;
const DECOMPOSED_STT_PROVIDERS = ['openai', 'deepgram'] as const;
const DECOMPOSED_LLM_PROVIDERS = ['openai', 'openrouter'] as const;
const DECOMPOSED_TTS_PROVIDERS = ['openai', 'deepgram'] as const;
const DECOMPOSED_TTS_TRANSPORTS = ['websocket'] as const;

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
  return {
    apiKey: optionalString(object, 'apiKey', 'providerConfig'),
    endpoint: optionalString(object, 'endpoint', 'providerConfig'),
    apiVersion: optionalEnum(object, 'apiVersion', 'providerConfig', GEMINI_API_VERSIONS),
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
    openaiApiKey: optionalString(object, 'openaiApiKey', 'providerConfig'),
    openrouterApiKey: optionalString(object, 'openrouterApiKey', 'providerConfig'),
    deepgramApiKey: optionalString(object, 'deepgramApiKey', 'providerConfig'),
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
