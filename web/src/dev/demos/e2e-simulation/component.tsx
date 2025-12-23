/**
 * E2E Simulation Demo - Full app layout with real stores
 *
 * Renders the actual StageOrchestrator layout (main panel + ThreadRail)
 * and plays captured events through the real agent/stage stores.
 */

import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { DemoProps } from '../../registry';
import { useAgentStore, useSubagentActivities } from '../../../stores/agent';
import { useStageStore, useFocusedSession } from '../../../stores/stage';
import { ChatStage } from '../../../components/stages/ChatStage';
import { SubagentStage } from '../../../components/stages/SubagentStage';
import { TerminalStage } from '../../../components/stages/TerminalStage';
import { ThreadRail } from '../../../components/rails/ThreadRail';
import type { SessionTreeNode, StageItem, WSMessage } from '../../../types';

// Default root stage for voice conversation
const ROOT_STAGE: StageItem = {
  id: 'root',
  type: 'chat',
  title: 'Realtime Agent',
  status: 'active',
  createdAt: Date.now(),
};

// Active stage renderer based on focused session
function ActiveStage({ session }: { session: SessionTreeNode | null }) {
  const profile = useAgentStore((s) => s.profile);
  const subagentActivities = useSubagentActivities();
  const subagentActive = useAgentStore((s) => s.subagentActive);

  // No session tree - check for subagent activity
  if (!session) {
    // If subagent is working, show SubagentStage immediately
    // This handles the gap between subagent_activity and session_tree_update
    if (subagentActivities.length > 0 || subagentActive) {
      const agentName = subagentActivities[0]?.agent || 'Agent';
      return (
        <SubagentStage
          stage={{
            id: `pending-${agentName}`,
            type: 'subagent',
            title: agentName,
            status: 'active',
            createdAt: Date.now(),
            data: { agentName },
          }}
        />
      );
    }
    // No subagent activity - show voice conversation
    return <ChatStage stage={{ ...ROOT_STAGE, title: profile || 'Realtime Agent' }} />;
  }

  // Render based on session type
  switch (session.type) {
    case 'terminal':
      return (
        <TerminalStage
          stage={{
            id: session.id,
            type: 'terminal',
            title: session.goal,
            status: 'active',
            createdAt: new Date(session.created_at).getTime(),
            data: { sessionId: session.id },
          }}
        />
      );

    case 'orchestrator':
      return (
        <SubagentStage
          stage={{
            id: session.id,
            type: 'subagent',
            title: session.agent_name || 'Agent',
            status: 'active',
            createdAt: new Date(session.created_at).getTime(),
            data: { agentName: session.agent_name || undefined },
          }}
        />
      );

    default:
      return <ChatStage stage={ROOT_STAGE} />;
  }
}

export function E2ESimulationDemo({ events, isPlaying, onReset }: DemoProps) {
  const handleMessage = useAgentStore((s) => s.handleMessage);
  const resetAgent = useAgentStore((s) => s.reset);
  const resetStage = useStageStore((s) => s.reset);
  const focusedSession = useFocusedSession();
  const state = useAgentStore((s) => s.state);
  const profile = useAgentStore((s) => s.profile);
  const subagentActivities = useSubagentActivities();

  // Calculate stage key for AnimatePresence transitions
  const pendingAgentName = !focusedSession && subagentActivities.length > 0
    ? subagentActivities[0]?.agent
    : null;
  const stageKey = focusedSession?.id ?? (pendingAgentName ? `pending-${pendingAgentName}` : 'root');

  // Track how many events we've already processed
  const processedCountRef = useRef(0);
  const isInitializedRef = useRef(false);

  // Initialize stores once
  useEffect(() => {
    if (!isInitializedRef.current) {
      resetAgent();
      resetStage();
      useAgentStore.setState({ connected: true, isMaster: true });
      isInitializedRef.current = true;
      processedCountRef.current = 0;
    }
  }, [resetAgent, resetStage]);

  // Reset when onReset is called (track via events length going to 0)
  useEffect(() => {
    if (events.length === 0 && processedCountRef.current > 0) {
      resetAgent();
      resetStage();
      useAgentStore.setState({ connected: true, isMaster: true });
      processedCountRef.current = 0;
    }
  }, [events.length, resetAgent, resetStage]);

  // Process new events as they arrive
  useEffect(() => {
    const newCount = events.length;
    const oldCount = processedCountRef.current;

    if (newCount > oldCount) {
      // Process only the new events
      for (let i = oldCount; i < newCount; i++) {
        const event = events[i];
        const wsMessage: WSMessage = {
          type: event.type as WSMessage['type'],
          payload: event.payload,
          timestamp: Date.now(),
        };
        handleMessage(wsMessage);
      }
      processedCountRef.current = newCount;
    }
  }, [events, handleMessage]);

  return (
    <div className="e2e-demo-layout">
      <style>{`
        .e2e-demo-layout {
          display: grid;
          grid-template-columns: 1fr 320px;
          height: 100%;
          width: 100%;
          background: var(--color-void);
          overflow: hidden;
        }

        .e2e-main-stage {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          position: relative;
          background: radial-gradient(
            ellipse 80% 50% at 50% 30%,
            rgba(26, 26, 36, 0.8) 0%,
            var(--color-void) 70%
          );
        }

        .e2e-stage-container {
          flex: 1;
          min-height: 0;
          position: relative;
          padding: 16px;
        }

        .e2e-rail {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(
            180deg,
            rgba(5, 5, 10, 0.5) 0%,
            rgba(3, 3, 8, 0.6) 100%
          );
          border-left: 1px solid var(--color-glass-border);
          overflow: hidden;
        }

        .e2e-status-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid var(--color-glass-border);
        }

        .e2e-status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .e2e-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--color-text-ghost);
          transition: all 0.3s ease;
        }

        .e2e-status-dot.listening {
          background: var(--color-emerald);
          box-shadow: 0 0 8px var(--color-emerald);
        }

        .e2e-status-dot.thinking {
          background: var(--color-amber);
          box-shadow: 0 0 8px var(--color-amber);
          animation: pulse-thinking 1s ease-in-out infinite;
        }

        .e2e-status-dot.speaking {
          background: var(--color-cyan);
          box-shadow: 0 0 8px var(--color-cyan);
          animation: pulse-speaking 0.5s ease-in-out infinite;
        }

        @keyframes pulse-thinking {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }

        @keyframes pulse-speaking {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .e2e-status-text {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .e2e-profile-badge {
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--color-cyan);
          padding: 3px 10px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 12px;
          letter-spacing: 0.1em;
        }

        .e2e-event-counter {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-text-ghost);
        }
      `}</style>

      {/* Main Stage Area */}
      <div className="e2e-main-stage">
        <div className="e2e-status-bar">
          <div className="e2e-status-indicator">
            <span className={`e2e-status-dot ${state}`} />
            <span className="e2e-status-text">{state}</span>
            {profile && <span className="e2e-profile-badge">{profile}</span>}
          </div>
          <span className="e2e-event-counter">
            {events.length} events
          </span>
        </div>

        <div className="e2e-stage-container">
          <AnimatePresence mode="wait">
            <ActiveStage key={stageKey} session={focusedSession} />
          </AnimatePresence>
        </div>
      </div>

      {/* Right Rail - Thread Navigation */}
      <div className="e2e-rail">
        <ThreadRail />
      </div>
    </div>
  );
}
