# Frontend Refactor Handoff - Phase 4

## Context

We've refactored the backend to use a unified session hierarchy. The frontend still uses the old `pushStage/popStage` pattern with race conditions. This document describes what needs to be done to complete the refactor.

## What Was Done (Backend - Complete)

### 1. Database Migration (Phase 1)
- Added columns to `cli_sessions`: `type`, `agent_name`, `model`, `conversation_history`, `finished_at`
- `type` can be `'orchestrator'` or `'terminal'`
- File: `pi-agent/src/db/schema.ts` (migration v3)

### 2. Session Repository (Phase 1)
- New methods: `createOrchestrator()`, `createTerminal()`, `findRunningOrchestrator()`, `getTree()`, `getActiveTrees()`, `cancelTree()`, `cleanup()`
- File: `pi-agent/src/db/repositories/cli-sessions.ts`

### 3. CLI Orchestrator Lifecycle (Phase 2)
- Orchestrator is stateful with `conversation_history`
- Finds existing running orchestrator OR creates new one
- Terminals are children of orchestrators
- File: `pi-agent/src/subagents/cli/index.ts`

### 4. WebSocket Events (Phase 3)
- New event: `session_tree_update` with full tree structure
- File: `pi-agent/src/api/websocket.ts`
- Functions: `wsBroadcast.sessionTreeUpdate(rootId)`, `wsBroadcast.allActiveTreesUpdate()`

## Session Hierarchy (New Architecture)

```
Voice Session (NOT in DB - fire-and-forget)
    │
    │ tool_call: developer_session
    ▼
Orchestrator (IN DB - stateful, conversation_history)
    │   type: 'orchestrator'
    │   agent_name: 'cli' | 'web_search' | 'deep_thinking'
    │
    │ tool_call: start_headless/interactive_session
    ▼
Terminal 1, Terminal 2, ... (IN DB - long-running)
    type: 'terminal'
    Can run for HOURS
```

## What Needs To Be Done (Frontend - Phase 4)

### Problem: Race Conditions

Current frontend has timing-based stage transitions that cause bugs:

```typescript
// agent.ts - PROBLEMATIC CODE:
case 'complete':
  setTimeout(() => popStage(), 2000);  // Race condition!

case 'cli_session_created':
  pushStage({ type: 'terminal', ... });  // Can conflict with above
```

### Solution: Event-Driven State

Frontend should ONLY render what backend tells it. No `pushStage/popStage` based on timing.

### Files To Modify

#### 1. `web/src/types/index.ts`

Add new types:

```typescript
// Session tree types (match backend)
export type SessionType = 'orchestrator' | 'terminal';
export type SessionStatus = 'pending' | 'running' | 'waiting_for_input' | 'finished' | 'error' | 'cancelled';
export type AgentName = 'cli' | 'web_search' | 'deep_thinking';

export interface SessionTreeNode {
  id: string;
  type: SessionType;
  status: SessionStatus;
  goal: string;
  agent_name: AgentName | null;
  created_at: string;
  children: SessionTreeNode[];
}

export interface SessionTreeUpdatePayload {
  rootId?: string;
  tree?: SessionTreeNode;
  trees?: SessionTreeNode[];  // For initial load (all active)
}
```

#### 2. `web/src/stores/stage.ts`

Replace current stack-based state with tree-based state:

**Current State (remove):**
```typescript
interface StageState {
  activeStage: StageItem;
  threadRail: StageItem[];
  backgroundTasks: StageItem[];
  pushStage: ...
  popStage: ...
}
```

**New State:**
```typescript
interface StageState {
  // Active session tree (from backend)
  sessionTree: SessionTreeNode | null;

  // Which session is currently focused in the UI
  focusedSessionId: string | null;

  // Background trees (minimized by user)
  backgroundTrees: SessionTreeNode[];

  // Actions
  setSessionTree: (tree: SessionTreeNode) => void;
  focusSession: (sessionId: string) => void;
  minimizeTree: () => void;
  restoreTree: (rootId: string) => void;
}
```

**Helper functions (keep existing, already in file):**
- `findDeepestRunning(node)` - finds deepest running session for auto-focus
- `findSessionById(node, id)` - finds session in tree

**ThreadRail derivation:**
```typescript
// Derive threadRail from tree + focusedSessionId
// Returns path from root to focused session
function getThreadRailPath(tree: SessionTreeNode, focusedId: string): SessionTreeNode[] {
  const path: SessionTreeNode[] = [];

  function traverse(node: SessionTreeNode): boolean {
    path.push(node);
    if (node.id === focusedId) return true;
    for (const child of node.children) {
      if (traverse(child)) return true;
    }
    path.pop();
    return false;
  }

  traverse(tree);
  return path;  // [root, child, grandchild, ...focused]
}
```

#### 3. `web/src/stores/agent.ts`

**Remove these handlers (causing race conditions):**
- `case 'cli_session_created':` - remove `pushStage()` call
- `case 'cli_session_update':` - remove `setTimeout(() => popStage())`
- In `handleSubagentActivity`:
  - `case 'reasoning_start':` - remove `pushStage()` call
  - `case 'complete':` - remove `setTimeout(() => popStage())`

**Add new handler:**
```typescript
case 'session_tree_update': {
  const { rootId, tree, trees } = payload as SessionTreeUpdatePayload;
  const stageStore = useStageStore.getState();

  if (tree) {
    // Single tree update
    stageStore.setSessionTree(tree);

    // Auto-focus deepest running session
    const deepest = findDeepestRunning(tree);
    if (deepest) {
      stageStore.focusSession(deepest.id);
    }
  } else if (trees) {
    // Initial load - multiple trees
    // Show first active tree, put rest in background
    if (trees.length > 0) {
      stageStore.setSessionTree(trees[0]);
      // Handle background trees...
    }
  }
  break;
}
```

#### 4. `web/src/components/rails/ThreadRail.tsx`

**Current (remove):**
```typescript
const threadRail = useStageStore((s) => s.threadRail);
const popStage = useStageStore((s) => s.popStage);

// Click handler pops stages
const handleCardClick = (index: number) => {
  for (let i = 0; i <= index; i++) {
    popStage();
  }
};
```

**New:**
```typescript
const sessionTree = useStageStore((s) => s.sessionTree);
const focusedSessionId = useStageStore((s) => s.focusedSessionId);
const focusSession = useStageStore((s) => s.focusSession);

// Derive path from tree
const threadPath = useMemo(() => {
  if (!sessionTree || !focusedSessionId) return [];
  return getThreadRailPath(sessionTree, focusedSessionId);
}, [sessionTree, focusedSessionId]);

// Click focuses that session (no popping!)
const handleCardClick = (session: SessionTreeNode) => {
  focusSession(session.id);
};

// Render: Root at TOP, focused at BOTTOM
return (
  <div className="thread-rail">
    {threadPath.map((session, index) => (
      <ThreadCard
        key={session.id}
        session={session}
        index={index}
        isFocused={session.id === focusedSessionId}
        onClick={() => handleCardClick(session)}
      />
    ))}
  </div>
);
```

**ThreadCard props change:**
```typescript
// Old: stage: StageItem
// New: session: SessionTreeNode

interface ThreadCardProps {
  session: SessionTreeNode;
  index: number;
  isFocused: boolean;
  onClick: () => void;
}
```

#### 5. `web/src/components/layout/StageOrchestrator.tsx`

**Current `ActiveStage` (modify):**
```typescript
function ActiveStage({ stage }: { stage: StageItem }) {
  switch (stage.type) {
    case 'chat': return <ChatStage />;
    case 'terminal': return <TerminalStage />;
    case 'subagent': return <SubagentStage />;
  }
}
```

**New approach:**
```typescript
function ActiveStage() {
  const sessionTree = useStageStore((s) => s.sessionTree);
  const focusedSessionId = useStageStore((s) => s.focusedSessionId);

  // No tree = show idle/chat view
  if (!sessionTree) {
    return <ChatStage />;
  }

  // Find focused session
  const focused = findSessionById(sessionTree, focusedSessionId);
  if (!focused) {
    return <ChatStage />;
  }

  // Render based on session type
  switch (focused.type) {
    case 'orchestrator':
      return <SubagentStage session={focused} />;
    case 'terminal':
      return <TerminalStage sessionId={focused.id} />;
    default:
      return <ChatStage />;
  }
}
```

#### 6. `web/src/components/rails/BackgroundRail.tsx`

Update to show `backgroundTrees` instead of `backgroundTasks`.

Each background tree should show:
- Root orchestrator name/goal
- Count of running terminals
- Click to restore

### ThreadRail Order

**IMPORTANT:** Root at TOP, deepest child (focused) at BOTTOM

```
┌─────────────────────┐
│ 🤖 CLI Orchestrator │ ← Root (index 0, top)
│ (running)           │
├─────────────────────┤
│ 🖥 Terminal 1       │ ← Child
│ (running)           │
├─────────────────────┤
│ 🖥 Terminal 2       │ ← Focused (bottom)
│ (running)           │
└─────────────────────┘
```

### No Voice Session in UI

Voice sessions are fire-and-forget. The UI should NOT show a "Voice" card in the ThreadRail. The root of the tree is always an Orchestrator.

### Cleanup Rules (Backend handles, Frontend just renders)

- Thread visible while ANY node is `running`
- When all nodes `finished` → thread moves to background/history
- Frontend just renders what `session_tree_update` says

### Testing Checklist

1. [ ] Start voice command "Computer, review Kireon"
   - ThreadRail shows: Orchestrator → Terminal
   - MainStage shows terminal output

2. [ ] Click on Orchestrator in ThreadRail
   - MainStage switches to SubagentStage (orchestrator view)
   - ThreadRail highlights Orchestrator

3. [ ] Start second terminal "Computer, also fix auth bug"
   - Same Orchestrator (conversation history preserved)
   - ThreadRail shows: Orchestrator → Terminal 1 → Terminal 2

4. [ ] Frontend reload
   - Fetch active trees from API
   - Restore ThreadRail state

5. [ ] Cancel orchestrator
   - Warning dialog if terminals running
   - Cascading cancel

## API Endpoints Needed

```typescript
// Get all active session trees
GET /api/sessions/active
Response: { trees: SessionTreeNode[] }

// Cancel a session (with cascade warning)
POST /api/sessions/:id/cancel
Body: { force: boolean }
Response: { success: true } | { warning: string, children: [...] }
```

## Files Summary

| File | Action |
|------|--------|
| `web/src/types/index.ts` | Add `SessionTreeNode`, `SessionTreeUpdatePayload` |
| `web/src/stores/stage.ts` | Replace stack with tree state |
| `web/src/stores/agent.ts` | Remove setTimeout popStage, add session_tree_update handler |
| `web/src/components/rails/ThreadRail.tsx` | Render from tree path, not stack |
| `web/src/components/layout/StageOrchestrator.tsx` | Render based on focused session type |
| `web/src/components/rails/BackgroundRail.tsx` | Show background trees |

## Key Principle

**Frontend is DUMB. Backend is SMART.**

- Backend decides session hierarchy
- Backend decides what's active
- Backend broadcasts `session_tree_update`
- Frontend just renders the tree
- No `setTimeout`, no `pushStage/popStage` timing logic
