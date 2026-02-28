import { encodeWavPcm16Mono } from '../decomposed-utils.js';
import type { SttTranscriptionInput } from './types.js';

export async function transcribeWithLocal(input: SttTranscriptionInput): Promise<string> {
  const { pcm, context } = input;
  const wav = encodeWavPcm16Mono(pcm, context.sampleRate);
  const endpoint = new URL('/v1/audio/transcriptions', context.localEndpoint);
  endpoint.searchParams.set('model', context.model);
  endpoint.searchParams.set('language', context.language);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/wav',
    },
    body: wav,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Local STT failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as { text?: string };
  return payload.text?.trim() ?? '';
}
