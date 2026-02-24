import type {
  SpokenWordCue,
  SpokenWordCueSource,
  SpokenWordCueUpdate,
  SpokenWordTimestamp,
} from '../types.js';

/**
 * Default minimum estimated ms per word for synthetic cue distribution during streaming.
 * Prevents a large batch of words (e.g. pre-audio buffer drain) from being crammed
 * into a tiny time window and highlighting all at once.
 * Conservative value — slightly slower than typical speech (~140ms/word).
 * Can be overridden via WordCueTimelineBuilder constructor.
 */
const DEFAULT_MIN_SYNTHETIC_MS_PER_WORD = 150;

interface CueIngestInput {
  spokenText: string;
  playbackMs: number;
  /** Byte-derived ms offset where audible speech starts in the audio stream. */
  speechOnsetMs?: number;
  providerWordTimestamps?: SpokenWordTimestamp[];
  providerTimeBase?: 'segment' | 'utterance';
}

interface CueIngestResult {
  update: SpokenWordCueUpdate | null;
  timeline: SpokenWordCue[];
}

export interface WordCueTimelineConfig {
  minMsPerWord?: number;
  punctuationPauseMs?: number;
  preferProviderTimestamps?: boolean;
}

/**
 * Builds a canonical utterance-relative word cue timeline.
 *
 * Runtime contract:
 * - deltas emit append-only cue updates where possible
 * - finals emit a full replacement timeline
 * - provider timestamps are normalized to utterance-relative once in runtime
 */
export class WordCueTimelineBuilder {
  private cues: SpokenWordCue[] = [];
  private readonly dedupeKeys = new Set<string>();
  private lastSpokenText = '';
  private lastPlaybackMs = 0;
  /** Detected speech onset offset — words should not start before this. */
  private speechOnsetMs = 0;
  /** Minimum ms per word for synthetic cues — prevents batch-cramming. */
  private readonly minMsPerWord: number;
  /** Extra pause after punctuation words in synthetic cues. */
  private readonly punctuationPauseMs: number;
  /** Whether to prefer provider-supplied timestamps over synthetic ones. */
  private readonly preferProviderTimestamps: boolean;

  constructor(config?: WordCueTimelineConfig) {
    const minMsPerWord = config?.minMsPerWord;
    this.minMsPerWord =
      minMsPerWord != null && Number.isFinite(minMsPerWord) && minMsPerWord > 0
        ? minMsPerWord
        : DEFAULT_MIN_SYNTHETIC_MS_PER_WORD;
    this.punctuationPauseMs =
      config?.punctuationPauseMs != null &&
      Number.isFinite(config.punctuationPauseMs) &&
      config.punctuationPauseMs > 0
        ? config.punctuationPauseMs
        : 0;
    this.preferProviderTimestamps = config?.preferProviderTimestamps ?? true;
  }

  reset(): void {
    this.cues = [];
    this.dedupeKeys.clear();
    this.lastSpokenText = '';
    this.lastPlaybackMs = 0;
    this.speechOnsetMs = 0;
  }

  getTimeline(): SpokenWordCue[] {
    return this.cues.map((cue) => ({ ...cue }));
  }

  ingestDelta(input: CueIngestInput): CueIngestResult {
    const spokenText = normalizeText(input.spokenText);
    const playbackMs = normalizeMs(input.playbackMs, this.lastPlaybackMs);
    const providerTimeBase = input.providerTimeBase ?? 'segment';

    // Latch speech onset: once detected, never regress.
    if (
      input.speechOnsetMs != null &&
      Number.isFinite(input.speechOnsetMs) &&
      input.speechOnsetMs > this.speechOnsetMs
    ) {
      this.speechOnsetMs = input.speechOnsetMs;
    }

    let update: SpokenWordCueUpdate | null = null;
    const hasProviderTimestamps =
      this.preferProviderTimestamps &&
      input.providerWordTimestamps != null &&
      input.providerWordTimestamps.length > 0;
    if (hasProviderTimestamps) {
      const appended = this.appendProviderWordTimestamps(
        input.providerWordTimestamps!,
        providerTimeBase,
        this.lastPlaybackMs
      );
      if (appended.length > 0) {
        update = { mode: 'append', cues: appended };
      }
    } else {
      update = this.appendSyntheticCues(spokenText, playbackMs);
    }

    this.lastSpokenText = spokenText;
    this.lastPlaybackMs = playbackMs;
    return {
      update,
      timeline: this.getTimeline(),
    };
  }

  ingestFinal(input: CueIngestInput): CueIngestResult {
    const spokenText = normalizeText(input.spokenText);
    const playbackMs = normalizeMs(input.playbackMs, this.lastPlaybackMs);
    const providerTimeBase = input.providerTimeBase ?? 'utterance';

    let cues: SpokenWordCue[];
    const hasProviderTimestamps =
      this.preferProviderTimestamps &&
      input.providerWordTimestamps != null &&
      input.providerWordTimestamps.length > 0;
    if (hasProviderTimestamps) {
      cues = this.buildProviderTimeline(input.providerWordTimestamps!, providerTimeBase, 0);
    } else {
      cues = this.buildSyntheticTimeline(spokenText, playbackMs);
    }

    this.replaceTimeline(cues);
    this.lastSpokenText = spokenText;
    this.lastPlaybackMs = playbackMs;

    return {
      update: { mode: 'replace', cues: this.getTimeline() },
      timeline: this.getTimeline(),
    };
  }

  private appendProviderWordTimestamps(
    timestamps: SpokenWordTimestamp[],
    timeBase: 'segment' | 'utterance',
    offsetMs: number
  ): SpokenWordCue[] {
    const appended: SpokenWordCue[] = [];
    const normalizedOffsetMs = normalizeMs(offsetMs, 0);
    let lastEndMs = this.cues[this.cues.length - 1]?.endMs ?? 0;

    for (const value of timestamps) {
      const normalized = normalizeTimestamp(value);
      if (!normalized) {
        continue;
      }

      const startMsRaw =
        timeBase === 'utterance'
          ? normalized.startMs
          : normalizedOffsetMs + normalized.startMs;
      const endMsRaw =
        timeBase === 'utterance'
          ? normalized.endMs
          : normalizedOffsetMs + normalized.endMs;
      const startMs = Math.max(lastEndMs, startMsRaw);
      const endMs = Math.max(startMs, endMsRaw);
      const key = cueKey(normalized.word, startMs, endMs);
      if (this.dedupeKeys.has(key)) {
        continue;
      }

      const cue: SpokenWordCue = {
        word: normalized.word,
        startMs,
        endMs,
        source: 'provider',
        timeBase: 'utterance',
      };
      this.cues.push(cue);
      this.dedupeKeys.add(key);
      appended.push({ ...cue });
      lastEndMs = endMs;
    }

    return appended;
  }

  private appendSyntheticCues(spokenText: string, playbackMs: number): SpokenWordCueUpdate | null {
    const words = tokenizeWords(spokenText);
    if (words.length === 0) {
      return null;
    }

    // If the spoken text regresses/corrects mid-turn, replace with a rebuilt timeline.
    if (this.lastSpokenText && !spokenText.startsWith(this.lastSpokenText)) {
      const rebuilt = this.buildSyntheticTimeline(spokenText, playbackMs);
      this.replaceTimeline(rebuilt);
      return { mode: 'replace', cues: this.getTimeline() };
    }

    const existingCount = this.cues.length;
    if (words.length <= existingCount) {
      return null;
    }

    const newWords = words.slice(existingCount);
    // Use speechOnsetMs as the floor so words don't start during TTS silence.
    const windowStartMs = Math.max(
      this.speechOnsetMs,
      this.lastPlaybackMs,
      this.cues[this.cues.length - 1]?.endMs ?? 0
    );
    // Guarantee a minimum per-word pace so a large batch (e.g. pre-audio
    // buffer drain) isn't crammed into a tiny window and highlighted instantly.
    // As more audio arrives, subsequent appends extend naturally.  The
    // spokenFinal rebuild uses actual total duration for final accuracy.
    const estimatedMinEndMs = windowStartMs + newWords.length * this.minMsPerWord;
    const windowEndMs = Math.max(windowStartMs, playbackMs, estimatedMinEndMs);
    const appended = distributeWordsIntoWindow(
      newWords, windowStartMs, windowEndMs, 'synthetic', this.punctuationPauseMs
    );
    for (const cue of appended) {
      const key = cueKey(cue.word, cue.startMs, cue.endMs);
      if (this.dedupeKeys.has(key)) {
        continue;
      }
      this.cues.push(cue);
      this.dedupeKeys.add(key);
    }

    const delta = this.cues.slice(existingCount).map((cue) => ({ ...cue }));
    if (delta.length === 0) {
      return null;
    }
    return { mode: 'append', cues: delta };
  }

  private buildProviderTimeline(
    timestamps: SpokenWordTimestamp[],
    timeBase: 'segment' | 'utterance',
    offsetMs: number
  ): SpokenWordCue[] {
    const cues: SpokenWordCue[] = [];
    const normalizedOffsetMs = normalizeMs(offsetMs, 0);
    let lastEndMs = 0;

    for (const value of timestamps) {
      const normalized = normalizeTimestamp(value);
      if (!normalized) {
        continue;
      }
      const startMsRaw =
        timeBase === 'utterance'
          ? normalized.startMs
          : normalizedOffsetMs + normalized.startMs;
      const endMsRaw =
        timeBase === 'utterance'
          ? normalized.endMs
          : normalizedOffsetMs + normalized.endMs;
      const startMs = Math.max(lastEndMs, startMsRaw);
      const endMs = Math.max(startMs, endMsRaw);
      cues.push({
        word: normalized.word,
        startMs,
        endMs,
        source: 'provider',
        timeBase: 'utterance',
      });
      lastEndMs = endMs;
    }

    return cues;
  }

  private buildSyntheticTimeline(spokenText: string, playbackMs: number): SpokenWordCue[] {
    const words = tokenizeWords(spokenText);
    if (words.length === 0) {
      return [];
    }
    const onset = this.speechOnsetMs;
    return distributeWordsIntoWindow(
      words, onset, Math.max(onset, playbackMs), 'synthetic', this.punctuationPauseMs
    );
  }

  private replaceTimeline(cues: SpokenWordCue[]): void {
    this.cues = cues.map((cue) => ({ ...cue }));
    this.dedupeKeys.clear();
    for (const cue of this.cues) {
      this.dedupeKeys.add(cueKey(cue.word, cue.startMs, cue.endMs));
    }
  }
}

export function cuesToWordTimestamps(cues: SpokenWordCue[]): SpokenWordTimestamp[] {
  return cues.map((cue) => ({
    word: cue.word,
    startMs: cue.startMs,
    endMs: cue.endMs,
  }));
}

/**
 * Resolve how many words are fully heard at a playback position.
 * Uses cue end boundaries (not start) so partially spoken words are excluded.
 */
export function resolveWordCountAtPlaybackMs(
  cues: SpokenWordCue[],
  playbackMs: number
): number {
  if (!Array.isArray(cues) || cues.length === 0) {
    return 0;
  }

  const timeMs = Number.isFinite(playbackMs) ? Math.max(0, playbackMs) : 0;
  let low = 0;
  let high = cues.length - 1;
  let count = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = cues[middle];
    const cueEndMs = cue ? Math.max(0, cue.endMs) : 0;
    if (cueEndMs <= timeMs) {
      count = middle + 1;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return count;
}

function distributeWordsIntoWindow(
  words: string[],
  startMsInput: number,
  endMsInput: number,
  source: SpokenWordCueSource,
  punctuationPauseMs: number = 0
): SpokenWordCue[] {
  if (words.length === 0) {
    return [];
  }

  const startMs = normalizeMs(startMsInput, 0);
  const endMs = Math.max(startMs, normalizeMs(endMsInput, startMs));
  const spanMs = Math.max(words.length, endMs - startMs);

  // Count punctuation words for weighted distribution.
  const punctCount =
    punctuationPauseMs > 0
      ? words.filter((w) => hasPausePunctuation(w)).length
      : 0;

  // Solve: words.length * baseDuration + punctCount * punctuationPauseMs = spanMs
  const totalPause = punctCount * punctuationPauseMs;
  const baseDuration = Math.max(1, (spanMs - totalPause) / words.length);

  const cues: SpokenWordCue[] = [];
  let cursorMs = startMs;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    const isPunct = punctuationPauseMs > 0 && hasPausePunctuation(word);
    const wordDuration = baseDuration + (isPunct ? punctuationPauseMs : 0);
    const projectedEnd = cursorMs + wordDuration;
    const nextBoundary =
      index === words.length - 1
        ? Math.max(endMs, projectedEnd)
        : projectedEnd;
    const cueStartMs = Math.max(cursorMs, startMs);
    const cueEndMs = Math.max(cueStartMs, nextBoundary);
    cues.push({
      word,
      startMs: cueStartMs,
      endMs: cueEndMs,
      source,
      timeBase: 'utterance',
    });
    cursorMs = cueEndMs;
  }

  return cues;
}

function hasPausePunctuation(word: string): boolean {
  if (!word) return false;
  const trimmed = word.trim().replace(/[)"'\]}>»\u201D\u2019]+$/u, '');
  return /[.,!?;:\u2026]$/u.test(trimmed);
}

function tokenizeWords(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\s+/).map((token) => token.trim()).filter(Boolean);
}

function normalizeTimestamp(
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

function normalizeText(value: string): string {
  return typeof value === 'string' ? value : '';
}

function normalizeMs(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return Math.max(0, fallback);
  }
  return Math.max(0, value);
}

function cueKey(word: string, startMs: number, endMs: number): string {
  return `${word}|${Math.round(startMs * 1000)}|${Math.round(endMs * 1000)}`;
}
