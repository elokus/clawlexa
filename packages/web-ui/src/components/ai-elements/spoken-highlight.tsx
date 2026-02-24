import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useVoiceState } from '@/stores';
import { useAudioControllerRef, useSpokenHighlightConfig } from '@/contexts/audio-context';
import { buildWordCueTimelineMs, useSpokenHighlight } from '@/hooks/useSpokenHighlight';
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
}: SpokenTextHighlightProps) {
  const { voiceState } = useVoiceState();
  const audioControllerRef = useAudioControllerRef();
  const spokenHighlight = useSpokenHighlightConfig();

  const words = useMemo(() => {
    if (!generatedText) return [];
    return generatedText.split(/\s+/).filter(Boolean);
  }, [generatedText]);

  // Prefer runtime-provided cues over heuristic cue timeline.
  const wordCueEndMs = useMemo(() => {
    const runtimeCues = wordCuesToCueEndMs(wordCues, words.length);
    if (runtimeCues) return runtimeCues;
    return buildWordCueTimelineMs(
      words,
      spokenHighlight.msPerWord,
      spokenHighlight.punctuationPauseMs
    );
  }, [words, wordCues, spokenHighlight.msPerWord, spokenHighlight.punctuationPauseMs]);

  const highlightedCount = useSpokenHighlight({
    totalWords: words.length,
    isFinalized: spokenFinalized,
    isSpeaking: voiceState === 'speaking',
    audioController: audioControllerRef.current,
    turnKey,
    wordCueEndMs,
    fallbackMsPerWord: spokenHighlight.msPerWord,
  });

  if (words.length === 0) {
    return pending ? <TypingIndicator /> : null;
  }

  return (
    <div className="spoken-highlight-container">
      <span className="spoken-highlight">
        {words.map((word, i) => (
          <span
            key={`${i}-${word}`}
            className={cn(
              'spoken-word',
              i < highlightedCount && 'spoken',
              i === highlightedCount && 'current',
              i > highlightedCount && 'pending',
            )}
          >
            {word}{' '}
          </span>
        ))}
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
