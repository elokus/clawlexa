import { useMemo } from 'react';
import type { AgentState } from '../types';

interface VoiceOrbProps {
  state: AgentState;
}

const stateColors: Record<AgentState, string> = {
  idle: 'var(--muted-foreground)',
  listening: 'var(--color-blue)',
  thinking: 'var(--color-purple)',
  speaking: 'var(--color-green)',
};

export function VoiceOrb({ state }: VoiceOrbProps) {
  const color = stateColors[state];
  const isActive = state !== 'idle';

  const bars = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => {
      const angle = (i / 24) * 360;
      const centerDistance = Math.abs(Math.sin((angle * Math.PI) / 180));
      const baseHeight = 0.4 + centerDistance * 0.6;
      const delay = i * 0.04;
      return { index: i, angle, baseHeight, delay };
    });
  }, []);

  return (
    <div className="voice-orb" data-state={state}>
      <div className="voice-orb-ring-outer" />
      <div className="voice-orb-ring" />

      {/* Central waveform bars in a circle */}
      <div className="relative w-[80px] h-[80px]">
        {bars.map(({ index, angle, baseHeight, delay }) => (
          <div
            key={index}
            className="voice-orb-bar"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: '2px',
              height: isActive ? `${baseHeight * 28}px` : `${baseHeight * 12}px`,
              background: color,
              borderRadius: '1px',
              transform: `rotate(${angle}deg) translateY(-24px)`,
              transformOrigin: '50% 50%',
              opacity: isActive ? 0.7 : 0.15,
              transition: 'height 0.4s ease, opacity 0.4s ease',
              animation: isActive
                ? `orb-bar-${state} ${state === 'speaking' ? '0.5s' : state === 'thinking' ? '0.6s' : '1.2s'} ease-in-out infinite`
                : 'orb-bar-idle 3s ease-in-out infinite',
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes orb-bar-idle {
          0%, 100% { height: calc(var(--h, 12px)); opacity: 0.12; }
          50% { height: calc(var(--h, 12px) * 1.3); opacity: 0.18; }
        }
        @keyframes orb-bar-listening {
          0%, 100% { opacity: 0.4; transform: var(--t) translateY(-24px) scaleY(1); }
          50% { opacity: 0.8; transform: var(--t) translateY(-24px) scaleY(1.6); }
        }
        @keyframes orb-bar-thinking {
          0% { opacity: 0.3; }
          50% { opacity: 0.7; }
          100% { opacity: 0.3; }
        }
        @keyframes orb-bar-speaking {
          0%, 100% { transform: var(--t) translateY(-24px) scaleY(1); opacity: 0.5; }
          25% { transform: var(--t) translateY(-24px) scaleY(1.4); opacity: 0.8; }
          50% { transform: var(--t) translateY(-24px) scaleY(0.8); opacity: 0.6; }
          75% { transform: var(--t) translateY(-24px) scaleY(1.5); opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}
