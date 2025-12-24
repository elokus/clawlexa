// ═══════════════════════════════════════════════════════════════════════════
// Chat Stage - Transparent floating container with HUD strip header
// Content floats over the global background - no container walls
// ═══════════════════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import { ConversationStream } from '../ConversationStream';
import { useVoiceTimeline, useVoiceState } from '../../stores';
import type { StageItem } from '../../types';

interface ChatStageProps {
  stage: StageItem;
}

export function ChatStage({ stage }: ChatStageProps) {
  const timeline = useAgentStore((s) => s.timeline);
  const state = useAgentStore((s) => s.state);

  const stateLabels: Record<string, { label: string; color: string; pulse: boolean }> = {
    idle: { label: 'STANDBY', color: 'var(--color-text-ghost)', pulse: false },
    listening: { label: 'LISTENING', color: 'var(--color-cyan)', pulse: true },
    thinking: { label: 'PROCESSING', color: 'var(--color-violet)', pulse: true },
    speaking: { label: 'SPEAKING', color: 'var(--color-emerald)', pulse: true },
  };

  const stateConfig = stateLabels[state] || stateLabels.idle;

  return (
    <motion.div
      className="chat-stage"
      layoutId={`stage-${stage.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{
        duration: 0.35,
        ease: [0.4, 0, 0.2, 1],
      }}
    >
      <style>{`
        .chat-stage {
          display: flex;
          flex-direction: column;
          height: 100%;
          /* Transparent - content floats on void */
          background: transparent;
          border: none;
          overflow: hidden;
          position: relative;
        }

        /* ═══════════════════════════════════════════════════════════════════
           HUD STRIP HEADER - Technical readout bar
           ═══════════════════════════════════════════════════════════════════ */

        .hud-strip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 0;
          margin-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          position: relative;
        }

        /* Decorative line accents */
        .hud-strip::before {
          content: '';
          position: absolute;
          left: 0;
          bottom: -1px;
          width: 60px;
          height: 1px;
          background: linear-gradient(90deg, var(--color-cyan), transparent);
          opacity: 0.5;
        }

        .hud-strip::after {
          content: '';
          position: absolute;
          right: 0;
          bottom: -1px;
          width: 60px;
          height: 1px;
          background: linear-gradient(270deg, ${stateConfig.color}, transparent);
          opacity: 0.5;
        }

        .hud-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .hud-title {
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.2em;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .hud-divider {
          width: 1px;
          height: 12px;
          background: var(--color-glass-border);
        }

        .hud-subtitle {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          letter-spacing: 0.05em;
        }

        .hud-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .hud-status {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-display);
          font-size: 9px;
          letter-spacing: 0.15em;
          color: ${stateConfig.color};
          text-transform: uppercase;
        }

        .hud-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${stateConfig.color};
        }

        .hud-status-dot.pulse {
          animation: hud-pulse 1.5s ease-in-out infinite;
          box-shadow: 0 0 8px ${stateConfig.color};
        }

        @keyframes hud-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .hud-timestamp {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
          letter-spacing: 0.05em;
        }

        /* ═══════════════════════════════════════════════════════════════════
           CONTENT AREA - Floating over void
           ═══════════════════════════════════════════════════════════════════ */

        .chat-content {
          flex: 1;
          overflow: hidden;
          position: relative;
        }

        @media (max-width: 768px) {
          .hud-strip {
            padding: 10px 0;
          }

          .hud-subtitle,
          .hud-divider {
            display: none;
          }

          .hud-title {
            font-size: 9px;
          }
        }
      `}</style>

      {/* HUD Strip Header */}
      <div className="hud-strip">
        <div className="hud-left">
          <span className="hud-title">{stage.title}</span>
          <span className="hud-divider" />
          <span className="hud-subtitle">Voice Interface</span>
        </div>
        <div className="hud-right">
          <div className="hud-status">
            <span className={`hud-status-dot ${stateConfig.pulse ? 'pulse' : ''}`} />
            {stateConfig.label}
          </div>
        </div>
      </div>

      {/* Floating Content */}
      <div className="chat-content">
        <ConversationStream timeline={timeline} />
      </div>
    </motion.div>
  );
}
