import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useVoiceState } from '@/stores';
import { useAudioControllerRef } from '@/contexts/audio-context';
import { useSpokenHighlight } from '@/hooks/useSpokenHighlight';
import { wordCuesToCueEndMs } from '@/lib/spoken-cues';
import type { SpokenWordCue } from '@/types';

interface SpokenTextHighlightProps {
  /** Full LLM-generated text — shown in grey immediately */
  generatedText: string;
  /** Whether spoken stream is complete */
  spokenFinalized: boolean;
  /** Whether the message is still streaming */
  pending?: boolean;
  /** Unique message/turn key for reset boundaries */
  turnKey?: string | number | null;
  /** Runtime-supplied canonical cue timeline (preferred over heuristic) */
  wordCues?: SpokenWordCue[];
  /** Server-reported spoken word count for the turn */
  spokenWords?: number;
}

/**
 * Renders words with progressive grey→white highlighting driven by
 * the browser's AudioContext playback clock.
 *
 * - pending words: ghost color (light grey)
 * - current word: cyan with glow
 * - spoken words: bright white
 */
export function SpokenTextHighlight({
  generatedText,
  spokenFinalized,
  pending,
  turnKey = null,
  wordCues,
  spokenWords,
}: SpokenTextHighlightProps) {
  const { voiceState } = useVoiceState();
  const audioControllerRef = useAudioControllerRef();

  const words = useMemo(() => {
    if (!generatedText) return [];
    return generatedText.split(/\s+/).filter(Boolean);
  }, [generatedText]);

  // Use runtime-provided cues (backend always generates synthetic cues when
  // the TTS provider does not supply word timestamps).
  const wordCueEndMs = useMemo(
    () => wordCuesToCueEndMs(wordCues, words.length),
    [words, wordCues]
  );
  const safeSpokenWords = Number.isFinite(spokenWords ?? NaN)
    ? Math.max(0, Math.min(words.length, spokenWords as number))
    : 0;
  const cueWordCount = wordCueEndMs?.length ?? 0;
  const hasCueTimeline = cueWordCount > 0;
  const highlightLimit = hasCueTimeline
    ? cueWordCount
    : safeSpokenWords > 0
      ? safeSpokenWords
      : words.length;

  const highlightedCount = useSpokenHighlight({
    totalWords: words.length,
    isFinalized: spokenFinalized,
    isSpeaking: voiceState === 'speaking',
    audioController: audioControllerRef.current,
    turnKey,
    wordCueEndMs,
    spokenWords: hasCueTimeline ? undefined : safeSpokenWords,
  });

  if (words.length === 0) {
    return pending ? <TypingIndicator /> : null;
  }

  return (
    <div className="spoken-highlight-container">
      <span className="spoken-highlight">
        {words.map((word, i) => {
          const boundaryCompleted =
            spokenFinalized &&
            highlightedCount >= highlightLimit &&
            highlightLimit < words.length;
          const isSpoken = i < highlightedCount || (boundaryCompleted && i >= highlightLimit);
          const isCurrent = i === highlightedCount && i < highlightLimit;
          const isPending = !isSpoken && !isCurrent;
          return (
            <span
              key={`${i}-${word}`}
              className={cn(
                'spoken-word',
                isSpoken && 'spoken',
                isCurrent && 'current',
                isPending && 'pending',
              )}
            >
              {word}{' '}
            </span>
          );
        })}
      </span>
      {pending && <TypingIndicator />}
    </div>
  );
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}
