# Sessions

Session management for the voice agent. All session types are persisted in SQLite and form a tree hierarchy.

## Session Types

| Type | Description | Parent | Protocol |
|------|-------------|--------|----------|
| `voice` | Root conversation via voice runtime | none | AI SDK via adapter |
| `subagent` | Delegated LLM agent (CLI, web_search, deep_thinking) | voice or subagent | AI SDK native |
| `terminal` | PTY process (tmux + Claude Code) | subagent | Binary PTY stream |

All agents emit **AI SDK Data Stream Protocol** events via WebSocket `stream_chunk`.

## Session Hierarchy

Sessions form a parent-child tree tracked by `parent_id`:

```
voice (root)
  ├── subagent (cli)
  │   └── terminal (claude-code)
  ├── subagent (web_search)
  └── subagent (cli, background)
      └── terminal (claude-code)
```

- Voice sessions have no parent (`parent_id = NULL`)
- Subagents reference their parent voice session
- Terminals reference their parent subagent
- The `getActiveRoots()` method uses a recursive CTE to find all roots that have active descendants

### Tree Queries

```typescript
const repo = new CliSessionsRepository();

// Get full tree from a root
repo.getTree(rootId);        // -> SessionTreeNode with nested children

// Get all active trees (for UI)
repo.getActiveTrees();       // -> SessionTreeNode[]

// Get recent trees including finished (for chat history)
repo.getRecentTrees(24);     // -> trees from last 24 hours
```

## Session Naming

Subagent sessions get human-readable names using adjective-noun pairs (e.g. "swift-falcon", "iron-beacon").

Source: `src/utils/session-names.ts`

**Generation**: 100 adjectives x 100 nouns = 10,000 unique combinations. On collision, appends `-2`, `-3`, etc.

```typescript
const existingNames = repo.getActiveSessionNames();
const name = generateSessionName(existingNames); // "swift-falcon"
```

**Resolution**: Voice commands reference sessions by spoken name. The resolver handles:

1. Exact match ("swift-falcon")
2. Partial match (spoken is substring or vice versa)
3. Word match (any word in name matches)
4. Fuzzy match (Levenshtein distance <= 2)

```typescript
resolveSessionName("swift falcon", sessions); // -> { id, name: "swift-falcon" }
```

## Session Lifecycle

### Status Transitions

```
pending -> running -> finished
                  \-> error
                  \-> cancelled
         running -> waiting_for_input -> running
```

Valid statuses: `pending`, `running`, `waiting_for_input`, `finished`, `error`, `cancelled`.

### Voice Session Lifecycle

1. Wake word detected (local mode) or `start_session` command (web mode)
2. `VoiceAgent.activateProfile()` creates voice session in DB with status `running`
3. Voice runtime connects to provider, agent begins listening
4. On 60s silence timeout or explicit stop: `deactivate()` marks session as `finished`
5. Cleanup: leaf voice sessions without children deleted after 24 hours

### Subagent Session Lifecycle

1. Voice tool call (e.g. `developer_session`) triggers subagent creation
2. `createSubagent()` in DB with `parent_id` pointing to voice session
3. Agent runs to completion or error
4. `finish()` sets status and `finished_at` timestamp

### Terminal Session Lifecycle

1. Subagent tool call creates terminal (e.g. Mac daemon tmux session)
2. `createTerminal()` in DB with `parent_id` pointing to subagent
3. `tool_call_id` links back to the tool call for UI navigation
4. Terminal runs until CLI process completes or is cancelled

## Service States

The main service (`src/index.ts`) has two states:

| State | Description |
|-------|-------------|
| **DORMANT** | Service is off. No audio capture, no wake word, no agent sessions |
| **RUNNING** | Service is active. Audio/wake word based on `audioMode` |

Transition via WebSocket commands: `start_service`, `stop_service`.

## Audio Modes

| Mode | Description |
|------|-------------|
| `web` | Browser handles audio I/O via WebSocket. Wake word disabled, activation via UI |
| `local` | Device handles audio via hardware (PipeWire/sox). Wake word active when idle |

Transition via WebSocket command: `set_audio_mode`.

The agent supports hot-swapping transports while a session is active.

## Background Sessions

Subagent sessions can be marked as `background = true` (detached/fire-and-forget):

- Do not block the voice agent
- Do not take over audio input
- User can continue speaking while background session runs
- Completion is notified via WebSocket `process-status` event
- If voice agent is active at completion, a message is injected into the conversation
- If inactive, notification is queued for the next voice session

## HandoffPacket

Structured context transfer from voice to subagents, solving the "telephone effect" where context is lost at each handoff boundary.

Source: `src/context/handoff.ts`

```typescript
interface HandoffPacket {
  id: string;
  timestamp: number;
  request: string;                    // User's explicit request
  voiceContext: VoiceContextEntry[];   // Last 20 voice conversation entries
  activeProcesses: ProcessSummary[];  // Running/recent background tasks
  source: { sessionId, profile };     // Origin metadata
}
```

The voice agent accumulates context entries (transcripts + tool results, max 30) and builds packets on demand:

```typescript
const packet = voiceAgent.createHandoffPacket("fix the auth endpoint bug");
// packet.voiceContext contains the last 20 entries of the conversation
```

Subagents receive the packet formatted as text blocks:
- `formatVoiceContext(packet)` - conversation entries as `[role] content`
- `formatActiveProcesses(packet)` - running tasks summary

Packets are persisted in the `handoff_packets` table for debugging and replay.

## ProcessManager

EventEmitter-based async process management for non-blocking tools.

Source: `src/processes/manager.ts`

```typescript
const pm = getProcessManager(); // singleton

// Spawn a background process
const process = pm.spawn({
  name: "swift-falcon",
  sessionId: "abc123",
  type: "headless",
  notifyVoiceOnCompletion: true,
  execute: async () => { /* ... */ return "result"; },
});

// Query
pm.getRunning();           // ManagedProcess[]
pm.getByName("swift-falcon");
pm.getBySessionId("abc123");
pm.cancel("swift-falcon");
pm.getSummary();           // "2 running, 1 completed"
```

Events:
- `process:completed` - Process finished successfully
- `process:error` - Process failed or was cancelled

Process types: `headless`, `interactive`, `web_search`, `deep_thinking`.

The main `index.ts` wires ProcessManager events to WebSocket broadcasts and voice agent notifications.
