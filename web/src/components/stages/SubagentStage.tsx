// ═══════════════════════════════════════════════════════════════════════════
// Subagent Stage - Activity stream view for delegated agent tasks
// Shows reasoning, tool calls, and responses in a drill-down stage
// Uses shared ActivityFeed component for consistent rendering
// ═══════════════════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import { useAgentStore } from '../../stores/agent';
import { useStageStore, useFocusedSessionChildren } from '../../stores/stage';
import { ActivityFeed } from '../ActivityFeed';
import type { StageItem } from '../../types';

interface SubagentStageProps {
  stage: StageItem;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function SubagentStage({ stage }: SubagentStageProps) {
  const stageAgentName = stage.data?.agentName || stage.title;

  // Get activities by orchestrator session ID
  // stage.id is the orchestrator session ID when navigating from session tree
  const getActivitiesForSession = useAgentStore((s) => s.getActivitiesForSession);
  const subagentActive = useAgentStore((s) => s.subagentActive);
  const activeOrchestratorId = useAgentStore((s) => s.activeOrchestratorId);
  const clearSubagentActivities = useAgentStore((s) => s.clearSubagentActivities);
  const popStage = useStageStore((s) => s.popStage);
  const focusSession = useStageStore((s) => s.focusSession);

  // Get children of the focused session for linking tool calls
  const focusedChildren = useFocusedSessionChildren();
  const focusedSessionId = useStageStore((s) => s.focusedSessionId);

  // Determine which orchestrator ID to use:
  // 1. If stage.id starts with 'pending-', we're in early transition (no session tree yet)
  //    In this case, use activeOrchestratorId from the store
  // 2. Otherwise, stage.id is the actual orchestrator session ID
  const isPending = stage.id.startsWith('pending-');
  const orchestratorId = isPending ? activeOrchestratorId : stage.id;

  // Debug: Log child session info
  console.log('[SubagentStage] Session linking debug:', {
    stageId: stage.id,
    isPending,
    orchestratorId,
    focusedSessionId,
    focusedChildrenCount: focusedChildren.length,
    focusedChildren: focusedChildren.map((c) => ({ id: c.id, type: c.type, goal: c.goal })),
  });

  // Get activities for this specific orchestrator session
  // Falls back to all activities if orchestratorId is null
  const activities = getActivitiesForSession(orchestratorId);

  // Get the actual agent name from activities for display
  const agentName = activities.length > 0
    ? activities[0].agent
    : stageAgentName;

  // Determine status based on activity
  const isActive = subagentActive && activities.some(
    (block) =>
      (block.type === 'reasoning' && !block.isComplete) ||
      (block.type === 'tool' && !block.isComplete)
  );

  const statusConfig = isActive
    ? { label: 'PROCESSING', color: 'var(--color-violet)', pulse: true }
    : { label: 'COMPLETE', color: 'var(--color-emerald)', pulse: false };

  return (
    <motion.div
      className="subagent-stage obsidian-glass"
      layoutId={`stage-${stage.id}`}
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -8 }}
      transition={{
        duration: 0.35,
        ease: [0.4, 0, 0.2, 1],
      }}
    >
      <style>{`
        .subagent-stage {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-radius: 16px;
          overflow: hidden;
          position: relative;
        }

        /* ═══════════════════════════════════════════════════════════════════
           HUD HEADER
           ═══════════════════════════════════════════════════════════════════ */

        .subagent-hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          background: linear-gradient(
            180deg,
            rgba(8, 8, 12, 0.9) 0%,
            rgba(5, 5, 8, 0.85) 100%
          );
          border-bottom: 1px solid rgba(139, 92, 246, 0.15);
          position: relative;
          flex-shrink: 0;
        }

        .subagent-hud-header::before,
        .subagent-hud-header::after {
          content: '';
          position: absolute;
          width: 20px;
          height: 20px;
          border: 1px solid rgba(139, 92, 246, 0.2);
        }

        .subagent-hud-header::before {
          top: 8px;
          left: 8px;
          border-right: none;
          border-bottom: none;
        }

        .subagent-hud-header::after {
          top: 8px;
          right: 8px;
          border-left: none;
          border-bottom: none;
        }

        .hud-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .hud-icon {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 92, 246, 0.08);
          border: 1px solid rgba(139, 92, 246, 0.2);
          border-radius: 8px;
          color: var(--color-violet);
          font-family: var(--font-mono);
          font-size: 16px;
          box-shadow: 0 0 16px rgba(139, 92, 246, 0.15);
        }

        .hud-meta {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .hud-agent-name {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: var(--color-text-bright);
          text-transform: uppercase;
        }

        .hud-subtitle {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
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
          padding: 6px 12px;
          border-radius: 6px;
          font-family: var(--font-display);
          font-size: 10px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          background: ${statusConfig.color}12;
          color: ${statusConfig.color};
          border: 1px solid ${statusConfig.color}35;
          box-shadow: 0 0 12px ${statusConfig.color}20;
        }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${statusConfig.color};
          box-shadow: 0 0 8px ${statusConfig.color};
        }

        .status-indicator.pulse {
          animation: status-glow 1.5s ease-in-out infinite;
        }

        @keyframes status-glow {
          0%, 100% {
            opacity: 1;
            box-shadow: 0 0 8px ${statusConfig.color};
          }
          50% {
            opacity: 0.5;
            box-shadow: 0 0 16px ${statusConfig.color};
          }
        }

        .hud-btn {
          padding: 8px 14px;
          border-radius: 6px;
          border: 1px solid var(--color-glass-border);
          background: rgba(255, 255, 255, 0.02);
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .hud-btn:hover {
          border-color: rgba(139, 92, 246, 0.3);
          color: var(--color-violet);
          background: rgba(139, 92, 246, 0.05);
        }

        /* ═══════════════════════════════════════════════════════════════════
           ACTIVITY STREAM CONTAINER
           ═══════════════════════════════════════════════════════════════════ */

        .activity-stream-container {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .activity-stream-container .activity-feed {
          height: 100%;
        }

        .activity-stream-container .activity-list {
          padding: 16px;
        }

        .activity-stream-container .activity-list::-webkit-scrollbar {
          width: 6px;
        }

        .activity-stream-container .activity-list::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }

        .activity-stream-container .activity-list::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.2);
          border-radius: 3px;
        }

        /* ═══════════════════════════════════════════════════════════════════
           RESPONSIVE
           ═══════════════════════════════════════════════════════════════════ */

        @media (max-width: 768px) {
          .subagent-hud-header {
            padding: 12px 14px;
          }

          .subagent-hud-header::before,
          .subagent-hud-header::after {
            display: none;
          }

          .hud-subtitle {
            display: none;
          }
        }
      `}</style>

      {/* HUD Header */}
      <div className="subagent-hud-header">
        <div className="hud-left">
          <div className="hud-icon">◇</div>
          <div className="hud-meta">
            <span className="hud-agent-name">{agentName}</span>
            <span className="hud-subtitle">Subagent Activity</span>
          </div>
        </div>
        <div className="hud-right">
          <div className="hud-status">
            <span className={`status-indicator ${statusConfig.pulse ? 'pulse' : ''}`} />
            {statusConfig.label}
          </div>
          <button className="hud-btn" onClick={popStage}>
            BACK
          </button>
        </div>
      </div>

      {/* Activity Stream - Uses shared ActivityFeed component */}
      <div className="activity-stream-container">
        <ActivityFeed
          blocks={activities}
          isActive={isActive}
          showHeader={false}
          onClear={() => clearSubagentActivities(orchestratorId || undefined)}
          emptyMessage={`Waiting for activity...\n${agentName} is initializing`}
          childSessions={focusedChildren}
          onNavigateToSession={focusSession}
        />
      </div>
    </motion.div>
  );
}
