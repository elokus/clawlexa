import { parseDecomposedProviderConfig } from '../provider-config.js';
import type {
  DecomposedProviderConfig,
  ProviderCapabilities,
  ProviderConfigSchema,
  SessionInput,
} from '../types.js';
import type { DecomposedVadEngine } from '../vad/turn-detector.js';
import { defaultTtsModelForProvider } from './tts/index.js';
import type { DecomposedTtsProvider } from './tts/types.js';
import { defaultInlineTtsChunkingEnabled } from './decomposed-utils.js';

export interface DecomposedOptions {
  sttProvider: 'openai' | 'deepgram' | 'local';
  sttModel: string;
  customSttMode: 'provider' | 'custom' | 'hybrid';
  llmProvider: 'openai' | 'openrouter' | 'anthropic' | 'google';
  llmModel: string;
  ttsProvider: DecomposedTtsProvider;
  ttsModel: string;
  ttsVoice: string;
  deepgramTtsTransport: 'websocket';
  deepgramTtsWsUrl: string;
  deepgramTtsPunctuationChunkingEnabled: boolean;
  inlineTtsChunkingEnabled: boolean;
  cartesiaTtsWsUrl: string;
  fishTtsWsUrl: string;
  rimeTtsWsUrl: string;
  googleChirpEndpoint: string;
  kokoroEndpoint: string;
  pocketTtsEndpoint: string;
  localEndpoint: string;
  localTtsStreamingIntervalSec: number;
  localQwenAdaptiveUnderrunEnabled: boolean;
  silenceMs: number;
  minSpeechMs: number;
  minRms: number;
  bargeInEnabled: boolean;
  speechStartDebounceMs: number;
  vadEngine: DecomposedVadEngine;
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
  llmCompletionEnabled: boolean;
  llmShortTimeoutMs: number;
  llmLongTimeoutMs: number;
  llmShortReprompt: string;
  llmLongReprompt: string;
  language: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  deepgramApiKey?: string;
  cartesiaApiKey?: string;
  fishAudioApiKey?: string;
  rimeApiKey?: string;
}

export const DECOMPOSED_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['http', 'websocket'],
  audioNegotiation: false,
  vadModes: ['manual'],
  interruptionModes: ['barge-in'],

  toolTimeout: false,
  asyncTools: true,
  toolCancellation: false,
  toolScheduling: false,
  toolReaction: false,
  precomputableTools: false,
  toolApproval: false,
  mcpTools: false,
  serverSideTools: false,

  sessionResumption: false,
  midSessionConfigUpdate: false,
  contextCompression: false,

  forceAgentMessage: false,
  outputMediumSwitch: false,
  callState: false,
  deferredText: false,
  callStages: false,
  proactivity: false,
  usageMetrics: false,
  orderedTranscripts: true,
  ephemeralTokens: false,
  nativeTruncation: false,
  wordLevelTimestamps: false,
};

export const DECOMPOSED_CONFIG_SCHEMA: ProviderConfigSchema = {
  providerId: 'decomposed',
  displayName: 'Decomposed (STT + LLM + TTS)',
  fields: [
    {
      key: 'turn.silenceMs',
      label: 'Silence Threshold (ms)',
      type: 'number',
      group: 'vad',
      min: 100,
      max: 3000,
      step: 50,
      defaultValue: 700,
      description: 'Duration of silence before finalizing a turn.',
    },
    {
      key: 'turn.minSpeechMs',
      label: 'Minimum Speech (ms)',
      type: 'number',
      group: 'vad',
      min: 50,
      max: 2000,
      step: 50,
      defaultValue: 350,
      description: 'Minimum speech duration to process a turn.',
    },
    {
      key: 'turn.minRms',
      label: 'Minimum RMS Level',
      type: 'number',
      group: 'vad',
      min: 0.001,
      max: 0.1,
      step: 0.001,
      defaultValue: 0.015,
      description: 'Audio level threshold for speech detection.',
    },
    {
      key: 'turn.bargeInEnabled',
      label: 'Barge-In Enabled',
      type: 'boolean',
      group: 'vad',
      defaultValue: true,
      description:
        'When disabled, mic audio is ignored while assistant audio is speaking (no auto interruption).',
    },
    {
      key: 'turn.speechStartDebounceMs',
      label: 'Speech Start Debounce (ms)',
      type: 'number',
      group: 'vad',
      min: 0,
      max: 600,
      step: 10,
      defaultValue: 140,
      description: 'Continuous speech required before opening a mic turn buffer.',
    },
    {
      key: 'turn.vadEngine',
      label: 'VAD Engine',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'webrtc-vad', label: 'WebRTC VAD (proper speech classifier)' },
        { value: 'rnnoise', label: 'RNNoise (neural, recommended)' },
        { value: 'rms', label: 'RMS (legacy fallback)' },
      ],
      defaultValue: 'webrtc-vad',
      description:
        'Speech detector used for turn start/barge-in. WebRTC VAD is recommended for robust speech-vs-noise classification.',
    },
    {
      key: 'turn.neuralFilterEnabled',
      label: 'Neural Input Filter',
      type: 'boolean',
      group: 'vad',
      defaultValue: true,
      description:
        'Denoises microphone audio with RNNoise before VAD/STT capture (fallbacks to raw audio if unavailable).',
    },
    {
      key: 'turn.rnnoiseSpeechThreshold',
      label: 'RNNoise Speech Threshold',
      type: 'range',
      group: 'vad',
      min: 0.2,
      max: 0.99,
      step: 0.01,
      defaultValue: 0.62,
      dependsOn: { field: 'turn.vadEngine', value: 'rnnoise' },
      description: 'Neural speech probability threshold in normal listening mode.',
    },
    {
      key: 'turn.webrtcVadMode',
      label: 'WebRTC VAD Mode',
      type: 'number',
      group: 'vad',
      min: 0,
      max: 3,
      step: 1,
      defaultValue: 3,
      dependsOn: { field: 'turn.vadEngine', value: 'webrtc-vad' },
      description: 'Aggressiveness of WebRTC VAD speech filtering.',
    },
    {
      key: 'turn.webrtcVadSpeechRatioThreshold',
      label: 'WebRTC Speech Ratio Threshold',
      type: 'range',
      group: 'vad',
      min: 0.2,
      max: 0.99,
      step: 0.01,
      defaultValue: 0.7,
      dependsOn: { field: 'turn.vadEngine', value: 'webrtc-vad' },
      description: 'Minimum voiced-frame ratio required to classify chunk as speech.',
    },
    {
      key: 'turn.webrtcVadEchoSpeechRatioBoost',
      label: 'WebRTC Speaking Boost',
      type: 'range',
      group: 'vad',
      min: 0,
      max: 0.4,
      step: 0.01,
      defaultValue: 0.15,
      dependsOn: { field: 'turn.vadEngine', value: 'webrtc-vad' },
      description: 'Extra voiced-ratio required while assistant is speaking.',
    },
    {
      key: 'turn.assistantOutputMinRms',
      label: 'Assistant Output VAD Min RMS',
      type: 'number',
      group: 'vad',
      min: 0.001,
      max: 0.08,
      step: 0.001,
      defaultValue: 0.008,
      description: 'RMS threshold to consider assistant output actively speaking.',
    },
    {
      key: 'turn.assistantOutputSilenceMs',
      label: 'Assistant Output Silence Hold (ms)',
      type: 'number',
      group: 'vad',
      min: 100,
      max: 1200,
      step: 10,
      defaultValue: 350,
      description: 'How long output stays "speaking" after last voiced chunk.',
    },
    {
      key: 'deepgramTtsPunctuationChunkingEnabled',
      label: 'Deepgram Punctuation Chunking',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
      description:
        'When enabled, Deepgram streaming TTS flushes on punctuation for lower latency. Disable for one continuous segment per turn.',
    },
    {
      key: 'inlineTtsChunkingEnabled',
      label: 'Inline TTS Chunking',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
      description:
        'When enabled, inline/non-streaming TTS is synthesized in small segments while text streams in. Disable to synthesize one full utterance per response.',
    },
    {
      key: 'localEndpoint',
      label: 'Local Inference Endpoint',
      type: 'string',
      group: 'advanced',
      defaultValue: 'http://localhost:1060',
      description:
        'Base URL for local STT/TTS provider calls (for example http://localhost:1060).',
    },
    {
      key: 'localTtsStreamingIntervalSec',
      label: 'Local Qwen Streaming Interval (s)',
      type: 'number',
      group: 'advanced',
      min: 0.2,
      max: 4,
      step: 0.1,
      defaultValue: 1.0,
      description:
        'Streaming chunk interval for local Qwen TTS. Lower values reduce first audio latency but can increase chunk overhead.',
    },
    {
      key: 'localQwenAdaptiveUnderrunEnabled',
      label: 'Local Qwen Adaptive Anti-Underrun',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
      description:
        'Dynamically increases startup buffer and streaming interval for local Qwen TTS when generation falls behind playback.',
    },
    // LLM completion fields (enabled, shortTimeoutMs, longTimeoutMs) are managed
    // by the dedicated turn.llmCompletion section in voice.config.json, not providerSettings.
  ],
};

export function resolveDecomposedOptions(input: SessionInput): DecomposedOptions {
  const providerConfig: DecomposedProviderConfig = parseDecomposedProviderConfig(input.providerConfig);
  const ttsProvider = (providerConfig.ttsProvider ?? 'openai') as DecomposedTtsProvider;
  const ttsModel = providerConfig.ttsModel ?? defaultTtsModelForProvider(ttsProvider);

  return {
    sttProvider: providerConfig.sttProvider ?? 'openai',
    sttModel: providerConfig.sttModel ?? 'gpt-4o-mini-transcribe',
    customSttMode: providerConfig.customSttMode ?? 'provider',
    llmProvider: providerConfig.llmProvider ?? 'openai',
    llmModel: providerConfig.llmModel ?? input.model,
    ttsProvider,
    ttsModel,
    ttsVoice: providerConfig.ttsVoice ?? input.voice,
    deepgramTtsTransport: providerConfig.deepgramTtsTransport ?? 'websocket',
    deepgramTtsWsUrl: providerConfig.deepgramTtsWsUrl ?? 'wss://api.deepgram.com/v1/speak',
    deepgramTtsPunctuationChunkingEnabled:
      providerConfig.deepgramTtsPunctuationChunkingEnabled ?? true,
    inlineTtsChunkingEnabled:
      providerConfig.inlineTtsChunkingEnabled ??
      defaultInlineTtsChunkingEnabled(ttsProvider, ttsModel),
    cartesiaTtsWsUrl:
      providerConfig.cartesiaTtsWsUrl ?? 'wss://api.cartesia.ai/tts/websocket',
    fishTtsWsUrl: providerConfig.fishTtsWsUrl ?? 'wss://api.fish.audio/v1/tts/live',
    rimeTtsWsUrl: providerConfig.rimeTtsWsUrl ?? 'wss://users-ws.rime.ai/ws2',
    googleChirpEndpoint:
      providerConfig.googleChirpEndpoint ??
      'https://texttospeech.googleapis.com/v1/text:synthesize',
    kokoroEndpoint:
      providerConfig.kokoroEndpoint ?? 'http://localhost:8880/v1/audio/speech',
    pocketTtsEndpoint: providerConfig.pocketTtsEndpoint ?? 'http://localhost:8000/tts',
    localEndpoint: providerConfig.localEndpoint ?? 'http://localhost:1060',
    localTtsStreamingIntervalSec: providerConfig.localTtsStreamingIntervalSec ?? 1.0,
    localQwenAdaptiveUnderrunEnabled: providerConfig.localQwenAdaptiveUnderrunEnabled ?? true,
    silenceMs: providerConfig.turn?.silenceMs ?? 700,
    minSpeechMs: providerConfig.turn?.minSpeechMs ?? 350,
    minRms: providerConfig.turn?.minRms ?? 0.015,
    bargeInEnabled: providerConfig.turn?.bargeInEnabled ?? true,
    speechStartDebounceMs: providerConfig.turn?.speechStartDebounceMs ?? 140,
    vadEngine: providerConfig.turn?.vadEngine ?? 'webrtc-vad',
    neuralFilterEnabled: providerConfig.turn?.neuralFilterEnabled ?? true,
    rnnoiseSpeechThreshold: providerConfig.turn?.rnnoiseSpeechThreshold ?? 0.62,
    rnnoiseEchoSpeechThresholdBoost: providerConfig.turn?.rnnoiseEchoSpeechThresholdBoost ?? 0.12,
    webrtcVadMode: providerConfig.turn?.webrtcVadMode ?? 3,
    webrtcVadSpeechRatioThreshold: providerConfig.turn?.webrtcVadSpeechRatioThreshold ?? 0.7,
    webrtcVadEchoSpeechRatioBoost:
      providerConfig.turn?.webrtcVadEchoSpeechRatioBoost ?? 0.15,
    assistantOutputMinRms: providerConfig.turn?.assistantOutputMinRms ?? 0.008,
    assistantOutputSilenceMs: providerConfig.turn?.assistantOutputSilenceMs ?? 350,
    spokenStreamEnabled: providerConfig.turn?.spokenStreamEnabled ?? false,
    wordAlignmentEnabled: providerConfig.turn?.wordAlignmentEnabled ?? false,
    llmCompletionEnabled: providerConfig.turn?.llmCompletionEnabled ?? false,
    llmShortTimeoutMs: providerConfig.turn?.llmShortTimeoutMs ?? 5000,
    llmLongTimeoutMs: providerConfig.turn?.llmLongTimeoutMs ?? 10000,
    llmShortReprompt:
      providerConfig.turn?.llmShortReprompt ??
      'Can you finish that thought for me?',
    llmLongReprompt:
      providerConfig.turn?.llmLongReprompt ??
      "I'm still here. Continue when you're ready.",
    language: input.language ?? 'en',
    openaiApiKey: providerConfig.openaiApiKey,
    openrouterApiKey: providerConfig.openrouterApiKey,
    anthropicApiKey: providerConfig.anthropicApiKey,
    googleApiKey: providerConfig.googleApiKey,
    deepgramApiKey: providerConfig.deepgramApiKey,
    cartesiaApiKey: providerConfig.cartesiaApiKey,
    fishAudioApiKey: providerConfig.fishAudioApiKey,
    rimeApiKey: providerConfig.rimeApiKey,
  };
}
