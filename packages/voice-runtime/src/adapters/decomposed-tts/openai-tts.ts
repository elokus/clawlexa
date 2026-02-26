import { streamPcmResponse } from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

export async function synthesizeOpenAiSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  if (!context.openaiApiKey) {
    throw new Error('OpenAI API key is missing for decomposed TTS');
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: context.model,
      voice: context.voice,
      input: text,
      response_format: 'pcm',
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI TTS failed (${response.status}): ${errorText}`);
  }

  await streamPcmResponse(response, emitChunk);
  return { precision: 'segment' };
}
