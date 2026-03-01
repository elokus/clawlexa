import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVoiceTimeline, useVoiceState, useFocusedSession } from '../../stores';
import type { TranscriptItem, TimelineItem } from '../../types';

interface GlassHUDProps {
  forceShow?: boolean;
}

export function GlassHUD({ forceShow = false }: GlassHUDProps) {
  const { voiceState: state, voiceProfile: profile } = useVoiceState();
  const timeline = useVoiceTimeline();
  const focusedSession = useFocusedSession();

  const isAgentActive = state === 'speaking' || state === 'thinking';
  const isTerminalStage = focusedSession?.type === 'terminal';
  const shouldShow = isAgentActive && (isTerminalStage || forceShow);

  const latestMessage = useMemo(() => {
    const assistantTranscripts = timeline.filter(
      (item): item is TranscriptItem =>
        item.type === 'transcript' && item.role === 'assistant'
    );
    return assistantTranscripts[assistantTranscripts.length - 1] || null;
  }, [timeline]);

  const generatedText = latestMessage?.generatedContent ?? latestMessage?.content ?? '';
  const spokenText = latestMessage?.spokenContent ?? '';

  const words = useMemo(() => {
    if (!generatedText) return [];
    return generatedText.split(/\s+/).filter(Boolean);
  }, [generatedText]);

  const spokenWordCount = useMemo(() => {
    if (!latestMessage) return 0;
    if (typeof latestMessage.spokenWords === 'number') {
      return Math.max(0, Math.min(latestMessage.spokenWords, words.length));
    }
    if (!spokenText.trim()) return 0;
    return Math.max(0, Math.min(spokenText.trim().split(/\s+/).length, words.length));
  }, [latestMessage, spokenText, words.length]);

  const stateDotColor = state === 'speaking'
    ? 'bg-green-500'
    : 'bg-purple-500';

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-48px)] max-w-[600px] px-5 py-4 bg-card/95 backdrop-blur-xl rounded-2xl shadow-xl z-50"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider">
              {profile || 'Agent'}
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              <span className={`w-1.5 h-1.5 rounded-full ${stateDotColor} animate-pulse`} />
              {state === 'speaking' ? 'Speaking' : 'Thinking'}
            </div>
          </div>

          {/* Transcript */}
          <div className="text-[15px] leading-[1.7] text-muted-foreground">
            {words.length === 0 ? (
              <span className="text-sm text-muted-foreground/50 italic">Preparing response...</span>
            ) : (
              words.map((word, index) => {
                const isSpoken = index < spokenWordCount;
                const isCurrent = index === spokenWordCount;
                return (
                  <span
                    key={`${index}-${word}`}
                    className={`inline transition-colors duration-150 ${
                      isSpoken
                        ? 'text-foreground'
                        : isCurrent
                        ? 'text-blue-500 dark:text-blue-400'
                        : 'text-muted-foreground/40'
                    }`}
                  >
                    {word}{' '}
                  </span>
                );
              })
            )}
          </div>

          {/* State dot */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <span className={`block w-2 h-2 rounded-full animate-pulse ${stateDotColor}`} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
