// ═══════════════════════════════════════════════════════════════════════════
// Stage Orchestrator - Main 3-column layout for Morphic Stage interface
//
// UNIFIED ARCHITECTURE (v3 - Phase 4):
// - Uses AgentStage for both voice and subagent sessions
// - TerminalStage only for PTY/terminal sessions
// - Simpler routing: just check session type
// ═══════════════════════════════════════════════════════════════════════════

import { AnimatePresence } from 'framer-motion';
import {
  useFocusedSession,
  useUnifiedSessionsStore,
  useSubagentActivities,
  useActiveView,
} from '../../stores';
import { BackgroundRail } from '../rails/BackgroundRail';
import { ThreadRail } from '../rails/ThreadRail';
import { AgentStage } from '../stages/AgentStage';
import { TerminalStage } from '../stages/TerminalStage';
import { GlassHUD } from '../overlays/GlassHUD';
import { EventsOverlay } from '../overlays/EventsOverlay';
import { ToolsOverlay } from '../overlays/ToolsOverlay';
import { ToastOverlay } from '../overlays/Toast';
import { PromptsView } from '../prompts/PromptsView';
import { useToasts } from '../../stores';
import { navigateToSession } from '../../hooks/useRouter';
import type { SessionTreeNode, StageItem } from '../../types';

// ═══════════════════════════════════════════════════════════════════════════
// Asymmetric layout: Expandable Left Dock (auto), Center Stage (1fr), Wide Right Rail (360px)
// ═══════════════════════════════════════════════════════════════════════════
const CONTEXT_RAIL_WIDTH = 360;

// Default root stage for when no session tree exists
const ROOT_STAGE: StageItem = {
  id: 'root',
  type: 'chat',
  title: 'Realtime Agent',
  status: 'active',
  createdAt: Date.now(),
};

/**
 * Renders the appropriate stage based on focused session.
 * - terminal sessions → TerminalStage (PTY rendering)
 * - all other sessions → AgentStage (unified for voice + subagent)
 */
function ActiveStage({ session }: { session: SessionTreeNode | null }) {
  // Check for active subagent work (before session tree arrives)
  const subagentActivities = useSubagentActivities();
  const subagentActive = useUnifiedSessionsStore((s) => s.subagentActive);
  // Check if we have a session tree (for distinguishing early transition vs navigation)
  const hasSessionTree = useUnifiedSessionsStore((s) => s.sessionTree !== null);

  // No focused session - check for early subagent transition or show voice
  if (!session) {
    // Early transition: show subagent activity before session tree arrives
    if ((subagentActivities.length > 0 || subagentActive) && !hasSessionTree) {
      const agentName = subagentActivities[0]?.agent || 'Agent';
      return (
        <AgentStage
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
    // No subagent activity OR user navigated back to voice - show voice
    return <AgentStage stage={ROOT_STAGE} />;
  }

  // Render based on session type
  switch (session.type) {
    case 'terminal':
      // Terminal sessions get specialized TerminalStage for PTY
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

    case 'subagent':
    case 'orchestrator': // Legacy alias
      // Subagent sessions use unified AgentStage
      return (
        <AgentStage
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

    case 'voice':
      // Voice sessions show the voice AgentStage with session context
      return (
        <AgentStage
          stage={{
            id: session.id,
            type: 'chat',
            title: session.goal || 'Voice',
            status: 'active',
            createdAt: new Date(session.created_at).getTime(),
          }}
        />
      );

    default:
      // Fallback to voice (root AgentStage)
      return <AgentStage stage={ROOT_STAGE} />;
  }
}

export function StageOrchestrator() {
  // Use the new tree-based focused session
  const focusedSession = useFocusedSession();
  const activeView = useActiveView();
  const toasts = useToasts();
  const dismissToast = useUnifiedSessionsStore((s) => s.dismissToast);

  // Check for pending subagent (for key generation)
  const subagentActivities = useSubagentActivities();
  const pendingAgentName = !focusedSession && subagentActivities.length > 0
    ? subagentActivities[0]?.agent
    : null;

  // Generate unique key for AnimatePresence transitions
  const stageKey = focusedSession?.id ?? (pendingAgentName ? `pending-${pendingAgentName}` : 'root');

  const isPromptsView = activeView === 'prompts';

  return (
    <div className="stage-orchestrator-wrapper stage-perspective">
      <style>{`
        .stage-orchestrator-wrapper {
          position: relative;
          height: 100%;
          width: 100%;
          overflow: hidden;
          /* Deep void background with subtle radial glow */
          background: radial-gradient(
            ellipse 80% 50% at 50% 30%,
            rgba(26, 26, 36, 0.8) 0%,
            var(--color-void) 70%
          );
        }

        .stage-orchestrator {
          display: grid;
          grid-template-columns: auto 1fr ${CONTEXT_RAIL_WIDTH}px;
          height: 100%;
          width: 100%;
          gap: 0;
          overflow: hidden;
          position: relative;
          z-index: 1;
        }

        .stage-orchestrator.prompts-view {
          grid-template-columns: auto 1fr;
        }

        /* Left Dock - Slim icon bar */
        .orchestrator-dock {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: rgba(3, 3, 8, 0.6);
          border-right: 1px solid var(--color-glass-border);
          overflow: hidden;
          position: relative;
          z-index: 2;
        }

        /* Right Rail - Wide context panel */
        .orchestrator-rail {
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
          position: relative;
          z-index: 2;
        }

        /* Subtle inner glow on rails */
        .orchestrator-rail::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(
            ellipse 100% 60% at 50% 0%,
            rgba(56, 189, 248, 0.02) 0%,
            transparent 70%
          );
          pointer-events: none;
        }

        .orchestrator-stage {
          display: flex;
          flex-direction: column;
          height: 100%;
          position: relative;
          padding: 16px;
          overflow: hidden;
          z-index: 10;
        }

        .stage-container {
          flex: 1;
          min-height: 0;
          position: relative;
        }

        /* Responsive: collapse rails on smaller screens */
        @media (max-width: 1200px) {
          .stage-orchestrator {
            grid-template-columns: auto 1fr 280px;
          }
          .stage-orchestrator.prompts-view {
            grid-template-columns: auto 1fr;
          }
        }

        @media (max-width: 1024px) {
          .stage-orchestrator {
            grid-template-columns: auto 1fr 60px;
          }
          .stage-orchestrator.prompts-view {
            grid-template-columns: auto 1fr;
          }
        }

        @media (max-width: 768px) {
          .stage-orchestrator {
            grid-template-columns: 1fr;
          }

          .orchestrator-dock,
          .orchestrator-rail {
            display: none;
          }
        }
      `}</style>

      {/* Ambient Grid Background */}
      <div className="ambient-grid" />

      {/* Main layout - 3-column for sessions, 2-column for prompts */}
      <div className={`stage-orchestrator ${isPromptsView ? 'prompts-view' : ''}`}>
        {/* Left Dock - Slim icon bar */}
        <div className="orchestrator-dock">
          <BackgroundRail />
        </div>

        {isPromptsView ? (
          /* Prompts View - Full width */
          <div className="orchestrator-stage">
            <div className="stage-container">
              <PromptsView />
            </div>
          </div>
        ) : (
          <>
            {/* Center Stage - Active View */}
            <div className="orchestrator-stage">
              <div className="stage-container">
                <AnimatePresence mode="wait">
                  <ActiveStage key={stageKey} session={focusedSession} />
                </AnimatePresence>

                {/* Glass HUD - shows when viewing terminal and agent is speaking */}
                <GlassHUD />

                {/* Toast notifications for process completion/errors */}
                <ToastOverlay
                  toasts={toasts}
                  dismissToast={dismissToast}
                  focusSession={navigateToSession}
                />
              </div>
            </div>

            {/* Right Rail - Wide context panel */}
            <div className="orchestrator-rail">
              <ThreadRail />
            </div>
          </>
        )}
      </div>

      {/* Overlays */}
      <EventsOverlay />
      <ToolsOverlay />
    </div>
  );
}
