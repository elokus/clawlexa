# Session Hierarchy Architecture Plan

## Overview

This document defines the architecture for a unified session management system that provides:
- Persistent session hierarchy (survives frontend reload)
- Clear parent-child relationships visible in the UI
- Event-based state transitions (no timing heuristics)
- Cascading termination with user warnings

## Key Design Decisions

1. **Voice Sessions are NOT persisted** - Fire-and-forget, no conversation history
2. **Orchestrators are stateful** - Conversation history in DB, can be resumed
3. **Terminals are long-running** - Can run for hours, managed by orchestrators
4. **Thread visibility** - Active while ANY node is running
5. **Auto-cleanup** - 24h for leafs, 10 days for parents with children

## Session Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Voice Session (NOT IN DB)                                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Fire-and-forget. No conversation history. Each wake word = fresh start.   │
│  Calls existing orchestrators or creates new ones via tool calls.           │
│  Examples: Jarvis profile, Marvin profile                                   │
│                                                                             │
│  NOT PERSISTED - only exists during active voice conversation               │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        │ tool_call: developer_session / web_search / deep_thinking
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  type='orchestrator'                                                        │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Stateful LLM agent. Conversation history persisted in DB.                  │
│  Can be resumed by subsequent voice commands.                               │
│  Only CLI orchestrator can spawn terminal sessions.                         │
│                                                                             │
│  agent_name: 'cli' | 'web_search' | 'deep_thinking'                         │
│  Auto-cleanup: 24h (no children) / 10 days (with children)                  │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        │ Only CLI orchestrator (tool_call: start_headless/interactive_session)
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  type='terminal'                                                            │
│  ─────────────────────────────────────────────────────────────────────────  │
│  PTY session on Mac Daemon running Claude Code CLI. Can run for HOURS.      │
│  Leaf node - cannot spawn children. Never finishes on its own.              │
│  Only terminated by: user "Stop", /exit, kill signal, cascading cancel      │
│                                                                             │
│  Auto-cleanup: 10 days after finished                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Example Flow

```
T0: User: "Computer, review Kireon Backend"
    → Voice (ephemeral, NOT in DB)
    → Tool: developer_session("review Kireon")

T1: → New Orchestrator created (DB: id=orch-1, agent_name='cli', history=[])
    → Orchestrator starts Terminal (DB: id=term-1, parent_id=orch-1)
    → Voice responds: "Starting the review"
    → Voice ends (not persisted)

    ThreadRail shows:
    ┌─────────────────────┐
    │ 🤖 CLI Orchestrator │ ← Thread Root (top)
    │ (running)           │
    ├─────────────────────┤
    │ 🖥 Kireon Review    │ ← Leaf (bottom, focused)
    │ (running)           │
    └─────────────────────┘

T2: User: "Computer, how's the review going?"
    → NEW Voice (no memory!)
    → Tool: developer_session("status Kireon")
    → SAME Orchestrator called (has history!)
    → Orchestrator knows what "Kireon Review" means
    → Voice responds with status

T3: User: "Computer, also fix the auth bug"
    → NEW Voice
    → Tool: developer_session("fix auth bug in Kireon")
    → SAME Orchestrator
    → Orchestrator starts SECOND Terminal

    ThreadRail shows:
    ┌─────────────────────┐
    │ 🤖 CLI Orchestrator │
    │ (running)           │
    ├─────────────────────┤
    │ 🖥 Kireon Review    │
    │ (running)           │
    ├─────────────────────┤
    │ 🖥 Auth Bug Fix     │ ← New
    │ (running)           │
    └─────────────────────┘
```

## Database Schema

### Migration: `cli_sessions` → `sessions`

```sql
-- Rename and extend the table
ALTER TABLE cli_sessions RENAME TO sessions;

-- Add type column (existing rows default to 'terminal')
ALTER TABLE sessions ADD COLUMN type TEXT DEFAULT 'terminal';

-- Add metadata for orchestrators
ALTER TABLE sessions ADD COLUMN agent_name TEXT;           -- 'cli', 'web_search', 'deep_thinking'
ALTER TABLE sessions ADD COLUMN model TEXT;                -- LLM model used
ALTER TABLE sessions ADD COLUMN conversation_history TEXT; -- JSON array of messages

-- Index for tree queries
CREATE INDEX idx_sessions_parent ON sessions(parent_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_type ON sessions(type);
```

### Final Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                -- 'orchestrator' | 'terminal'
  status TEXT DEFAULT 'running',     -- 'running' | 'finished' | 'cancelled' | 'error'
  goal TEXT,                         -- Human-readable description

  -- Hierarchy (orchestrator → terminals)
  parent_id TEXT REFERENCES sessions(id),

  -- Orchestrator-specific
  agent_name TEXT,                   -- 'cli', 'web_search', 'deep_thinking'
  model TEXT,                        -- LLM model: 'grok-code-fast-1', 'grok-4.1-fast:online'
  conversation_history TEXT,         -- JSON array of messages for stateful agents

  -- Terminal-specific
  mac_session_id TEXT,               -- tmux session name on Mac daemon

  -- Timestamps
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

-- Indexes
CREATE INDEX idx_sessions_parent ON sessions(parent_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_type ON sessions(type);
```

### Auto-Cleanup Query (scheduled hourly)

```sql
-- 1. Leaf orchestrators without children: cleanup after 24h
DELETE FROM sessions
WHERE type = 'orchestrator'
  AND status IN ('finished', 'cancelled')
  AND id NOT IN (SELECT DISTINCT parent_id FROM sessions WHERE parent_id IS NOT NULL)
  AND finished_at < datetime('now', '-24 hours');

-- 2. Orchestrators with children + all terminals: cleanup after 10 days
DELETE FROM sessions
WHERE status IN ('finished', 'cancelled')
  AND finished_at < datetime('now', '-10 days');
```
```

## Session Lifecycle

### 1. Voice Session (NOT persisted)

**Trigger:** Wake word detected or manual activation

Voice sessions are ephemeral - they exist only in memory during the conversation.
No database entry is created. Each wake word starts fresh with no history.

```typescript
// pi-agent/src/realtime/session.ts
class VoiceSession {
  async connect() {
    // NO database entry - voice is fire-and-forget
    this.sessionId = randomUUID();  // Only for tool context passing

    // Connect to OpenAI
    await this.session.connect();

    // Broadcast state change (not tree - voice isn't in tree)
    broadcastStateChange('listening');
  }
}
```

### 2. Orchestrator Session Creation

**Trigger:** Voice agent calls a tool that spawns an LLM (developer_session, web_search, etc.)

Orchestrators are stateful and persisted. They can be resumed by subsequent voice commands.

```typescript
// pi-agent/src/subagents/cli/index.ts
export async function handleDeveloperRequest(
  request: string,
  history: RealtimeItem[]
) {
  // Check if there's an existing running CLI orchestrator
  let orchestrator = await sessionsRepo.findRunningByAgentName('cli');

  if (!orchestrator) {
    // Create new orchestrator session
    orchestrator = await sessionsRepo.create({
      id: randomUUID(),
      type: 'orchestrator',
      status: 'running',
      goal: request.substring(0, 100),
      agent_name: 'cli',
      model: 'x-ai/grok-code-fast-1',
      conversation_history: JSON.stringify([]),
    });
  }

  // Load conversation history for context
  const conversationHistory = JSON.parse(orchestrator.conversation_history || '[]');

  // Broadcast tree update (orchestrator is now visible in UI)
  broadcastSessionTree(orchestrator.id);

  // Run the agent with history
  const result = await runObservableAgent(agent, request, {
    sessionId: orchestrator.id,
    history: conversationHistory,
    onActivity: (event) => broadcastSubagentActivity(orchestrator.id, event),
  });

  // Update conversation history
  conversationHistory.push({ role: 'user', content: request });
  conversationHistory.push({ role: 'assistant', content: result });

  await sessionsRepo.update(orchestrator.id, {
    conversation_history: JSON.stringify(conversationHistory),
    updated_at: new Date().toISOString(),
  });

  // DON'T mark as finished - orchestrator stays running while it has terminals
  // Only finish when user explicitly stops or all terminals are done

  return result;
}
```

### 3. Terminal Session Creation

**Trigger:** CLI Orchestrator calls `start_headless_session` or `start_interactive_session`

```typescript
// pi-agent/src/subagents/cli/tools.ts
const startHeadlessSession = tool({
  name: 'start_headless_session',
  async execute({ prompt }, { sessionId: orchestratorId }) {
    const terminalId = randomUUID();

    // Create terminal session in DB
    await sessionsRepo.create({
      id: terminalId,
      type: 'terminal',
      status: 'running',
      goal: `Headless: ${prompt.substring(0, 100)}`,
      parent_id: orchestratorId,
      mac_session_id: null,  // Set after Mac daemon responds
    });

    // Start on Mac daemon
    const result = await macClient.createSession({ prompt, mode: 'headless' });

    await sessionsRepo.update(terminalId, {
      mac_session_id: result.macSessionId,
    });

    broadcastSessionTree(orchestratorId);

    return { sessionId: terminalId, ...result };
  },
});
```

## WebSocket Events

### Session Tree Update (New)

Sent whenever any session in a thread changes. Frontend replaces its entire tree state.

```typescript
interface SessionTreeUpdate {
  type: 'session_tree_update';
  threadId: string;
  tree: SessionNode;
}

interface SessionNode {
  id: string;
  type: 'voice' | 'subagent' | 'terminal';
  status: 'running' | 'finished' | 'cancelled' | 'error';
  goal: string;
  agentName?: string;
  profileName?: string;
  createdAt: string;
  children: SessionNode[];
}
```

**Example payload:**

```json
{
  "type": "session_tree_update",
  "threadId": "voice-abc123",
  "tree": {
    "id": "voice-abc123",
    "type": "voice",
    "status": "running",
    "goal": "Voice conversation (Marvin)",
    "profileName": "marvin",
    "createdAt": "2025-01-15T10:00:00Z",
    "children": [
      {
        "id": "subagent-def456",
        "type": "subagent",
        "status": "running",
        "goal": "Review Kireon Backend",
        "agentName": "cli",
        "createdAt": "2025-01-15T10:00:05Z",
        "children": [
          {
            "id": "terminal-ghi789",
            "type": "terminal",
            "status": "running",
            "goal": "Headless: Review authentication...",
            "createdAt": "2025-01-15T10:00:10Z",
            "children": []
          }
        ]
      }
    ]
  }
}
```

### Subagent Activity (Keep existing, scoped to session)

Streaming events for live UI updates within a subagent stage.

```typescript
interface SubagentActivity {
  type: 'subagent_activity';
  sessionId: string;  // The subagent session ID
  threadId: string;   // For routing
  activity: {
    type: 'reasoning_start' | 'reasoning' | 'tool_call' | 'tool_result' | 'response' | 'complete';
    // ... existing fields
  };
}
```

### Terminal Output (Keep existing, scoped to session)

```typescript
interface TerminalOutput {
  type: 'terminal_output';
  sessionId: string;
  threadId: string;
  data: string;
}
```

## Frontend State Management

### Stage Store Refactor

The ThreadRail is now derived directly from the session tree.

```typescript
// web/src/stores/stage.ts

interface StageState {
  // Active thread (from session tree)
  activeThreadId: string | null;
  sessionTree: SessionNode | null;

  // Currently focused session within the tree
  focusedSessionId: string | null;

  // Background threads (minimized)
  backgroundThreadIds: string[];
}

const useStageStore = create<StageState>((set, get) => ({
  activeThreadId: null,
  sessionTree: null,
  focusedSessionId: null,
  backgroundThreadIds: [],

  // Called when session_tree_update arrives
  setSessionTree: (threadId: string, tree: SessionNode) => {
    set({
      activeThreadId: threadId,
      sessionTree: tree,
      // Auto-focus the deepest running session
      focusedSessionId: findDeepestRunning(tree)?.id || tree.id,
    });
  },

  // User clicks on a session in ThreadRail
  focusSession: (sessionId: string) => {
    set({ focusedSessionId: sessionId });
  },

  // User minimizes current thread to background
  minimizeThread: () => {
    const { activeThreadId, backgroundThreadIds } = get();
    if (activeThreadId) {
      set({
        backgroundThreadIds: [...backgroundThreadIds, activeThreadId],
        activeThreadId: null,
        sessionTree: null,
        focusedSessionId: null,
      });
    }
  },

  // User restores a background thread
  restoreThread: (threadId: string) => {
    const { backgroundThreadIds } = get();
    set({
      activeThreadId: threadId,
      backgroundThreadIds: backgroundThreadIds.filter(id => id !== threadId),
      // Tree will be populated by next session_tree_update
    });
    // Request full tree from backend
    requestSessionTree(threadId);
  },
}));
```

### ThreadRail Rendering

ThreadRail directly renders the session tree - no guessing required.

**Order:** Root at TOP, deepest child at BOTTOM (like a breadcrumb trail going down)

```
┌─────────────────────┐
│ 🎤 Voice Session    │ ← Root (top)
├─────────────────────┤
│ 🤖 CLI Orchestrator │ ← Child
├─────────────────────┤
│ 🖥 Terminal-1       │ ← Leaf (bottom, focused)
└─────────────────────┘
```

```tsx
// web/src/components/rails/ThreadRail.tsx

function ThreadRail() {
  const { sessionTree, focusedSessionId, focusSession } = useStageStore();

  if (!sessionTree) return null;

  // Flatten tree to ordered list: root FIRST, deepest LAST
  const flattenedPath = getFocusedPath(sessionTree, focusedSessionId);

  return (
    <div className="thread-rail">
      {flattenedPath.map((session, index) => (
        <SessionCard
          key={session.id}
          session={session}
          isFocused={session.id === focusedSessionId}
          depth={index}
          onClick={() => focusSession(session.id)}
        />
      ))}
    </div>
  );
}

// Returns path from root to focused session (root first, leaf last)
function getFocusedPath(tree: SessionNode, focusedId: string | null): SessionNode[] {
  const path: SessionNode[] = [];

  function traverse(node: SessionNode): boolean {
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

### MainStage Rendering

MainStage shows content based on focused session type.

```tsx
// web/src/components/stages/MainStage.tsx

function MainStage() {
  const { sessionTree, focusedSessionId } = useStageStore();
  const focusedSession = findSessionById(sessionTree, focusedSessionId);

  if (!focusedSession) {
    return <IdleStage />;
  }

  switch (focusedSession.type) {
    case 'voice':
      return <VoiceStage session={focusedSession} />;
    case 'subagent':
      return <SubagentStage session={focusedSession} />;
    case 'terminal':
      return <TerminalStage session={focusedSession} />;
  }
}
```

## Cascading Termination

### User Cancels a Session

When user clicks "Stop" on any session, we need to:
1. Check for running children
2. Warn if children exist
3. Cancel the entire subtree

```typescript
// pi-agent/src/api/routes.ts
app.post('/api/sessions/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const { force } = req.body;

  const session = await sessionsRepo.getById(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Get all running children
  const runningChildren = await sessionsRepo.getRunningChildren(id);

  if (runningChildren.length > 0 && !force) {
    // Return warning, don't cancel yet
    return res.status(409).json({
      warning: 'Session has running children',
      children: runningChildren.map(c => ({
        id: c.id,
        type: c.type,
        goal: c.goal,
      })),
      message: `This will also stop ${runningChildren.length} child session(s). Confirm?`,
    });
  }

  // Cancel entire subtree
  await cancelSessionTree(id);

  // Broadcast update
  broadcastSessionTree(session.thread_id);

  res.json({ success: true, cancelled: runningChildren.length + 1 });
});

async function cancelSessionTree(rootId: string) {
  const session = await sessionsRepo.getById(rootId);
  if (!session || session.status !== 'running') return;

  // First cancel all children (depth-first)
  const children = await sessionsRepo.getChildren(rootId);
  for (const child of children) {
    await cancelSessionTree(child.id);
  }

  // Then cancel this session
  switch (session.type) {
    case 'terminal':
      // Kill tmux session on Mac
      if (session.mac_session_id) {
        await macClient.killSession(session.mac_session_id);
      }
      break;
    case 'subagent':
      // Abort the running agent (if using AbortController)
      abortAgent(session.id);
      break;
    case 'voice':
      // Disconnect realtime session
      voiceAgent.disconnect();
      break;
  }

  await sessionsRepo.update(rootId, {
    status: 'cancelled',
    finished_at: new Date().toISOString(),
  });
}
```

### Frontend Cancel Flow

```tsx
// web/src/components/SessionControls.tsx

function SessionControls({ session }: { session: SessionNode }) {
  const [showWarning, setShowWarning] = useState(false);
  const [pendingChildren, setPendingChildren] = useState<SessionNode[]>([]);

  const handleCancel = async () => {
    const response = await fetch(`/api/sessions/${session.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ force: false }),
    });

    if (response.status === 409) {
      const data = await response.json();
      setPendingChildren(data.children);
      setShowWarning(true);
      return;
    }

    // Success - tree update will come via WebSocket
  };

  const handleForceCancel = async () => {
    await fetch(`/api/sessions/${session.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    });
    setShowWarning(false);
  };

  return (
    <>
      <button onClick={handleCancel}>Stop</button>

      {showWarning && (
        <Dialog>
          <p>This session has {pendingChildren.length} running child(ren):</p>
          <ul>
            {pendingChildren.map(c => (
              <li key={c.id}>{c.type}: {c.goal}</li>
            ))}
          </ul>
          <p>Stop all?</p>
          <button onClick={handleForceCancel}>Yes, stop all</button>
          <button onClick={() => setShowWarning(false)}>Cancel</button>
        </Dialog>
      )}
    </>
  );
}
```

## Event-Based State Transitions (No Timeouts)

### Old (Problematic)

```typescript
// ❌ Timing-based heuristic
case 'complete':
  setTimeout(() => popStage(), 2000);
```

### New (Event-Based)

```typescript
// ✅ State derived from session tree
// When session_tree_update arrives with status='finished',
// the UI automatically updates because it renders the tree directly.

// The frontend NEVER decides when to pop/push stages.
// It just renders whatever the backend says the tree looks like.
```

**The key insight:** The frontend doesn't manage stage transitions anymore. It renders the session tree as-is. When a session finishes:

1. Backend updates DB: `status = 'finished'`
2. Backend broadcasts `session_tree_update`
3. Frontend receives new tree
4. Frontend re-renders with finished session shown as inactive
5. User can click to view finished session details, or the UI auto-focuses the next running session

## Implementation Phases

### Phase 1: Database Migration
- [ ] Rename `cli_sessions` → `sessions`
- [ ] Add `type`, `agent_name`, `profile_name`, `model` columns
- [ ] Create indexes
- [ ] Migrate existing data (set type='terminal' for existing rows)

### Phase 2: Backend Session Lifecycle
- [ ] Update `VoiceSession` to create DB entry on connect
- [ ] Update subagent handlers to create DB entries
- [ ] Update terminal tools to use new schema
- [ ] Implement `SessionsRepository.getTree(threadId)`
- [ ] Implement `cancelSessionTree(id)`

### Phase 3: WebSocket Events
- [ ] Implement `broadcastSessionTree(threadId)`
- [ ] Add `threadId` to existing `subagent_activity` events
- [ ] Add `threadId` to existing `terminal_output` events
- [ ] Add REST endpoint `GET /api/sessions/:threadId/tree`
- [ ] Add REST endpoint `POST /api/sessions/:id/cancel`

### Phase 4: Frontend Refactor
- [ ] Refactor `stage.ts` to use session tree state
- [ ] Remove all `setTimeout` for stage transitions
- [ ] Update `ThreadRail` to render from tree
- [ ] Update `MainStage` to switch on session type
- [ ] Update `BackgroundRail` to show background threads
- [ ] Implement cancel confirmation dialog

### Phase 5: Polish (Later)
- [ ] Session history view (past threads)
- [ ] Search through past sessions
- [ ] Export conversation logs
- [ ] Session bookmarking

## Resolved Questions

1. **Session Retention:**
   - DB: Keep for 10 days, then auto-cleanup via scheduled task
   - Frontend: Only show sessions with `status='running'` (or parent of running)
   - When terminal finishes → hide subagent → hide voice (if no other running children)
   - Past sessions visible in separate "History" view (Phase 5)

2. **Frontend Reload:**
   - No special "reconnect" logic needed
   - On load: `GET /api/sessions/active` returns all running trees
   - WebSocket connects → receives `session_tree_update` for any changes

3. **Multi-Client:** Already solved - WebSocket broadcasts to all connected clients

## Frontend Visibility Rules

A session is visible in the active UI if:
```typescript
function isSessionVisible(session: SessionNode): boolean {
  // Running sessions are always visible
  if (session.status === 'running') return true;

  // Finished sessions are visible if ANY descendant is running
  return session.children.some(child => isSessionVisible(child));
}
```

When a terminal finishes:
1. Terminal marked `status='finished'` in DB
2. `session_tree_update` broadcasted
3. Frontend filters: terminal not visible (no running children)
4. Subagent not visible (no running children)
5. Voice not visible (no running children)
6. Thread removed from active view → appears in BackgroundRail as "finished"

User can still click finished threads in BackgroundRail to view history.
