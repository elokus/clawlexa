// ═══════════════════════════════════════════════════════════════════════════
// Stage Store v2 - Session Tree based navigation
// ═══════════════════════════════════════════════════════════════════════════
//
// NEW ARCHITECTURE:
// - sessionTree: Full tree from backend (orchestrator → terminals)
// - focusedSessionId: Currently viewed session in the tree
// - The frontend renders what the backend tells it - no local state management
//
// The ThreadRail renders the path from root to focused session.
// The MainStage renders based on focused session type.

import { create } from 'zustand';
import type { StageItem, OverlayType, SessionTreeNode } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// Store Interface
// ═══════════════════════════════════════════════════════════════════════════

interface StageStore {
  // ─────────────────────────────────────────────────────────────────────────
  // New Session Tree State
  // ─────────────────────────────────────────────────────────────────────────

  /** Active session tree from backend */
  sessionTree: SessionTreeNode | null;

  /** Currently focused session ID within the tree */
  focusedSessionId: string | null;

  /** Background thread root IDs (minimized) */
  backgroundTreeIds: string[];

  /** Whether voice conversation is active (for ChatStage visibility) */
  voiceActive: boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy State (kept for migration compatibility)
  // ─────────────────────────────────────────────────────────────────────────

  /** @deprecated Use sessionTree instead */
  activeStage: StageItem;
  /** @deprecated Use sessionTree path instead */
  threadRail: StageItem[];
  /** @deprecated Use backgroundTreeIds instead */
  backgroundTasks: StageItem[];

  // Overlay state (still needed)
  activeOverlay: OverlayType;

  // ─────────────────────────────────────────────────────────────────────────
  // New Actions
  // ─────────────────────────────────────────────────────────────────────────

  /** Set session tree from backend event */
  setSessionTree: (tree: SessionTreeNode) => void;

  /** Focus a specific session in the tree */
  focusSession: (sessionId: string) => void;

  /** Minimize current tree to background */
  minimizeTree: () => void;

  /** Restore a tree from background */
  restoreTree: (rootId: string) => void;

  /** Set voice active state */
  setVoiceActive: (active: boolean) => void;

  /** Clear session tree (when all sessions end) */
  clearSessionTree: () => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy Actions (deprecated but functional for migration)
  // ─────────────────────────────────────────────────────────────────────────

  /** @deprecated Backend controls stage now */
  pushStage: (item: Omit<StageItem, 'createdAt'>) => void;
  /** @deprecated Backend controls stage now */
  popStage: () => void;
  /** @deprecated Use minimizeTree instead */
  backgroundStage: (id: string) => void;
  /** @deprecated Use restoreTree instead */
  restoreStage: (id: string) => void;

  setActiveOverlay: (overlay: OverlayType) => void;
  openSessionTerminal: (sessionId: string, goal?: string) => void;
  reset: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/** Find the deepest running session in a tree (for auto-focus) */
function findDeepestRunning(node: SessionTreeNode): SessionTreeNode | null {
  // Check children first (depth-first)
  for (const child of node.children) {
    const found = findDeepestRunning(child);
    if (found) return found;
  }
  // If this node is running, return it
  if (['pending', 'running', 'waiting_for_input'].includes(node.status)) {
    return node;
  }
  return null;
}

/** Find a session by ID in a tree */
function findSessionById(
  node: SessionTreeNode | null,
  id: string | null
): SessionTreeNode | null {
  if (!node || !id) return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findSessionById(child, id);
    if (found) return found;
  }
  return null;
}

/** Get path from root to a specific session (for ThreadRail) */
export function getPathToSession(
  tree: SessionTreeNode | null,
  targetId: string | null
): SessionTreeNode[] {
  if (!tree || !targetId) return [];

  const path: SessionTreeNode[] = [];

  function traverse(node: SessionTreeNode): boolean {
    path.push(node);
    if (node.id === targetId) return true;
    for (const child of node.children) {
      if (traverse(child)) return true;
    }
    path.pop();
    return false;
  }

  traverse(tree);
  return path; // [root, child, grandchild, ...focused]
}

/** Check if a tree has any running sessions */
function hasRunningSession(node: SessionTreeNode): boolean {
  if (['pending', 'running', 'waiting_for_input'].includes(node.status)) {
    return true;
  }
  return node.children.some(hasRunningSession);
}

// ═══════════════════════════════════════════════════════════════════════════
// Default State
// ═══════════════════════════════════════════════════════════════════════════

const ROOT_STAGE: StageItem = {
  id: 'root',
  type: 'chat',
  title: 'Realtime Agent',
  status: 'active',
  createdAt: Date.now(),
};

// ═══════════════════════════════════════════════════════════════════════════
// Store Implementation
// ═══════════════════════════════════════════════════════════════════════════

export const useStageStore = create<StageStore>((set, get) => ({
  // New state
  sessionTree: null,
  focusedSessionId: null,
  backgroundTreeIds: [],
  voiceActive: false,

  // Legacy state
  activeStage: ROOT_STAGE,
  threadRail: [],
  backgroundTasks: [],
  activeOverlay: null,

  // ─────────────────────────────────────────────────────────────────────────
  // New Actions
  // ─────────────────────────────────────────────────────────────────────────

  setSessionTree: (tree) => {
    const current = get();

    // Auto-focus deepest running session if not already focused
    let focusedId = current.focusedSessionId;
    if (!focusedId || !findSessionById(tree, focusedId)) {
      const deepest = findDeepestRunning(tree);
      focusedId = deepest?.id ?? tree.id;
    }

    set({
      sessionTree: tree,
      focusedSessionId: focusedId,
    });
  },

  focusSession: (sessionId) => {
    const { sessionTree } = get();
    if (sessionTree && findSessionById(sessionTree, sessionId)) {
      set({ focusedSessionId: sessionId });
    }
  },

  minimizeTree: () => {
    const { sessionTree, backgroundTreeIds } = get();
    if (sessionTree) {
      set({
        backgroundTreeIds: [...backgroundTreeIds, sessionTree.id],
        sessionTree: null,
        focusedSessionId: null,
      });
    }
  },

  restoreTree: (rootId) => {
    const { backgroundTreeIds } = get();
    set({
      backgroundTreeIds: backgroundTreeIds.filter((id) => id !== rootId),
      // Tree will be populated by next session_tree_update from backend
    });
    // TODO: Request tree from backend via WebSocket
  },

  setVoiceActive: (active) => {
    set({ voiceActive: active });
  },

  clearSessionTree: () => {
    const { sessionTree, backgroundTreeIds } = get();
    // Move to background if it has history value
    if (sessionTree) {
      set({
        backgroundTreeIds: [...backgroundTreeIds, sessionTree.id],
        sessionTree: null,
        focusedSessionId: null,
      });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy Actions (functional but deprecated)
  // ─────────────────────────────────────────────────────────────────────────

  pushStage: (item) => {
    console.warn('[StageStore] pushStage is deprecated - use session_tree_update');
    const fullItem: StageItem = { ...item, createdAt: Date.now() };
    set((state) => ({
      threadRail: [{ ...state.activeStage, status: 'waiting' }, ...state.threadRail],
      activeStage: { ...fullItem, status: 'active' },
    }));
  },

  popStage: () => {
    console.warn('[StageStore] popStage is deprecated - use session_tree_update');
    set((state) => {
      if (state.threadRail.length === 0) return state;
      const [nextStage, ...remaining] = state.threadRail;
      return {
        activeStage: { ...nextStage, status: 'active' },
        threadRail: remaining,
      };
    });
  },

  backgroundStage: (id) => {
    console.warn('[StageStore] backgroundStage is deprecated');
    // Keep minimal implementation for compatibility
  },

  restoreStage: (id) => {
    console.warn('[StageStore] restoreStage is deprecated');
    // Keep minimal implementation for compatibility
  },

  setActiveOverlay: (overlay) => {
    set({ activeOverlay: overlay });
  },

  openSessionTerminal: (sessionId, goal) => {
    // This is now handled by focusSession when terminal is in tree
    const { sessionTree } = get();
    if (sessionTree) {
      const session = findSessionById(sessionTree, sessionId);
      if (session) {
        set({ focusedSessionId: sessionId });
        return;
      }
    }
    // Fallback to legacy behavior
    console.warn('[StageStore] openSessionTerminal fallback - session not in tree');
  },

  reset: () => {
    set({
      sessionTree: null,
      focusedSessionId: null,
      backgroundTreeIds: [],
      voiceActive: false,
      activeStage: ROOT_STAGE,
      threadRail: [],
      backgroundTasks: [],
      activeOverlay: null,
    });
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

/** Get the focused session from the tree */
export function useFocusedSession(): SessionTreeNode | null {
  const { sessionTree, focusedSessionId } = useStageStore();
  return findSessionById(sessionTree, focusedSessionId);
}

/** Get the path to focused session for ThreadRail */
export function useSessionPath(): SessionTreeNode[] {
  const { sessionTree, focusedSessionId } = useStageStore();
  return getPathToSession(sessionTree, focusedSessionId);
}

/** Check if there's an active session tree */
export function useHasActiveTree(): boolean {
  const { sessionTree } = useStageStore();
  return sessionTree !== null && hasRunningSession(sessionTree);
}

// Legacy helpers
export const isRootStage = (stage: StageItem): boolean => stage.id === 'root';

export const findStageById = (
  id: string,
  store: Pick<StageStore, 'activeStage' | 'threadRail' | 'backgroundTasks'>
): StageItem | null => {
  if (store.activeStage.id === id) return store.activeStage;
  return (
    store.threadRail.find((s) => s.id === id) ??
    store.backgroundTasks.find((s) => s.id === id) ??
    null
  );
};
