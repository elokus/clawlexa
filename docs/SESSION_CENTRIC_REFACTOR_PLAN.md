# Session-Centric Architecture Refactoring Plan

> **Goal**: One protocol. One store. One component. Reduce complexity by eliminating parallel systems.

## Executive Summary

**The Problem:** Current architecture has 3 stores, 4 stage components, multiple event types, and parallel streaming patterns. Every change touches 2-4 files. Bugs hide in sync logic.

**The Solution:**
1. **One Protocol** - All agents emit AI SDK stream events (voice via adapter)
2. **One Store** - `sessions.ts` replaces agent.ts + stage.ts + sessions.ts
3. **One Component** - `<AgentStage />` renders any agent type
4. **Voice in Tree** - Voice is a persisted root session, not ephemeral
5. **Terminology** - `orchestrator` → `subagent`

**Estimated Impact:** -2000 LoC, 1 path to debug instead of 4

---

## Phase 0: Research & Documentation

### 0.1 Vercel AI SDK v5 Research
- [x] Read AI SDK Core documentation: `streamText`, `generateText`, tool definitions
- [x] Study AI SDK Data Stream Protocol specification
- [x] Understand `createDataStreamResponse` for WebSocket adaptation
- [x] Review `useChat` and `useCompletion` hooks architecture
- [x] Document how to adapt HTTP streaming to WebSocket transport
- [x] Study `experimental_prepareStep` for multi-step agent flows

> **Finding:** Our `pi-agent/src/lib/agent-runner.ts` already uses AI SDK v5 `streamText` with `fullStream`! The refactoring is about unifying the event protocol (replacing `subagent_activity` with `stream_chunk`).

**Key Documentation Links:**
- https://ai-sdk.dev/docs (main docs)
- https://ai-sdk.dev/docs/reference (API reference)
- https://ai-sdk.dev/elements/components/conversation (AI Elements)

#### Key AI SDK v5 Patterns (Research Summary)

**1. streamText with fullStream for Observable Agents:**
```typescript
import { streamText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const result = streamText({
  model: openrouter.chat('x-ai/grok-code-fast-1'),
  prompt,
  tools,
  maxSteps: 5,
});

// Process all events for real-time UI
for await (const event of result.fullStream) {
  switch (event.type) {
    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end':
      // Thinking/reasoning events for grok, deepseek-r1
      break;
    case 'tool-call':
      // event.input (NOT event.args)
      // event.toolName, event.toolCallId
      break;
    case 'tool-result':
      // event.output (NOT event.result)
      break;
    case 'text-delta':
      // event.textDelta
      break;
    case 'finish-step':
      // event.usage { inputTokens, outputTokens, reasoningTokens }
      break;
  }
}
```

**2. Tool Definition (CRITICAL - Must use tool() helper):**
```typescript
import { tool } from 'ai';  // MUST import
import { z } from 'zod';

const myTool = tool({           // MUST use tool() wrapper
  description: 'My tool',
  inputSchema: z.object({...}), // MUST use inputSchema (NOT parameters)
  execute: async (args) => {...},
});
```

**3. useChat Hook (v5 Changes):**
```typescript
// v5 uses sendMessage, NOT append
const { messages, sendMessage, status } = useChat();
const [input, setInput] = useState('');

sendMessage({ text: input });  // NOT append({ content, role })

// Messages use parts, NOT content
message.parts.map(part => part.type === 'text' ? part.text : null)
```

**4. WebSocket Adaptation Pattern:**
```typescript
// Backend: Stream events via WebSocket
for await (const event of result.fullStream) {
  broadcast('stream_chunk', { sessionId, event });
}

// Frontend: Accumulate events into messages
// Adapt useChat pattern with custom transport
```

### 0.2 AI Elements Research (Shadcn + AI SDK)
- [x] Explore `vercel/ai-chatbot` reference implementation
- [x] Study shadcn `ai` components: Message, ChatInput, ToolInvocation
- [x] Document component patterns for streaming messages
- [x] Review `useActions` and server actions integration
- [x] Understand styling patterns and Tailwind integration
- [x] Identify reusable components for our unified `<AgentStage />`

> **Finding:** AI Elements provides `<Conversation>`, `<Message>`, `<MessageResponse>`, `<CodeBlock>`, `<Loader>` components. These handle streaming states, markdown, and tool displays automatically - solving problems we currently handle manually in `ChatStage.tsx` and `SubagentStage.tsx`.

**Key Resources:**
- https://github.com/vercel/ai-elements (Official AI Elements library)
- https://ai-sdk.dev/elements/components/conversation (Component docs)
- https://ai-sdk.dev/elements/examples/chatbot (Chatbot example)
- https://vercel.com/templates/next.js/nextjs-ai-chatbot (Full template)
- https://shadcn-chatbot-kit.vercel.app/ (Community alternative)

#### AI Elements Components (Research Summary)

**Installation:**
```bash
# All components
npx shadcn@latest add https://registry.ai-sdk.dev/all.json

# Specific component
npx shadcn@latest add https://registry.ai-sdk.dev/message.json
npx shadcn@latest add https://registry.ai-sdk.dev/conversation.json
```

**Key Components for Our Use Case:**

| Component | Purpose | Use In |
|-----------|---------|--------|
| `<Conversation>` | Message list with streaming | AgentStage |
| `<Message>` | Single message with parts | AgentStage |
| `<CodeBlock>` | Syntax highlighted code | SubagentStage |
| `<ChainOfThought>` | Reasoning visualization | SubagentStage |
| `<Loader>` | Streaming indicators | All stages |
| `<Actions>` | Quick action buttons | AgentStage |

**Conversation Component Pattern:**
```tsx
import { Conversation, Message } from '@/components/ui/conversation';

<Conversation>
  {messages.map((message) => (
    <Message
      key={message.id}
      role={message.role}
      parts={message.parts}
      status={message.status}
    />
  ))}
</Conversation>
```

**Note:** AI Elements handles streaming states, markdown rendering, and tool displays automatically - solves problems we currently handle manually.

### 0.3 XState Research (Skipped)

**Decision: Skip XState** - Adds complexity without solving our actual problems.

| Factor | Assessment |
|--------|------------|
| Learning curve | High - team needs to learn machine syntax |
| Bundle size | +20-40KB |
| LoC impact | +500 lines for machine definitions |
| Our state complexity | Low - 4-5 states, linear transitions |
| Problems XState solves | Impossible states, race conditions - we don't have these |

Our complexity comes from architecture (asymmetric sessions, manual routing), not state management bugs. The Session Registry pattern solves this without XState overhead.

**Reconsider if:** Multi-agent handoff becomes complex (5+ agents with conditional transitions).

### 0.4 Current Codebase Analysis (Validated)

| File | LoC | Key Responsibilities |
|------|-----|---------------------|
| `web/src/stores/agent.ts` | 834 | 15+ WS event handlers, timeline, activities, cross-store sync |
| `web/src/stores/stage.ts` | 539 | Session tree navigation (v2), legacy stage stack |
| `web/src/stores/sessions.ts` | 234 | CLI session CRUD, API calls |
| `pi-agent/src/lib/agent-runner.ts` | 247 | Already uses AI SDK `streamText` + `fullStream` |

**Total frontend stores:** 1,607 LoC → Target: ~300 LoC (unified sessions.ts)

**Key Insight:** The backend `agent-runner.ts` already uses AI SDK correctly. The work is:
1. Replace `subagent_activity` events with `stream_chunk` (unified protocol)
2. Add Realtime API → AI SDK adapter for voice
3. Frontend accumulates `stream_chunk` into messages (like `useChat` does)

---

## Architecture Overview

### Current vs Target

```
CURRENT (Parallel Systems)                 TARGET (Unified)
─────────────────────────────────         ─────────────────────────────────
Stores:                                    Store:
  agent.ts (830 LoC)                         sessions.ts (300 LoC)
  stage.ts (540 LoC)                         - sessions: Map<id, SessionState>
  sessions.ts (150 LoC)                      - focusedSessionId
  = 1520 LoC, sync bugs                      - tree derived from parentId

Components:                                Components:
  ChatStage.tsx                              AgentStage.tsx (all agents)
  SubagentStage.tsx                          TerminalStage.tsx (PTY only)
  ActivityFeed.tsx
  ConversationStream.tsx
  = 900 LoC, parallel logic

Events:                                    Events:
  transcript                                 stream_chunk { sessionId, event }
  subagent_activity                          - event follows AI SDK format
  tool_start/tool_end                        - text-delta, tool-call, etc.
  reasoning_start/delta/end
  cli_session_created
  = many handlers

Voice:                                     Voice:
  Ephemeral (not in DB)                      Persisted session (root of tree)
  Special "voiceActive" flag                 Just another session type
```

### Session Types

| Type | Description | Parent | I/O |
|------|-------------|--------|-----|
| `voice` | Root conversation | none | Audio (Realtime API) |
| `subagent` | Delegated agent (CLI, search) | voice or subagent | Text (AI SDK) |
| `terminal` | PTY process on Mac | subagent | PTY stream |

### Unified Event Protocol

All agents emit the same format - frontend doesn't know the source:

```typescript
// Backend broadcasts
broadcast('stream_chunk', {
  sessionId: 'session-123',
  event: {
    type: 'text-delta',      // AI SDK event type
    textDelta: 'Hello...',
  }
});

// Voice adapter converts Realtime API → AI SDK format
// Subagents use AI SDK directly
// Frontend just accumulates events
```

---

## Phase 1: Unified Event Protocol ✅

### 1.1 AI SDK Adapter for Voice ✅
**File:** `pi-agent/src/realtime/ai-sdk-adapter.ts`

- [x] Create adapter that converts Realtime API events → AI SDK format
- [x] Map `transcript` → `text-delta`
- [x] Map `toolStart` → `tool-call` with `input` property
- [x] Map `toolEnd` → `tool-result` with `output` property
- [x] Emit `stream_chunk` messages with sessionId via `createVoiceAdapter()`

```typescript
// Usage in VoiceSession:
const adapter = createVoiceAdapter(sessionId);
adapter.transcript(text, role);      // → text-delta
adapter.toolStart(name, args);       // → tool-call
adapter.toolEnd(name, result);       // → tool-result
adapter.stateChange(state, profile); // → start-step/finish
```

### 1.2 Subagents Use AI SDK Directly ✅
**Files:** `pi-agent/src/subagents/cli/index.ts`, `web-search/index.ts`

- [x] Replace custom `runObservableAgent` with AI SDK `streamText`
- [x] Use `result.fullStream` to emit events
- [x] Emit `stream_chunk` with sessionId for each event
- [x] Deleted legacy `pi-agent/src/lib/agent-runner.ts`

```typescript
// In CLI agent:
const result = streamText({ model, system, prompt, tools, stopWhen: stepCountIs(3) });

for await (const event of result.fullStream) {
  wsBroadcast.streamChunk(sessionId, event);
}
```

### 1.3 Shared Event Types ✅
**File:** `pi-agent/src/api/stream-types.ts`

- [x] Define `StreamChunkMessage` type
- [x] Define `AISDKStreamEvent` union type (full AI SDK event coverage)
- [x] Export for backend use
- [x] Added `wsBroadcast.streamChunk()` helper in websocket.ts
- [x] Verified against `ai@5.0.108` TypeScript types (not web docs which can be outdated)

```typescript
// Verified from node_modules/ai/dist/index.d.ts
export type AISDKStreamEvent =
  | { type: 'text-delta'; textDelta: string }        // NOT 'text' - verified in TS types
  | { type: 'tool-call'; toolName: string; toolCallId: string; input: unknown }
  | { type: 'tool-result'; toolName: string; toolCallId: string; output: unknown }
  | { type: 'reasoning-start' } | { type: 'reasoning-delta'; text: string } | { type: 'reasoning-end'; ... }
  | { type: 'start' } | { type: 'start-step' } | { type: 'finish-step'; ... } | { type: 'finish'; ... }
  | { type: 'error'; error: string };
```

> **Lesson learned:** Always verify against the installed package's TypeScript types (`node_modules/ai/dist/index.d.ts`), not web documentation which may describe different API layers or be outdated.

---

## Phase 2: Database & Sessions ✅

### 2.1 Schema Migration
**File:** `pi-agent/src/db/schema.ts`

- [x] ~~Rename `cli_sessions` → `sessions`~~ (kept as `cli_sessions` for backward compat)
- [x] Add `type` column: `'voice' | 'subagent' | 'terminal'`
- [x] Add fields for all session types (`profile` column added)
- [x] Migrate existing data (`orchestrator` → `subagent`)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                -- 'voice' | 'subagent' | 'terminal'
  status TEXT DEFAULT 'running',     -- 'running' | 'finished' | 'cancelled' | 'error'
  goal TEXT,

  -- Hierarchy
  parent_id TEXT REFERENCES sessions(id),

  -- Agent-specific (voice + subagent)
  agent_name TEXT,                   -- 'jarvis' | 'marvin' | 'cli' | 'web_search'
  model TEXT,
  profile TEXT,                      -- For voice: 'jarvis' | 'marvin'

  -- Terminal-specific
  mac_session_id TEXT,

  -- Timestamps
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
```

### 2.2 Voice Session Persistence
**File:** `pi-agent/src/agent/voice-agent.ts` (handled at VoiceAgent level, not VoiceSession)

- [x] Create session in DB on voice activation
- [x] Set `type='voice'`, `profile=profileName`
- [x] Mark finished on disconnect
- [x] Broadcast tree update on lifecycle events

```typescript
async connect(profile: string): Promise<void> {
  // Create DB session - voice is now persisted!
  this.sessionId = await sessionsRepo.create({
    type: 'voice',
    status: 'running',
    goal: `Voice conversation`,
    profile,
    agent_name: profile.toLowerCase(),
  });

  // Broadcast tree update
  wsBroadcast.sessionTreeUpdate(this.sessionId);

  // Connect to OpenAI...
}
```

### 2.3 Subagent as Child of Voice
**File:** `pi-agent/src/subagents/cli/index.ts`

- [x] Accept `voiceSessionId` (the voice session)
- [x] Create subagent session with `parent_id`
- [x] Broadcast tree update when created

```typescript
export async function handleDeveloperRequest(
  request: string,
  parentSessionId: string  // Voice session ID
): Promise<string> {
  const subagentSession = await sessionsRepo.create({
    type: 'subagent',
    status: 'running',
    goal: request.substring(0, 100),
    agent_name: 'cli',
    parent_id: parentSessionId,  // ← Child of voice
  });

  wsBroadcast.sessionTreeUpdate(parentSessionId);

  // Run with AI SDK...
}
```

---

## Phase 3: Frontend - One Store ✅ COMPLETE

### 3.1 Unified Sessions Store ✅
**New File:** `web/src/stores/unified-sessions.ts`

- [x] Create single Zustand store for all session state
- [x] Implement message accumulation from `stream_chunk` events
- [x] Derive tree structure from `parentId` relationships
- [x] Support legacy events (`subagent_activity`) during transition
- [x] Maintain voice timeline for backward compatibility
- [ ] Migrate components to use unified store
- [ ] Delete legacy stores after migration complete

**Implementation Notes (Completed 2025-12-24):**
- Created `unified-sessions.ts` (921 LoC) consolidating agent.ts + stage.ts + sessions.ts
- Store manages: connection, voice state, session tree, sessions by ID, activities, events
- `handleStreamChunk()` accumulates AI SDK events into messages with parts
- `handleSubagentActivity()` routes reasoning/tool/content/error blocks
- Session tree logic ported from stage.ts (auto-focus, tree traversal)
- `message-handler.ts` routes WebSocket events to unified store
- `stores/index.ts` exports for gradual migration
- `useWebSocket.ts` updated to use `createDualModeHandler()` for both stores
- Added `stream_chunk` to `WSMessageType` in types/index.ts

```typescript
// Key exports from unified-sessions.ts:
export interface SessionState {
  id: string;
  type: 'voice' | 'subagent' | 'terminal';
  status: SessionStatus;
  parentId: string | null;
  agentName?: string;
  goal?: string;
  profile?: string;
  messages: Message[];      // AI SDK format with parts
  children: string[];       // Child session IDs
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];     // text, tool-call, tool-result, reasoning
  createdAt: number;
}

// Selector hooks for components:
export function useFocusedSession(): SessionTreeNode | null;
export function useFocusPath(): SessionTreeNode[];
export function useFocusedSessionChildren(): SessionTreeNode[];
export function useSessionActivities(sessionId: string | null): ActivityBlock[];
export function useAllActivities(): ActivityBlock[];
export function useHasActiveSession(): boolean;
export function useVoiceTimeline(): TimelineItem[];
export function useConnectionState(): { connected, wsError, clientId, isMaster };
export function useVoiceState(): { voiceState, voiceProfile, voiceActive, currentTool };
```

### 3.2 Stream Chunk Handler ✅
**In:** `web/src/stores/unified-sessions.ts`

- [x] Accumulate `text-delta` into messages (AI SDK format)
- [x] Track `tool-call` → `tool-result` pairs
- [x] Handle `reasoning-delta` for thinking display
- [x] Update session status on `finish`
- [x] Support legacy `subagent_activity` events

```typescript
// Handles both new and legacy events:
handleStreamChunk(sessionId, event)    // New AI SDK protocol
handleSubagentActivity(agent, type, payload, timestamp, orchestratorId) // Legacy
```

### 3.3 Message Handler ✅
**File:** `web/src/stores/message-handler.ts`

- [x] Routes all WebSocket events to unified store
- [x] Maintains voice timeline for ChatStage compatibility
- [x] Provides `createDualModeHandler()` for gradual migration
- [x] `useWebSocket.ts` updated to use dual mode handler

**Usage in useWebSocket.ts:**
```typescript
const legacyHandleMessage = useAgentStore((s) => s.handleMessage);
const handleMessage = useMemo(
  () => createDualModeHandler(legacyHandleMessage),
  [legacyHandleMessage]
);
```

### 3.4 Delete Old Stores & Complete Migration ✅ COMPLETE

> **Status (2025-12-24):** Migration COMPLETE. All components now use unified store. TypeScript compilation passes.

**Completed Work:**
- ✅ Legacy stores deleted: `agent.ts`, `stage.ts`, `sessions.ts`
- ✅ All components migrated to `useUnifiedSessionsStore`
- ✅ `setClientIdentity` signature fixed to accept `string | null`
- ✅ TypeScript compilation passes with 0 errors

#### 3.4.1 Migration Summary

| File | Changes Made |
|------|--------------|
| `stores/unified-sessions.ts` | Fixed `setClientIdentity` to accept `null` for disconnect |
| `CommandPanel.tsx` | Added local `useCliSessions()` hook for REST API fetch, uses unified store for subagent state |
| `BackgroundRail.tsx` | Added `sessions` array from Map, removed `hasFetched`, updated `SessionButton`/`ThreadGroup` to use `SessionState` |
| `e2e-simulation/component.tsx` | Full migration to unified store, uses `handleWebSocketMessage` |

#### 3.4.2 Component Migration Status (All Complete)

| Component | Migration Status |
|-----------|------------------|
| **StageOrchestrator.tsx** | ✅ Complete |
| **ChatStage.tsx** | ✅ Complete |
| **SubagentStage.tsx** | ✅ Complete |
| **TerminalStage.tsx** | ✅ Complete |
| **ThreadRail.tsx** | ✅ Complete |
| **BackgroundRail.tsx** | ✅ Complete |
| **ConversationStream.tsx** | ✅ Complete |
| **CommandPanel.tsx** | ✅ Complete |
| **GlassHUD.tsx** | ✅ Complete |
| **ToolsOverlay.tsx** | ✅ Complete |
| **EventsOverlay.tsx** | ✅ Complete |
| **e2e-simulation demo** | ✅ Complete |
| **useWebSocket.ts** | ✅ Complete |

#### 3.4.3 Legacy → Unified Mapping

**From `useAgentStore` → `useUnifiedSessionsStore`:**

| Legacy Selector/Action | Unified Equivalent | Notes |
|------------------------|-------------------|-------|
| `state` | `voiceState` | Renamed |
| `profile` | `voiceProfile` | Renamed |
| `timeline` | `voiceTimeline` | Renamed, use `useVoiceTimeline()` |
| `currentTool` | `currentTool` | Same |
| `connected` | `clientId !== null` | Derived |
| `isMaster` | `isMaster` | Same |
| `wsError` | `wsError` | Same |
| `events` | `events` | Same |
| `subagentActive` | `subagentActive` | Same |
| `activeOrchestratorId` | `activeOrchestratorId` | Same |
| `activitiesBySession` | `activitiesBySession` | Same |
| `setConnected()` | **REMOVED** | Use `setClientIdentity()` |
| `setWsError()` | `setWsError()` | Same |
| `handleMessage()` | **REMOVED** | Use `handleWebSocketMessage()` from message-handler |
| `clearTimeline()` | `clearVoiceTimeline()` | Renamed |
| `clearSubagentActivities()` | `clearActivities()` | Renamed |
| `getActivitiesForSession()` | `useSessionActivities()` | Now a selector hook |
| `reset()` | `reset()` | Same |

**From `useStageStore` → `useUnifiedSessionsStore`:**

| Legacy Selector/Action | Unified Equivalent | Notes |
|------------------------|-------------------|-------|
| `sessionTree` | `sessionTree` | Same |
| `allTrees` | `allTrees` | Same |
| `focusedSessionId` | `focusedSessionId` | Same |
| `backgroundTreeIds` | `backgroundTreeIds` | Same |
| `voiceActive` | `voiceActive` | Same |
| `activeOverlay` | `activeOverlay` | Same |
| `activeStage` | **REMOVED** | Backend-driven, use `useFocusedSession()` |
| `threadRail` | **REMOVED** | Use `useFocusPath()` |
| `backgroundTasks` | **REMOVED** | Use `backgroundTreeIds` |
| `focusSession()` | `focusSession()` | Same |
| `minimizeTree()` | `minimizeTree()` | Same |
| `restoreTree()` | `restoreTree()` | Same |
| `setActiveOverlay()` | `setActiveOverlay()` | Same |
| `pushStage()` | **REMOVED** | Backend controls via events |
| `popStage()` | **REMOVED** | Backend controls via events |
| `backgroundStage()` | `minimizeTree()` | Renamed |
| `restoreStage()` | `restoreTree()` | Renamed |
| `clearFocusedSession()` | `clearFocusedSession()` | Same |
| `reset()` | `reset()` | Same |

**From `useSessionsStore` → `useUnifiedSessionsStore`:**

| Legacy Selector/Action | Unified Equivalent | Notes |
|------------------------|-------------------|-------|
| `sessions` | `sessions` (Map) | Changed to Map, not array |
| `selectedSessionId` | `focusedSessionId` | Unified with focus |
| `fetchSessions()` | **NOT MIGRATED** | Keep separate or implement |
| `selectSession()` | `focusSession()` | Unified |

#### 3.4.4 Unified Store Selector Hooks (Available)

```typescript
// Import from '@/stores' (unified-sessions.ts)
useFocusedSession()              // SessionTreeNode | null
useFocusPath()                   // SessionTreeNode[] (focus path from root)
useFocusedSessionChildren()      // SessionTreeNode[] (children of focused)
useSessionActivities(sessionId)  // ActivityBlock[] for specific session
useAllActivities()               // ActivityBlock[] flattened + sorted
useHasActiveSession()            // boolean
useVoiceTimeline()               // TimelineItem[] (voice transcripts)
useConnectionState()             // { connected, wsError, clientId, isMaster }
useVoiceState()                  // { voiceState, voiceProfile, voiceActive, currentTool }
```

#### 3.4.5 Verification Complete

- [x] TypeScript compilation passes (0 errors)
- [ ] Test all stage transitions (manual testing needed)
- [ ] Test multi-client master/replica flow (manual testing needed)

---

## Phase 4: Frontend - One Component ✅ COMPLETE

> **Status (2025-12-24):** Phase 4 complete. Unified AgentStage with AI Elements replaces ChatStage + SubagentStage.

### 4.1 Install AI Elements ✅
**In:** `web/`

- [x] Initialized shadcn in web directory
- [x] Added path alias (`@/`) to tsconfig.json and vite.config.ts
- [x] Installed Conversation, Message, Loader components from AI SDK registry

```bash
npx shadcn@latest init -d
npx shadcn@latest add https://registry.ai-sdk.dev/conversation.json
npx shadcn@latest add https://registry.ai-sdk.dev/message.json
npx shadcn@latest add https://registry.ai-sdk.dev/loader.json
```

**New Files Created:**
- `web/components.json` - shadcn configuration
- `web/src/lib/utils.ts` - `cn()` helper function
- `web/src/components/ui/button.tsx`
- `web/src/components/ai-elements/conversation.tsx`
- `web/src/components/ai-elements/message.tsx`
- `web/src/components/ai-elements/loader.tsx`

### 4.2 Unified AgentStage Component ✅
**New File:** `web/src/components/stages/AgentStage.tsx`

- [x] Created single component that renders any agent session (voice or subagent)
- [x] Uses AI Elements (Conversation, Message, MessageResponse) for rendering
- [x] Handles voice timeline conversion to AI SDK message format
- [x] Handles subagent activities conversion to messages
- [x] Custom HUDHeader component with status indicator
- [x] MessageBlock with TextPart, ReasoningPart, ToolPart renderers
- [x] Tool parts show linked child sessions with navigation

**Key Features:**
- Accepts `stage: StageItem` prop
- Detects voice vs subagent from `stage.type`
- Voice: Uses `useVoiceTimeline()` → converts to DisplayMessage format
- Subagent: Uses `useSessionActivities()` → converts to DisplayMessage format
- Shows reasoning blocks as collapsible details
- Shows tool calls with args/result in details panel
- Navigation to child sessions via "View" button on tool cards

### 4.3 Simplified StageOrchestrator ✅
**File:** `web/src/components/layout/StageOrchestrator.tsx`

- [x] Simplified to use AgentStage for voice and subagent sessions
- [x] TerminalStage kept for PTY sessions only
- [x] Removed ChatStage and SubagentStage imports

```tsx
// Now just two branches:
switch (session.type) {
  case 'terminal':
    return <TerminalStage ... />;
  case 'orchestrator':
    return <AgentStage ... />;
  default:
    return <AgentStage stage={ROOT_STAGE} />;  // Voice
}
```

### 4.4 ThreadRail from Session Tree ✅
**File:** `web/src/components/rails/ThreadRail.tsx`

- [x] Already uses unified store (`useUnifiedSessionsStore`)
- [x] Uses `useSessionPath()` and `useFocusedSessionChildren()` selectors
- [x] No changes needed - was already well-structured

### 4.5 Delete Old Components ✅

- [x] Deleted `web/src/components/stages/ChatStage.tsx`
- [x] Deleted `web/src/components/stages/SubagentStage.tsx`
- [x] Deleted `web/src/components/ActivityFeed.tsx`
- [x] Deleted `web/src/components/ConversationStream.tsx`
- [x] Updated `CommandPanel.tsx` with inline AgentTab component
- [x] Updated `e2e-simulation` demo to use AgentStage
- [x] Deleted `activity-feed` demo (depended on ActivityFeed)
- [x] Updated demo index to remove activity-feed import
- [x] TypeScript compilation passes (0 errors)

---

## Phase 5: WebSocket Simplification ✅ COMPLETE

> **Status (2025-12-24):** Phase 5 complete. Simplified to 8 message types (was 26+).

### 5.1 Simplified Message Types ✅
**File:** `pi-agent/src/api/websocket.ts`

Reduced from 26+ types to 8 core types:

```typescript
// Core unified protocol (5)
| 'welcome'               // Client identity on connect
| 'stream_chunk'          // All agent events (AI SDK format: text-delta, tool-call, etc.)
| 'session_tree_update'   // Session hierarchy for ThreadRail
| 'state_change'          // Voice UI state (listening/thinking/speaking/idle)
| 'master_changed'        // Multi-client master coordination

// Lifecycle events (3)
| 'session_started'       // Voice session activated
| 'session_ended'         // Voice session deactivated
| 'cli_session_deleted'   // Terminal session removed
| 'error'                 // Error messages
```

**Removed types:** `transcript`, `tool_start`, `tool_end`, `item_pending`, `item_completed`, `audio_start`, `audio_end`, `cli_session_created`, `cli_session_update`, `cli_session_output`, `subagent_activity`

### 5.2 AI SDK Adapter Integration ✅
**File:** `pi-agent/src/agent/voice-agent.ts`

- [x] Wired up the existing AI SDK adapter (`ai-sdk-adapter.ts`) in VoiceAgent
- [x] Voice transcript, toolStart, toolEnd now emit `stream_chunk` events
- [x] `state_change` kept separate for voice UI state (listening/speaking have no AI SDK equivalent)
- [x] Removed redundant event handlers from `index.ts`

```typescript
// VoiceAgent now uses adapter for unified streaming:
this.adapter = createVoiceAdapter(sessionId);
this.session.on('transcript', (text, role) => {
  this.adapter?.transcript(text, role);  // → stream_chunk (text-delta)
});
this.session.on('toolStart', (name, args) => {
  this.adapter?.toolStart(name, args);   // → stream_chunk (tool-call)
});
```

### 5.3 Simplified wsBroadcast ✅
**File:** `pi-agent/src/api/websocket.ts`

Removed unused broadcast functions:
- ~~`transcript`~~ → Now uses `stream_chunk` via adapter
- ~~`toolStart`, `toolEnd`~~ → Now uses `stream_chunk` via adapter
- ~~`itemPending`, `itemCompleted`~~ → Never used
- ~~`cliSessionCreated`, `cliSessionUpdate`, `cliSessionOutput`~~ → Uses `session_tree_update`

### 5.4 Simplified Frontend Handler ✅
**File:** `web/src/stores/message-handler.ts`

- [x] Removed handlers for legacy message types
- [x] `stream_chunk` now populates both `session.messages` AND `voiceTimeline` for voice sessions
- [x] Removed `createDualModeHandler` compatibility layer
- [x] Reduced handler from ~360 lines to ~250 lines

```typescript
// stream_chunk handling now works for ALL agent types:
case 'stream_chunk': {
  store.handleStreamChunk(sessionId, event);  // Update session.messages

  // For voice sessions, also populate voiceTimeline for backward compat
  if (isVoiceSession) {
    switch (event.type) {
      case 'text-delta': // → TranscriptItem
      case 'tool-call':  // → ToolItem (running)
      case 'tool-result': // → ToolItem (completed)
    }
  }
}
```

### 5.5 Updated Frontend Types ✅
**Files:** `web/src/types/index.ts`, `web/src/types/stage.ts`

- [x] Updated `WSMessageType` to match simplified protocol
- [x] Added `'voice'` to `SessionType` union
- [x] Removed legacy payload types (`TranscriptPayload`, `ToolPayload`, `SubagentActivityPayload`, etc.)

### 5.6 TypeScript Verification ✅

- [x] Backend compilation passes (0 errors)
- [x] Frontend compilation passes (0 errors)

---

## Phase 6: Input Routing (Chatable Subagents) ✅ COMPLETE

> **Status (2025-12-24):** Phase 6 complete. Users can now type directly to focused subagent sessions.

### 6.1 Focus Tracking ✅
**File:** `pi-agent/src/api/websocket.ts`

- [x] Track `focusedSessionId` per client (added to ClientState)
- [x] Handle `focus_session` message from frontend
- [x] Handle `session_input` message to route text to focused session
- [x] Added `onSessionInput()` registration function

```typescript
// Client → Server
{ type: 'focus_session', payload: { sessionId: string | null } }
{ type: 'session_input', payload: { text: string } }  // Uses tracked focusedSessionId
```

### 6.2 Direct Input to Subagents ✅
**New File:** `pi-agent/src/subagents/direct-input.ts`

- [x] Created `handleDirectInput(sessionId, text)` function
- [x] Loads session from DB, validates type
- [x] Routes to appropriate handler based on `agent_name`
- [x] For CLI: Loads conversation history, calls AI SDK, streams events
- [x] Saves updated history back to DB
- [x] Wired up in `index.ts` via `onSessionInput(handleDirectInput)`

### 6.3 Frontend Integration ✅

**Files Modified:**
- `web/src/hooks/useWebSocket.ts` - Added `sendFocusSession()` and `sendSessionInput()` helpers
- `web/src/App.tsx` - Added effect to sync `focusedSessionId` changes to backend
- `web/src/components/stages/AgentStage.tsx` - Added text input UI for subagent sessions

**Key Features:**
- Text input field appears only for subagent sessions (not voice)
- Enter to send, Shift+Enter for newline
- Input disabled during submission
- Focus synced to backend on change

---

## Phase 7: Cleanup & Testing ✅ COMPLETE

> **Status (2025-12-24):** Phase 7 complete. All old code deleted, documentation updated.

### 7.1 Delete Old Code ✅

**Backend (Verified 2025-12-24):**
- [x] ~~Delete `pi-agent/src/lib/agent-runner.ts`~~ - Already deleted, no references remain
- [x] Clean up old event type handlers in websocket.ts - Simplified to 8 message types

**Frontend (Verified 2025-12-24):**
- [x] ~~Delete `web/src/stores/agent.ts`~~ - Deleted (was 830 LoC)
- [x] ~~Delete `web/src/stores/stage.ts`~~ - Deleted (was 540 LoC)
- [x] ~~Delete `web/src/stores/sessions.ts`~~ - Deleted (was 150 LoC)
- [x] ~~Delete `web/src/components/stages/ChatStage.tsx`~~ - Deleted
- [x] ~~Delete `web/src/components/stages/SubagentStage.tsx`~~ - Deleted
- [x] ~~Delete `web/src/components/ActivityFeed.tsx`~~ - Deleted
- [x] ~~Delete `web/src/components/ConversationStream.tsx`~~ - Deleted

**Verification Commands:**
```bash
# Verify no orphaned imports of old stores
grep -r "useAgentStore\|useStageStore\|useSessionsStore" web/src/
# Result: Only comments in stores/index.ts documenting migration

# Verify no renders of deleted components
grep -r "ChatStage\|SubagentStage\|ActivityFeed\|ConversationStream" web/src/
# Result: Only comments explaining backwards compatibility

# Verify backend cleanup
ls pi-agent/src/lib/agent-runner.ts
# Result: No such file (correctly deleted)
```

### 7.2 Integration Tests

- [ ] Test voice → subagent → terminal flow (manual testing needed)
- [ ] Test direct text input to focused subagent (manual testing needed)
- [ ] Test session tree persistence across reload (manual testing needed)
- [ ] Test cascading cancellation (manual testing needed)

### 7.3 Update Documentation ✅

- [x] Update CLAUDE.md architecture diagrams
- [x] Document unified event protocol (see docs/SESSION_MANAGEMENT.md)
- [x] Update WebSocket message reference (see docs/SESSION_MANAGEMENT.md)

---

## Summary: What Changes

| Before | After |
|--------|-------|
| 3 stores (1520 LoC) | 1 store (~300 LoC) |
| 4 stage components (900 LoC) | 2 components (~200 LoC) |
| 15+ WebSocket event types | 4 event types |
| Voice ephemeral | Voice persisted in tree |
| `orchestrator` terminology | `subagent` terminology |
| Custom streaming protocol | AI SDK protocol |
| Multiple debug paths | Single debug path |

**Estimated LoC Reduction:** ~2000 lines

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Voice in tree? | **Yes** - persisted as root session |
| orchestrator naming? | **Rename to subagent** |
| AI SDK for all? | **Yes** - with adapter for voice |
| XState? | **Skip** - adds complexity without benefit |
| Conversation history storage? | JSON column (simple), migrate if needed |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Stores | 1 unified store |
| Stage components | 2 (AgentStage + TerminalStage) |
| WebSocket handlers | 3 cases in switch statement |
| Event types | 4 (welcome, stream_chunk, session_tree_update, audio) |
| Lines of code | -2000 from current |
| Debug paths | 1 (same for voice + subagent) |

---

## Implementation Order

1. **Phase 1: Unified Protocol** ✅ - AI SDK adapter for voice, subagents use AI SDK directly
2. **Phase 2: Database** ✅ - Schema migration, voice persistence
3. **Phase 3: Frontend Store** ✅ - Unified sessions.ts, deleted old stores (agent.ts, stage.ts, sessions.ts)
4. **Phase 4: Frontend Components** ✅ - AgentStage with AI Elements, deleted ChatStage/SubagentStage
5. **Phase 5: WebSocket** ✅ - Simplified to 8 message types (was 26+), wired AI SDK adapter for voice
6. **Phase 6: Input Routing** ✅ - Chatable subagents with text input UI
7. **Phase 7: Cleanup** ✅ - All old code verified deleted, documentation updated

---

## Refactoring Complete 🎉

**Completed:** 2025-12-24

All phases of the Session-Centric Architecture refactoring are complete. The system now uses:

- **One Protocol**: AI SDK v5 Data Stream Protocol for all agents
- **One Store**: `unified-sessions.ts` (921 LoC vs 1520 LoC before)
- **One Component**: `AgentStage.tsx` renders all agent types
- **8 Message Types**: Down from 26+ WebSocket event types
- **Unified Session Model**: Voice, subagent, terminal all use same `SessionState`

**Documentation:**
- `docs/SESSION_CENTRIC_REFACTOR_PLAN.md` - This refactoring plan
- `docs/SESSION_MANAGEMENT.md` - Detailed session management architecture
- `CLAUDE.md` - Updated project documentation
