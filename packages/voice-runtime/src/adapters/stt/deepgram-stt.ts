import { encodeWavPcm16Mono } from '../decomposed-utils.js';
import type { SttTranscriptionInput } from './types.js';

export interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}

export async function transcribeWithDeepgram(input: SttTranscriptionInput): Promise<string> {
  const { pcm, context } = input;
  if (!context.deepgramApiKey) {
    throw new Error('Deepgram API key is missing for decomposed STT');
  }

  const wav = encodeWavPcm16Mono(pcm, context.sampleRate);
  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', context.model || 'nova-3');
  url.searchParams.set('language', context.language);
  url.searchParams.set('smart_format', 'true');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${context.deepgramApiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: wav,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram STT failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as DeepgramListenResponse;
  return payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}
