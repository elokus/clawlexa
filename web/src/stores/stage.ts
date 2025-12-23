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
import { useShallow } from 'zustand/shallow';
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

  /** All known session trees (keyed by root ID) */
  allTrees: Map<string, SessionTreeNode>;

  /** Currently focused session ID within the tree */
  focusedSessionId: string | null;

  /** Background thread root IDs (minimized) */
  backgroundTreeIds: string[];

  /** Whether voice conversation is active (for ChatStage visibility) */
  voiceActive: boolean;

  /** Timeout ID for delayed auto-focus (internal use) */
  focusTimeout: ReturnType<typeof setTimeout> | null;

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

  /** Set all trees from backend (initial load) */
  setAllTrees: (trees: SessionTreeNode[]) => void;

  /** Focus a specific session (searches across all trees) */
  focusSession: (sessionId: string) => void;

  /** Minimize current tree to background */
  minimizeTree: () => void;

  /** Restore a tree from background */
  restoreTree: (rootId: string) => void;

  /** Set voice active state */
  setVoiceActive: (active: boolean) => void;

  /** Clear session tree (when all sessions end) */
  clearSessionTree: () => void;

  /** Clear focused session to return to voice view */
  clearFocusedSession: () => void;

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

/** Get children of a specific session */
export function getChildrenOfSession(
  tree: SessionTreeNode | null,
  targetId: string | null
): SessionTreeNode[] {
  if (!tree || !targetId) return [];
  const session = findSessionById(tree, targetId);
  return session?.children ?? [];
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
  allTrees: new Map(),
  focusedSessionId: null,
  backgroundTreeIds: [],
  voiceActive: false,
  focusTimeout: null,

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

    // Helper to collect all IDs in a tree
    const getAllIds = (node: SessionTreeNode): Set<string> => {
      const ids = new Set<string>([node.id]);
      node.children.forEach((child) => {
        getAllIds(child).forEach((id) => ids.add(id));
      });
      return ids;
    };

    // Detect new running sessions (present in new tree but not in old)
    let newRunningId: string | null = null;
    if (current.sessionTree) {
      const oldIds = getAllIds(current.sessionTree);
      // Find a node in new tree that wasn't in old tree and is running
      const findNewRunning = (node: SessionTreeNode): string | null => {
        if (!oldIds.has(node.id) && ['running', 'waiting_for_input'].includes(node.status)) {
          return node.id;
        }
        for (const child of node.children) {
          const found = findNewRunning(child);
          if (found) return found;
        }
        return null;
      };
      newRunningId = findNewRunning(tree);
    } else {
      // Initial load - focus deepest running immediately (no delay)
      const deepest = findDeepestRunning(tree);
      if (deepest && deepest.id !== tree.id) {
        set({ sessionTree: tree, focusedSessionId: deepest.id });
        return;
      }
    }

    // Keep existing focus if valid, otherwise fallback to current state
    let focusedId = current.focusedSessionId;
    if (focusedId && !findSessionById(tree, focusedId)) {
      // Current focus is no longer valid - reset to null (will trigger fallback)
      focusedId = null;
    }

    // Update the tree immediately and add to allTrees
    const newAllTrees = new Map(current.allTrees);
    newAllTrees.set(tree.id, tree);
    set({ sessionTree: tree, allTrees: newAllTrees });

    // Handle delayed auto-focus for new running sessions
    if (newRunningId) {
      // Clear any existing focus timeout
      if (current.focusTimeout) {
        clearTimeout(current.focusTimeout);
      }

      console.log(`[StageStore] New running session ${newRunningId} detected. Scheduling focus in 2s.`);

      // Schedule focus after delay (allows user to see tool invocation first)
      const timeout = setTimeout(() => {
        const currentTree = get().sessionTree;
        const currentFocus = get().focusedSessionId;
        // Only auto-focus if:
        // 1. Session still exists
        // 2. User hasn't manually navigated somewhere else
        if (currentTree && findSessionById(currentTree, newRunningId)) {
          // If user is still at root (null) or the same focus point, auto-navigate
          if (currentFocus === null || currentFocus === current.focusedSessionId) {
            get().focusSession(newRunningId);
          }
        }
        set({ focusTimeout: null });
      }, 2000); // 2 second delay

      set({ focusTimeout: timeout });
    } else if (!focusedId && !current.focusTimeout) {
      // No focus and no pending timeout - set fallback focus
      const deepest = findDeepestRunning(tree);
      set({ focusedSessionId: deepest?.id ?? null });
    }
  },

  setAllTrees: (trees) => {
    const newAllTrees = new Map<string, SessionTreeNode>();
    for (const tree of trees) {
      newAllTrees.set(tree.id, tree);
    }

    // Set first tree as active if none currently
    const current = get();
    const firstTree = trees[0] || null;
    const sessionTree = current.sessionTree || firstTree;

    // Find deepest running session to focus
    let focusedSessionId = current.focusedSessionId;
    if (!focusedSessionId && sessionTree) {
      const deepest = findDeepestRunning(sessionTree);
      focusedSessionId = deepest?.id ?? null;
    }

    console.log('[StageStore] setAllTrees:', {
      treeCount: trees.length,
      activeTree: sessionTree?.id,
      focusedSessionId,
    });

    set({ allTrees: newAllTrees, sessionTree, focusedSessionId });
  },

  focusSession: (sessionId) => {
    const { sessionTree, allTrees, backgroundTreeIds, focusedSessionId: currentFocused } = get();

    // First, check if session is in current tree
    if (sessionTree && findSessionById(sessionTree, sessionId)) {
      set({ focusedSessionId: sessionId });
      console.log('[StageStore] focusedSessionId updated to:', sessionId);
      return;
    }

    // Search across all trees
    for (const [rootId, tree] of allTrees) {
      if (findSessionById(tree, sessionId)) {
        console.log('[StageStore] Found session in different tree, switching:', {
          sessionId,
          fromTree: sessionTree?.id,
          toTree: rootId,
        });

        // If current tree exists, move it to background
        let newBackgroundIds = [...backgroundTreeIds];
        if (sessionTree && !newBackgroundIds.includes(sessionTree.id)) {
          newBackgroundIds.push(sessionTree.id);
        }

        // Remove target tree from background if present
        newBackgroundIds = newBackgroundIds.filter((id) => id !== rootId);

        set({
          sessionTree: tree,
          focusedSessionId: sessionId,
          backgroundTreeIds: newBackgroundIds,
        });
        return;
      }
    }

    console.log('[StageStore] focusSession called:', {
      sessionId,
      currentFocused,
      treeExists: !!sessionTree,
      allTreesCount: allTrees.size,
      sessionFound: false,
    });
    console.warn('[StageStore] focusSession failed - session not found in any tree');
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

  clearFocusedSession: () => {
    console.log('[StageStore] clearFocusedSession - returning to voice view');
    set({ focusedSessionId: null });
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
    const { focusTimeout } = get();
    if (focusTimeout) {
      clearTimeout(focusTimeout);
    }
    set({
      sessionTree: null,
      allTrees: new Map(),
      focusedSessionId: null,
      backgroundTreeIds: [],
      voiceActive: false,
      focusTimeout: null,
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
  // Use a selector to properly subscribe to both sessionTree and focusedSessionId
  return useStageStore((state) =>
    findSessionById(state.sessionTree, state.focusedSessionId)
  );
}

/** Get the path to focused session for ThreadRail */
export function useSessionPath(): SessionTreeNode[] {
  return useStageStore(
    useShallow((state) => getPathToSession(state.sessionTree, state.focusedSessionId))
  );
}

/** Get children of the focused session for ThreadRail */
export function useFocusedSessionChildren(): SessionTreeNode[] {
  return useStageStore(
    useShallow((state) => {
      const { sessionTree, focusedSessionId } = state;

      // If we are in Voice View (null focus) and a tree exists,
      // the root of that tree is effectively a "child" to navigate to
      if (focusedSessionId === null && sessionTree) {
        return [sessionTree];
      }

      return getChildrenOfSession(sessionTree, focusedSessionId);
    })
  );
}

/** Check if there's an active session tree */
export function useHasActiveTree(): boolean {
  return useStageStore((state) =>
    state.sessionTree !== null && hasRunningSession(state.sessionTree)
  );
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
