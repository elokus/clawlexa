import { useState, useEffect, useRef } from 'react';
import type { AudioController } from '../lib/audio';

interface UseSpokenHighlightOptions {
  /** Total number of words in the generated text */
  totalWords: number;
  /** Whether the spoken stream is finalized (all audio emitted) */
  isFinalized: boolean;
  /** Whether the agent is currently speaking */
  isSpeaking: boolean;
  /** AudioController instance for querying real playback position */
  audioController: AudioController | null;
  /** Unique key for the currently highlighted turn/message */
  turnKey?: string | number | null;
  /** Optional cumulative word cue endpoints in milliseconds */
  wordCueEndMs?: number[];
  /** Fallback pace in ms/word when no cue timeline is provided */
  fallbackMsPerWord?: number;
}

const DEFAULT_MS_PER_WORD = 340;

/**
 * Drives word-by-word highlighting from the client's AudioContext clock.
 * The cursor is monotonic inside each turn and resets only on turnKey change.
 */
export function useSpokenHighlight({
  totalWords,
  isFinalized,
  isSpeaking,
  audioController,
  turnKey = null,
  wordCueEndMs,
  fallbackMsPerWord = DEFAULT_MS_PER_WORD,
}: UseSpokenHighlightOptions): number {
  const [highlightedCount, setHighlightedCount] = useState(0);
  const highlightedRef = useRef(0);
  const rafRef = useRef<number>(0);
  const previousTurnKeyRef = useRef<string | number | null>(turnKey);

  useEffect(() => {
    if (turnKey !== previousTurnKeyRef.current) {
      previousTurnKeyRef.current = turnKey;
      highlightedRef.current = 0;
      setHighlightedCount(0);
    }
  }, [turnKey]);

  useEffect(() => {
    if (!audioController || totalWords <= 0) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (totalWords === 0 && highlightedRef.current !== 0) {
        highlightedRef.current = 0;
        setHighlightedCount(0);
      }
      return;
    }

    if (highlightedRef.current > totalWords) {
      highlightedRef.current = totalWords;
      setHighlightedCount(totalWords);
    }

    const cueTimeline =
      Array.isArray(wordCueEndMs) && wordCueEndMs.length === totalWords
        ? wordCueEndMs
        : undefined;
    const msPerWord = normalizePositive(fallbackMsPerWord, DEFAULT_MS_PER_WORD);

    const tick = () => {
      const playbackMs = audioController.getPlaybackPositionMs();
      const scheduledMs = audioController.getScheduledDurationMs();
      const hasPendingAudio = scheduledMs > 0;

      let nextWordCount = cueTimeline
        ? countWordsForPlayback(cueTimeline, playbackMs)
        : Math.floor(playbackMs / msPerWord);

      if (isFinalized && !hasPendingAudio) {
        nextWordCount = totalWords;
      }

      nextWordCount = clamp(nextWordCount, 0, totalWords);
      if (nextWordCount < highlightedRef.current) {
        nextWordCount = highlightedRef.current;
      }

      if (nextWordCount !== highlightedRef.current) {
        highlightedRef.current = nextWordCount;
        setHighlightedCount(nextWordCount);
      }

      if (isSpeaking || hasPendingAudio) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = 0;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [totalWords, isFinalized, isSpeaking, audioController, turnKey, wordCueEndMs, fallbackMsPerWord]);

  return highlightedCount;
}

/**
 * Build a cumulative word timeline with optional punctuation pause bonus.
 */
export function buildWordCueTimelineMs(
  words: string[],
  msPerWord: number,
  punctuationPauseMs: number
): number[] {
  if (!Array.isArray(words) || words.length === 0) return [];

  const baseMs = normalizePositive(msPerWord, DEFAULT_MS_PER_WORD);
  const pauseMs = Math.max(0, Number.isFinite(punctuationPauseMs) ? punctuationPauseMs : 0);
  const cueEndMs: number[] = [];
  let elapsedMs = 0;

  for (const word of words) {
    elapsedMs += baseMs;
    if (hasPausePunctuation(word)) {
      elapsedMs += pauseMs;
    }
    cueEndMs.push(elapsedMs);
  }

  return cueEndMs;
}

function countWordsForPlayback(cueEndMs: number[], playbackMs: number): number {
  if (cueEndMs.length === 0) return 0;
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

function hasPausePunctuation(word: string): boolean {
  if (!word) return false;
  const trimmed = word.trim().replace(/[)"'\]}>»”’]+$/u, '');
  return /[.,!?;:\u2026]$/u.test(trimmed);
}

function normalizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
