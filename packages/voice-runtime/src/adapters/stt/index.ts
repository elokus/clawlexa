import { transcribeWithDeepgram } from './deepgram-stt.js';
import { transcribeWithLocal } from './local-stt.js';
import { transcribeWithOpenAI } from './openai-stt.js';
import type {
  DecomposedSttProvider,
  SttProviderDefinition,
  SttTranscriptionInput,
} from './types.js';

const PROVIDERS: Record<DecomposedSttProvider, SttProviderDefinition> = {
  openai: {
    id: 'openai',
    transcribe: transcribeWithOpenAI,
  },
  deepgram: {
    id: 'deepgram',
    transcribe: transcribeWithDeepgram,
  },
  local: {
    id: 'local',
    transcribe: transcribeWithLocal,
  },
};

export function getSttProviderDefinition(provider: DecomposedSttProvider): SttProviderDefinition {
  return PROVIDERS[provider];
}

export async function transcribeStt(input: SttTranscriptionInput): Promise<string> {
  const provider = getSttProviderDefinition(input.context.provider);
  return provider.transcribe(input);
}
