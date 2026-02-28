import type { SegmentSynthesisInput, SegmentSynthesisResult } from './types.js';

export async function synthesizeDeepgramSegment(
  _input: SegmentSynthesisInput
): Promise<SegmentSynthesisResult> {
  throw new Error(
    'Deepgram segment synthesis is handled by DecomposedAdapter streaming transport. '
      + 'Use the adapter deepgram websocket path.'
  );
}
