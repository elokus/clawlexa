import type {
  AudioFrame,
  InterruptionContext,
  SpokenWordTimestamp,
} from '../types.js';
import { WordTimeline } from './word-timeline.js';

interface SpokenSegment {
  id: string;
  text: string;
  audioStartMs: number;
  audioEndMs: number;
}

/**
 * Tracks assistant text/audio alignment at session level so interruptions can
 * resolve "what the user actually heard" even for providers without native
 * truncation support.
 */
export class InterruptionTracker {
  private currentItemId: string | null = null;
  private fullText = '';
  private pendingText = '';
  private segments: SpokenSegment[] = [];
  private cumulativeAudioMs = 0;
  private explicitSpokenText = '';
  private explicitSpokenWordCount = 0;
  private explicitPlaybackMs = 0;
  private explicitPrecision:
    | 'ratio'
    | 'segment'
    | 'aligned'
    | 'provider-word-timestamps'
    | null = null;
  private explicitSegments: SpokenSegment[] = [];
  private readonly wordTimeline = new WordTimeline();
  private segmentCounter = 0;

  beginAssistantItem(itemId?: string): void {
    if (!itemId) return;
    if (this.currentItemId && this.currentItemId !== itemId) {
      this.reset();
    }
    this.currentItemId = itemId;
  }

  trackAssistantDelta(delta: string, itemId?: string): void {
    if (!delta) return;
    this.beginAssistantItem(itemId);
    this.pendingText += delta;
    this.fullText += delta;
  }

  trackAssistantTranscript(text: string, itemId?: string): void {
    if (!text) return;
    this.beginAssistantItem(itemId);
    this.fullText = text;
  }

  trackAssistantSpokenDelta(
    delta: string,
    itemId?: string,
    meta?: {
      spokenChars?: number;
      spokenWords?: number;
      playbackMs?: number;
      precision?: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
      wordTimestamps?: SpokenWordTimestamp[];
      wordTimestampsTimeBase?: 'segment' | 'utterance';
    }
  ): void {
    this.beginAssistantItem(itemId);
    const playbackMs = this.normalizeMs(meta?.playbackMs, this.explicitPlaybackMs);
    const previousText = this.explicitSpokenText;
    let nextText = previousText;
    if (delta) {
      nextText = previousText + delta;
    }
    if (typeof meta?.spokenChars === 'number' && meta.spokenChars >= 0 && this.fullText) {
      nextText = this.fullText.slice(0, Math.min(this.fullText.length, meta.spokenChars));
    }

    if (nextText.length > previousText.length) {
      const appended = nextText.slice(previousText.length);
      this.explicitSegments.push({
        id: this.nextSegmentId(),
        text: appended,
        audioStartMs: this.explicitPlaybackMs,
        audioEndMs: Math.max(this.explicitPlaybackMs, playbackMs),
      });
    }

    this.explicitSpokenText = nextText;
    this.ingestWordTimestamps(
      meta?.wordTimestamps,
      this.explicitPlaybackMs,
      meta?.wordTimestampsTimeBase ?? 'segment'
    );
    this.explicitPlaybackMs = playbackMs;
    this.explicitPrecision = this.wordTimeline.hasWords()
      ? 'provider-word-timestamps'
      : meta?.precision ?? this.explicitPrecision ?? 'segment';
    this.explicitSpokenWordCount =
      typeof meta?.spokenWords === 'number' && meta.spokenWords >= 0
        ? meta.spokenWords
        : countWords(nextText);
  }

  trackAssistantSpokenProgress(
    itemId: string,
    progress: {
      spokenChars: number;
      spokenWords: number;
      playbackMs: number;
      precision: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
    }
  ): void {
    this.beginAssistantItem(itemId);
    const playbackMs = this.normalizeMs(progress.playbackMs, this.explicitPlaybackMs);
    const previousText = this.explicitSpokenText;
    let nextText = previousText;
    if (this.fullText) {
      nextText = this.fullText.slice(0, Math.min(this.fullText.length, progress.spokenChars));
    } else if (progress.spokenChars < previousText.length) {
      nextText = previousText.slice(0, progress.spokenChars);
    }

    if (nextText.length > previousText.length) {
      this.explicitSegments.push({
        id: this.nextSegmentId(),
        text: nextText.slice(previousText.length),
        audioStartMs: this.explicitPlaybackMs,
        audioEndMs: Math.max(this.explicitPlaybackMs, playbackMs),
      });
    } else if (nextText.length < previousText.length) {
      this.explicitSegments = trimSegmentsToChars(this.explicitSegments, nextText.length);
    }

    this.explicitSpokenText = nextText;
    this.explicitPlaybackMs = playbackMs;
    this.explicitPrecision = this.wordTimeline.hasWords()
      ? 'provider-word-timestamps'
      : progress.precision;
    this.explicitSpokenWordCount = Math.max(0, progress.spokenWords);
  }

  trackAssistantSpokenFinal(
    text: string,
    itemId?: string,
    meta?: {
      spokenChars?: number;
      spokenWords?: number;
      playbackMs?: number;
      precision?: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
      wordTimestamps?: SpokenWordTimestamp[];
      wordTimestampsTimeBase?: 'segment' | 'utterance';
    }
  ): void {
    this.beginAssistantItem(itemId);
    const playbackMs = this.normalizeMs(meta?.playbackMs, this.explicitPlaybackMs);
    const finalText = text ?? '';
    this.explicitSpokenText = finalText;
    // spokenFinal can always replace the word timeline — it carries the
    // authoritative final timestamps, correcting any partial/inaccurate
    // data from earlier deltas.
    if (meta?.wordTimestamps && meta.wordTimestamps.length > 0) {
      this.wordTimeline.reset();
      this.ingestWordTimestamps(
        meta.wordTimestamps,
        0,
        meta.wordTimestampsTimeBase ?? 'utterance'
      );
    }
    this.explicitPlaybackMs = playbackMs;
    this.explicitPrecision = this.wordTimeline.hasWords()
      ? 'provider-word-timestamps'
      : meta?.precision ?? this.explicitPrecision ?? 'segment';
    this.explicitSpokenWordCount =
      typeof meta?.spokenWords === 'number' && meta.spokenWords >= 0
        ? meta.spokenWords
        : countWords(finalText);

    if (this.explicitSegments.length === 0 && finalText) {
      this.explicitSegments.push({
        id: this.nextSegmentId(),
        text: finalText,
        audioStartMs: 0,
        audioEndMs: playbackMs,
      });
    } else if (this.explicitSegments.length > 0) {
      const segmentText = this.explicitSegments.map((segment) => segment.text).join('');
      if (segmentText !== finalText) {
        this.explicitSegments = [
          {
            id: this.nextSegmentId(),
            text: finalText,
            audioStartMs: 0,
            audioEndMs: playbackMs,
          },
        ];
      }
    }
  }

  trackAssistantAudio(frame: AudioFrame): void {
    const chunkDurationMs = this.computeAudioDurationMs(frame);
    if (this.pendingText) {
      this.segments.push({
        id: this.nextSegmentId(),
        text: this.pendingText,
        audioStartMs: this.cumulativeAudioMs,
        audioEndMs: this.cumulativeAudioMs + chunkDurationMs,
      });
      this.pendingText = '';
    }
    this.cumulativeAudioMs += chunkDurationMs;
  }

  hasActiveAssistantOutput(): boolean {
    return (
      this.currentItemId !== null ||
      this.fullText.length > 0 ||
      this.pendingText.length > 0 ||
      this.cumulativeAudioMs > 0 ||
      this.explicitSpokenText.length > 0 ||
      this.explicitPlaybackMs > 0
    );
  }

  resolve(playbackPositionMs?: number): InterruptionContext | null {
    if (!this.currentItemId && !this.fullText && this.cumulativeAudioMs === 0) {
      return null;
    }

    const rawPlaybackMs = playbackPositionMs ?? this.cumulativeAudioMs;
    const upperBoundMs = Math.max(this.cumulativeAudioMs, this.explicitPlaybackMs, rawPlaybackMs);
    const clampedPlaybackMs = Math.max(
      0,
      Math.min(rawPlaybackMs, upperBoundMs || rawPlaybackMs)
    );

    let precision: InterruptionContext['precision'] = this.explicitPrecision ?? 'segment';
    let spokenText = '';
    let spans: InterruptionContext['spans'] | undefined;
    let explicitInterpolated = false;
    let resolvedSpokenWordCount: number | undefined;
    let resolvedSpokenWordIndex: number | undefined;

    const hasExplicitSpokenData =
      this.explicitSpokenText.length > 0 ||
      this.explicitSegments.length > 0 ||
      this.explicitPlaybackMs > 0;

    if (this.wordTimeline.hasWords()) {
      const timelineResolution = this.wordTimeline.getSpokenTextAt(clampedPlaybackMs);
      precision = 'provider-word-timestamps';
      spans = this.wordTimeline.getWordSpans();
      spokenText =
        playbackPositionMs === undefined && hasExplicitSpokenData
          ? this.explicitSpokenText
          : timelineResolution.text;
      resolvedSpokenWordCount =
        playbackPositionMs === undefined &&
        hasExplicitSpokenData &&
        this.explicitSpokenWordCount > 0
          ? this.explicitSpokenWordCount
          : timelineResolution.wordCount;
      resolvedSpokenWordIndex =
        playbackPositionMs === undefined && hasExplicitSpokenData
          ? undefined
          : timelineResolution.wordIndex;
    } else if (hasExplicitSpokenData) {
      const shouldInterpolateExplicitSegments =
        playbackPositionMs !== undefined &&
        clampedPlaybackMs > 0 &&
        clampedPlaybackMs < this.explicitPlaybackMs &&
        this.explicitSegments.length > 0;
      spokenText = shouldInterpolateExplicitSegments
        ? interpolateSegmentsToPlayback(this.explicitSegments, clampedPlaybackMs)
        : this.explicitSpokenText;
      explicitInterpolated = shouldInterpolateExplicitSegments;
      spans = this.explicitSegments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        startMs: segment.audioStartMs,
        endMs: segment.audioEndMs,
        type: 'segment' as const,
      }));
    } else {
      spokenText = this.segments
        .filter((segment) => segment.audioStartMs < clampedPlaybackMs)
        .map((segment) => segment.text)
        .join('');
      spans = this.segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        startMs: segment.audioStartMs,
        endMs: segment.audioEndMs,
        type: 'segment' as const,
      }));
    }

    // Fallback for providers that do not align deltas tightly to audio chunks.
    if (!spokenText && this.fullText && clampedPlaybackMs > 0) {
      precision = 'ratio';
      const ratio =
        this.cumulativeAudioMs > 0 ? clampedPlaybackMs / this.cumulativeAudioMs : 0;
      const chars = Math.max(
        0,
        Math.min(this.fullText.length, Math.floor(this.fullText.length * ratio))
      );
      spokenText = this.fullText.slice(0, chars);
    }

    if (spokenText.length > this.fullText.length && this.fullText) {
      spokenText = spokenText.slice(0, this.fullText.length);
    }

    const spokenWordCount =
      typeof resolvedSpokenWordCount === 'number'
        ? resolvedSpokenWordCount
        : hasExplicitSpokenData && this.explicitSpokenWordCount > 0 && !explicitInterpolated
        ? this.explicitSpokenWordCount
        : countWords(spokenText);
    const spokenWordIndex =
      typeof resolvedSpokenWordIndex === 'number'
        ? resolvedSpokenWordIndex
        : spokenWordCount > 0
          ? Math.max(0, spokenWordCount - 1)
          : undefined;

    return {
      itemId: this.currentItemId ?? undefined,
      fullText: this.fullText,
      spokenText,
      playbackPositionMs: clampedPlaybackMs,
      truncated: spokenText !== this.fullText,
      spokenWordCount: spokenWordCount > 0 ? spokenWordCount : undefined,
      spokenWordIndex,
      precision,
      spans:
        precision === 'segment' || precision === 'provider-word-timestamps'
          ? spans
          : undefined,
    };
  }

  reset(): void {
    this.currentItemId = null;
    this.fullText = '';
    this.pendingText = '';
    this.segments = [];
    this.cumulativeAudioMs = 0;
    this.explicitSpokenText = '';
    this.explicitSpokenWordCount = 0;
    this.explicitPlaybackMs = 0;
    this.explicitPrecision = null;
    this.explicitSegments = [];
    this.wordTimeline.reset();
    this.segmentCounter = 0;
  }

  private computeAudioDurationMs(frame: AudioFrame): number {
    if (frame.sampleRate <= 0) return 0;
    const sampleCount = frame.data.byteLength / 2;
    return (sampleCount / frame.sampleRate) * 1000;
  }

  private normalizeMs(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value) || value === undefined || value < 0) {
      return Math.max(0, fallback);
    }
    return Math.max(0, value);
  }

  private nextSegmentId(): string {
    this.segmentCounter += 1;
    return `seg-${this.segmentCounter}`;
  }

  private ingestWordTimestamps(
    wordTimestamps: SpokenWordTimestamp[] | undefined,
    offsetMs: number,
    timeBase: 'segment' | 'utterance'
  ): void {
    if (!wordTimestamps || wordTimestamps.length === 0) {
      return;
    }
    const effectiveOffset = timeBase === 'utterance' ? 0 : offsetMs;
    this.wordTimeline.beginSegment(effectiveOffset);
    this.wordTimeline.addWords(wordTimestamps);
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function trimSegmentsToChars(segments: SpokenSegment[], maxChars: number): SpokenSegment[] {
  if (maxChars <= 0) return [];
  const trimmed: SpokenSegment[] = [];
  let remaining = maxChars;
  for (const segment of segments) {
    if (remaining <= 0) break;
    if (segment.text.length <= remaining) {
      trimmed.push(segment);
      remaining -= segment.text.length;
      continue;
    }
    trimmed.push({
      ...segment,
      text: segment.text.slice(0, remaining),
    });
    remaining = 0;
  }
  return trimmed;
}

function interpolateSegmentsToPlayback(
  segments: SpokenSegment[],
  playbackPositionMs: number
): string {
  if (segments.length === 0 || playbackPositionMs <= 0) {
    return '';
  }

  let text = '';
  for (const segment of segments) {
    if (segment.audioStartMs >= playbackPositionMs) {
      break;
    }

    const segmentDuration = Math.max(0, segment.audioEndMs - segment.audioStartMs);
    if (segmentDuration <= 0 || segment.audioEndMs <= playbackPositionMs) {
      text += segment.text;
      continue;
    }

    const ratio = (playbackPositionMs - segment.audioStartMs) / segmentDuration;
    const interpolatedChars = Math.max(
      0,
      Math.min(segment.text.length, Math.floor(segment.text.length * ratio))
    );
    const snappedChars = snapToWordBoundary(segment.text, interpolatedChars);
    text += segment.text.slice(0, snappedChars);
    break;
  }
  return text;
}

function snapToWordBoundary(text: string, chars: number): number {
  if (chars <= 0) {
    return 0;
  }
  if (chars >= text.length) {
    return text.length;
  }
  if (text[chars] === ' ') {
    return chars;
  }
  const lastSpace = text.lastIndexOf(' ', chars);
  return lastSpace > 0 ? lastSpace : chars;
}
