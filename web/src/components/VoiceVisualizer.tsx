// ═══════════════════════════════════════════════════════════════════════════
// Voice Visualizer - Sci-fi audio spectrum with dramatic animations
// Inspired by: Transistor, cyberpunk UIs, audio analyzers
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { AgentState } from '../types';

interface VoiceVisualizerProps {
  state: AgentState;
  className?: string;
}

export function VoiceVisualizer({ state, className = '' }: VoiceVisualizerProps) {
  const barCount = 32;

  const stateColors = {
    idle: { primary: '#6e6e88', glow: 'transparent' },
    listening: { primary: '#38bdf8', glow: '#38bdf8' },
    thinking: { primary: '#a78bfa', glow: '#a78bfa' },
    speaking: { primary: '#34d399', glow: '#34d399' },
  };

  const colors = stateColors[state] || stateColors.idle;

  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      const position = i / barCount;
      const centerDistance = Math.abs(position - 0.5) * 2;
      // Create a curved profile - higher in center, lower at edges
      const baseHeight = 0.15 + (1 - Math.pow(centerDistance, 1.5)) * 0.85;
      const delay = Math.abs(position - 0.5) * 1.2; // Delay from center outward

      return { index: i, baseHeight, delay };
    });
  }, []);

  return (
    <div className={`viz-container ${className}`} data-state={state}>
      <style>{`
        .viz-container {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 3px;
          height: 100%;
          width: 100%;
          padding: 8px 16px;
          position: relative;
        }

        /* Horizontal scan line effect */
        .viz-container::before {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg,
            transparent 0%,
            ${colors.primary}40 20%,
            ${colors.primary}80 50%,
            ${colors.primary}40 80%,
            transparent 100%
          );
          animation: scan-line 3s linear infinite;
          opacity: ${state === 'idle' ? '0' : '0.6'};
          pointer-events: none;
        }

        @keyframes scan-line {
          0% { top: 100%; }
          100% { top: 0%; }
        }

        /* Grid lines behind bars */
        .viz-container::after {
          content: '';
          position: absolute;
          inset: 8px 16px;
          background:
            linear-gradient(0deg, ${colors.primary}08 1px, transparent 1px);
          background-size: 100% 12px;
          pointer-events: none;
        }

        .viz-bar {
          width: 6px;
          min-height: 4px;
          background: linear-gradient(
            180deg,
            ${colors.primary} 0%,
            ${colors.primary}80 50%,
            ${colors.primary}40 100%
          );
          transition: background 0.3s ease;
          position: relative;
          transform-origin: bottom center;
        }

        /* Glow effect on bars */
        .viz-bar::before {
          content: '';
          position: absolute;
          inset: -2px;
          background: ${colors.glow};
          filter: blur(4px);
          opacity: ${state === 'idle' ? '0' : '0.4'};
          transition: opacity 0.3s ease;
        }

        /* Top cap on bars */
        .viz-bar::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: ${colors.primary};
          box-shadow: 0 0 8px ${colors.glow};
        }

        /* ══════════════════════════════════════════════════════════
           IDLE - Minimal ambient pulse
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="idle"] .viz-bar {
          animation: idle-breathe 4s ease-in-out infinite;
          opacity: 0.4;
        }

        @keyframes idle-breathe {
          0%, 100% {
            height: calc(var(--base-height) * 12px);
            opacity: 0.3;
          }
          50% {
            height: calc(var(--base-height) * 20px);
            opacity: 0.5;
          }
        }

        /* ══════════════════════════════════════════════════════════
           LISTENING - Wave from center outward
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="listening"] .viz-bar {
          animation: listening-wave 1.5s ease-in-out infinite;
          opacity: 0.9;
        }

        @keyframes listening-wave {
          0%, 100% {
            height: calc(var(--base-height) * 20px);
          }
          50% {
            height: calc(var(--base-height) * 60px);
          }
        }

        /* ══════════════════════════════════════════════════════════
           THINKING - Rapid erratic movement
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="thinking"] .viz-bar {
          animation: thinking-erratic 0.3s ease-in-out infinite alternate;
          opacity: 1;
        }

        @keyframes thinking-erratic {
          0% {
            height: calc(var(--base-height) * 15px);
          }
          25% {
            height: calc(var(--base-height) * 45px);
          }
          50% {
            height: calc(var(--base-height) * 25px);
          }
          75% {
            height: calc(var(--base-height) * 50px);
          }
          100% {
            height: calc(var(--base-height) * 30px);
          }
        }

        /* ══════════════════════════════════════════════════════════
           SPEAKING - Dynamic peaks like audio output
           ══════════════════════════════════════════════════════════ */
        .viz-container[data-state="speaking"] .viz-bar {
          animation: speaking-dynamic 0.4s ease-in-out infinite;
          opacity: 1;
        }

        @keyframes speaking-dynamic {
          0%, 100% {
            height: calc(var(--base-height) * 25px);
          }
          20% {
            height: calc(var(--base-height) * 55px);
          }
          40% {
            height: calc(var(--base-height) * 35px);
          }
          60% {
            height: calc(var(--base-height) * 60px);
          }
          80% {
            height: calc(var(--base-height) * 40px);
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
