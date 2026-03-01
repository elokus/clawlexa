import { transcribeStt } from '../stt/index.js';
import type { DecomposedSttProvider } from '../stt/types.js';

export interface SharedSttConfig {
  provider: DecomposedSttProvider;
  model: string;
  language: string;
  sampleRate: number;
  openaiApiKey?: string;
  deepgramApiKey?: string;
  localEndpoint: string;
}

export async function transcribeWithSharedStt(input: {
  pcm: Uint8Array;
  config: SharedSttConfig;
}): Promise<string> {
  const { pcm, config } = input;
  return transcribeStt({
    pcm,
    context: {
      provider: config.provider,
      model: config.model,
      language: config.language,
      sampleRate: config.sampleRate,
      openaiApiKey: config.openaiApiKey,
      deepgramApiKey: config.deepgramApiKey,
      localEndpoint: config.localEndpoint,
    },
  });
}
