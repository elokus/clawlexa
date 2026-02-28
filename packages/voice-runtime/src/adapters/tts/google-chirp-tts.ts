import {
  chunkArrayBuffer,
  decodeBase64ToArrayBuffer,
  PCM_BYTES_PER_100MS,
  stripWavHeader,
} from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

interface GoogleSynthesizeResponse {
  audioContent?: string;
}

export async function synthesizeGoogleChirpSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  if (!context.googleApiKey) {
    throw new Error('Google API key is missing for decomposed TTS provider google-chirp');
  }

  const endpoint = new URL(context.googleChirpEndpoint);
  if (!endpoint.searchParams.has('key')) {
    endpoint.searchParams.set('key', context.googleApiKey);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text },
      voice: {
        name: context.voice,
        languageCode: inferGoogleLanguageCode(context.language, context.voice),
      },
      audioConfig: {
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 24000,
      },
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Chirp TTS failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as GoogleSynthesizeResponse;
  if (!payload.audioContent) {
    throw new Error('Google Chirp TTS response is missing audioContent');
  }

  const wavOrPcm = decodeBase64ToArrayBuffer(payload.audioContent);
  const pcm = stripWavHeader(wavOrPcm);
  const chunks = chunkArrayBuffer(pcm, PCM_BYTES_PER_100MS);
  for (const chunk of chunks) {
    const keepGoing = await emitChunk(chunk);
    if (!keepGoing) {
      break;
    }
  }

  return { precision: 'segment' };
}

function inferGoogleLanguageCode(language: string, voice: string): string {
  const voiceMatch = voice.match(/^[a-z]{2}-[a-z]{2}/i);
  if (voiceMatch?.[0]) {
    return voiceMatch[0];
  }

  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return 'en-US';
  }
  if (/^[a-z]{2}-[a-z]{2}$/i.test(normalized)) {
    return normalized;
  }

  if (normalized === 'en') return 'en-US';
  if (normalized === 'de') return 'de-DE';
  if (normalized === 'fr') return 'fr-FR';
  if (normalized === 'es') return 'es-ES';
  if (normalized === 'it') return 'it-IT';
  if (normalized === 'pt') return 'pt-BR';
  if (normalized === 'ja') return 'ja-JP';
  if (normalized === 'ko') return 'ko-KR';
  if (normalized === 'zh') return 'cmn-CN';

  return 'en-US';
}
