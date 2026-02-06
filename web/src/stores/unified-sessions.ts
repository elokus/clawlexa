// ═══════════════════════════════════════════════════════════════════════════
// Unified Sessions Store - Single source of truth for all session state
// ═══════════════════════════════════════════════════════════════════════════
//
// This store consolidates agent.ts + stage.ts + sessions.ts into one unified store.
// All agents emit AI SDK format events via stream_chunk, enabling:
// - One handler for all agent types
// - Consistent message accumulation
// - Simplified debugging (one path instead of 4)
//
// See: docs/SESSION_CENTRIC_REFACTOR_PLAN.md

import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import type {
  AgentState,
  RealtimeEvent,
  SessionTreeNode,
  SessionStatus,
  ActivityBlock,
  ReasoningBlock,
  ToolBlock,
  ContentBlock,
  ErrorBlock,
  OverlayType,
} from '../types';
import type { TimelineItem, TranscriptItem, ToolItem } from '../types/timeline';
import type { ToastItem } from '../components/overlays/Toast';
import type { PromptInfo } from '../lib/prompts-api';
import * as promptsApi from '../lib/prompts-api';
import * as sessionsApi from '../lib/sessions-api';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Session types in the unified model */
export type SessionType = 'voice' | 'subagent' | 'terminal';

/** Re-export for convenience */
export type { SessionStatus, AgentState, ActivityBlock, ReasoningBlock, ToolBlock, ContentBlock, ErrorBlock };

/** Message role in AI SDK format */
export type MessageRole = 'user' | 'assistant' | 'system';

/** Message part types following AI SDK format */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool-result'; toolName: string; toolCallId: string; result: unknown }
  | { type: 'reasoning'; text: string };

/** Message in AI SDK format */
export interface Message {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: number;
}

/** Session state in the unified model */
export interface SessionState {
  id: string;
  type: SessionType;
  status: SessionStatus;
  parentId: string | null;
  agentName?: string;
  goal?: string;
  profile?: string;
  messages: Message[];
  children: string[];
}

/** AI SDK stream event types */
export type AISDKStreamEvent =
  | { type: 'text-delta'; textDelta: string; itemId?: string }
  | { type: 'user-transcript'; text: string; itemId?: string } // Custom extension for voice user messages
  // Placeholders for message ordering (custom extension for voice sessions)
  | { type: 'user-placeholder'; itemId: string }
  | { type: 'assistant-placeholder'; itemId: string; previousItemId?: string }
  | { type: 'tool-call'; toolName: string; toolCallId: string; input: unknown }
  | { type: 'tool-result'; toolName: string; toolCallId: string; output: unknown }
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-end'; text: string; durationMs?: number }
  | { type: 'start' }
  | { type: 'start-step' }
  | { type: 'finish-step'; finishReason?: string; usage?: Record<string, number> }
  | { type: 'finish'; finishReason: string }
  | { type: 'error'; error: string }
  | { type: 'process-status'; processName: string; sessionId: string; status: 'completed' | 'error'; summary?: string };

/** Re-export timeline types for message-handler compatibility */
export type { TimelineItem, TranscriptItem, ToolItem };
export type { SessionTreeNode, OverlayType };
export type { ToastItem };

// ═══════════════════════════════════════════════════════════════════════════
// Store Interface
// ═══════════════════════════════════════════════════════════════════════════

interface UnifiedSessionsStore {
  // ─────────────────────────────────────────────────────────────────────────
  // Connection State
  // ─────────────────────────────────────────────────────────────────────────
  clientId: string | null;
  isMaster: boolean;
  wsError: string | null;

  // ─────────────────────────────────────────────────────────────────────────
  // Service State (Soft Power)
  // ─────────────────────────────────────────────────────────────────────────
  serviceActive: boolean;
  audioMode: 'web' | 'local';

  // ─────────────────────────────────────────────────────────────────────────
  // Voice State (for ChatStage compatibility)
  // ─────────────────────────────────────────────────────────────────────────
  voiceState: AgentState;
  voiceProfile: string | null;
  voiceActive: boolean;
  voiceTimeline: TimelineItem[];
  currentTool: { name: string; args?: Record<string, unknown> } | null;

  // ─────────────────────────────────────────────────────────────────────────
  // Session Tree (from backend)
  // ─────────────────────────────────────────────────────────────────────────
  sessionTree: SessionTreeNode | null;
  allTrees: Map<string, SessionTreeNode>;
  focusedSessionId: string | null;
  backgroundTreeIds: string[];
  focusTimeout: ReturnType<typeof setTimeout> | null;

  // ─────────────────────────────────────────────────────────────────────────
  // Sessions (by ID for O(1) lookup)
  // ─────────────────────────────────────────────────────────────────────────
  sessions: Map<string, SessionState>;
  loadingSessionIds: Set<string>; // Sessions currently loading history

  // ─────────────────────────────────────────────────────────────────────────
  // Subagent Activities
  // ─────────────────────────────────────────────────────────────────────────
  activitiesBySession: Record<string, ActivityBlock[]>;
  activeOrchestratorId: string | null;
  subagentActive: boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // Events Log
  // ─────────────────────────────────────────────────────────────────────────
  events: RealtimeEvent[];

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay State
  // ─────────────────────────────────────────────────────────────────────────
  activeOverlay: OverlayType;

  // ─────────────────────────────────────────────────────────────────────────
  // View State (Prompts vs Sessions)
  // ─────────────────────────────────────────────────────────────────────────
  activeView: 'sessions' | 'prompts';

  // ─────────────────────────────────────────────────────────────────────────
  // Toast Notifications
  // ─────────────────────────────────────────────────────────────────────────
  toasts: ToastItem[];

  // ─────────────────────────────────────────────────────────────────────────
  // Prompts State
  // ─────────────────────────────────────────────────────────────────────────
  prompts: PromptInfo[];
  selectedPromptId: string | null;
  selectedVersion: string | null;
  promptContent: string;
  promptVersions: string[];
  promptsLoading: boolean;
  promptsError: string | null;
  promptDirty: boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // Connection Actions
  // ─────────────────────────────────────────────────────────────────────────
  setClientIdentity: (clientId: string | null, isMaster: boolean, serviceActive?: boolean, audioMode?: 'web' | 'local') => void;
  setIsMaster: (isMaster: boolean) => void;
  setWsError: (error: string | null) => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Service State Actions
  // ─────────────────────────────────────────────────────────────────────────
  setServiceState: (active: boolean, mode: 'web' | 'local') => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Voice Actions
  // ─────────────────────────────────────────────────────────────────────────
  setVoiceState: (state: AgentState, profile?: string | null) => void;
  setVoiceActive: (active: boolean) => void;
  clearVoiceTimeline: () => void;
  addVoiceTimelineItem: (item: TimelineItem) => void;
  updateVoiceTimelineItem: (id: string, updates: Partial<TimelineItem>) => void;
  setCurrentTool: (tool: { name: string; args?: Record<string, unknown> } | null) => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Session Tree Actions
  // ─────────────────────────────────────────────────────────────────────────
  handleSessionTreeUpdate: (payload: { tree?: SessionTreeNode; trees?: SessionTreeNode[] }) => void;
  focusSession: (sessionId: string) => void;
  minimizeTree: () => void;
  restoreTree: (rootId: string) => void;
  clearFocusedSession: () => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Session Actions
  // ─────────────────────────────────────────────────────────────────────────
  upsertSession: (session: Partial<SessionState> & { id: string }) => void;
  removeSession: (id: string) => void;
  clearSessions: () => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Activity Actions
  // ─────────────────────────────────────────────────────────────────────────
  handleSubagentActivity: (
    agent: string,
    eventType: string,
    payload: unknown,
    timestamp: number,
    orchestratorId?: string
  ) => void;
  clearActivities: (orchestratorId?: string) => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Stream Chunk Handler (AI SDK Protocol)
  // ─────────────────────────────────────────────────────────────────────────
  handleStreamChunk: (sessionId: string, event: AISDKStreamEvent) => void;

  // ─────────────────────────────────────────────────────────────────────────
  // History Loading (Chat Persistence)
  // ─────────────────────────────────────────────────────────────────────────
  loadSessionHistory: (sessionId: string, sessionType?: SessionType) => Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Events & Overlay
  // ─────────────────────────────────────────────────────────────────────────
  addEvent: (type: string, payload: unknown) => void;
  clearEvents: () => void;
  setActiveOverlay: (overlay: OverlayType) => void;

  // ─────────────────────────────────────────────────────────────────────────
  // Toast Actions
  // ─────────────────────────────────────────────────────────────────────────
  addToast: (toast: ToastItem) => void;
  dismissToast: (id: string) => void;

  // ─────────────────────────────────────────────────────────────────────────
  // View & Prompts Actions
  // ─────────────────────────────────────────────────────────────────────────
  setActiveView: (view: 'sessions' | 'prompts') => void;
  loadPrompts: () => Promise<void>;
  selectPrompt: (id: string) => Promise<void>;
  selectVersion: (version: string) => Promise<void>;
  setPromptContent: (content: string) => void;
  savePromptVersion: () => Promise<void>;
  setPromptActiveVersion: (version: string) => Promise<void>;
  updatePromptMetadata: (id: string, metadata: PromptInfo['metadata']) => Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Reset
  // ─────────────────────────────────────────────────────────────────────────
  reset: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const GLOBAL_KEY = '__global__';

/** Find session by ID in tree */
function findSessionById(node: SessionTreeNode | null, id: string | null): SessionTreeNode | null {
  if (!node || !id) return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findSessionById(child, id);
    if (found) return found;
  }
  return null;
}

/** Get path from root to target session */
function getPathToSession(tree: SessionTreeNode | null, targetId: string | null): SessionTreeNode[] {
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
  return path;
}

/** Get children of target session */
function getChildrenOfSession(tree: SessionTreeNode | null, targetId: string | null): SessionTreeNode[] {
  if (!tree || !targetId) return [];
  const session = findSessionById(tree, targetId);
  return session?.children ?? [];
}

/** Flattened tree node with depth info for consistent rail display */
export interface FlattenedTreeNode {
  node: SessionTreeNode;
  depth: number;
}

/** Flatten tree into linear list with depth info (DFS pre-order) */
function flattenTree(node: SessionTreeNode | null, depth = 0): FlattenedTreeNode[] {
  if (!node) return [];
  const result: FlattenedTreeNode[] = [{ node, depth }];
  for (const child of node.children) {
    result.push(...flattenTree(child, depth + 1));
  }
  return result;
}

/** Find deepest running session in tree */
function findDeepestRunning(node: SessionTreeNode): SessionTreeNode | null {
  for (const child of node.children) {
    const found = findDeepestRunning(child);
    if (found) return found;
  }
  if (['pending', 'running', 'waiting_for_input'].includes(node.status)) {
    return node;
  }
  return null;
}

/** Get all IDs in a tree */
function getAllTreeIds(node: SessionTreeNode): Set<string> {
  const ids = new Set<string>([node.id]);
  node.children.forEach((child) => getAllTreeIds(child).forEach((id) => ids.add(id)));
  return ids;
}

function buildVoiceTimelineFromMessages(messages: Message[]): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'text') {
        timeline.push({
          id: generateId(),
          type: 'transcript',
          role: message.role as 'user' | 'assistant',
          content: part.text,
          timestamp: message.createdAt,
          pending: false,
        });
        continue;
      }

      if (part.type === 'tool-call') {
        const toolItem: ToolItem = {
          id: part.toolCallId,
          type: 'tool',
          name: part.toolName,
          args: part.args as Record<string, unknown>,
          status: 'running',
          timestamp: message.createdAt,
        };
        toolIndexByCallId.set(part.toolCallId, timeline.length);
        timeline.push(toolItem);
        continue;
      }

      if (part.type === 'tool-result') {
        const resultText =
          typeof part.result === 'string'
            ? part.result
            : JSON.stringify(part.result, null, 2);
        const existingIdx = toolIndexByCallId.get(part.toolCallId);

        if (existingIdx !== undefined) {
          const existing = timeline[existingIdx];
          if (existing?.type === 'tool') {
            timeline[existingIdx] = {
              ...existing,
              status: 'completed',
              result: resultText,
            };
          }
        } else {
          // Keep result visible even when persisted history misses the call event.
          const fallbackTool: ToolItem = {
            id: part.toolCallId,
            type: 'tool',
            name: part.toolName,
            args: {},
            status: 'completed',
            result: resultText,
            timestamp: message.createdAt,
          };
          toolIndexByCallId.set(part.toolCallId, timeline.length);
          timeline.push(fallbackTool);
        }
      }
    }
  }

  return timeline;
}

// ═══════════════════════════════════════════════════════════════════════════
// Store Implementation
// ═══════════════════════════════════════════════════════════════════════════

export const useUnifiedSessionsStore = create<UnifiedSessionsStore>((set, get) => ({
  // ─────────────────────────────────────────────────────────────────────────
  // Initial State
  // ─────────────────────────────────────────────────────────────────────────

  // Connection
  clientId: null,
  isMaster: false,
  wsError: null,

  // Service state (soft power)
  serviceActive: false,
  audioMode: 'web',

  // Voice
  voiceState: 'idle',
  voiceProfile: null,
  voiceActive: false,
  voiceTimeline: [],
  currentTool: null,

  // Session tree
  sessionTree: null,
  allTrees: new Map(),
  focusedSessionId: null,
  backgroundTreeIds: [],
  focusTimeout: null,

  // Sessions
  sessions: new Map(),
  loadingSessionIds: new Set(),

  // Activities
  activitiesBySession: {},
  activeOrchestratorId: null,
  subagentActive: false,

  // Events
  events: [],

  // Overlay
  activeOverlay: null,

  // View
  activeView: 'sessions',

  // Toasts
  toasts: [],

  // Prompts
  prompts: [],
  selectedPromptId: null,
  selectedVersion: null,
  promptContent: '',
  promptVersions: [],
  promptsLoading: false,
  promptsError: null,
  promptDirty: false,

  // ─────────────────────────────────────────────────────────────────────────
  // Connection Actions
  // ─────────────────────────────────────────────────────────────────────────

  setClientIdentity: (clientId, isMaster, serviceActive, audioMode) =>
    set({
      clientId,
      isMaster,
      ...(serviceActive !== undefined && { serviceActive }),
      ...(audioMode !== undefined && { audioMode }),
    }),
  setIsMaster: (isMaster) => set({ isMaster }),
  setWsError: (wsError) => set({ wsError }),

  // ─────────────────────────────────────────────────────────────────────────
  // Service State Actions
  // ─────────────────────────────────────────────────────────────────────────
  setServiceState: (serviceActive, audioMode) => set({ serviceActive, audioMode }),

  // ─────────────────────────────────────────────────────────────────────────
  // Voice Actions
  // ─────────────────────────────────────────────────────────────────────────

  setVoiceState: (state, profile) =>
    set((s) => ({
      voiceState: state,
      voiceProfile: profile !== undefined ? profile : s.voiceProfile,
    })),

  setVoiceActive: (active) => set({ voiceActive: active }),

  clearVoiceTimeline: () => set({ voiceTimeline: [], currentTool: null }),

  addVoiceTimelineItem: (item) =>
    set((s) => ({ voiceTimeline: [...s.voiceTimeline, item] })),

  updateVoiceTimelineItem: (id, updates) =>
    set((s) => ({
      voiceTimeline: s.voiceTimeline.map((item) =>
        item.id === id ? ({ ...item, ...updates } as TimelineItem) : item
      ),
    })),

  setCurrentTool: (tool) => set({ currentTool: tool }),

  // ─────────────────────────────────────────────────────────────────────────
  // Session Tree Actions
  // ─────────────────────────────────────────────────────────────────────────

  handleSessionTreeUpdate: (payload) => {
    const { tree, trees } = payload;

    // Check if URL has a session - if so, don't auto-focus (URL is source of truth)
    const urlHasSession = window.location.pathname.startsWith('/session/');

    if (trees) {
      // Batch update - initial load / reconnect
      const newAllTrees = new Map<string, SessionTreeNode>();
      for (const t of trees) {
        newAllTrees.set(t.id, t);
      }

      // First tree becomes the active sessionTree, rest go to background
      const firstTree = trees[0] ?? null;
      const backgroundIds = trees.slice(1).map((t) => t.id);

      // Only auto-focus if URL doesn't specify a session
      let focusId: string | null = null;
      if (!urlHasSession) {
        const deepest = firstTree ? findDeepestRunning(firstTree) : null;
        focusId = deepest?.id ?? firstTree?.id ?? null;
      }

      set({
        allTrees: newAllTrees,
        sessionTree: firstTree,
        ...(focusId !== null && { focusedSessionId: focusId }),
        backgroundTreeIds: backgroundIds,
      });
      return;
    }

    if (!tree) return;

    const current = get();

    // Detect new running sessions
    let newRunningId: string | null = null;
    if (current.sessionTree) {
      const oldIds = getAllTreeIds(current.sessionTree);
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
    } else if (!urlHasSession) {
      // Initial load without URL session - focus deepest running immediately
      const deepest = findDeepestRunning(tree);
      if (deepest && deepest.id !== tree.id) {
        set({ sessionTree: tree, focusedSessionId: deepest.id });
        return;
      }
    }

    // Validate existing focus - only clear if session no longer exists
    let focusedId = current.focusedSessionId;
    if (focusedId && !findSessionById(tree, focusedId)) {
      focusedId = null;
    }

    // Update tree
    const newAllTrees = new Map(current.allTrees);
    newAllTrees.set(tree.id, tree);
    set({ sessionTree: tree, allTrees: newAllTrees });

    // Handle auto-focus for NEW running sessions (user just started a session)
    // This should always focus regardless of URL - user explicitly started it
    if (newRunningId) {
      if (current.focusTimeout) clearTimeout(current.focusTimeout);
      const timeout = setTimeout(() => {
        const currentTree = get().sessionTree;
        const currentFocus = get().focusedSessionId;
        if (currentTree && findSessionById(currentTree, newRunningId)) {
          // Focus new session and update URL
          console.log(`[TreeUpdate] Auto-focusing new session ${newRunningId.slice(0, 8)}`);
          get().focusSession(newRunningId);
        }
        set({ focusTimeout: null });
      }, 500); // Reduced delay for better UX
      set({ focusTimeout: timeout });
    } else if (!focusedId && !current.focusTimeout && !urlHasSession) {
      // Only auto-focus deepest if no focus exists and URL doesn't specify one
      const deepest = findDeepestRunning(tree);
      set({ focusedSessionId: deepest?.id ?? null });
    }
  },

  focusSession: (sessionId) => {
    const { sessionTree, allTrees, backgroundTreeIds } = get();

    console.log(`[Focus] Focusing session ${sessionId.slice(0, 8)}`);

    // Helper to find session and trigger history load
    const focusAndLoadHistory = (node: SessionTreeNode | null) => {
      if (node) {
        console.log(`[Focus] Found node type=${node.type}, triggering history load`);
        // Trigger history loading in background (async, don't await)
        get().loadSessionHistory(sessionId, node.type as SessionType);
      }
    };

    // Check current tree first
    if (sessionTree) {
      const node = findSessionById(sessionTree, sessionId);
      if (node) {
        set({ focusedSessionId: sessionId });
        focusAndLoadHistory(node);
        return;
      }
    }

    // Search all trees
    for (const [rootId, tree] of allTrees) {
      const node = findSessionById(tree, sessionId);
      if (node) {
        let newBackgroundIds = [...backgroundTreeIds];
        if (sessionTree && !newBackgroundIds.includes(sessionTree.id)) {
          newBackgroundIds.push(sessionTree.id);
        }
        newBackgroundIds = newBackgroundIds.filter((id) => id !== rootId);
        set({
          sessionTree: tree,
          focusedSessionId: sessionId,
          backgroundTreeIds: newBackgroundIds,
        });
        focusAndLoadHistory(node);
        return;
      }
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
    const { backgroundTreeIds, allTrees } = get();
    const tree = allTrees.get(rootId);
    const deepestNode = tree ? findDeepestRunning(tree) : null;
    const focusedId = deepestNode?.id ?? null;
    set({
      backgroundTreeIds: backgroundTreeIds.filter((id) => id !== rootId),
      sessionTree: tree ?? null,
      focusedSessionId: focusedId,
    });
    // Load history for the focused session
    if (focusedId && deepestNode) {
      get().loadSessionHistory(focusedId, deepestNode.type as SessionType);
    }
  },

  clearFocusedSession: () => set({ focusedSessionId: null }),

  // ─────────────────────────────────────────────────────────────────────────
  // Session Actions
  // ─────────────────────────────────────────────────────────────────────────

  upsertSession: (session) => {
    set((s) => {
      const newSessions = new Map(s.sessions);
      const existing = newSessions.get(session.id);
      const updated: SessionState = existing
        ? { ...existing, ...session }
        : {
            id: session.id,
            type: session.type ?? 'subagent',
            status: session.status ?? 'running',
            parentId: session.parentId ?? null,
            agentName: session.agentName,
            goal: session.goal,
            profile: session.profile,
            messages: session.messages ?? [],
            children: session.children ?? [],
          };
      newSessions.set(session.id, updated);
      return { sessions: newSessions };
    });
  },

  removeSession: (id) => {
    set((s) => {
      const newSessions = new Map(s.sessions);
      newSessions.delete(id);
      return { sessions: newSessions };
    });
  },

  clearSessions: () => {
    const { focusTimeout } = get();
    if (focusTimeout) clearTimeout(focusTimeout);
    // Clear all session-related state but keep connection state
    set({
      // Keep: clientId, isMaster, wsError (connection state)
      // Clear session state:
      voiceState: 'idle',
      voiceProfile: null,
      voiceActive: false,
      voiceTimeline: [],
      currentTool: null,
      sessionTree: null,
      allTrees: new Map(),
      focusedSessionId: null,
      backgroundTreeIds: [],
      focusTimeout: null,
      sessions: new Map(),
      activitiesBySession: {},
      activeOrchestratorId: null,
      subagentActive: false,
      events: [],
      activeOverlay: null,
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Activity Actions
  // ─────────────────────────────────────────────────────────────────────────

  handleSubagentActivity: (agent, eventType, payload, timestamp, orchestratorId) => {
    const sessionKey = orchestratorId || GLOBAL_KEY;

    set((s) => {
      const activities = [...(s.activitiesBySession[sessionKey] || [])];

      switch (eventType) {
        case 'reasoning_start': {
          const block: ReasoningBlock = {
            id: generateId(),
            type: 'reasoning',
            agent,
            orchestratorId,
            timestamp,
            content: '',
            isComplete: false,
          };
          activities.push(block);
          return {
            activitiesBySession: { ...s.activitiesBySession, [sessionKey]: activities },
            subagentActive: true,
            activeOrchestratorId: orchestratorId ?? s.activeOrchestratorId,
          };
        }

        case 'reasoning_delta': {
          const lastReasoning = [...activities].reverse().find(
            (b) => b.type === 'reasoning' && !b.isComplete
          ) as ReasoningBlock | undefined;
          if (lastReasoning) {
            const idx = activities.findIndex((b) => b.id === lastReasoning.id);
            activities[idx] = {
              ...lastReasoning,
              content: lastReasoning.content + ((payload as { text?: string })?.text || ''),
            };
          }
          return { activitiesBySession: { ...s.activitiesBySession, [sessionKey]: activities } };
        }

        case 'reasoning_end': {
          const lastReasoning = [...activities].reverse().find(
            (b) => b.type === 'reasoning' && !b.isComplete
          ) as ReasoningBlock | undefined;
          if (lastReasoning) {
            const idx = activities.findIndex((b) => b.id === lastReasoning.id);
            const endPayload = payload as { text?: string; durationMs?: number };
            activities[idx] = {
              ...lastReasoning,
              content: endPayload?.text || lastReasoning.content,
              isComplete: true,
              durationMs: endPayload?.durationMs,
            };
          }
          return { activitiesBySession: { ...s.activitiesBySession, [sessionKey]: activities } };
        }

        case 'tool_call': {
          const toolPayload = payload as { toolName: string; toolCallId: string; args: Record<string, unknown> };
          const block: ToolBlock = {
            id: generateId(),
            type: 'tool',
            agent,
            orchestratorId,
            timestamp,
            toolName: toolPayload.toolName,
            toolCallId: toolPayload.toolCallId,
            args: toolPayload.args || {},
            isComplete: false,
          };
          activities.push(block);
          return { activitiesBySession: { ...s.activitiesBySession, [sessionKey]: activities } };
        }

        case 'tool_result': {
          const resultPayload = payload as { toolCallId: string; result: string };
          const toolBlock = [...activities].reverse().find(
            (b) => b.type === 'tool' && (b as ToolBlock).toolCallId === resultPayload.toolCallId
          ) as ToolBlock | undefined;
          if (toolBlock) {
            const idx = activities.findIndex((b) => b.id === toolBlock.id);
            activities[idx] = {
              ...toolBlock,
              result: resultPayload.result,
              isComplete: true,
            };
          }
          return { activitiesBySession: { ...s.activitiesBySession, [sessionKey]: activities } };
        }

        case 'response': {
          const responsePayload = payload as { text: string };
          const block: ContentBlock = {
            id: generateId(),
            type: 'content',
            agent,
            orchestratorId,
            timestamp,
            text: responsePayload.text,
          };
          activities.push(block);
          return { activitiesBySession: { ...s.activitiesBySession, [sessionKey]: activities } };
        }

        case 'error': {
          const errorPayload = payload as { message: string };
          const block: ErrorBlock = {
            id: generateId(),
            type: 'error',
            agent,
            orchestratorId,
            timestamp,
            message: errorPayload.message,
          };
          activities.push(block);
          return { activitiesBySession: { ...s.activitiesBySession, [sessionKey]: activities } };
        }

        case 'complete':
          return { subagentActive: false };

        default:
          return {};
      }
    });
  },

  clearActivities: (orchestratorId) => {
    if (orchestratorId) {
      set((s) => {
        const newActivities = { ...s.activitiesBySession };
        delete newActivities[orchestratorId];
        return { activitiesBySession: newActivities };
      });
    } else {
      set({ activitiesBySession: {}, subagentActive: false, activeOrchestratorId: null });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Stream Chunk Handler (AI SDK Protocol)
  // ─────────────────────────────────────────────────────────────────────────

  handleStreamChunk: (sessionId, event) => {
    set((s) => {
      const newSessions = new Map(s.sessions);
      let session = newSessions.get(sessionId);

      // Create session if doesn't exist
      if (!session) {
        session = {
          id: sessionId,
          type: 'subagent',
          status: 'running',
          parentId: null,
          messages: [],
          children: [],
        };
        newSessions.set(sessionId, session);
      }

      const messages = [...session.messages];
      const lastMessage = messages[messages.length - 1];
      const isAssistantMessage = lastMessage?.role === 'assistant';

      switch (event.type) {
        case 'text-delta': {
          if (isAssistantMessage) {
            // Append to existing message
            const lastPart = lastMessage.parts[lastMessage.parts.length - 1];
            if (lastPart?.type === 'text') {
              lastMessage.parts[lastMessage.parts.length - 1] = {
                type: 'text',
                text: lastPart.text + event.textDelta,
              };
            } else {
              lastMessage.parts.push({ type: 'text', text: event.textDelta });
            }
            messages[messages.length - 1] = { ...lastMessage };
          } else {
            // Create new assistant message
            messages.push({
              id: generateId(),
              role: 'assistant',
              parts: [{ type: 'text', text: event.textDelta }],
              createdAt: Date.now(),
            });
          }
          break;
        }

        case 'user-transcript': {
          // User transcripts always create a new user message
          messages.push({
            id: generateId(),
            role: 'user',
            parts: [{ type: 'text', text: event.text }],
            createdAt: Date.now(),
          });
          break;
        }

        case 'tool-call': {
          const toolPart: MessagePart = {
            type: 'tool-call',
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            args: event.input,
          };
          if (isAssistantMessage) {
            lastMessage.parts.push(toolPart);
            messages[messages.length - 1] = { ...lastMessage };
          } else {
            messages.push({
              id: generateId(),
              role: 'assistant',
              parts: [toolPart],
              createdAt: Date.now(),
            });
          }
          break;
        }

        case 'tool-result': {
          const resultPart: MessagePart = {
            type: 'tool-result',
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            result: event.output,
          };
          if (isAssistantMessage) {
            lastMessage.parts.push(resultPart);
            messages[messages.length - 1] = { ...lastMessage };
          } else {
            messages.push({
              id: generateId(),
              role: 'assistant',
              parts: [resultPart],
              createdAt: Date.now(),
            });
          }
          break;
        }

        case 'reasoning-delta': {
          const reasoningPart: MessagePart = { type: 'reasoning', text: event.text };
          if (isAssistantMessage) {
            const lastPart = lastMessage.parts[lastMessage.parts.length - 1];
            if (lastPart?.type === 'reasoning') {
              lastMessage.parts[lastMessage.parts.length - 1] = {
                type: 'reasoning',
                text: lastPart.text + event.text,
              };
            } else {
              lastMessage.parts.push(reasoningPart);
            }
            messages[messages.length - 1] = { ...lastMessage };
          } else {
            messages.push({
              id: generateId(),
              role: 'assistant',
              parts: [reasoningPart],
              createdAt: Date.now(),
            });
          }
          break;
        }

        case 'finish':
          session = { ...session, status: 'finished' };
          break;

        case 'error':
          session = { ...session, status: 'error' };
          break;

        // Ignore lifecycle events
        case 'start':
        case 'start-step':
        case 'finish-step':
        case 'reasoning-start':
        case 'reasoning-end':
        case 'process-status':
          break;
      }

      newSessions.set(sessionId, { ...session, messages });
      return { sessions: newSessions };
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // History Loading (Chat Persistence)
  // ─────────────────────────────────────────────────────────────────────────

  loadSessionHistory: async (sessionId, sessionType) => {
    const { loadingSessionIds, sessions } = get();

    console.log(`[History] Loading history for ${sessionId.slice(0, 8)}, type=${sessionType}`);

    // Skip if already loading
    if (loadingSessionIds.has(sessionId)) {
      console.log(`[History] Already loading ${sessionId.slice(0, 8)}, skipping`);
      return;
    }

    // Check if session already has messages (cached from previous load)
    const existing = sessions.get(sessionId);
    if (existing?.messages && existing.messages.length > 0) {
      console.log(`[History] Session ${sessionId.slice(0, 8)} already has ${existing.messages.length} messages (cached)`);

      // For voice sessions, still need to repopulate voiceTimeline from cached messages
      if (sessionType === 'voice') {
        console.log(`[History] Repopulating voiceTimeline from cached messages`);
        set({ voiceTimeline: buildVoiceTimelineFromMessages(existing.messages) });
      }
      return;
    }

    // Mark as loading
    set((s) => ({
      loadingSessionIds: new Set([...s.loadingSessionIds, sessionId]),
    }));

    try {
      console.log(`[History] Fetching messages from API for ${sessionId.slice(0, 8)}`);
      const rawMessages = await sessionsApi.fetchSessionMessages(sessionId);
      console.log(`[History] Got ${rawMessages.length} messages from API`);

      // Replay events through handleStreamChunk to reconstruct messages
      for (const msg of rawMessages) {
        const event = JSON.parse(msg.payload);
        get().handleStreamChunk(sessionId, event);
      }

      // For voice sessions, also populate voiceTimeline
      if (sessionType === 'voice') {
        set((s) => {
          const session = s.sessions.get(sessionId);
          return { voiceTimeline: buildVoiceTimelineFromMessages(session?.messages ?? []) };
        });
      }

      // Check what we actually got
      const finalSession = get().sessions.get(sessionId);
      console.log(`[History] After replay: session has ${finalSession?.messages?.length ?? 0} messages`);
      if (sessionType === 'voice') {
        console.log(`[History] voiceTimeline has ${get().voiceTimeline.length} items`);
      }
    } catch (error) {
      console.error(`[History] Failed to load history for session ${sessionId}:`, error);
    } finally {
      // Remove from loading set
      set((s) => {
        const newLoading = new Set(s.loadingSessionIds);
        newLoading.delete(sessionId);
        return { loadingSessionIds: newLoading };
      });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Events & Overlay
  // ─────────────────────────────────────────────────────────────────────────

  addEvent: (type, payload) => {
    set((s) => ({
      events: [
        ...s.events.slice(-99), // Keep last 100 events
        { id: generateId(), type, timestamp: Date.now(), data: payload },
      ],
    }));
  },

  clearEvents: () => {
    set({ events: [] });
  },

  setActiveOverlay: (overlay) => set({ activeOverlay: overlay }),

  // ─────────────────────────────────────────────────────────────────────────
  // Toast Actions
  // ─────────────────────────────────────────────────────────────────────────

  addToast: (toast) => set((s) => ({ toasts: [...s.toasts, toast] })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // ─────────────────────────────────────────────────────────────────────────
  // View & Prompts Actions
  // ─────────────────────────────────────────────────────────────────────────

  setActiveView: (view) => set({ activeView: view }),

  loadPrompts: async () => {
    set({ promptsLoading: true, promptsError: null });
    try {
      const prompts = await promptsApi.fetchPrompts();
      set({ prompts, promptsLoading: false });
    } catch (error) {
      set({
        promptsError: error instanceof Error ? error.message : 'Failed to load prompts',
        promptsLoading: false,
      });
    }
  },

  selectPrompt: async (id) => {
    set({ promptsLoading: true, promptsError: null });
    try {
      const data = await promptsApi.fetchPrompt(id);
      set({
        selectedPromptId: id,
        selectedVersion: data.activeVersion,
        promptContent: data.content ?? '',
        promptVersions: data.versions,
        promptDirty: false,
        promptsLoading: false,
      });
    } catch (error) {
      set({
        promptsError: error instanceof Error ? error.message : 'Failed to load prompt',
        promptsLoading: false,
      });
    }
  },

  selectVersion: async (version) => {
    const { selectedPromptId } = get();
    if (!selectedPromptId) return;

    set({ promptsLoading: true, promptsError: null });
    try {
      const data = await promptsApi.fetchVersion(selectedPromptId, version);
      set({
        selectedVersion: version,
        promptContent: data.content,
        promptDirty: false,
        promptsLoading: false,
      });
    } catch (error) {
      set({
        promptsError: error instanceof Error ? error.message : 'Failed to load version',
        promptsLoading: false,
      });
    }
  },

  setPromptContent: (content) => set({ promptContent: content, promptDirty: true }),

  savePromptVersion: async () => {
    const { selectedPromptId, promptContent } = get();
    if (!selectedPromptId) return;

    set({ promptsLoading: true, promptsError: null });
    try {
      const result = await promptsApi.saveNewVersion(selectedPromptId, promptContent);
      // Reload prompt to get updated versions list
      const data = await promptsApi.fetchPrompt(selectedPromptId);
      set({
        selectedVersion: result.version,
        promptVersions: data.versions,
        promptDirty: false,
        promptsLoading: false,
      });
    } catch (error) {
      set({
        promptsError: error instanceof Error ? error.message : 'Failed to save version',
        promptsLoading: false,
      });
    }
  },

  setPromptActiveVersion: async (version) => {
    const { selectedPromptId, prompts } = get();
    if (!selectedPromptId) return;

    set({ promptsLoading: true, promptsError: null });
    try {
      await promptsApi.setActiveVersion(selectedPromptId, version);
      // Update the prompts list with new active version
      const updatedPrompts = prompts.map((p) =>
        p.id === selectedPromptId ? { ...p, activeVersion: version } : p
      );
      set({ prompts: updatedPrompts, promptsLoading: false });
    } catch (error) {
      set({
        promptsError: error instanceof Error ? error.message : 'Failed to set active version',
        promptsLoading: false,
      });
    }
  },

  updatePromptMetadata: async (id, metadata) => {
    const { prompts } = get();
    set({ promptsLoading: true, promptsError: null });
    try {
      await promptsApi.updateMetadata(id, metadata);
      const updatedPrompts = prompts.map((p) =>
        p.id === id ? { ...p, metadata: { ...p.metadata, ...metadata } } : p
      );
      set({ prompts: updatedPrompts, promptsLoading: false });
    } catch (error) {
      set({
        promptsError: error instanceof Error ? error.message : 'Failed to update metadata',
        promptsLoading: false,
      });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Reset
  // ─────────────────────────────────────────────────────────────────────────

  reset: () => {
    const { focusTimeout } = get();
    if (focusTimeout) clearTimeout(focusTimeout);
    set({
      clientId: null,
      isMaster: false,
      wsError: null,
      voiceState: 'idle',
      voiceProfile: null,
      voiceActive: false,
      voiceTimeline: [],
      currentTool: null,
      sessionTree: null,
      allTrees: new Map(),
      focusedSessionId: null,
      backgroundTreeIds: [],
      focusTimeout: null,
      sessions: new Map(),
      activitiesBySession: {},
      activeOrchestratorId: null,
      subagentActive: false,
      events: [],
      activeOverlay: null,
      toasts: [],
      activeView: 'sessions',
      prompts: [],
      selectedPromptId: null,
      selectedVersion: null,
      promptContent: '',
      promptVersions: [],
      promptsLoading: false,
      promptsError: null,
      promptDirty: false,
    });
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

/** Get the focused session from the tree */
export function useFocusedSession(): SessionTreeNode | null {
  return useUnifiedSessionsStore((s) => findSessionById(s.sessionTree, s.focusedSessionId));
}

/** Get path from root to focused session */
export function useFocusPath(): SessionTreeNode[] {
  return useUnifiedSessionsStore(
    useShallow((s) => getPathToSession(s.sessionTree, s.focusedSessionId))
  );
}

/** Get children of focused session */
export function useFocusedSessionChildren(): SessionTreeNode[] {
  return useUnifiedSessionsStore(
    useShallow((s) => {
      const { sessionTree, focusedSessionId } = s;
      if (focusedSessionId === null && sessionTree) {
        return [sessionTree];
      }
      return getChildrenOfSession(sessionTree, focusedSessionId);
    })
  );
}

/** Get session tree for flattening (use useMemo in component to flatten) */
export function useSessionTree(): SessionTreeNode | null {
  return useUnifiedSessionsStore((s) => s.sessionTree);
}

/** Get flattened session tree - memoized to avoid infinite loops */
export function useFlattenedSessionTree(): FlattenedTreeNode[] {
  const sessionTree = useUnifiedSessionsStore((s) => s.sessionTree);
  return useMemo(() => flattenTree(sessionTree), [sessionTree]);
}

/** Flatten tree helper - export for use with useMemo in components */
export { flattenTree };

/** Get activities for a specific session */
export function useSessionActivities(sessionId: string | null): ActivityBlock[] {
  return useUnifiedSessionsStore(
    useShallow((s) => (sessionId ? s.activitiesBySession[sessionId] ?? [] : []))
  );
}

/** Get all activities flattened and sorted */
export function useAllActivities(): ActivityBlock[] {
  return useUnifiedSessionsStore(
    useShallow((s) =>
      Object.values(s.activitiesBySession)
        .flat()
        .sort((a, b) => a.timestamp - b.timestamp)
    )
  );
}

/** Check if any session is active */
export function useHasActiveSession(): boolean {
  return useUnifiedSessionsStore((s) => {
    if (!s.sessionTree) return false;
    const checkRunning = (node: SessionTreeNode): boolean => {
      if (['pending', 'running', 'waiting_for_input'].includes(node.status)) return true;
      return node.children.some(checkRunning);
    };
    return checkRunning(s.sessionTree);
  });
}

/** Get voice timeline for ChatStage */
export function useVoiceTimeline(): TimelineItem[] {
  return useUnifiedSessionsStore(useShallow((s) => s.voiceTimeline));
}

/** Get connection state */
export function useConnectionState() {
  return useUnifiedSessionsStore(
    useShallow((s) => ({
      connected: s.clientId !== null,
      wsError: s.wsError,
      clientId: s.clientId,
      isMaster: s.isMaster,
    }))
  );
}

/** Get voice state */
export function useVoiceState() {
  return useUnifiedSessionsStore(
    useShallow((s) => ({
      voiceState: s.voiceState,
      voiceProfile: s.voiceProfile,
      voiceActive: s.voiceActive,
      currentTool: s.currentTool,
    }))
  );
}

/** Get service state (soft power) */
export function useServiceState() {
  return useUnifiedSessionsStore(
    useShallow((s) => ({
      serviceActive: s.serviceActive,
      audioMode: s.audioMode,
    }))
  );
}

/** Get active view */
export function useActiveView() {
  return useUnifiedSessionsStore((s) => s.activeView);
}

/** Get prompts state */
export function usePromptsState() {
  return useUnifiedSessionsStore(
    useShallow((s) => ({
      prompts: s.prompts,
      selectedPromptId: s.selectedPromptId,
      selectedVersion: s.selectedVersion,
      promptContent: s.promptContent,
      promptVersions: s.promptVersions,
      promptsLoading: s.promptsLoading,
      promptsError: s.promptsError,
      promptDirty: s.promptDirty,
    }))
  );
}

/** Get toast notifications */
export function useToasts() {
  return useUnifiedSessionsStore(useShallow((s) => s.toasts));
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Compatibility Selectors (for migration from deleted stores)
// ─────────────────────────────────────────────────────────────────────────────

/** Alias for useFocusPath (legacy name from stage.ts) */
export const useSessionPath = useFocusPath;

/** Get all subagent activities flattened (legacy from agent.ts) */
export function useSubagentActivities(): ActivityBlock[] {
  return useAllActivities();
}

/** Get sessions Map (legacy from sessions.ts) */
export function useSessions(): Map<string, SessionState> {
  return useUnifiedSessionsStore((s) => s.sessions);
}

/** Get events array (legacy from agent.ts) */
export function useEvents() {
  return useUnifiedSessionsStore((s) => s.events);
}

/** Get overlay state (legacy from stage.ts) */
export function useOverlayState() {
  return useUnifiedSessionsStore(
    useShallow((s) => ({
      activeOverlay: s.activeOverlay,
      setActiveOverlay: s.setActiveOverlay,
    }))
  );
}
