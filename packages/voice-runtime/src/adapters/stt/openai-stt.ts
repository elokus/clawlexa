import { encodeWavPcm16Mono } from '../decomposed-utils.js';
import type { SttTranscriptionInput } from './types.js';

export async function transcribeWithOpenAI(input: SttTranscriptionInput): Promise<string> {
  const { pcm, context } = input;
  if (!context.openaiApiKey) {
    throw new Error('OpenAI API key is missing for decomposed STT');
  }

  const wav = encodeWavPcm16Mono(pcm, context.sampleRate);
  const form = new FormData();
  form.append('file', new File([wav], 'speech.wav', { type: 'audio/wav' }));
  form.append('model', context.model);
  if (context.language) {
    form.append('language', context.language);
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.openaiApiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI STT failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as { text?: string };
  return payload.text?.trim() ?? '';
}
