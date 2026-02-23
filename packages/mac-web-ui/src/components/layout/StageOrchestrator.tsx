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

const CONTEXT_RAIL_WIDTH = 320;

const ROOT_STAGE: StageItem = {
  id: 'root',
  type: 'chat',
  title: 'Realtime Agent',
  status: 'active',
  createdAt: Date.now(),
};

function ActiveStage({ session }: { session: SessionTreeNode | null }) {
  const subagentActivities = useSubagentActivities();
  const subagentActive = useUnifiedSessionsStore((s) => s.subagentActive);
  const hasSessionTree = useUnifiedSessionsStore((s) => s.sessionTree !== null);

  if (!session) {
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
    return <AgentStage stage={ROOT_STAGE} />;
  }

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

    case 'subagent':
    case 'orchestrator':
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
      return <AgentStage stage={ROOT_STAGE} />;
  }
}

export function StageOrchestrator() {
  const focusedSession = useFocusedSession();
  const activeView = useActiveView();
  const toasts = useToasts();
  const dismissToast = useUnifiedSessionsStore((s) => s.dismissToast);

  const subagentActivities = useSubagentActivities();
  const pendingAgentName = !focusedSession && subagentActivities.length > 0
    ? subagentActivities[0]?.agent
    : null;

  const stageKey = focusedSession?.id ?? (pendingAgentName ? `pending-${pendingAgentName}` : 'root');

  const isPromptsView = activeView === 'prompts';

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <div
        className={`grid h-full w-full overflow-hidden relative z-[1] ${
          isPromptsView ? 'grid-cols-[auto_1fr]' : ''
        }`}
        style={!isPromptsView ? {
          gridTemplateColumns: `auto 1fr ${CONTEXT_RAIL_WIDTH}px`,
        } : undefined}
      >
        {/* Left Dock — no border, subtle bg */}
        <div className="flex flex-col h-full bg-sidebar overflow-hidden relative z-[2]">
          <BackgroundRail />
        </div>

        {isPromptsView ? (
          <div className="flex flex-col h-full relative p-4 overflow-hidden z-10">
            <div className="flex-1 min-h-0 relative">
              <PromptsView />
            </div>
          </div>
        ) : (
          <>
            {/* Center Stage — flush, no padding */}
            <div className="flex flex-col h-full relative overflow-hidden z-10">
              <div className="flex-1 min-h-0 relative">
                <AnimatePresence mode="wait">
                  <ActiveStage key={stageKey} session={focusedSession} />
                </AnimatePresence>

                <GlassHUD />

                <ToastOverlay
                  toasts={toasts}
                  dismissToast={dismissToast}
                  focusSession={navigateToSession}
                />
              </div>
            </div>

            {/* Right Rail — no border, subtle bg */}
            <div className="flex flex-col h-full bg-sidebar overflow-hidden relative z-[2]">
              <ThreadRail />
            </div>
          </>
        )}
      </div>

      <EventsOverlay />
      <ToolsOverlay />
    </div>
  );
}
