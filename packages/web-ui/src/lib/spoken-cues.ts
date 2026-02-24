import type { SpokenWordCue, SpokenWordCueUpdate } from '@/types';

export function applyWordCueUpdate(
  existingCues: SpokenWordCue[] | undefined,
  update: SpokenWordCueUpdate | undefined
): SpokenWordCue[] | undefined {
  if (!update || !Array.isArray(update.cues)) {
    return existingCues;
  }

  const nextCues = normalizeWordCues(update.cues);
  if (update.mode === 'replace') {
    return nextCues.length > 0 ? nextCues : undefined;
  }

  const merged = existingCues ? [...existingCues] : [];
  const dedupeKeys = new Set(merged.map(cueKey));
  for (const cue of nextCues) {
    const key = cueKey(cue);
    if (dedupeKeys.has(key)) {
      continue;
    }
    merged.push(cue);
    dedupeKeys.add(key);
  }

  return merged.length > 0 ? merged : undefined;
}

export function wordCuesToCueEndMs(
  wordCues: SpokenWordCue[] | undefined,
  totalWords: number
): number[] | undefined {
  if (!Array.isArray(wordCues) || wordCues.length === 0 || totalWords <= 0) {
    return undefined;
  }

  const normalized = normalizeWordCues(wordCues);
  if (normalized.length === 0) {
    return undefined;
  }

  const limit = Math.min(totalWords, normalized.length);
  if (limit <= 0) {
    return undefined;
  }
  return normalized.slice(0, limit).map((cue) => cue.endMs);
}

export function countCuesForPlayback(cueEndMs: number[], playbackMs: number): number {
  if (cueEndMs.length === 0) {
    return 0;
  }
  const timeMs = Math.max(0, playbackMs);
  let low = 0;
  let high = cueEndMs.length - 1;
  let count = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = cueEndMs[middle] ?? 0;
    if (cue <= timeMs) {
      count = middle + 1;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return count;
}

function normalizeWordCues(cues: SpokenWordCue[]): SpokenWordCue[] {
  const normalized: SpokenWordCue[] = [];
  let previousEndMs = 0;

  for (const cue of cues) {
    if (!cue || typeof cue.word !== 'string') {
      continue;
    }
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)) {
      continue;
    }
    const word = cue.word.trim();
    if (!word) {
      continue;
    }
    const startMs = Math.max(previousEndMs, cue.startMs);
    const endMs = Math.max(startMs, cue.endMs);
    normalized.push({
      word,
      startMs,
      endMs,
      source: cue.source === 'provider' ? 'provider' : 'synthetic',
      timeBase: 'utterance',
    });
    previousEndMs = endMs;
  }

  return normalized;
}

function cueKey(cue: SpokenWordCue): string {
  return `${cue.word}|${Math.round(cue.startMs * 1000)}|${Math.round(cue.endMs * 1000)}`;
}
