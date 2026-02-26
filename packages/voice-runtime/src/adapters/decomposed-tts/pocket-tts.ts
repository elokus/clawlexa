import {
  chunkArrayBuffer,
  PCM_BYTES_PER_100MS,
  stripWavHeader,
} from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

export async function synthesizePocketTtsSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  const response = await fetch(context.pocketTtsEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice: context.voice,
      model: context.model,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pocket TTS failed (${response.status}): ${errorText}`);
  }

  const wavOrPcm = await response.arrayBuffer();
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
