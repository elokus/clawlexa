import { useMemo } from 'react';
import { useVoiceState, useUnifiedSessionsStore } from '../../stores';
import type { AgentState } from '../../types';

const stateLabels: Record<string, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Processing',
  speaking: 'Speaking',
};

const stateColors: Record<AgentState, string> = {
  idle: 'var(--muted-foreground)',
  listening: 'var(--color-blue)',
  thinking: 'var(--color-purple)',
  speaking: 'var(--color-green)',
};

/**
 * Generate a smooth closed blob path from control points.
 * Uses cubic bezier curves for organic feel.
 */
function blobPath(points: Array<{ x: number; y: number }>, tension = 0.3): string {
  const n = points.length;
  if (n < 3) return '';

  const parts: string[] = [`M ${points[0]!.x} ${points[0]!.y}`];

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    parts.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }

  parts.push('Z');
  return parts.join(' ');
}

function VoiceBlob({ state }: { state: AgentState }) {
  const color = stateColors[state];
  const isActive = state !== 'idle';
  const isSpeaking = state === 'speaking';
  const isListening = state === 'listening';
  const isThinking = state === 'thinking';

  // Base blob radius and number of control points
  const cx = 75;
  const cy = 75;
  const baseR = 40;
  const pointCount = 8;

  // Generate multiple blob paths for animation layers
  const blobs = useMemo(() => {
    const configs = [
      { offset: 0, rVariance: 6, name: 'a' },
      { offset: Math.PI / pointCount, rVariance: 8, name: 'b' },
    ];

    return configs.map(({ offset, rVariance, name }) => {
      const points = Array.from({ length: pointCount }, (_, i) => {
        const angle = (i / pointCount) * Math.PI * 2 + offset;
        const r = baseR + (i % 2 === 0 ? rVariance : -rVariance * 0.5);
        return {
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
        };
      });
      return { name, d: blobPath(points) };
    });
  }, []);

  // Animation speed and scale per state
  const animDuration = isSpeaking ? '1.2s' : isListening ? '2.5s' : isThinking ? '1.8s' : '6s';
  const animDuration2 = isSpeaking ? '0.9s' : isListening ? '2s' : isThinking ? '1.5s' : '5s';

  return (
    <div className="relative w-[150px] h-[150px] flex items-center justify-center">
      <svg viewBox="0 0 150 150" className="w-full h-full" aria-hidden="true">
        <defs>
          <radialGradient id="blob-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity={isActive ? 0.25 : 0.06} />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient glow */}
        <circle cx={cx} cy={cy} r="65" fill="url(#blob-glow)" />

        {/* Blob layer 1 — main shape */}
        <path
          d={blobs[0]!.d}
          fill={color}
          fillOpacity={isActive ? 0.15 : 0.05}
          stroke={color}
          strokeWidth={isActive ? 1.5 : 0.8}
          strokeOpacity={isActive ? 0.6 : 0.15}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: `blob-morph-1 ${animDuration} ease-in-out infinite, blob-rotate-1 ${isSpeaking ? '3s' : '12s'} linear infinite`,
          }}
        />

        {/* Blob layer 2 — offset, counter-rotated */}
        <path
          d={blobs[1]!.d}
          fill={color}
          fillOpacity={isActive ? 0.08 : 0.02}
          stroke={color}
          strokeWidth={isActive ? 1 : 0.5}
          strokeOpacity={isActive ? 0.3 : 0.08}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: `blob-morph-2 ${animDuration2} ease-in-out infinite, blob-rotate-2 ${isSpeaking ? '4s' : '16s'} linear infinite`,
          }}
        />

        {/* Center dot */}
        <circle
          cx={cx}
          cy={cy}
          r={isActive ? 3 : 2}
          fill={color}
          fillOpacity={isActive ? 0.7 : 0.2}
          style={{
            transition: 'r 0.4s ease, fill-opacity 0.4s ease',
            animation: isSpeaking ? 'blob-center-pulse 0.6s ease-in-out infinite' : undefined,
          }}
        />
      </svg>

      <style>{`
        @keyframes blob-morph-1 {
          0%, 100% { transform: scale(1) rotate(0deg); }
          25% { transform: scale(${isSpeaking ? 1.15 : isActive ? 1.06 : 1.02}) rotate(2deg); }
          50% { transform: scale(${isSpeaking ? 0.9 : isActive ? 0.97 : 0.99}) rotate(-1deg); }
          75% { transform: scale(${isSpeaking ? 1.12 : isActive ? 1.04 : 1.01}) rotate(1deg); }
        }
        @keyframes blob-morph-2 {
          0%, 100% { transform: scale(1) rotate(0deg); }
          33% { transform: scale(${isSpeaking ? 1.18 : isActive ? 1.08 : 1.03}) rotate(-3deg); }
          66% { transform: scale(${isSpeaking ? 0.88 : isActive ? 0.95 : 0.98}) rotate(2deg); }
        }
        @keyframes blob-rotate-1 {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes blob-rotate-2 {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes blob-center-pulse {
          0%, 100% { r: 3; fill-opacity: 0.7; }
          50% { r: 5; fill-opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

export function VoiceOrbCard() {
  const { voiceState, voiceProfile } = useVoiceState();
  const sessionName = useUnifiedSessionsStore((s) => s.sessionTree?.name);

  const profileName = voiceProfile || 'Voice Agent';
  const displayName = profileName.charAt(0).toUpperCase() + profileName.slice(1);

  const modelInfo = voiceProfile === 'marvin'
    ? 'gpt-4o-realtime'
    : 'gpt-4o-mini-realtime';

  return (
    <div className="voice-orb-card">
      <div className="flex justify-center py-2">
        <VoiceBlob state={voiceState} />
      </div>
      <div className="px-3 pb-3 text-center">
        <div className="text-[11px] font-medium text-foreground/70">
          {displayName}
          <span className="text-muted-foreground/40 font-normal"> · </span>
          <span className="text-muted-foreground/50 font-normal">{stateLabels[voiceState]}</span>
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">
          {modelInfo}
          {sessionName && <span className="text-muted-foreground/25"> · {sessionName}</span>}
        </div>
      </div>
    </div>
  );
}
