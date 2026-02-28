import type { SpokenWordTimestamp } from '../../types.js';

export const DECOMPOSED_TTS_PROVIDERS = [
  'openai',
  'deepgram',
  'cartesia',
  'fish',
  'rime',
  'google-chirp',
  'kokoro',
  'pocket-tts',
  'local',
] as const;

export type DecomposedTtsProvider = (typeof DECOMPOSED_TTS_PROVIDERS)[number];

export interface DecomposedTtsProviderContext {
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
  googleChirpEndpoint: string;
  cartesiaTtsWsUrl: string;
  fishTtsWsUrl: string;
  rimeTtsWsUrl: string;
}

export interface SegmentSynthesisResult {
  wordTimestamps?: SpokenWordTimestamp[];
  wordTimestampsTimeBase?: 'segment' | 'utterance';
  precision?: 'segment' | 'provider-word-timestamps';
}

export interface SegmentSynthesisInput {
  text: string;
  context: DecomposedTtsProviderContext;
  emitChunk: (chunk: ArrayBuffer) => Promise<boolean>;
  signal: AbortSignal;
}

export type SegmentSynthesizer = (
  input: SegmentSynthesisInput
) => Promise<SegmentSynthesisResult>;

export interface TtsProviderDefinition {
  id: DecomposedTtsProvider;
  defaultModel: string;
  supportsRealtimeStreaming: boolean;
  supportsProviderWordTimestamps: boolean;
  synthesizeSegment?: SegmentSynthesizer;
}
