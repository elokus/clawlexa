import { useMemo } from 'react';
import type { AgentState } from '../types';

interface VoiceIndicatorProps {
  state: AgentState;
  size?: 'sm' | 'md';
}

const stateColors: Record<AgentState, string> = {
  idle: 'bg-muted-foreground/40',
  listening: 'bg-blue-500',
  thinking: 'bg-purple-500',
  speaking: 'bg-green-500',
};

export function VoiceIndicator({ state, size = 'md' }: VoiceIndicatorProps) {
  const barCount = size === 'sm' ? 5 : 7;
  const isActive = state !== 'idle';
  const dimensions = size === 'sm' ? { width: 32, height: 24 } : { width: 48, height: 32 };
  const colorClass = stateColors[state] || stateColors.idle;

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
      className="flex items-center justify-center gap-[2px] relative"
      data-state={state}
      style={{ width: dimensions.width, height: dimensions.height }}
    >
      <style>{`
        [data-state="idle"] .vi-bar {
          animation: vi-idle 2.5s ease-in-out infinite;
          opacity: 0.4;
        }
        @keyframes vi-idle {
          0%, 100% { height: calc(var(--base-h) * 8px); }
          50% { height: calc(var(--base-h) * 12px); }
        }
        [data-state="listening"] .vi-bar {
          animation: vi-listen 1s ease-in-out infinite;
          opacity: 1;
        }
        @keyframes vi-listen {
          0%, 100% { height: calc(var(--base-h) * 10px); }
          50% { height: calc(var(--base-h) * 24px); }
        }
        [data-state="thinking"] .vi-bar {
          animation: vi-think 0.4s ease-in-out infinite alternate;
          opacity: 1;
        }
        @keyframes vi-think {
          0% { height: calc(var(--base-h) * 8px); }
          100% { height: calc(var(--base-h) * 20px); }
        }
        [data-state="speaking"] .vi-bar {
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
          className={`vi-bar w-[3px] rounded-full ${colorClass} transition-colors`}
          style={{
            '--base-h': baseHeight,
            animationDelay: `${delay}s`,
            transformOrigin: 'center',
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
