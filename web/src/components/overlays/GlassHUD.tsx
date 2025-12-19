// ═══════════════════════════════════════════════════════════════════════════
// Glass HUD - Teleprompter-style overlay for spoken transcript
// Shows current sentence with word-by-word highlighting
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '../../stores/agent';
import { useStageStore } from '../../stores/stage';
import { VoiceIndicator } from '../VoiceIndicator';

interface GlassHUDProps {
  /** Show even when not on terminal stage */
  forceShow?: boolean;
}

export function GlassHUD({ forceShow = false }: GlassHUDProps) {
  const state = useAgentStore((s) => s.state);
  const profile = useAgentStore((s) => s.profile);
  const messages = useAgentStore((s) => s.messages);
  const activeStage = useStageStore((s) => s.activeStage);

  // Only show HUD when:
  // 1. Agent is speaking or thinking
  // 2. We're on a terminal stage (or forceShow is true)
  const isAgentActive = state === 'speaking' || state === 'thinking';
  const isTerminalStage = activeStage.type === 'terminal';
  const shouldShow = isAgentActive && (isTerminalStage || forceShow);

  // Get the latest assistant message (what's being spoken)
  const latestMessage = useMemo(() => {
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    return assistantMessages[assistantMessages.length - 1];
  }, [messages]);

  // Split content into words for highlighting effect
  const words = useMemo(() => {
    if (!latestMessage?.content) return [];
    return latestMessage.content.split(/\s+/).filter(Boolean);
  }, [latestMessage?.content]);

  // Estimate how many words have been spoken based on time
  // Assuming ~150 words per minute speaking rate
  const spokenWordCount = useMemo(() => {
    if (!latestMessage || state !== 'speaking') return 0;
    const messageAge = Date.now() - latestMessage.timestamp;
    const wordsPerMs = 150 / 60000; // 150 WPM
    return Math.min(Math.floor(messageAge * wordsPerMs), words.length);
  }, [latestMessage, state, words.length]);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          className="glass-hud"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        >
          <style>{`
            .glass-hud {
              position: absolute;
              bottom: 24px;
              left: 50%;
              transform: translateX(-50%);
              width: calc(100% - 48px);
              max-width: 600px;
              padding: 16px 20px;
              background: rgba(5, 5, 10, 0.85);
              backdrop-filter: blur(24px);
              border: 1px solid rgba(56, 189, 248, 0.15);
              border-radius: 16px;
              box-shadow:
                0 8px 32px rgba(0, 0, 0, 0.4),
                0 0 0 1px rgba(56, 189, 248, 0.05),
                inset 0 1px 0 rgba(255, 255, 255, 0.03);
              z-index: 50;
            }

            .hud-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 12px;
            }

            .hud-profile {
              display: flex;
              align-items: center;
              gap: 8px;
            }

            .hud-profile-name {
              font-family: var(--font-display);
              font-size: 10px;
              letter-spacing: 0.15em;
              color: var(--color-cyan);
              text-transform: uppercase;
            }

            .hud-state {
              display: flex;
              align-items: center;
              gap: 6px;
              font-family: var(--font-mono);
              font-size: 9px;
              color: var(--color-text-ghost);
              text-transform: uppercase;
              letter-spacing: 0.1em;
            }

            .hud-state-dot {
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: var(--color-emerald);
              animation: hud-pulse 1.5s ease-in-out infinite;
            }

            .hud-state-dot.speaking {
              background: var(--color-cyan);
            }

            .hud-state-dot.thinking {
              background: var(--color-amber);
            }

            @keyframes hud-pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }

            .hud-transcript {
              font-family: var(--font-ui);
              font-size: 15px;
              line-height: 1.7;
              color: var(--color-text-dim);
            }

            .hud-word {
              display: inline;
              transition: color 0.15s ease;
            }

            .hud-word.spoken {
              color: var(--color-text-bright);
            }

            .hud-word.current {
              color: var(--color-cyan);
              text-shadow: 0 0 8px rgba(56, 189, 248, 0.4);
            }

            .hud-word.pending {
              color: var(--color-text-ghost);
            }

            .hud-empty {
              font-family: var(--font-mono);
              font-size: 12px;
              color: var(--color-text-ghost);
              font-style: italic;
            }

            .hud-indicator {
              position: absolute;
              right: 16px;
              top: 50%;
              transform: translateY(-50%);
            }
          `}</style>

          <div className="hud-header">
            <div className="hud-profile">
              <span className="hud-profile-name">{profile || 'Agent'}</span>
            </div>
            <div className="hud-state">
              <span className={`hud-state-dot ${state}`} />
              {state === 'speaking' ? 'Speaking' : 'Thinking'}
            </div>
          </div>

          <div className="hud-transcript">
            {words.length === 0 ? (
              <span className="hud-empty">Preparing response...</span>
            ) : (
              words.map((word, index) => {
                let className = 'hud-word';
                if (index < spokenWordCount) {
                  className += ' spoken';
                } else if (index === spokenWordCount) {
                  className += ' current';
                } else {
                  className += ' pending';
                }

                return (
                  <span key={`${index}-${word}`} className={className}>
                    {word}{' '}
                  </span>
                );
              })
            )}
          </div>

          <div className="hud-indicator">
            <VoiceIndicator state={state} size="sm" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
