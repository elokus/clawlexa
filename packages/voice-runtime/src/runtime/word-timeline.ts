import type { SpokenWordTimestamp } from '../types.js';

interface CumulativeWordTimestamp {
  id: string;
  word: string;
  startMs: number;
  endMs: number;
  segmentIndex: number;
}

export class WordTimeline {
  private readonly words: CumulativeWordTimestamp[] = [];
  private readonly dedupeKeys = new Set<string>();
  private segmentIndex = -1;
  private segmentOffsetMs = 0;
  private wordCounter = 0;

  get length(): number {
    return this.words.length;
  }

  hasWords(): boolean {
    return this.words.length > 0;
  }

  beginSegment(offsetMs: number): void {
    this.segmentIndex += 1;
    this.segmentOffsetMs = Number.isFinite(offsetMs) ? Math.max(0, offsetMs) : 0;
  }

  addWords(wordTimestamps: SpokenWordTimestamp[]): void {
    if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) {
      return;
    }
    if (this.segmentIndex < 0) {
      this.beginSegment(0);
    }

    let added = false;
    for (const timestamp of wordTimestamps) {
      const normalized = normalizeWordTimestamp(timestamp);
      if (!normalized) {
        continue;
      }

      const absoluteStartMs = this.segmentOffsetMs + normalized.startMs;
      const absoluteEndMs = this.segmentOffsetMs + normalized.endMs;
      const dedupeKey = `${normalized.word}|${toDedupeMs(absoluteStartMs)}|${toDedupeMs(absoluteEndMs)}`;
      if (this.dedupeKeys.has(dedupeKey)) {
        continue;
      }

      this.wordCounter += 1;
      this.words.push({
        id: `word-${this.wordCounter}`,
        word: normalized.word,
        startMs: absoluteStartMs,
        endMs: absoluteEndMs,
        segmentIndex: this.segmentIndex,
      });
      this.dedupeKeys.add(dedupeKey);
      added = true;
    }

    if (added && this.words.length > 1) {
      this.words.sort((left, right) => {
        if (left.startMs !== right.startMs) {
          return left.startMs - right.startMs;
        }
        if (left.endMs !== right.endMs) {
          return left.endMs - right.endMs;
        }
        return left.segmentIndex - right.segmentIndex;
      });
    }
  }

  getSpokenTextAt(playbackMs: number): {
    text: string;
    wordCount: number;
    wordIndex?: number;
  } {
    if (this.words.length === 0) {
      return { text: '', wordCount: 0 };
    }

    const clampedPlaybackMs = Number.isFinite(playbackMs) ? Math.max(0, playbackMs) : 0;
    const lastWordIndex = findLastStartedWordIndex(this.words, clampedPlaybackMs);
    if (lastWordIndex < 0) {
      return { text: '', wordCount: 0 };
    }

    const spokenWords = this.words.slice(0, lastWordIndex + 1).map((word) => word.word);
    const text = spokenWords.join(' ');
    const wordCount = spokenWords.length;
    return {
      text,
      wordCount,
      wordIndex: wordCount > 0 ? wordCount - 1 : undefined,
    };
  }

  getWordSpans(): Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    type: 'word';
  }> {
    return this.words.map((word) => ({
      id: word.id,
      text: word.word,
      startMs: word.startMs,
      endMs: word.endMs,
      type: 'word',
    }));
  }

  reset(): void {
    this.words.length = 0;
    this.dedupeKeys.clear();
    this.segmentIndex = -1;
    this.segmentOffsetMs = 0;
    this.wordCounter = 0;
  }
}

function normalizeWordTimestamp(
  value: SpokenWordTimestamp
): { word: string; startMs: number; endMs: number } | null {
  if (!value || typeof value.word !== 'string') {
    return null;
  }

  const word = value.word.trim();
  if (!word) {
    return null;
  }
  if (!Number.isFinite(value.startMs) || !Number.isFinite(value.endMs)) {
    return null;
  }

  const startMs = Math.max(0, value.startMs);
  const endMs = Math.max(startMs, value.endMs);
  return { word, startMs, endMs };
}

function findLastStartedWordIndex(
  words: CumulativeWordTimestamp[],
  playbackMs: number
): number {
  let low = 0;
  let high = words.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = words[middle];
    if (!candidate) {
      break;
    }
    if (candidate.startMs < playbackMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

function toDedupeMs(value: number): number {
  return Math.round(value * 1000);
}
