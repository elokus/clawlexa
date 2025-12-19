// ═══════════════════════════════════════════════════════════════════════════
// Thread Rail - 3D stacked cards with glowing SVG connector to center stage
// Obsidian Glass / Minority Report aesthetic
// ═══════════════════════════════════════════════════════════════════════════

import { motion, AnimatePresence } from 'framer-motion';
import { useStageStore } from '../../stores/stage';
import type { StageItem } from '../../types';

const STAGE_ICONS: Record<string, string> = {
  chat: '◎',
  terminal: '▣',
};

function ThreadCard({
  stage,
  index,
  isFirst,
  onClick,
}: {
  stage: StageItem;
  index: number;
  isFirst: boolean;
  onClick: () => void;
}) {
  // 3D depth calculations
  const depthZ = -40 * index;
  const depthY = 8 * index;
  const depthOpacity = 1 - index * 0.18;
  const depthScale = 1 - index * 0.04;

  return (
    <motion.button
      className={`thread-card ${isFirst ? 'is-active' : ''}`}
      data-type={stage.type}
      onClick={onClick}
      initial={{ opacity: 0, x: 30, rotateY: -15 }}
      animate={{
        opacity: depthOpacity,
        x: 0,
        rotateY: -8,
        translateZ: depthZ,
        translateY: depthY,
        scale: depthScale,
      }}
      exit={{ opacity: 0, x: 30, rotateY: -15, scale: 0.9 }}
      transition={{
        duration: 0.35,
        delay: index * 0.05,
        ease: [0.4, 0, 0.2, 1],
      }}
      style={{
        transformStyle: 'preserve-3d',
        transformOrigin: 'right center',
      }}
      whileHover={{
        x: -8,
        rotateY: -4,
        transition: { duration: 0.2 },
      }}
    >
      <div className="thread-card-inner">
        <div className="thread-icon">{STAGE_ICONS[stage.type] || '◆'}</div>
        <div className="thread-info">
          <div className="thread-title">{stage.title}</div>
          <div className="thread-type">{stage.type}</div>
        </div>
        <span className="thread-arrow">←</span>
      </div>

      {/* Active card glow indicator */}
      {isFirst && <div className="thread-card-glow" />}
    </motion.button>
  );
}

// SVG Connector from active thread card to center stage
function StageConnector({ hasItems }: { hasItems: boolean }) {
  if (!hasItems) return null;

  return (
    <svg className="connector-svg" viewBox="0 0 40 200" preserveAspectRatio="none">
      <defs>
        <linearGradient id="connector-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity="0.6" />
          <stop offset="50%" stopColor="var(--color-cyan)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--color-cyan)" stopOpacity="0.4" />
        </linearGradient>
        <filter id="connector-glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Main connector path - bezier curve from rail to stage */}
      <path
        className="connector-path connector-path-active"
        d="M 38,60 C 20,60 10,100 2,100"
        filter="url(#connector-glow)"
      />

      {/* Data flow particles */}
      <circle className="connector-particle" r="2" fill="var(--color-cyan)">
        <animateMotion dur="1.5s" repeatCount="indefinite" path="M 38,60 C 20,60 10,100 2,100" />
      </circle>
    </svg>
  );
}

export function ThreadRail() {
  const threadRail = useStageStore((s) => s.threadRail);
  const popStage = useStageStore((s) => s.popStage);

  const handleCardClick = (index: number) => {
    // Pop stages until we reach the clicked one
    for (let i = 0; i <= index; i++) {
      popStage();
    }
  };

  return (
    <div className="thread-rail stage-perspective">
      <style>{`
        .thread-rail {
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 16px 12px;
          overflow: hidden;
          position: relative;
        }

        .thread-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
          padding: 0 4px;
        }

        .thread-label {
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.2em;
          color: var(--color-text-ghost);
          text-transform: uppercase;
        }

        .thread-count {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-cyan);
          padding: 2px 8px;
          background: rgba(56, 189, 248, 0.08);
          border: 1px solid rgba(56, 189, 248, 0.15);
          border-radius: 4px;
        }

        .thread-stack-container {
          position: relative;
          flex: 1;
          overflow: visible;
        }

        .thread-stack {
          display: flex;
          flex-direction: column;
          gap: 12px;
          perspective: 800px;
          transform-style: preserve-3d;
        }

        /* ═══════════════════════════════════════════════════════════════════
           THREAD CARD - 3D Glass Card
           ═══════════════════════════════════════════════════════════════════ */

        .thread-card {
          position: relative;
          width: 100%;
          padding: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          transform-style: preserve-3d;
        }

        .thread-card-inner {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          background: linear-gradient(
            135deg,
            rgba(10, 10, 15, 0.85) 0%,
            rgba(8, 8, 12, 0.9) 100%
          );
          backdrop-filter: blur(12px);
          border: 1px solid var(--color-glass-border);
          border-radius: 12px;
          transition: all 0.25s var(--ease-out);
        }

        .thread-card:hover .thread-card-inner {
          border-color: rgba(56, 189, 248, 0.25);
          background: linear-gradient(
            135deg,
            rgba(12, 12, 18, 0.9) 0%,
            rgba(10, 10, 15, 0.95) 100%
          );
        }

        .thread-card.is-active .thread-card-inner {
          border-color: rgba(56, 189, 248, 0.35);
          box-shadow:
            0 0 20px rgba(56, 189, 248, 0.1),
            0 4px 16px rgba(0, 0, 0, 0.3);
        }

        /* Active card glow */
        .thread-card-glow {
          position: absolute;
          inset: -2px;
          background: radial-gradient(
            ellipse at right center,
            rgba(56, 189, 248, 0.15) 0%,
            transparent 60%
          );
          border-radius: 14px;
          pointer-events: none;
          z-index: -1;
        }

        .thread-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(52, 211, 153, 0.08);
          border: 1px solid rgba(52, 211, 153, 0.15);
          border-radius: 8px;
          font-family: var(--font-mono);
          font-size: 14px;
          color: var(--color-emerald);
          flex-shrink: 0;
          transition: all 0.2s ease;
        }

        .thread-card[data-type="terminal"] .thread-icon {
          background: rgba(56, 189, 248, 0.08);
          border-color: rgba(56, 189, 248, 0.15);
          color: var(--color-cyan);
        }

        .thread-card.is-active .thread-icon {
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
        }

        .thread-info {
          flex: 1;
          min-width: 0;
        }

        .thread-title {
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-normal);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .thread-card.is-active .thread-title {
          color: var(--color-text-bright);
        }

        .thread-type {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-text-ghost);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-top: 3px;
        }

        .thread-arrow {
          font-size: 14px;
          color: var(--color-text-ghost);
          transition: all 0.2s ease;
          opacity: 0.5;
        }

        .thread-card:hover .thread-arrow {
          transform: translateX(-4px);
          color: var(--color-cyan);
          opacity: 1;
        }

        /* ═══════════════════════════════════════════════════════════════════
           SVG CONNECTOR
           ═══════════════════════════════════════════════════════════════════ */

        .connector-svg {
          position: absolute;
          top: 20px;
          left: -32px;
          width: 40px;
          height: 120px;
          pointer-events: none;
          z-index: 10;
          overflow: visible;
        }

        .connector-particle {
          opacity: 0.8;
        }

        /* ═══════════════════════════════════════════════════════════════════
           EMPTY STATE
           ═══════════════════════════════════════════════════════════════════ */

        .thread-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          text-align: center;
          padding: 24px 16px;
        }

        .thread-empty-icon {
          font-size: 28px;
          color: var(--color-text-ghost);
          opacity: 0.25;
          margin-bottom: 16px;
        }

        .thread-empty-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
          line-height: 1.8;
          opacity: 0.7;
        }

        /* ═══════════════════════════════════════════════════════════════════
           RESPONSIVE
           ═══════════════════════════════════════════════════════════════════ */

        @media (max-width: 1024px) {
          .thread-rail {
            padding: 12px 8px;
          }

          .thread-header {
            display: none;
          }

          .thread-card-inner {
            padding: 10px;
            justify-content: center;
          }

          .thread-info,
          .thread-arrow {
            display: none;
          }

          .thread-icon {
            width: 36px;
            height: 36px;
          }

          .connector-svg {
            display: none;
          }
        }
      `}</style>

      <div className="thread-header">
        <span className="thread-label">Thread</span>
        {threadRail.length > 0 && (
          <span className="thread-count">{threadRail.length}</span>
        )}
      </div>

      {threadRail.length === 0 ? (
        <div className="thread-empty">
          <div className="thread-empty-icon">◇</div>
          <div className="thread-empty-text">
            No parent contexts.<br />
            Open a sub-task to see<br />
            the thread stack here.
          </div>
        </div>
      ) : (
        <div className="thread-stack-container">
          {/* SVG Connector to center stage */}
          <StageConnector hasItems={threadRail.length > 0} />

          <div className="thread-stack">
            <AnimatePresence>
              {threadRail.map((stage, index) => (
                <ThreadCard
                  key={stage.id}
                  stage={stage}
                  index={index}
                  isFirst={index === 0}
                  onClick={() => handleCardClick(index)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
