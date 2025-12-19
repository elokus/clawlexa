// ═══════════════════════════════════════════════════════════════════════════
// Background Rail - Slim vertical Icon Dock with tooltips
// Obsidian Glass / Minority Report aesthetic
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStageStore } from '../../stores/stage';
import { useAgentStore } from '../../stores/agent';
import type { StageItem, OverlayType } from '../../types';

// Persistent action icons
const DOCK_ACTIONS: { id: OverlayType; icon: string; label: string }[] = [
  { id: 'events', icon: '⚡', label: 'Events' },
  { id: 'tools', icon: '◇', label: 'Tools' },
  { id: 'history', icon: '◷', label: 'History' },
];

function DockButton({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <button
      className={`dock-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <style>{`
        .dock-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          background: transparent;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .dock-btn::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 0;
          background: var(--color-cyan);
          border-radius: 0 2px 2px 0;
          transition: all 0.2s ease;
          box-shadow: 0 0 8px var(--color-cyan);
        }

        .dock-btn:hover::before {
          height: 24px;
        }

        .dock-btn.active::before {
          height: 32px;
          box-shadow: 0 0 12px var(--color-cyan);
        }

        .dock-btn:hover {
          background: rgba(56, 189, 248, 0.05);
        }

        .dock-btn.active {
          background: rgba(56, 189, 248, 0.08);
        }

        .dock-icon {
          font-size: 20px;
          color: var(--color-text-dim);
          transition: all 0.2s ease;
        }

        .dock-btn:hover .dock-icon,
        .dock-btn.active .dock-icon {
          color: var(--color-cyan);
          text-shadow: 0 0 12px var(--color-cyan);
        }

        .dock-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--color-cyan);
          border-radius: 8px;
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 600;
          color: var(--color-void);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 8px var(--color-cyan);
        }

        .dock-tooltip {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 12px;
          padding: 6px 12px;
          background: rgba(10, 10, 15, 0.95);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-normal);
          white-space: nowrap;
          pointer-events: none;
          z-index: 100;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        }

        .dock-tooltip::before {
          content: '';
          position: absolute;
          left: -6px;
          top: 50%;
          transform: translateY(-50%);
          border: 6px solid transparent;
          border-right-color: rgba(10, 10, 15, 0.95);
        }
      `}</style>

      <span className="dock-icon">{icon}</span>
      {badge !== undefined && badge > 0 && (
        <span className="dock-badge">{badge > 99 ? '99+' : badge}</span>
      )}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            className="dock-tooltip"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.15 }}
          >
            {label}
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

function BackgroundTask({
  stage,
  onClick,
}: {
  stage: StageItem;
  onClick: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isTerminal = stage.type === 'terminal';

  return (
    <motion.button
      className={`dock-task ${isTerminal ? 'terminal' : 'chat'}`}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
    >
      <style>{`
        .dock-task {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          background: rgba(10, 10, 15, 0.6);
          border: 1px solid var(--color-glass-border);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .dock-task:hover {
          border-color: var(--color-cyan-dim);
          background: rgba(56, 189, 248, 0.05);
        }

        .dock-task.terminal {
          border-left: 2px solid var(--color-cyan);
        }

        .dock-task.terminal .dock-task-icon {
          color: var(--color-cyan);
          animation: task-pulse 2s ease-in-out infinite;
        }

        @keyframes task-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .dock-task-icon {
          font-family: var(--font-mono);
          font-size: 16px;
          color: var(--color-text-dim);
        }

        .dock-task-tooltip {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 12px;
          padding: 6px 12px;
          background: rgba(10, 10, 15, 0.95);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-normal);
          white-space: nowrap;
          pointer-events: none;
          z-index: 100;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        }
      `}</style>

      <span className="dock-task-icon">{isTerminal ? '▣' : '◎'}</span>
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            className="dock-task-tooltip"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.15 }}
          >
            {stage.title}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function BackgroundRail() {
  const backgroundTasks = useStageStore((s) => s.backgroundTasks);
  const activeOverlay = useStageStore((s) => s.activeOverlay);
  const setActiveOverlay = useStageStore((s) => s.setActiveOverlay);
  const restoreStage = useStageStore((s) => s.restoreStage);
  const events = useAgentStore((s) => s.events);

  const handleOverlayToggle = (overlay: OverlayType) => {
    if (activeOverlay === overlay) {
      setActiveOverlay(null);
    } else {
      setActiveOverlay(overlay);
    }
  };

  return (
    <div className="dock-rail">
      <style>{`
        .dock-rail {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          padding: 20px 0;
          gap: 0;
        }

        .dock-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding-bottom: 20px;
        }

        .dock-divider {
          width: 32px;
          height: 1px;
          background: var(--color-glass-border);
          margin: 4px 0 16px 0;
        }

        .dock-tasks {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          flex: 1;
          overflow-y: auto;
          padding: 0 8px;
        }

        .dock-tasks::-webkit-scrollbar {
          width: 0;
        }
      `}</style>

      {/* Action Icons */}
      <div className="dock-actions">
        {DOCK_ACTIONS.map((action) => (
          <DockButton
            key={action.id}
            icon={action.icon}
            label={action.label}
            active={activeOverlay === action.id}
            badge={action.id === 'events' ? events.length : undefined}
            onClick={() => handleOverlayToggle(action.id)}
          />
        ))}
      </div>

      {/* Divider if there are background tasks */}
      {backgroundTasks.length > 0 && <div className="dock-divider" />}

      {/* Background Tasks */}
      <div className="dock-tasks">
        <AnimatePresence>
          {backgroundTasks.map((task) => (
            <BackgroundTask
              key={task.id}
              stage={task}
              onClick={() => restoreStage(task.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
