import { streamPcmResponse } from './audio-utils.js';
import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

function isQwenModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('qwen3') || normalized.includes('qwen-tts');
}

export async function synthesizeLocalSegment(
  input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  const { context, text, emitChunk, signal } = input;
  const endpoint = new URL('/v1/audio/speech', context.localEndpoint);
  const requestBody: Record<string, unknown> = {
    model: context.model,
    voice: context.voice,
    language: context.language,
    lang_code: context.language,
    input: text,
    response_format: 'pcm',
  };
  if (isQwenModel(context.model)) {
    const interval =
      Number.isFinite(context.localTtsStreamingIntervalSec) &&
      context.localTtsStreamingIntervalSec > 0
        ? context.localTtsStreamingIntervalSec
        : 1.0;
    requestBody.seed = 42;
    requestBody.stream = true;
    requestBody.streaming_interval = interval;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Local TTS failed (${response.status}): ${errorText}`);
  }

  await streamPcmResponse(response, emitChunk, {
    passthroughChunks: isQwenModel(context.model),
  });
  return { precision: 'segment' };
}
