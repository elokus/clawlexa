export type VoiceProviderId =
  | 'openai-sdk'
  | 'openai-ws'
  | 'ultravox-ws'
  | 'gemini-live'
  | 'decomposed'
  | 'pipecat-rtvi';

export type {
  ToolCallContext,
  ToolCallHandler,
  ToolCallResult,
  ToolDefinition,
  ToolReaction,
} from '../tools/types.js';

export interface VoiceHistoryItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  createdAt: number;
  providerMeta?: Record<string, unknown>;
}

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
  providerId: VoiceProviderId;
  displayName: string;
  fields: ConfigFieldDescriptor[];
  voices?: ProviderVoiceEntry[];
}

export interface OpenAIProviderConfig extends Record<string, unknown> {
  apiKey?: string;
  language?: string;
  transcriptionModel?: string;
  turnDetection?: 'server_vad' | 'semantic_vad';
}

export interface UltravoxProviderConfig extends Record<string, unknown> {
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  voice?: string;
  clientBufferSizeMs?: number;
  inputSampleRate?: number;
  outputSampleRate?: number;
}

export interface GeminiProviderConfig extends Record<string, unknown> {
  apiKey?: string;
  endpoint?: string;
  apiVersion?: 'v1alpha' | 'v1beta';
  vadMode?: 'server' | 'manual';
  vadSilenceDurationMs?: number;
  vadPrefixPaddingMs?: number;
  vadThreshold?: number;
  vadStartOfSpeechSensitivity?: 'high' | 'low';
  vadEndOfSpeechSensitivity?: 'high' | 'low';
  enableInputTranscription?: boolean;
  enableOutputTranscription?: boolean;
  noInterruption?: boolean;
  contextWindowCompressionTokens?: number;
  proactivity?: boolean;
  sessionResumptionHandle?: string;
  useEphemeralToken?: boolean;
}

export interface DecomposedProviderConfig extends Record<string, unknown> {
  openaiApiKey?: string;
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  deepgramApiKey?: string;
  customSttMode?: 'provider' | 'custom' | 'hybrid';
  sttProvider?: 'openai' | 'deepgram';
  sttModel?: string;
  llmProvider?: 'openai' | 'openrouter' | 'anthropic' | 'google';
  llmModel?: string;
  ttsProvider?: 'openai' | 'deepgram';
  ttsModel?: string;
  ttsVoice?: string;
  deepgramTtsTransport?: 'websocket';
  deepgramTtsWsUrl?: string;
  deepgramTtsPunctuationChunkingEnabled?: boolean;
  turn?: {
    silenceMs?: number;
    minSpeechMs?: number;
    minRms?: number;
    bargeInEnabled?: boolean;
    speechStartDebounceMs?: number;
    vadEngine?: 'rms' | 'rnnoise' | 'webrtc-vad';
    neuralFilterEnabled?: boolean;
    rnnoiseSpeechThreshold?: number;
    rnnoiseEchoSpeechThresholdBoost?: number;
    webrtcVadMode?: 0 | 1 | 2 | 3;
    webrtcVadSpeechRatioThreshold?: number;
    webrtcVadEchoSpeechRatioBoost?: number;
    assistantOutputMinRms?: number;
    assistantOutputSilenceMs?: number;
    spokenStreamEnabled?: boolean;
    wordAlignmentEnabled?: boolean;
    llmCompletionEnabled?: boolean;
    llmShortTimeoutMs?: number;
    llmLongTimeoutMs?: number;
    llmShortReprompt?: string;
    llmLongReprompt?: string;
  };
}

export interface PipecatProviderConfig extends Record<string, unknown> {
  serverUrl?: string;
  transport: 'websocket' | 'webrtc';
  inputSampleRate?: number;
  outputSampleRate?: number;
  audioInputEncoding?: 'binary-pcm16' | 'client-message-base64';
  audioInputMessageType?: string;
  readyTimeoutMs?: number;
  reconnect?: boolean;
  clientVersion?: string;
  autoToolExecution?: boolean;
  bootstrapMessageType?: string;
  keepAliveIntervalMs?: number;
  pingMessageType?: string;
  pipeline?: {
    stt?: { provider: string; model: string };
    llm: { provider: string; model: string };
    tts?: { provider: string; model: string; voice?: string };
  };
  botId?: string;
}
