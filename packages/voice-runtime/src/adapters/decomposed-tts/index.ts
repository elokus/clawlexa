import { synthesizeCartesiaSegment } from './cartesia-tts.js';
import { synthesizeDeepgramSegment } from './deepgram-tts.js';
import { synthesizeFishSegment } from './fish-tts.js';
import { synthesizeGoogleChirpSegment } from './google-chirp-tts.js';
import { synthesizeKokoroSegment } from './kokoro-tts.js';
import { synthesizeOpenAiSegment } from './openai-tts.js';
import { synthesizePocketTtsSegment } from './pocket-tts.js';
import { synthesizeRimeSegment } from './rime-tts.js';
import type {
  DecomposedTtsProvider,
  SegmentSynthesisInput,
  SegmentSynthesisResult,
  TtsProviderDefinition,
} from './types.js';

const PROVIDERS: Record<DecomposedTtsProvider, TtsProviderDefinition> = {
  openai: {
    id: 'openai',
    defaultModel: 'gpt-4o-mini-tts',
    supportsRealtimeStreaming: false,
    supportsProviderWordTimestamps: false,
    synthesizeSegment: synthesizeOpenAiSegment,
  },
  deepgram: {
    id: 'deepgram',
    defaultModel: 'aura-2-thalia-en',
    supportsRealtimeStreaming: true,
    supportsProviderWordTimestamps: false,
    synthesizeSegment: synthesizeDeepgramSegment,
  },
  cartesia: {
    id: 'cartesia',
    defaultModel: 'sonic-3',
    supportsRealtimeStreaming: false,
    supportsProviderWordTimestamps: true,
    synthesizeSegment: synthesizeCartesiaSegment,
  },
  fish: {
    id: 'fish',
    defaultModel: 's1',
    supportsRealtimeStreaming: false,
    supportsProviderWordTimestamps: false,
    synthesizeSegment: synthesizeFishSegment,
  },
  rime: {
    id: 'rime',
    defaultModel: 'arcana',
    supportsRealtimeStreaming: false,
    supportsProviderWordTimestamps: true,
    synthesizeSegment: synthesizeRimeSegment,
  },
  'google-chirp': {
    id: 'google-chirp',
    defaultModel: 'chirp-3-hd',
    supportsRealtimeStreaming: false,
    supportsProviderWordTimestamps: false,
    synthesizeSegment: synthesizeGoogleChirpSegment,
  },
  kokoro: {
    id: 'kokoro',
    defaultModel: 'kokoro-v1.0',
    supportsRealtimeStreaming: false,
    supportsProviderWordTimestamps: false,
    synthesizeSegment: synthesizeKokoroSegment,
  },
  'pocket-tts': {
    id: 'pocket-tts',
    defaultModel: 'b6369a24',
    supportsRealtimeStreaming: false,
    supportsProviderWordTimestamps: false,
    synthesizeSegment: synthesizePocketTtsSegment,
  },
};

export function getTtsProviderDefinition(
  provider: DecomposedTtsProvider
): TtsProviderDefinition {
  return PROVIDERS[provider];
}

export function defaultTtsModelForProvider(provider: DecomposedTtsProvider): string {
  return getTtsProviderDefinition(provider).defaultModel;
}

export function isRealtimeStreamingTtsProvider(provider: DecomposedTtsProvider): boolean {
  return getTtsProviderDefinition(provider).supportsRealtimeStreaming;
}

export async function synthesizeTtsSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const provider = getTtsProviderDefinition(input.context.provider);
  if (!provider.synthesizeSegment) {
    throw new Error(`TTS provider ${provider.id} does not implement segment synthesis`);
  }
  return provider.synthesizeSegment(input);
}
