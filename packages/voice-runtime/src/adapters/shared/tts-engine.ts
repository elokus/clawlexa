import { defaultTtsModelForProvider, synthesizeTtsSegment } from '../tts/index.js';
import type {
  DecomposedTtsProvider,
  DecomposedTtsProviderContext,
  SegmentSynthesisResult,
} from '../tts/types.js';

export interface SharedTtsConfig {
  provider: DecomposedTtsProvider;
  model: string;
  voice: string;
  language: string;
  openaiApiKey?: string;
  deepgramApiKey?: string;
  googleApiKey?: string;
  cartesiaApiKey?: string;
  fishAudioApiKey?: string;
  rimeApiKey?: string;
  kokoroEndpoint: string;
  pocketTtsEndpoint: string;
  localEndpoint: string;
  localTtsStreamingIntervalSec: number;
  voiceRefAudio?: string;
  voiceRefText?: string;
  googleChirpEndpoint: string;
  cartesiaTtsWsUrl: string;
  fishTtsWsUrl: string;
  rimeTtsWsUrl: string;
}

export function resolveSharedTtsConfig(input: {
  provider?: DecomposedTtsProvider;
  model?: string;
  voice: string;
  language: string;
  openaiApiKey?: string;
  deepgramApiKey?: string;
  googleApiKey?: string;
  cartesiaApiKey?: string;
  fishAudioApiKey?: string;
  rimeApiKey?: string;
  kokoroEndpoint?: string;
  pocketTtsEndpoint?: string;
  localEndpoint?: string;
  localTtsStreamingIntervalSec?: number;
  voiceRefAudio?: string;
  voiceRefText?: string;
  googleChirpEndpoint?: string;
  cartesiaTtsWsUrl?: string;
  fishTtsWsUrl?: string;
  rimeTtsWsUrl?: string;
}): SharedTtsConfig {
  const provider = input.provider ?? 'openai';
  return {
    provider,
    model: input.model ?? defaultTtsModelForProvider(provider),
    voice: input.voice,
    language: input.language,
    openaiApiKey: input.openaiApiKey,
    deepgramApiKey: input.deepgramApiKey,
    googleApiKey: input.googleApiKey,
    cartesiaApiKey: input.cartesiaApiKey,
    fishAudioApiKey: input.fishAudioApiKey,
    rimeApiKey: input.rimeApiKey,
    kokoroEndpoint: input.kokoroEndpoint ?? 'http://localhost:8880/v1/audio/speech',
    pocketTtsEndpoint: input.pocketTtsEndpoint ?? 'http://localhost:8000/tts',
    localEndpoint: input.localEndpoint ?? 'http://localhost:1060',
    localTtsStreamingIntervalSec: input.localTtsStreamingIntervalSec ?? 1.0,
    voiceRefAudio: input.voiceRefAudio,
    voiceRefText: input.voiceRefText,
    googleChirpEndpoint:
      input.googleChirpEndpoint ??
      'https://texttospeech.googleapis.com/v1/text:synthesize',
    cartesiaTtsWsUrl: input.cartesiaTtsWsUrl ?? 'wss://api.cartesia.ai/tts/websocket',
    fishTtsWsUrl: input.fishTtsWsUrl ?? 'wss://api.fish.audio/v1/tts/live',
    rimeTtsWsUrl: input.rimeTtsWsUrl ?? 'wss://users-ws.rime.ai/ws2',
  };
}

export function toSharedTtsProviderContext(
  config: SharedTtsConfig,
  localTtsStreamingIntervalSec = config.localTtsStreamingIntervalSec
): DecomposedTtsProviderContext {
  return {
    provider: config.provider,
    model: config.model,
    voice: config.voice,
    language: config.language,
    openaiApiKey: config.openaiApiKey,
    deepgramApiKey: config.deepgramApiKey,
    googleApiKey: config.googleApiKey,
    cartesiaApiKey: config.cartesiaApiKey,
    fishAudioApiKey: config.fishAudioApiKey,
    rimeApiKey: config.rimeApiKey,
    kokoroEndpoint: config.kokoroEndpoint,
    pocketTtsEndpoint: config.pocketTtsEndpoint,
    localEndpoint: config.localEndpoint,
    localTtsStreamingIntervalSec,
    voiceRefAudio: config.voiceRefAudio,
    voiceRefText: config.voiceRefText,
    googleChirpEndpoint: config.googleChirpEndpoint,
    cartesiaTtsWsUrl: config.cartesiaTtsWsUrl,
    fishTtsWsUrl: config.fishTtsWsUrl,
    rimeTtsWsUrl: config.rimeTtsWsUrl,
  };
}

export async function synthesizeWithSharedTts(input: {
  text: string;
  config: SharedTtsConfig;
  emitChunk: (chunk: ArrayBuffer) => Promise<boolean>;
  signal: AbortSignal;
  localTtsStreamingIntervalSec?: number;
}): Promise<SegmentSynthesisResult> {
  return synthesizeTtsSegment({
    text: input.text,
    context: toSharedTtsProviderContext(
      input.config,
      input.localTtsStreamingIntervalSec ?? input.config.localTtsStreamingIntervalSec
    ),
    emitChunk: input.emitChunk,
    signal: input.signal,
  });
}
