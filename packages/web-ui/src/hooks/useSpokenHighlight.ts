import { useState, useEffect, useRef } from 'react';
import type { AudioController } from '../lib/audio';
import { countCuesForPlayback } from '../lib/spoken-cues';

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
  /**
   * Server-reported spoken word count for this turn.
   * Used only when cue timelines are unavailable.
   */
  spokenWords?: number;
  /** Fallback pace in ms/word when no cue timeline is provided */
  fallbackMsPerWord?: number;
}

const DEFAULT_MS_PER_WORD = 340;
const CUE_BOUNDARY_TOLERANCE_MS = 32;

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
  spokenWords,
  fallbackMsPerWord = DEFAULT_MS_PER_WORD,
}: UseSpokenHighlightOptions): number {
  const [highlightedCount, setHighlightedCount] = useState(0);
  const highlightedRef = useRef(0);
  const rafRef = useRef<number>(0);
  const previousTurnKeyRef = useRef<string | number | null>(turnKey);

  // Cumulative playback offset — bridges AudioController position resets
  // between TTS segments.  AudioController resets playbackPositionMs to 0
  // when all scheduled audio drains, but word cues use utterance-relative
  // timestamps that accumulate across segments.  This offset keeps the
  // two aligned so highlighting progresses continuously.
  const playbackOffsetRef = useRef(0);
  const prevRawPlaybackRef = useRef(0);
  const prevRawScheduledRef = useRef(0);

  useEffect(() => {
    if (turnKey !== previousTurnKeyRef.current) {
      previousTurnKeyRef.current = turnKey;
      highlightedRef.current = 0;
      playbackOffsetRef.current = 0;
      prevRawPlaybackRef.current = 0;
      prevRawScheduledRef.current = 0;
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
      Array.isArray(wordCueEndMs) && wordCueEndMs.length > 0 ? wordCueEndMs : undefined;
    const cueWordCount = cueTimeline?.length ?? 0;
    const hasCueTimeline = cueWordCount > 0;
    const clampedSpokenWords = clamp(
      Number.isFinite(spokenWords) ? (spokenWords as number) : 0,
      0,
      totalWords
    );
    const completionWordCount = hasCueTimeline
      ? clamp(cueWordCount, 0, totalWords)
      : clampedSpokenWords > 0
        ? clampedSpokenWords
        : totalWords;
    const msPerWord = normalizePositive(fallbackMsPerWord, DEFAULT_MS_PER_WORD);

    const tick = () => {
      const rawPlaybackMs = audioController.getPlaybackPositionMs();
      const rawScheduledMs = audioController.getScheduledDurationMs();
      const hasPendingAudio = rawScheduledMs > 0;

      // Detect AudioController position reset: the raw position dropped while
      // there was previously scheduled audio.  This happens between TTS
      // segments when all scheduled audio finishes before the next segment
      // arrives.  Accumulate the previous segment's total duration so that
      // the cumulative position keeps advancing.
      if (
        rawPlaybackMs < prevRawPlaybackRef.current &&
        prevRawScheduledRef.current > 0
      ) {
        playbackOffsetRef.current += prevRawScheduledRef.current;
      }
      prevRawPlaybackRef.current = rawPlaybackMs;
      prevRawScheduledRef.current = rawScheduledMs;

      const playbackMs = playbackOffsetRef.current + rawPlaybackMs;

      let nextWordCount = cueTimeline
        ? countCuesForPlayback(cueTimeline, playbackMs)
        : Math.floor(playbackMs / msPerWord);

      // When runtime cues are present, they are authoritative for progression.
      // Server spokenWords can be a completion boundary, not a per-frame cursor.
      if (!hasCueTimeline) {
        nextWordCount = Math.max(nextWordCount, clampedSpokenWords);
      }

      if (cueTimeline && cueTimeline.length > 0) {
        const finalCueEndMs = cueTimeline[cueTimeline.length - 1] ?? 0;
        if (playbackMs + CUE_BOUNDARY_TOLERANCE_MS >= finalCueEndMs) {
          nextWordCount = Math.max(nextWordCount, completionWordCount);
        }
      }

      if (isFinalized && !hasPendingAudio) {
        // Audio fully drained — force-complete regardless of cue mode.
        // When runtime cues are available, they define the true spoken boundary.
        // This avoids jumping to the full generated-text length when spoken-final
        // is shorter (for example after interruption).
        nextWordCount = completionWordCount;
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
  }, [totalWords, isFinalized, isSpeaking, audioController, turnKey, wordCueEndMs, spokenWords, fallbackMsPerWord]);

  return highlightedCount;
}

function normalizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
