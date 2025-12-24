# Phase 5: WebSocket Simplification

## Session Context

You are continuing a major refactoring effort for a voice agent web dashboard. **Phases 1-4 are COMPLETE.** This session focuses on Phase 5.

### What Was Completed (DO NOT REDO)

- **Phase 1**: AI SDK adapter for voice, subagents use AI SDK directly
- **Phase 2**: Database schema migration, voice session persistence
- **Phase 3**: Frontend unified store migration - ALL components now use `useUnifiedSessionsStore`
- **Phase 4**: Unified AgentStage component with AI Elements, deleted ChatStage/SubagentStage

### Critical: Legacy Code Still Exists (TO BE REMOVED)

The following legacy patterns need to be **REMOVED** in this phase:

1. **Dual-mode handler** in `web/src/stores/message-handler.ts` - routes to both old and new patterns
2. **Legacy event types** in `web/src/types/index.ts` - 15+ event types that should be 4
3. **Multiple WebSocket handlers** - giant switch statements with many cases

**Goal: Reduce, don't add. Simplify, don't support both.**

---

## Your Task: Phase 5 - WebSocket Simplification

### Goal

Reduce WebSocket message types from 15+ to 4 core types. Remove legacy event handlers. Simplify the frontend message routing.

### Target Architecture

```typescript
// AFTER: 4 core types only
type WSMessageType =
  | 'welcome'              // Client identity (clientId, isMaster)
  | 'stream_chunk'         // All agent events (AI SDK format)
  | 'session_tree_update'  // Tree structure changed
  | 'audio'                // Binary audio (voice only)
```

### Before You Start

**MANDATORY: Explore the codebase first.** Do not make changes until you understand:

1. **Current WebSocket Message Types**
   - Read `web/src/types/index.ts` - find `WSMessageType`
   - Understand all current event types being used
   - Identify which are legacy (can be removed)

2. **Message Handler**
   - Read `web/src/stores/message-handler.ts`
   - Understand `handleWebSocketMessage()` and `createDualModeHandler()`
   - Note which events are handled by unified store vs legacy

3. **useWebSocket Hook**
   - Read `web/src/hooks/useWebSocket.ts`
   - Understand how messages are routed
   - Find where `createDualModeHandler()` is used

4. **Backend WebSocket**
   - Read `pi-agent/src/api/websocket.ts`
   - Find all `broadcast()` calls and event types emitted
   - Identify which backend events map to which frontend handlers

5. **Unified Store**
   - Read `web/src/stores/unified-sessions.ts`
   - Understand `handleStreamChunk()` - the new unified handler
   - Understand `handleSubagentActivity()` - legacy handler still in use

6. **Refactoring Plan**
   - Read `docs/SESSION_CENTRIC_REFACTOR_PLAN.md` - Phase 5 section
   - Note the target: 4 message types, 3 switch cases

---

## Phase 5 Implementation Steps

### 5.1 Audit Current Event Types

First, create a complete inventory:

| Event Type | Backend Source | Frontend Handler | Keep/Remove |
|------------|----------------|------------------|-------------|
| `welcome` | websocket.ts | message-handler | **KEEP** |
| `stream_chunk` | AI SDK events | handleStreamChunk | **KEEP** |
| `session_tree_update` | session lifecycle | unified store | **KEEP** |
| `audio` | binary | audio handler | **KEEP** |
| `transcript` | voice-agent | ??? | REMOVE (use stream_chunk) |
| `subagent_activity` | agent-runner | handleSubagentActivity | REMOVE (use stream_chunk) |
| `state_change` | voice state | ??? | EVALUATE |
| ... | ... | ... | ... |

### 5.2 Backend: Consolidate Event Emission

**Files to modify:** `pi-agent/src/api/websocket.ts`, `pi-agent/src/realtime/ai-sdk-adapter.ts`

Ensure all events are emitted as `stream_chunk`:
- Voice transcripts → `stream_chunk` with `text-delta`
- Voice tools → `stream_chunk` with `tool-call`/`tool-result`
- Subagent events → `stream_chunk` (already done in Phase 1)

Remove or consolidate:
- `transcript` → use `stream_chunk`
- `tool_start`/`tool_end` → use `stream_chunk`
- `state_change` → either keep or embed in `stream_chunk`

### 5.3 Frontend: Remove Dual-Mode Handler

**File:** `web/src/stores/message-handler.ts`

Before:
```typescript
export function createDualModeHandler(legacyHandler: LegacyHandler) {
  return (msg: WSMessage) => {
    handleWebSocketMessage(msg);  // New
    legacyHandler(msg);           // Old
  };
}
```

After:
```typescript
// Just export handleWebSocketMessage directly
// Delete createDualModeHandler
// Delete all legacy handler calls
```

### 5.4 Frontend: Simplify useWebSocket

**File:** `web/src/hooks/useWebSocket.ts`

Remove:
- Import of `createDualModeHandler`
- Usage of legacy handler
- Complex handler composition

Simplify to:
```typescript
ws.onmessage = (event) => {
  if (typeof event.data !== 'string') {
    handleAudio(event.data);
    return;
  }
  const msg = JSON.parse(event.data);
  handleWebSocketMessage(msg);  // Single handler
};
```

### 5.5 Frontend: Clean Up Types

**File:** `web/src/types/index.ts`

Remove unused event types from `WSMessageType`. Keep only:
```typescript
export type WSMessageType =
  | 'welcome'
  | 'master_changed'        // Keep if still used
  | 'stream_chunk'
  | 'session_tree_update'
  | 'audio';
```

### 5.6 Frontend: Simplify message-handler.ts

**File:** `web/src/stores/message-handler.ts`

Target: Simple switch with 4-5 cases max:
```typescript
export function handleWebSocketMessage(msg: WSMessage): void {
  switch (msg.type) {
    case 'welcome':
      store.setClientIdentity(msg.payload.clientId, msg.payload.isMaster);
      break;
    case 'master_changed':
      store.setMaster(msg.payload.isMaster);
      break;
    case 'stream_chunk':
      store.handleStreamChunk(msg.payload.sessionId, msg.payload.event);
      break;
    case 'session_tree_update':
      store.handleSessionTreeUpdate(msg.payload);
      break;
    // No default - unknown types are ignored
  }
}
```

### 5.7 Backend: Clean Up websocket.ts

**File:** `pi-agent/src/api/websocket.ts`

Remove:
- Unused broadcast helpers
- Legacy event type definitions
- Handlers for deprecated events

Keep only:
- `wsBroadcast.welcome()`
- `wsBroadcast.masterChanged()`
- `wsBroadcast.streamChunk()`
- `wsBroadcast.sessionTreeUpdate()`
- Binary audio sending

---

## Important Patterns

### Store Access (Unified Store Only)

```typescript
// CORRECT
import { useUnifiedSessionsStore, handleWebSocketMessage } from '@/stores';

// WRONG - these patterns should be removed
import { createDualModeHandler } from '@/stores/message-handler';
```

### Event Type Mapping

| Old Event | New Event | Notes |
|-----------|-----------|-------|
| `transcript` | `stream_chunk` (text-delta) | Voice adapter emits this |
| `tool_start` | `stream_chunk` (tool-call) | Voice adapter emits this |
| `tool_end` | `stream_chunk` (tool-result) | Voice adapter emits this |
| `subagent_activity` | `stream_chunk` | Already migrated in Phase 1 |
| `cli_session_created` | `session_tree_update` | Tree includes new session |
| `cli_session_update` | `session_tree_update` | Tree reflects status change |
| `state_change` | Keep or `stream_chunk` (state) | Evaluate if needed |

### What NOT to Do

- **DON'T** add backward compatibility for old events
- **DON'T** keep dual handlers "just in case"
- **DON'T** add new abstractions - remove existing ones
- **DON'T** worry about breaking old code - it's been deleted

---

## Verification Checklist

Before considering Phase 5 complete:

- [ ] Audit complete: all event types documented with keep/remove decision
- [ ] `WSMessageType` reduced to 4-5 types
- [ ] `createDualModeHandler` deleted
- [ ] `message-handler.ts` has single `handleWebSocketMessage` with <10 cases
- [ ] `useWebSocket.ts` simplified to single handler
- [ ] Backend `websocket.ts` only emits 4 core event types
- [ ] TypeScript compilation passes (0 errors)
- [ ] No references to deleted event types remain

---

## File Reference

Key files to understand and modify:

```
web/src/
├── stores/
│   ├── index.ts                 # Exports from unified-sessions
│   ├── unified-sessions.ts      # THE store - handleStreamChunk lives here
│   └── message-handler.ts       # Routes WS events → TO SIMPLIFY
├── hooks/
│   └── useWebSocket.ts          # WebSocket singleton → TO SIMPLIFY
└── types/
    └── index.ts                 # WSMessageType → TO REDUCE

pi-agent/src/
├── api/
│   ├── websocket.ts             # WS server, broadcast helpers → TO SIMPLIFY
│   └── stream-types.ts          # AI SDK event types (keep)
└── realtime/
    └── ai-sdk-adapter.ts        # Voice → AI SDK events (already done)
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| WSMessageType cases | 15+ | 4-5 |
| message-handler.ts switch cases | Many | <10 |
| useWebSocket handler composition | Complex | Single function |
| Backend broadcast helpers | Many | 4 |
| Lines in message-handler.ts | ~200 | ~50 |

---

## Starting the Work

1. **First Message:** "I'm starting Phase 5 of the session-centric refactoring. Let me explore the current WebSocket implementation to understand the event types and message routing."

2. **Use Explore Agent:** For understanding backend event emission patterns

3. **Read Key Files:** Before making any changes, fully understand:
   - All places that emit WebSocket events
   - All places that handle WebSocket events
   - The flow from backend emission to frontend store update

4. **Create Audit Table:** Document all event types before removing any

5. **Delete Aggressively:** The old components are gone. The old stores are gone. The legacy handlers can go too.

Good luck! The goal is **simplification** - fewer event types, fewer handlers, fewer lines of code.
