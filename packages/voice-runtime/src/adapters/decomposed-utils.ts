import type { DecomposedTtsProvider } from './tts/types.js';

/**
 * RMS threshold for detecting speech onset in PCM16 audio.
 * Values below this are considered silence (Deepgram TTS preamble).
 * PCM16 range is [-32768, 32767]; a typical quiet signal has RMS < 200.
 */
export const SPEECH_ONSET_RMS_THRESHOLD = 300;

export const DEEPGRAM_FLUSH_FALLBACK_POLL_MS = 500;
export const DEEPGRAM_FLUSH_FALLBACK_IDLE_MS = 1200;
export const DEEPGRAM_FLUSH_FALLBACK_FORCE_MS = 1400;

export const TURN_MARKERS = ['✓', '○', '◐'] as const;

export type TurnMarker = (typeof TURN_MARKERS)[number];

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatCompletionMessage;
    finish_reason?: string | null;
  }>;
}

export interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export interface ChatCompletionMessage {
  role?: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type?: string; text?: string }> | null;
  tool_calls?: ChatCompletionToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface LlmRequestTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type LlmMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: ChatCompletionToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

/**
 * Detect the sample offset within a PCM16 chunk where speech begins.
 * Returns the byte offset relative to the chunk start, or -1 if the
 * entire chunk is silence. Uses a small sliding window (128 samples ≈ 5ms)
 * to avoid triggering on isolated clicks/pops.
 */
export function detectSpeechOnsetInChunk(chunk: ArrayBuffer): number {
  const samples = new Int16Array(chunk);
  const windowSize = Math.min(128, samples.length);
  if (windowSize === 0) return -1;

  let sumSquares = 0;
  for (let i = 0; i < windowSize; i++) {
    const s = samples[i]!;
    sumSquares += s * s;
  }
  if (Math.sqrt(sumSquares / windowSize) >= SPEECH_ONSET_RMS_THRESHOLD) {
    return 0;
  }

  for (let i = windowSize; i < samples.length; i++) {
    const entering = samples[i]!;
    const leaving = samples[i - windowSize]!;
    sumSquares += entering * entering - leaving * leaving;
    const rms = Math.sqrt(Math.max(0, sumSquares) / windowSize);
    if (rms >= SPEECH_ONSET_RMS_THRESHOLD) {
      const onsetSample = i - windowSize + 1;
      return onsetSample * 2;
    }
  }

  return -1;
}

export function toRawDataUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    const views: Uint8Array[] = [];
    let total = 0;
    for (const part of value) {
      if (part instanceof Uint8Array) {
        views.push(part);
        total += part.byteLength;
      } else if (ArrayBuffer.isView(part)) {
        const view = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
        views.push(view);
        total += view.byteLength;
      } else if (part instanceof ArrayBuffer) {
        const view = new Uint8Array(part);
        views.push(view);
        total += view.byteLength;
      }
    }
    if (views.length === 0) return null;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const view of views) {
      merged.set(view, offset);
      offset += view.byteLength;
    }
    return merged;
  }
  return null;
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = parseJsonObject(raw);
  if (parsed) return parsed;
  return { raw };
}

export function sanitizeToolCalls(
  value: ChatCompletionToolCall[] | undefined
): ChatCompletionToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ChatCompletionToolCall[] = [];
  for (const call of value) {
    if (!call || typeof call !== 'object') continue;
    const name = call.function?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    calls.push(call);
  }
  return calls;
}

export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized;
    }
    return String(value);
  } catch {
    return String(value);
  }
}

export async function* emptyAsyncGenerator(): AsyncGenerator<string> {
  // yields nothing
}

export async function* singleValueGenerator(value: string): AsyncGenerator<string> {
  if (value) yield value;
}

export async function* prependToAsyncGenerator(
  prefix: string,
  source: AsyncIterable<string>
): AsyncGenerator<string> {
  if (prefix) yield prefix;
  yield* source;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function parseMarker(
  text: string,
  markerMode: boolean
): { marker: TurnMarker; text: string } {
  const trimmed = text.trim();
  if (!markerMode || trimmed.length === 0) {
    return {
      marker: '✓',
      text: trimmed,
    };
  }

  const marker = trimmed[0] as TurnMarker;
  if (!TURN_MARKERS.includes(marker)) {
    return {
      marker: '✓',
      text: trimmed,
    };
  }

  return {
    marker,
    text: trimmed.slice(1).trimStart(),
  };
}

export function makeItemId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export function computeRmsPcm16(input: ArrayBuffer): number {
  const bytes = new DataView(input);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = bytes.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

export function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function encodeWavPcm16Mono(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const headerSize = 44;
  const wav = new ArrayBuffer(headerSize + pcm.byteLength);
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);

  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, headerSize);

  return wav;
}

export function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    target[offset + i] = value.charCodeAt(i);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractChatCompletionText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

export function extractChatCompletionMessageText(message: ChatCompletionMessage): string {
  const content = message.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

export function extractChatCompletionDeltaText(chunk: ChatCompletionStreamChunk): string {
  const content = chunk.choices?.[0]?.delta?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

export function splitSpeakableText(buffer: string): { segments: string[]; remainder: string } {
  if (!buffer) {
    return { segments: [], remainder: '' };
  }

  const segments: string[] = [];
  let start = 0;
  let candidate = -1;
  const minSegmentChars = 16;
  const earlySegmentChars = 8;
  const whitespaceSegmentChars = 18;
  const forceFlushChars = 72;
  const firstSegmentForceFlushChars = 28;

  const pushSegment = (endExclusive: number): void => {
    const raw = buffer.slice(start, endExclusive).trim();
    if (raw.length > 0) {
      segments.push(raw);
    }
    start = endExclusive;
    candidate = -1;
  };

  for (let i = 0; i < buffer.length; i += 1) {
    const char = buffer[i];
    if (char === '.' || char === '!' || char === '?' || char === ';' || char === '\n') {
      candidate = i + 1;
    } else if ((char === ',' || char === ':') && i + 1 - start >= 28) {
      candidate = i + 1;
    } else if (char === ' ' && i + 1 - start >= whitespaceSegmentChars) {
      candidate = i + 1;
    }

    const minCharsForSplit = segments.length === 0 ? earlySegmentChars : minSegmentChars;
    if (candidate > start && candidate - start >= minCharsForSplit) {
      pushSegment(candidate);
      continue;
    }

    const forceLimit = segments.length === 0 ? firstSegmentForceFlushChars : forceFlushChars;
    if (i + 1 - start >= forceLimit) {
      let splitAt = buffer.lastIndexOf(' ', i);
      if (splitAt <= start) {
        splitAt = i;
      }
      pushSegment(splitAt + 1);
    }
  }

  const remainder = buffer.slice(start);
  return { segments, remainder };
}

export function shouldFlushDeepgramStream(
  delta: string,
  pendingChars: number,
  completedFlushes: number,
  punctuationChunkingEnabled: boolean
): boolean {
  if (pendingChars <= 0) return false;

  if (!punctuationChunkingEnabled) {
    const baseThreshold = completedFlushes === 0 ? 140 : 220;
    const overflowThreshold = baseThreshold + 72;
    const hasSentenceBoundary = /[.!?;\n]/.test(delta);
    if (pendingChars < baseThreshold) return false;

    if (hasSentenceBoundary) return true;
    if (/\s/.test(delta) && pendingChars >= baseThreshold + 12) return true;
    return pendingChars >= overflowThreshold;
  }

  const hasSentenceBoundary = /[.!?;\n]/.test(delta);
  const hasMinorBoundary = /[,]/.test(delta);
  const boundaryThreshold = completedFlushes === 0 ? 24 : 64;
  const hasWhitespaceBoundary = /\s/.test(delta);

  if (hasSentenceBoundary && pendingChars >= boundaryThreshold) {
    return true;
  }
  if (completedFlushes === 0 && hasWhitespaceBoundary && pendingChars >= 32) {
    return true;
  }
  if (hasMinorBoundary && pendingChars >= 96) {
    return true;
  }
  if (completedFlushes === 0 && pendingChars >= 64) {
    return true;
  }
  if (pendingChars >= 180) {
    return true;
  }

  return false;
}

export function isQwenTtsModelId(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('qwen3') || normalized.includes('qwen-tts');
}

export function defaultInlineTtsChunkingEnabled(
  ttsProvider: DecomposedTtsProvider,
  ttsModel: string
): boolean {
  if (ttsProvider === 'local' && isQwenTtsModelId(ttsModel)) {
    return false;
  }
  return true;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}
