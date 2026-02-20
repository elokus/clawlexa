# Agent Session Management Architecture

> Comprehensive documentation for the session-centric architecture implemented in the voice-agent system.

## Overview

The voice-agent system uses a **unified session model** where all agent interactions (voice, subagent, terminal) are managed through a single protocol and state management system.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INPUT                                      │
│                     (Voice via Realtime API / Text via WebSocket)           │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            VOICE AGENT                                       │
│                     (OpenAI Realtime API Session)                           │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │  VoiceAdapter   │───▶│  stream_chunk   │───▶│   Frontend      │        │
│  │  (AI SDK fmt)   │    │  (WebSocket)    │    │   Store         │        │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Tool calls (developer_session, web_search, etc.)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SUBAGENT                                          │
│                 (CLI Agent, Web Search, Deep Thinking)                      │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │  AI SDK         │───▶│  stream_chunk   │───▶│   Frontend      │        │
│  │  streamText()   │    │  (WebSocket)    │    │   Store         │        │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Tool calls (start_headless_session, etc.)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TERMINAL                                          │
│                        (Mac Daemon + tmux)                                   │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │  PTY Stream     │───▶│  WebSocket      │───▶│   xterm.js      │        │
│  │  (Mac Daemon)   │    │  (Binary)       │    │   Terminal      │        │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Session Types

| Type | Description | Parent | Protocol | Database |
|------|-------------|--------|----------|----------|
| `voice` | Root conversation (OpenAI Realtime API) | none | AI SDK via adapter | Yes (profile, status) |
| `subagent` | Delegated agent (CLI, web_search) | voice or subagent | AI SDK native | Yes (history, status) |
| `terminal` | PTY process (tmux + Claude Code) | subagent | Binary PTY stream | Yes (mac_session_id) |

---

## Backend Architecture

### Key Files

| File | Purpose |
|------|---------|
| `packages/voice-agent/src/api/websocket.ts` | WebSocket server, message broadcasting |
| `packages/voice-agent/src/api/stream-types.ts` | AI SDK event type definitions |
| `packages/voice-agent/src/realtime/ai-sdk-adapter.ts` | Voice → AI SDK event conversion |
| `packages/voice-agent/src/agent/voice-agent.ts` | Voice session lifecycle management |
| `packages/voice-agent/src/subagents/cli/index.ts` | CLI orchestration agent |
| `packages/voice-agent/src/subagents/direct-input.ts` | Text input to focused subagent |
| `packages/voice-agent/src/db/schema.ts` | Database schema and migrations |
| `packages/voice-agent/src/db/repositories/cli-sessions.ts` | Session CRUD operations |

### Session Lifecycle

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         VOICE SESSION LIFECYCLE                           │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Wake word detected ("Jarvis" / "Computer")                          │
│     │                                                                    │
│     ▼                                                                    │
│  2. VoiceAgent.activate(profile)                                        │
│     ├── Create session in DB (type='voice', profile='jarvis')           │
│     ├── Create VoiceAdapter for this sessionId                          │
│     ├── Connect to OpenAI Realtime API                                  │
│     └── Broadcast: session_started, state_change('listening')           │
│     │                                                                    │
│     ▼                                                                    │
│  3. User speaks → OpenAI transcribes                                    │
│     └── adapter.transcript(text, 'user')                                │
│         └── Broadcast: stream_chunk { type: 'text-delta' }              │
│     │                                                                    │
│     ▼                                                                    │
│  4. OpenAI responds                                                      │
│     ├── state_change('thinking')                                        │
│     ├── adapter.transcript(text, 'assistant')                           │
│     │   └── Broadcast: stream_chunk { type: 'text-delta' }              │
│     └── state_change('speaking') → TTS playback                         │
│     │                                                                    │
│     ▼                                                                    │
│  5. Tool call (e.g., developer_session)                                 │
│     ├── adapter.toolStart(name, args)                                   │
│     │   └── Broadcast: stream_chunk { type: 'tool-call' }               │
│     ├── Execute tool → Creates subagent session                         │
│     └── adapter.toolEnd(name, result)                                   │
│         └── Broadcast: stream_chunk { type: 'tool-result' }             │
│     │                                                                    │
│     ▼                                                                    │
│  6. Conversation ends (timeout or user stops)                           │
│     ├── Update session status='finished'                                │
│     ├── Broadcast: session_ended                                        │
│     └── Disconnect from OpenAI                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Database Schema

```sql
-- Sessions table (unified for all types)
CREATE TABLE cli_sessions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT DEFAULT 'pending',     -- pending|running|waiting_for_input|finished|error|cancelled

  -- Session hierarchy
  parent_id TEXT REFERENCES cli_sessions(id),
  thread_id TEXT,                    -- Root session of this tree

  -- Type discrimination
  type TEXT DEFAULT 'terminal',      -- 'voice' | 'subagent' | 'terminal'

  -- Agent-specific (voice + subagent)
  agent_name TEXT,                   -- 'cli' | 'web_search' | 'deep_thinking'
  model TEXT,                        -- LLM model used
  profile TEXT,                      -- Voice profile: 'jarvis' | 'marvin'
  conversation_history TEXT,         -- JSON array for stateful agents

  -- Terminal-specific
  mac_session_id TEXT,               -- tmux session on Mac daemon
  tool_call_id TEXT,                 -- Links to creating tool call

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);
```

### AI SDK Adapter

The adapter converts OpenAI Realtime API events to AI SDK v5 format:

```typescript
// packages/voice-agent/src/realtime/ai-sdk-adapter.ts

// Voice event → AI SDK event mapping
const mapping = {
  transcript:   { text }      → { type: 'text-delta', textDelta: text },
  toolStart:    { name, args } → { type: 'tool-call', toolName, toolCallId, input },
  toolEnd:      { name, result } → { type: 'tool-result', toolName, toolCallId, output },
  stateChange:  { state: 'thinking' } → { type: 'start-step' },
  stateChange:  { state: 'idle' } → { type: 'finish', finishReason: 'stop' },
  error:        { message } → { type: 'error', error: message },
};

// Usage in VoiceAgent:
const adapter = createVoiceAdapter(sessionId);
adapter.transcript('Hello, how can I help?', 'assistant');
adapter.toolStart('web_search', { query: 'weather' });
adapter.toolEnd('web_search', 'Sunny, 72°F');
```

### Subagent Streaming

Subagents use AI SDK's native `streamText()` with `fullStream`:

```typescript
// packages/voice-agent/src/subagents/cli/index.ts

const result = streamText({
  model: openrouter.chat('x-ai/grok-code-fast-1'),
  system: systemPrompt,
  prompt: request,
  tools: cliTools,
  maxSteps: 3,
});

// Stream all events to frontend
for await (const event of result.fullStream) {
  wsBroadcast.streamChunk(sessionId, event);
  // event types: text-delta, tool-call, tool-result, reasoning-delta, finish, etc.
}
```

---

## WebSocket Protocol

### Message Types (8 total)

| Type | Direction | Purpose | Payload |
|------|-----------|---------|---------|
| `welcome` | Server→Client | Identity on connect | `{ clientId, isMaster }` |
| `stream_chunk` | Server→Client | All agent events | `{ sessionId, event: AISDKStreamEvent }` |
| `session_tree_update` | Server→Client | Session hierarchy | `{ rootId?, tree?, trees? }` |
| `state_change` | Server→Client | Voice UI state | `{ state, profile }` |
| `master_changed` | Server→Client | Audio control handoff | `{ masterId }` |
| `session_started` | Server→Client | Voice activation | `{ profile }` |
| `session_ended` | Server→Client | Voice deactivation | `{ profile }` |
| `cli_session_deleted` | Server→Client | Session cleanup | `{ sessionId }` or `{ all: true }` |
| `error` | Server→Client | Error notification | `{ message }` |

### Client → Server Commands

| Type | Purpose | Payload |
|------|---------|---------|
| `request_master` | Request audio control | (none) |
| `focus_session` | Set focused session | `{ sessionId }` |
| `session_input` | Send text to focused subagent | `{ text }` |
| `client_command` | Start/stop voice | `{ command: 'start'|'stop', profile? }` |

### AI SDK Stream Events

All agents emit events following the AI SDK v5 Data Stream Protocol:

```typescript
type AISDKStreamEvent =
  // Text streaming
  | { type: 'text-delta'; textDelta: string }

  // Tool calls
  | { type: 'tool-call'; toolName: string; toolCallId: string; input: unknown }
  | { type: 'tool-result'; toolName: string; toolCallId: string; output: unknown }

  // Reasoning (thinking models)
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-end'; text: string; durationMs?: number }

  // Step lifecycle
  | { type: 'start' }
  | { type: 'start-step' }
  | { type: 'finish-step'; finishReason?: string; usage?: TokenUsage }
  | { type: 'finish'; finishReason: string }

  // Errors
  | { type: 'error'; error: string };
```

---

## Frontend Architecture

### Key Files

| File | Purpose |
|------|---------|
| `packages/web-ui/src/stores/unified-sessions.ts` | Unified Zustand store (~921 LoC) |
| `packages/web-ui/src/stores/message-handler.ts` | WebSocket event routing |
| `packages/web-ui/src/stores/index.ts` | Store exports and selector hooks |
| `packages/web-ui/src/hooks/useWebSocket.ts` | Singleton WebSocket connection |
| `packages/web-ui/src/components/stages/AgentStage.tsx` | Unified agent renderer |
| `packages/web-ui/src/components/stages/TerminalStage.tsx` | PTY terminal renderer |
| `packages/web-ui/src/components/layout/StageOrchestrator.tsx` | Stage routing |

### State Management

The unified store replaces the previous 3-store architecture:

```typescript
// packages/web-ui/src/stores/unified-sessions.ts

interface UnifiedSessionsStore {
  // ─── Connection State ───
  clientId: string | null;
  isMaster: boolean;
  wsError: string | null;

  // ─── Voice State ───
  voiceState: AgentState;           // 'idle' | 'listening' | 'thinking' | 'speaking'
  voiceProfile: string | null;       // 'jarvis' | 'marvin'
  voiceActive: boolean;              // Derived from voiceState !== 'idle'
  voiceTimeline: TimelineItem[];     // Transcript + tool items for voice
  currentTool: { name, args } | null;

  // ─── Session Tree ───
  sessionTree: SessionTreeNode | null;  // Current focused tree
  allTrees: SessionTreeNode[];          // All active trees
  focusedSessionId: string | null;      // Currently focused session
  backgroundTreeIds: Set<string>;       // Minimized trees

  // ─── Sessions ───
  sessions: Map<string, SessionState>;  // O(1) lookup by ID

  // ─── Subagent Activities ───
  activitiesBySession: Map<string, ActivityBlock[]>;
  subagentActive: boolean;
  activeOrchestratorId: string | null;

  // ─── Events ───
  events: RealtimeEvent[];

  // ─── Actions ───
  handleStreamChunk(sessionId: string, event: AISDKStreamEvent): void;
  handleSessionTreeUpdate(data: SessionTreeUpdatePayload): void;
  focusSession(sessionId: string): void;
  minimizeTree(rootId: string): void;
  restoreTree(rootId: string): void;
  setActiveOverlay(overlay: OverlayType | null): void;
  reset(): void;
}
```

### Selector Hooks

```typescript
// Import from '@/stores'
useFocusedSession()              // SessionTreeNode | null
useFocusPath()                   // SessionTreeNode[] (breadcrumb path)
useFocusedSessionChildren()      // SessionTreeNode[] (children of focused)
useSessionActivities(sessionId)  // ActivityBlock[] for specific session
useAllActivities()               // ActivityBlock[] flattened + sorted
useHasActiveSession()            // boolean
useVoiceTimeline()               // TimelineItem[] (voice transcripts)
useConnectionState()             // { connected, wsError, clientId, isMaster }
useVoiceState()                  // { voiceState, voiceProfile, voiceActive, currentTool }
```

### Message Accumulation

The `handleStreamChunk()` function accumulates AI SDK events into messages:

```typescript
// Simplified logic from unified-sessions.ts

handleStreamChunk(sessionId, event) {
  switch (event.type) {
    case 'text-delta':
      // Append to current assistant message
      currentMessage.parts[textPartIndex].text += event.textDelta;
      break;

    case 'tool-call':
      // Add tool-call part to message
      currentMessage.parts.push({
        type: 'tool-call',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: event.input,
      });
      break;

    case 'tool-result':
      // Update matching tool-call part with result
      const toolPart = findToolPart(event.toolCallId);
      toolPart.result = event.output;
      break;

    case 'reasoning-delta':
      // Add to reasoning part
      currentMessage.parts[reasoningPartIndex].text += event.text;
      break;

    case 'finish':
      // Mark message complete
      session.status = 'finished';
      break;
  }
}
```

### Component Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              App.tsx                                         │
│  ├─ useWebSocket()     → WebSocket connection singleton                     │
│  ├─ useAudioSession()  → Mic/speaker control (master only)                  │
│  └─ StageOrchestrator  → Main 3-column layout                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐         ┌─────────────────┐         ┌─────────────────┐
│ BackgroundRail │         │   ActiveStage   │         │   ThreadRail    │
│ (Left 80px)    │         │   (Center)      │         │   (Right 360px) │
│                │         │                 │         │                 │
│ - Minimized    │         │  AgentStage     │         │ - Focus path    │
│   session      │         │  (voice/subagent)│        │ - Child sessions │
│   trees        │         │  ────────────── │         │                 │
│                │         │  TerminalStage  │         │                 │
│                │         │  (terminal)     │         │                 │
└───────────────┘         └─────────────────┘         └─────────────────┘
```

### AgentStage Component

The unified `AgentStage` renders any agent session using AI Elements:

```tsx
// packages/web-ui/src/components/stages/AgentStage.tsx

export function AgentStage({ stage }: { stage: StageItem }) {
  // Get data based on session type
  const isVoice = stage.type === 'voice' || stage.id === ROOT_STAGE.id;

  // Voice: use voiceTimeline
  const voiceTimeline = useVoiceTimeline();

  // Subagent: use session activities
  const activities = useSessionActivities(isVoice ? null : stage.id);

  // Convert to display messages
  const messages = isVoice
    ? convertTimelineToMessages(voiceTimeline)
    : convertActivitiesToMessages(activities);

  return (
    <div className="agent-stage">
      <HUDHeader session={stage} />

      <Conversation>
        {messages.map(msg => (
          <MessageBlock key={msg.id} message={msg} />
        ))}
      </Conversation>

      {/* Text input for subagent sessions */}
      {!isVoice && <TextInput sessionId={stage.id} />}
    </div>
  );
}
```

---

## Direct Input (Chatable Subagents)

Users can type directly to focused subagent sessions:

### Flow

```
1. User focuses on a subagent session
   Frontend: focusSession(sessionId)
   WebSocket: { type: 'focus_session', payload: { sessionId } }

2. User types in text input
   Frontend: sendSessionInput(text)
   WebSocket: { type: 'session_input', payload: { text } }

3. Backend routes to focused session
   packages/voice-agent/src/index.ts: onSessionInput(handleDirectInput)

4. handleDirectInput processes the input
   - Loads session from DB
   - Loads conversation_history
   - Adds user message
   - Runs AI SDK streamText()
   - Broadcasts stream_chunk events
   - Saves updated history

5. Frontend accumulates events
   - handleStreamChunk() updates session messages
   - AgentStage re-renders with new content
```

### Implementation

```typescript
// packages/voice-agent/src/subagents/direct-input.ts

export async function handleDirectInput(sessionId: string, text: string): Promise<void> {
  // Load session
  const session = await sessionsRepo.getById(sessionId);
  if (!session || session.type !== 'subagent') {
    throw new Error('Invalid session for direct input');
  }

  // Load conversation history
  const history = JSON.parse(session.conversation_history || '[]');

  // Add user message
  history.push({ role: 'user', content: text });

  // Emit user message as stream_chunk
  wsBroadcast.streamChunk(sessionId, { type: 'text-delta', textDelta: text });

  // Run agent
  const result = streamText({
    model: getModelForAgent(session.agent_name),
    messages: history,
    tools: getToolsForAgent(session.agent_name),
  });

  // Stream all events
  let assistantResponse = '';
  for await (const event of result.fullStream) {
    wsBroadcast.streamChunk(sessionId, event);
    if (event.type === 'text-delta') {
      assistantResponse += event.textDelta;
    }
  }

  // Save updated history
  history.push({ role: 'assistant', content: assistantResponse });
  await sessionsRepo.update(sessionId, {
    conversation_history: JSON.stringify(history),
  });
}
```

---

## Multi-Client Coordination

The system supports multiple browser clients with Master/Replica pattern:

```
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│  Master Client    │    │  Replica Client   │    │  Replica Client   │
│  (Audio I/O)      │    │  (View Only)      │    │  (View Only)      │
└───────────────────┘    └───────────────────┘    └───────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        WebSocket Server                              │
│                                                                     │
│  clients: Map<clientId, ClientState>                                │
│  masterId: string | null                                            │
│                                                                     │
│  ClientState: {                                                     │
│    id: string,                                                      │
│    ws: WebSocket,                                                   │
│    focusedSessionId: string | null,  // For input routing          │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Rules

1. First client to connect becomes Master
2. Only Master receives/sends audio
3. All clients receive state updates and transcripts
4. Replicas can request Master via "Take Control" button
5. If Master disconnects, oldest Replica is promoted
6. Master transfer denied during active voice session

---

## Session Tree Navigation

The ThreadRail displays the session hierarchy for navigation:

```
Voice Session (root)
 └── CLI Agent
      ├── Terminal 1 (finished)
      └── Terminal 2 (running) ← focused
```

### Tree Updates

```typescript
// Backend broadcasts tree updates on session lifecycle events
wsBroadcast.sessionTreeUpdate(rootId);

// Frontend receives and updates store
handleSessionTreeUpdate({ rootId, tree }) {
  // Update sessionTree if rootId matches focusedSessionId root
  // Update allTrees with new tree data
  // Derive focusPath from tree structure
}
```

### Focus Path

The `useFocusPath()` hook returns the breadcrumb path from root to focused:

```typescript
// Example: Voice → CLI Agent → Terminal
const focusPath = useFocusPath();
// Returns: [voiceNode, cliAgentNode, terminalNode]
```

---

## Error Handling

### Backend Errors

```typescript
// Broadcast error to clients
wsBroadcast.error('Tool execution failed: timeout');

// Session-specific errors via stream_chunk
wsBroadcast.streamChunk(sessionId, { type: 'error', error: 'Connection lost' });
```

### Frontend Error Display

```typescript
// ErrorBlock in ActivityFeed
interface ErrorBlock {
  type: 'error';
  message: string;
  timestamp: number;
}

// AgentStage renders error blocks with error styling
<ErrorDisplay message={block.message} />
```

---

## Testing Checklist

### Voice → Subagent → Terminal Flow

1. [ ] Say wake word, verify voice session created in DB
2. [ ] Verify transcript events appear in frontend
3. [ ] Trigger tool call (e.g., "Review Kireon Backend")
4. [ ] Verify subagent session created with parent_id pointing to voice
5. [ ] Verify terminal session created when CLI agent runs command
6. [ ] Verify session tree updates in ThreadRail
7. [ ] Verify cleanup when sessions complete

### Direct Text Input

1. [ ] Focus on a subagent session
2. [ ] Verify focus_session message sent to backend
3. [ ] Type text, verify session_input message sent
4. [ ] Verify stream_chunk events received for response
5. [ ] Verify conversation history persisted in DB

### Multi-Client

1. [ ] Connect first client, verify isMaster=true
2. [ ] Connect second client, verify isMaster=false
3. [ ] Verify both clients receive state updates
4. [ ] Click "Take Control" on replica, verify master handoff
5. [ ] Disconnect master, verify promotion of replica

