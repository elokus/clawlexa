import { streamPcmResponse } from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

export async function synthesizeKokoroSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  const response = await fetch(context.kokoroEndpoint, {
    method: 'POST',
    headers: {
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
    throw new Error(`Kokoro TTS failed (${response.status}): ${errorText}`);
  }

  await streamPcmResponse(response, emitChunk);
  return { precision: 'segment' };
}
