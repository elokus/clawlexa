export const DECOMPOSED_STT_PROVIDERS = ['openai', 'deepgram', 'local'] as const;

export type DecomposedSttProvider = (typeof DECOMPOSED_STT_PROVIDERS)[number];

export interface SttProviderContext {
  provider: DecomposedSttProvider;
  model: string;
  language: string;
  sampleRate: number;
  openaiApiKey?: string;
  deepgramApiKey?: string;
  localEndpoint: string;
}

export interface SttTranscriptionInput {
  pcm: Uint8Array;
  context: SttProviderContext;
}

export type SttTranscriber = (input: SttTranscriptionInput) => Promise<string>;

export interface SttProviderDefinition {
  id: DecomposedSttProvider;
  transcribe: SttTranscriber;
}
