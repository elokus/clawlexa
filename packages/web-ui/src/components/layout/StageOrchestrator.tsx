import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useFocusedSession,
  useUnifiedSessionsStore,
  useSubagentActivities,
  useActiveView,
} from '../../stores';
import { HistoryPanel } from '../rails/HistoryPanel';
import { ThreadRail } from '../rails/ThreadRail';
import { VoiceOrbCard } from '../rails/VoiceOrbCard';
import { AgentStage } from '../stages/AgentStage';
import { TerminalStage } from '../stages/TerminalStage';
import { GlassHUD } from '../overlays/GlassHUD';
import { EventsOverlay } from '../overlays/EventsOverlay';
import { ToolsOverlay } from '../overlays/ToolsOverlay';
import { ToastOverlay } from '../overlays/Toast';
import { PromptsView } from '../prompts/PromptsView';
import { SettingsView } from '../settings/SettingsView';
import { useToasts } from '../../stores';
import { navigateToSession, useRouter } from '../../hooks/useRouter';
import type { SessionTreeNode, StageItem } from '../../types';

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
  const historyPanelOpen = useUnifiedSessionsStore((s) => s.historyPanelOpen);

  const subagentActivities = useSubagentActivities();
  const pendingAgentName = !focusedSession && subagentActivities.length > 0
    ? subagentActivities[0]?.agent
    : null;

  const stageKey = focusedSession?.id ?? (pendingAgentName ? `pending-${pendingAgentName}` : 'root');

  const isPromptsView = activeView === 'prompts';
  const isSettingsView = activeView === 'settings';
  const { params } = useRouter();

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {isSettingsView ? (
        <div className="h-full overflow-hidden">
          <SettingsView initialPage={params.settingsPage} />
        </div>
      ) : isPromptsView ? (
        <div className="h-full overflow-hidden">
          <PromptsView />
        </div>
      ) : (
        <div className="relative h-full w-full overflow-hidden">
          {/* Main content - full width, messages constrained via CSS */}
          <div className="h-full w-full overflow-hidden">
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

          {/* Floating history panel */}
          <AnimatePresence>
            {historyPanelOpen && (
              <motion.div
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              >
                <HistoryPanel />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Right sidebar — voice card + thread rail in flex column */}
          <div className="right-sidebar">
            <VoiceOrbCard />
            <ThreadRail />
          </div>
        </div>
      )}

      <EventsOverlay />
      <ToolsOverlay />
    </div>
  );
}
