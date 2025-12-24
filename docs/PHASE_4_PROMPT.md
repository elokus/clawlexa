# Phase 4: Frontend - One Component

## Session Context

You are continuing a major refactoring effort for a voice agent web dashboard. **Phases 1-3 are COMPLETE.** This session focuses on Phase 4.

### What Was Completed (DO NOT REDO)

- **Phase 1**: AI SDK adapter for voice, subagents use AI SDK directly
- **Phase 2**: Database schema migration, voice session persistence
- **Phase 3**: Frontend unified store migration - ALL components now use `useUnifiedSessionsStore`

### Critical: No Legacy Code Remains

The following stores have been **DELETED** and no longer exist:
- `web/src/stores/agent.ts` - DELETED
- `web/src/stores/stage.ts` - DELETED
- `web/src/stores/sessions.ts` - DELETED

**All components now import from `@/stores` which exports from `unified-sessions.ts`.**

If you see any imports from deleted stores, they are bugs that need fixing - but this should not happen as Phase 3 is verified complete with 0 TypeScript errors.

---

## Your Task: Phase 4 - Unified Component Architecture

### Goal

Replace multiple stage components (`ChatStage`, `SubagentStage`) with a single `<AgentStage />` component using Vercel AI Elements (shadcn-based AI components).

### Before You Start

**MANDATORY: Explore the codebase first.** Do not make changes until you understand:

1. **Current Stage Components**
   - Read `web/src/components/stages/ChatStage.tsx`
   - Read `web/src/components/stages/SubagentStage.tsx`
   - Read `web/src/components/stages/TerminalStage.tsx`
   - Understand what each renders and their props

2. **Unified Store Structure**
   - Read `web/src/stores/unified-sessions.ts` (the ONLY store)
   - Understand `SessionState`, `Message`, `MessagePart` types
   - Review available selector hooks: `useFocusedSession()`, `useVoiceTimeline()`, `useSessionActivities()`, etc.

3. **Current Orchestration**
   - Read `web/src/components/layout/StageOrchestrator.tsx`
   - Understand how it decides which stage to render
   - Note the `StageItem` type and how it maps to sessions

4. **Message Handler**
   - Read `web/src/stores/message-handler.ts`
   - Understand how WebSocket events populate the store

5. **Refactoring Plan**
   - Read `docs/SESSION_CENTRIC_REFACTOR_PLAN.md` - Phase 4 section
   - Note the AI Elements components to install
   - Understand the target architecture

---

## Phase 4 Implementation Steps

### 4.1 Install AI Elements

```bash
cd web
npx shadcn@latest add https://registry.ai-sdk.dev/conversation.json
npx shadcn@latest add https://registry.ai-sdk.dev/message.json
npx shadcn@latest add https://registry.ai-sdk.dev/loader.json
```

**Exploration Task:** After installing, read the generated component files in `web/src/components/ui/` to understand their API.

### 4.2 Create Unified AgentStage Component

**New File:** `web/src/components/stages/AgentStage.tsx`

Requirements:
- Renders ANY agent session (voice or subagent)
- Uses AI Elements `<Conversation>` and `<Message>` components
- Gets session data via `sessionId` prop
- Shows messages with proper parts rendering (text, tool-call, tool-result, reasoning)
- Handles streaming state indicators
- Includes chat input for direct interaction (future Phase 6 prep)

Key data flow:
```typescript
// Session from unified store
const session = useUnifiedSessionsStore((s) => s.sessions.get(sessionId));

// Or for focused session
const focused = useFocusedSession();

// Messages are in AI SDK format
session.messages.forEach(msg => {
  msg.parts.forEach(part => {
    // part.type: 'text' | 'tool-call' | 'tool-result' | 'reasoning'
  });
});
```

### 4.3 Simplify StageOrchestrator

**Modify:** `web/src/components/layout/StageOrchestrator.tsx`

Target logic:
```tsx
export function StageOrchestrator() {
  const focusedSession = useFocusedSession();

  if (!focusedSession) {
    return <IdleView />;  // Or voice ChatStage as root
  }

  if (focusedSession.type === 'terminal') {
    return <TerminalStage sessionId={focusedSession.id} />;
  }

  // Both 'voice' and 'subagent' use AgentStage
  return <AgentStage sessionId={focusedSession.id} />;
}
```

### 4.4 Update ThreadRail

**Modify:** `web/src/components/rails/ThreadRail.tsx`

- Simplify to read session tree from store
- Remove complex tree derivation (already done in store)
- Use `useFocusPath()` for breadcrumb path

### 4.5 Delete Old Components (After AgentStage Works)

Only delete AFTER verifying AgentStage works:
- `web/src/components/stages/ChatStage.tsx`
- `web/src/components/stages/SubagentStage.tsx`
- `web/src/components/ActivityFeed.tsx` (if absorbed into AgentStage)
- `web/src/components/ConversationStream.tsx` (if absorbed into AgentStage)

---

## Important Patterns

### Store Access (Always Use Unified Store)

```typescript
// CORRECT - import from @/stores
import { useUnifiedSessionsStore, useFocusedSession } from '@/stores';

// WRONG - these files don't exist
import { useAgentStore } from '@/stores/agent';  // DELETED
import { useStageStore } from '@/stores/stage';  // DELETED
```

### Session Types

```typescript
type SessionType = 'voice' | 'subagent' | 'terminal';

// voice and subagent both have messages - use AgentStage
// terminal is special - keep TerminalStage for PTY rendering
```

### Message Parts (AI SDK Format)

```typescript
type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool-result'; toolName: string; toolCallId: string; result: unknown }
  | { type: 'reasoning'; text: string };
```

### Voice Timeline vs Session Messages

- `useVoiceTimeline()` - Legacy format for voice transcripts (TranscriptItem, ToolItem)
- `session.messages` - AI SDK format with parts

During Phase 4, you may need to support both or migrate voice to use messages.

---

## Verification Checklist

Before considering Phase 4 complete:

- [ ] AI Elements installed and components generated
- [ ] `AgentStage.tsx` created and renders voice sessions
- [ ] `AgentStage.tsx` renders subagent sessions with activities
- [ ] `StageOrchestrator.tsx` simplified to use AgentStage
- [ ] `ThreadRail.tsx` simplified (if needed)
- [ ] TypeScript compilation passes (0 errors)
- [ ] Old stage components deleted (ChatStage, SubagentStage)
- [ ] Documentation updated in `SESSION_CENTRIC_REFACTOR_PLAN.md`

---

## File Reference

Key files to understand:
```
web/src/
├── stores/
│   ├── index.ts                 # Exports from unified-sessions
│   ├── unified-sessions.ts      # THE store (959 lines)
│   └── message-handler.ts       # WebSocket → store routing
├── components/
│   ├── layout/
│   │   └── StageOrchestrator.tsx    # Main layout, decides which stage
│   ├── stages/
│   │   ├── ChatStage.tsx            # Voice conversation (TO DELETE)
│   │   ├── SubagentStage.tsx        # Subagent activities (TO DELETE)
│   │   └── TerminalStage.tsx        # PTY terminal (KEEP)
│   ├── rails/
│   │   ├── ThreadRail.tsx           # Right rail breadcrumb
│   │   └── BackgroundRail.tsx       # Left dock
│   ├── ActivityFeed.tsx             # Activity block renderer (TO DELETE?)
│   └── ConversationStream.tsx       # Message list (TO DELETE?)
├── hooks/
│   └── useWebSocket.ts              # WebSocket singleton
└── types/
    └── index.ts                     # Type definitions
```

---

## Starting the Work

1. **First Message:** "I'm starting Phase 4 of the session-centric refactoring. Let me explore the current codebase to understand the stage components and unified store structure."

2. **Use Explore Agent:** For understanding component structure and data flow

3. **Read Key Files:** Before making any changes

4. **Install AI Elements First:** Then explore the generated components

5. **Build Incrementally:** Create AgentStage, verify it works, then delete old components

Good luck! The goal is to reduce complexity by having ONE component that renders any agent type.
