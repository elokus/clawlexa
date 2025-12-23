// ═══════════════════════════════════════════════════════════════════════════
// Stage Orchestrator - Main 3-column layout for Morphic Stage interface
//
// NEW ARCHITECTURE (v2):
// - Renders based on focused session from session tree
// - When no session tree: shows ChatStage (voice conversation)
// - When focused session: shows appropriate stage based on session type
// ═══════════════════════════════════════════════════════════════════════════

import { AnimatePresence } from 'framer-motion';
import { useFocusedSession } from '../../stores/stage';
import { BackgroundRail } from '../rails/BackgroundRail';
import { ThreadRail } from '../rails/ThreadRail';
import { ChatStage } from '../stages/ChatStage';
import { TerminalStage } from '../stages/TerminalStage';
import { SubagentStage } from '../stages/SubagentStage';
import { GlassHUD } from '../overlays/GlassHUD';
import { EventsOverlay } from '../overlays/EventsOverlay';
import { ToolsOverlay } from '../overlays/ToolsOverlay';
import type { SessionTreeNode, StageItem } from '../../types';

// ═══════════════════════════════════════════════════════════════════════════
// Asymmetric layout: Slim Left Dock (80px), Center Stage (1fr), Wide Right Rail (360px)
// ═══════════════════════════════════════════════════════════════════════════
const DOCK_WIDTH = 80;
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
 * - terminal sessions → TerminalStage
 * - orchestrator sessions → SubagentStage (shows activity feed)
 * - no session → ChatStage (voice conversation)
 */
function ActiveStage({ session }: { session: SessionTreeNode | null }) {
  // No session tree - show voice conversation
  if (!session) {
    return <ChatStage stage={ROOT_STAGE} />;
  }

  // Render based on session type
  switch (session.type) {
    case 'terminal':
      // Terminal sessions get TerminalStage with session ID
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
      // Orchestrator sessions get SubagentStage showing activity
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
      // Fallback to chat
      return <ChatStage stage={ROOT_STAGE} />;
  }
}

export function StageOrchestrator() {
  // Use the new tree-based focused session
  const focusedSession = useFocusedSession();

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
          grid-template-columns: ${DOCK_WIDTH}px 1fr ${CONTEXT_RAIL_WIDTH}px;
          height: 100%;
          width: 100%;
          gap: 0;
          overflow: hidden;
          position: relative;
          z-index: 1;
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
            grid-template-columns: 60px 1fr 280px;
          }
        }

        @media (max-width: 1024px) {
          .stage-orchestrator {
            grid-template-columns: 60px 1fr 60px;
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

      {/* Main 3-column asymmetric layout */}
      <div className="stage-orchestrator">
        {/* Left Dock - Slim icon bar */}
        <div className="orchestrator-dock">
          <BackgroundRail />
        </div>

        {/* Center Stage - Active View */}
        <div className="orchestrator-stage">
          <div className="stage-container">
            <AnimatePresence mode="wait">
              <ActiveStage key={focusedSession?.id ?? 'root'} session={focusedSession} />
            </AnimatePresence>

            {/* Glass HUD - shows when viewing terminal and agent is speaking */}
            <GlassHUD />
          </div>
        </div>

        {/* Right Rail - Wide context panel */}
        <div className="orchestrator-rail">
          <ThreadRail />
        </div>
      </div>

      {/* Overlays */}
      <EventsOverlay />
      <ToolsOverlay />
    </div>
  );
}
