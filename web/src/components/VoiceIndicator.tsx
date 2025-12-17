// ═══════════════════════════════════════════════════════════════════════════
// Voice Indicator - Compact inline audio visualization for bottom bar
// Minimal footprint, high visual impact
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { AgentState } from '../types';

interface VoiceIndicatorProps {
  state: AgentState;
  size?: 'sm' | 'md';
}

export function VoiceIndicator({ state, size = 'md' }: VoiceIndicatorProps) {
  const barCount = size === 'sm' ? 5 : 7;

  const stateConfig = {
    idle: { color: 'rgba(110, 110, 136, 0.5)', glow: 'transparent' },
    listening: { color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.4)' },
    thinking: { color: '#a78bfa', glow: 'rgba(167, 139, 250, 0.4)' },
    speaking: { color: '#34d399', glow: 'rgba(52, 211, 153, 0.4)' },
  };

  const config = stateConfig[state] || stateConfig.idle;
  const isActive = state !== 'idle';
  const dimensions = size === 'sm' ? { width: 32, height: 24 } : { width: 48, height: 32 };

  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      const centerDistance = Math.abs(i - (barCount - 1) / 2) / ((barCount - 1) / 2);
      const baseHeight = 0.3 + (1 - Math.pow(centerDistance, 1.5)) * 0.7;
      const delay = i * 0.08;
      return { index: i, baseHeight, delay };
    });
  }, [barCount]);

  return (
    <div
      className="voice-indicator"
      data-state={state}
      style={{ width: dimensions.width, height: dimensions.height }}
    >
      <style>{`
        .voice-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          position: relative;
        }

        .voice-indicator::before {
          content: '';
          position: absolute;
          inset: -4px;
          background: radial-gradient(
            ellipse,
            ${config.glow} 0%,
            transparent 70%
          );
          opacity: ${isActive ? 1 : 0};
          transition: opacity 0.3s ease;
          pointer-events: none;
        }

        .vi-bar {
          width: 3px;
          background: ${config.color};
          border-radius: 1.5px;
          transition: background 0.3s ease;
          transform-origin: center;
          will-change: height;
        }

        /* IDLE - minimal pulse */
        .voice-indicator[data-state="idle"] .vi-bar {
          animation: vi-idle 2.5s ease-in-out infinite;
          opacity: 0.4;
        }

        @keyframes vi-idle {
          0%, 100% { height: calc(var(--base-h) * 8px); }
          50% { height: calc(var(--base-h) * 12px); }
        }

        /* LISTENING - smooth wave */
        .voice-indicator[data-state="listening"] .vi-bar {
          animation: vi-listen 1s ease-in-out infinite;
          opacity: 1;
        }

        @keyframes vi-listen {
          0%, 100% { height: calc(var(--base-h) * 10px); }
          50% { height: calc(var(--base-h) * 24px); }
        }

        /* THINKING - rapid pulse */
        .voice-indicator[data-state="thinking"] .vi-bar {
          animation: vi-think 0.4s ease-in-out infinite alternate;
          opacity: 1;
        }

        @keyframes vi-think {
          0% { height: calc(var(--base-h) * 8px); }
          100% { height: calc(var(--base-h) * 20px); }
        }

        /* SPEAKING - dynamic output */
        .voice-indicator[data-state="speaking"] .vi-bar {
          animation: vi-speak 0.5s ease-in-out infinite;
          opacity: 1;
        }

        @keyframes vi-speak {
          0%, 100% { height: calc(var(--base-h) * 12px); }
          25% { height: calc(var(--base-h) * 22px); }
          50% { height: calc(var(--base-h) * 14px); }
          75% { height: calc(var(--base-h) * 26px); }
        }

        @media (prefers-reduced-motion: reduce) {
          .vi-bar {
            animation: none !important;
            height: calc(var(--base-h) * 14px) !important;
          }
        }
      `}</style>

      {bars.map(({ index, baseHeight, delay }) => (
        <div
          key={index}
          className="vi-bar"
          style={{
            '--base-h': baseHeight,
            animationDelay: `${delay}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
