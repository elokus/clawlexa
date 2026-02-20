// ═══════════════════════════════════════════════════════════════════════════
// Voice Visualizer - Radial audio visualization optimized for mobile orb
// Inspired by: Siri, Hey Google, premium AI assistants
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { AgentState } from '../types';

interface VoiceVisualizerProps {
  state: AgentState;
  className?: string;
}

export function VoiceVisualizer({ state, className = '' }: VoiceVisualizerProps) {
  const barCount = 24; // Fewer bars for cleaner mobile look

  const stateColors = {
    idle: { primary: 'rgba(110, 110, 136, 0.6)', glow: 'transparent', gradient: 'rgba(110, 110, 136, 0.3)' },
    listening: { primary: '#38bdf8', glow: '#38bdf8', gradient: '#0ea5e9' },
    thinking: { primary: '#a78bfa', glow: '#a78bfa', gradient: '#8b5cf6' },
    speaking: { primary: '#34d399', glow: '#34d399', gradient: '#10b981' },
  };

  const colors = stateColors[state] || stateColors.idle;

  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      const position = i / barCount;
      const centerDistance = Math.abs(position - 0.5) * 2;
      // Smoother curve for mobile
      const baseHeight = 0.2 + (1 - Math.pow(centerDistance, 2)) * 0.8;
      const delay = Math.abs(position - 0.5) * 0.8;

      return { index: i, baseHeight, delay };
    });
  }, []);

  return (
    <div className={`viz-container ${className}`} data-state={state}>
      <style>{`
        .viz-container {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          height: 100%;
          width: 100%;
          padding: 0 8px;
          position: relative;
        }

        @media (max-width: 768px) {
          .viz-container {
            gap: 4px;
            padding: 0 4px;
          }
        }

        /* Center glow effect */
        .viz-container::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 60%;
          height: 60%;
          background: radial-gradient(
            ellipse,
            ${colors.glow}20 0%,
            transparent 70%
          );
          pointer-events: none;
          transition: all 0.4s ease;
        }

        .viz-bar {
          width: 4px;
          min-height: 4px;
          background: linear-gradient(
            180deg,
            ${colors.primary} 0%,
            ${colors.gradient} 100%
          );
          border-radius: 2px;
          transition: background 0.4s ease;
          position: relative;
          transform-origin: center;
          will-change: height, transform;
        }

        @media (max-width: 768px) {
          .viz-bar {
            width: 5px;
            border-radius: 2.5px;
          }
        }

        /* Glow effect on active bars */
        .viz-bar::after {
          content: '';
          position: absolute;
          inset: -1px;
          background: ${colors.glow};
          filter: blur(6px);
          opacity: ${state === 'idle' ? '0' : '0.5'};
          border-radius: inherit;
          transition: opacity 0.4s ease;
        }

        /* ══════════════════════════════════════════════════════════
           IDLE - Minimal ambient breathing
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="idle"] .viz-bar {
          animation: idle-pulse 3s ease-in-out infinite;
          opacity: 0.4;
        }

        @keyframes idle-pulse {
          0%, 100% {
            height: calc(var(--base-height) * 16px);
            opacity: 0.3;
          }
          50% {
            height: calc(var(--base-height) * 24px);
            opacity: 0.5;
          }
        }

        /* ══════════════════════════════════════════════════════════
           LISTENING - Smooth wave animation
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="listening"] .viz-bar {
          animation: listening-wave 1.2s ease-in-out infinite;
          opacity: 0.95;
        }

        @keyframes listening-wave {
          0%, 100% {
            height: calc(var(--base-height) * 24px);
            transform: scaleY(1);
          }
          50% {
            height: calc(var(--base-height) * 56px);
            transform: scaleY(1.1);
          }
        }

        /* ══════════════════════════════════════════════════════════
           THINKING - Rapid, erratic pulsing
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="thinking"] .viz-bar {
          animation: thinking-rapid 0.4s ease-in-out infinite alternate;
          opacity: 1;
        }

        @keyframes thinking-rapid {
          0% {
            height: calc(var(--base-height) * 18px);
            transform: scaleY(0.9);
          }
          50% {
            height: calc(var(--base-height) * 48px);
            transform: scaleY(1.05);
          }
          100% {
            height: calc(var(--base-height) * 32px);
            transform: scaleY(1);
          }
        }

        /* ══════════════════════════════════════════════════════════
           SPEAKING - Dynamic audio-like output
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="speaking"] .viz-bar {
          animation: speaking-output 0.5s ease-in-out infinite;
          opacity: 1;
        }

        @keyframes speaking-output {
          0%, 100% {
            height: calc(var(--base-height) * 28px);
          }
          25% {
            height: calc(var(--base-height) * 52px);
          }
          50% {
            height: calc(var(--base-height) * 36px);
          }
          75% {
            height: calc(var(--base-height) * 58px);
          }
        }

        /* ══════════════════════════════════════════════════════════
           Mobile optimizations - reduce motion complexity
           ══════════════════════════════════════════════════════════ */
        @media (max-width: 768px) {
          .viz-container[data-state="listening"] .viz-bar {
            animation-duration: 1.4s;
          }

          .viz-container[data-state="thinking"] .viz-bar {
            animation-duration: 0.5s;
          }

          .viz-container[data-state="speaking"] .viz-bar {
            animation-duration: 0.6s;
          }

          /* Slightly smaller max heights on mobile */
          @keyframes listening-wave {
            0%, 100% {
              height: calc(var(--base-height) * 20px);
              transform: scaleY(1);
            }
            50% {
              height: calc(var(--base-height) * 48px);
              transform: scaleY(1.05);
            }
          }

          @keyframes speaking-output {
            0%, 100% {
              height: calc(var(--base-height) * 24px);
            }
            25% {
              height: calc(var(--base-height) * 44px);
            }
            50% {
              height: calc(var(--base-height) * 30px);
            }
            75% {
              height: calc(var(--base-height) * 48px);
            }
          }
        }

        /* Reduced motion preference */
        @media (prefers-reduced-motion: reduce) {
          .viz-bar {
            animation: none !important;
            height: calc(var(--base-height) * 30px) !important;
            opacity: ${state === 'idle' ? '0.4' : '0.9'} !important;
          }
        }
      `}</style>

      {bars.map(({ index, baseHeight, delay }) => (
        <div
          key={index}
          className="viz-bar"
          style={{
            '--base-height': baseHeight,
            animationDelay: `${delay}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
