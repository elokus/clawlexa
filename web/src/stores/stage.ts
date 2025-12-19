// ═══════════════════════════════════════════════════════════════════════════
// Stage Store - Zustand state management for Morphic Stage navigation
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type { StageItem, OverlayType } from '../types';

interface StageStore {
  // Active focus stage (center)
  activeStage: StageItem;

  // Thread rail items (right) - the "stack" of parent contexts
  threadRail: StageItem[];

  // Background tasks (left) - minimized/persistent items
  backgroundTasks: StageItem[];

  // Active overlay modal
  activeOverlay: OverlayType;

  // Actions
  pushStage: (item: Omit<StageItem, 'createdAt'>) => void;
  popStage: () => void;
  backgroundStage: (id: string) => void;
  restoreStage: (id: string) => void;
  setActiveOverlay: (overlay: OverlayType) => void;
  openSessionTerminal: (sessionId: string, goal?: string) => void;
  reset: () => void;
}

// Default root stage (Realtime Agent chat)
const ROOT_STAGE: StageItem = {
  id: 'root',
  type: 'chat',
  title: 'Realtime Agent',
  status: 'active',
  createdAt: Date.now(),
};

export const useStageStore = create<StageStore>((set, get) => ({
  // Initial state
  activeStage: ROOT_STAGE,
  threadRail: [],
  backgroundTasks: [],
  activeOverlay: null,

  // Push a new stage to focus, moving current to thread rail
  pushStage: (item) => {
    const fullItem: StageItem = {
      ...item,
      createdAt: Date.now(),
    };

    set((state) => {
      // Move current active stage to thread rail (mark as waiting)
      const previousStage: StageItem = {
        ...state.activeStage,
        status: 'waiting',
      };

      return {
        threadRail: [previousStage, ...state.threadRail],
        activeStage: { ...fullItem, status: 'active' },
      };
    });
  },

  // Pop back to previous stage from thread rail
  popStage: () => {
    set((state) => {
      if (state.threadRail.length === 0) {
        // Nothing to pop, stay on current stage
        return state;
      }

      const [nextStage, ...remainingThread] = state.threadRail;

      // Optionally move current stage to background if it's a terminal
      // that finished (caller can background before pop if needed)
      const currentStage = state.activeStage;

      // Check if current stage should go to background
      // (e.g., terminal sessions that aren't finished)
      let newBackgroundTasks = state.backgroundTasks;
      if (currentStage.type === 'terminal' && currentStage.status !== 'active') {
        // Could optionally add to background, but for now we just discard
        // since the session finished
      }

      return {
        activeStage: { ...nextStage, status: 'active' },
        threadRail: remainingThread,
        backgroundTasks: newBackgroundTasks,
      };
    });
  },

  // Move a stage to background
  backgroundStage: (id) => {
    set((state) => {
      // Find the stage in active or thread rail
      let stageToBackground: StageItem | null = null;
      let newActiveStage = state.activeStage;
      let newThreadRail = state.threadRail;

      if (state.activeStage.id === id) {
        // Backgrounding active stage - need to pop from thread
        stageToBackground = state.activeStage;

        if (state.threadRail.length > 0) {
          const [nextStage, ...remaining] = state.threadRail;
          newActiveStage = { ...nextStage, status: 'active' };
          newThreadRail = remaining;
        } else {
          // No thread to pop, reset to root
          newActiveStage = ROOT_STAGE;
        }
      } else {
        // Find in thread rail
        const idx = state.threadRail.findIndex((s) => s.id === id);
        if (idx !== -1) {
          stageToBackground = state.threadRail[idx];
          newThreadRail = state.threadRail.filter((_, i) => i !== idx);
        }
      }

      if (!stageToBackground) {
        return state;
      }

      return {
        activeStage: newActiveStage,
        threadRail: newThreadRail,
        backgroundTasks: [
          ...state.backgroundTasks,
          { ...stageToBackground, status: 'background' },
        ],
      };
    });
  },

  // Restore a stage from background to active
  restoreStage: (id) => {
    set((state) => {
      const idx = state.backgroundTasks.findIndex((s) => s.id === id);
      if (idx === -1) {
        return state;
      }

      const stageToRestore = state.backgroundTasks[idx];
      const newBackgroundTasks = state.backgroundTasks.filter((_, i) => i !== idx);

      // Push current active to thread, restore from background
      return {
        threadRail: [{ ...state.activeStage, status: 'waiting' }, ...state.threadRail],
        activeStage: { ...stageToRestore, status: 'active' },
        backgroundTasks: newBackgroundTasks,
      };
    });
  },

  // Set active overlay modal
  setActiveOverlay: (overlay) => {
    set({ activeOverlay: overlay });
  },

  // Open a terminal stage for a session
  openSessionTerminal: (sessionId, goal) => {
    const { activeStage, threadRail, backgroundTasks, pushStage } = get();

    // Check if session is already open anywhere
    const allStages = [activeStage, ...threadRail, ...backgroundTasks];
    const existingStage = allStages.find(
      (s) => s.type === 'terminal' && s.data?.sessionId === sessionId
    );

    if (existingStage) {
      // If in background, restore it
      if (backgroundTasks.some((s) => s.id === existingStage.id)) {
        get().restoreStage(existingStage.id);
        return;
      }
      // If already active, do nothing
      if (activeStage.id === existingStage.id) {
        return;
      }
      // If in thread rail, it'll become active when we pop to it
      // For now, just push a new stage (could optimize to jump to it)
    }

    // Push new terminal stage
    pushStage({
      id: `terminal-${sessionId}`,
      type: 'terminal',
      title: goal || `Session ${sessionId.slice(0, 8)}`,
      data: { sessionId },
      status: 'active',
    });
  },

  // Reset to initial state
  reset: () => {
    set({
      activeStage: ROOT_STAGE,
      threadRail: [],
      backgroundTasks: [],
      activeOverlay: null,
    });
  },
}));

// Helper to check if we're on root chat stage
export const isRootStage = (stage: StageItem): boolean => stage.id === 'root';

// Helper to get stage by ID from any rail
export const findStageById = (
  id: string,
  store: Pick<StageStore, 'activeStage' | 'threadRail' | 'backgroundTasks'>
): StageItem | null => {
  if (store.activeStage.id === id) return store.activeStage;
  const inThread = store.threadRail.find((s) => s.id === id);
  if (inThread) return inThread;
  const inBackground = store.backgroundTasks.find((s) => s.id === id);
  if (inBackground) return inBackground;
  return null;
};
