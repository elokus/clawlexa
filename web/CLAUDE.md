# Web Dashboard - CLAUDE.md

React + Vite + TypeScript web dashboard for the Voice Agent system.

## Quick Start

```bash
cd web
npm install
npm run dev        # Dev server at http://localhost:5173
npm run typecheck  # Type checking
npm run build      # Production build
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              App.tsx                                         │
│  ├─ useWebSocket()     → WebSocket connection to pi-agent                   │
│  ├─ useAudioSession()  → Mic/speaker control (master clients only)          │
│  └─ StageOrchestrator  → Main 3-column layout                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  BackgroundRail │         │   ActiveStage   │         │   ThreadRail    │
│  (Left 80px)    │         │   (Center)      │         │   (Right 360px) │
│                 │         │                 │         │                 │
│  - Overlays     │         │  - ChatStage    │         │  - Breadcrumb   │
│  - Background   │         │  - SubagentStage│         │  - Parent stages│
│    tasks        │         │  - TerminalStage│         │                 │
└───────────────┘         └─────────────────┘         └─────────────────┘
```

## Stage Navigation System

The UI uses a **stack-based stage navigation** pattern where views can "drill down" into child contexts.

### Stage Types

| Type | Description | Icon | Color |
|------|-------------|------|-------|
| `chat` | Realtime Agent conversation (root) | ◎ | Emerald |
| `subagent` | Delegated agent activity (CLI Agent, etc.) | ◇ | Violet |
| `terminal` | CLI session output | ▣ | Cyan |

### Stage Store (`stores/stage.ts`)

```typescript
interface StageStore {
  activeStage: StageItem;      // Currently focused view (center)
  threadRail: StageItem[];     // Parent contexts (right rail breadcrumb)
  backgroundTasks: StageItem[]; // Minimized tasks (left rail)

  pushStage(item): void;       // Push new stage, current → threadRail
  popStage(): void;            // Pop back to parent from threadRail
  backgroundStage(id): void;   // Move stage to background
  restoreStage(id): void;      // Restore from background to active
}
```

### Navigation Flow Example

```
1. Initial State
   Active: ChatStage (Realtime Agent)
   ThreadRail: []

2. User triggers CLI Agent via voice
   → reasoning_start event for "Marvin"
   → pushStage({ type: 'subagent', title: 'Marvin' })
   Active: SubagentStage
   ThreadRail: [ChatStage]

3. CLI Agent starts terminal session
   → cli_session_created event
   → pushStage({ type: 'terminal', sessionId: '...' })
   Active: TerminalStage
   ThreadRail: [ChatStage, SubagentStage]

4. Session completes
   → popStage() after delay
   Active: SubagentStage
   ThreadRail: [ChatStage]

5. Subagent completes
   → popStage() after delay
   Active: ChatStage
   ThreadRail: []
```

## Subagent Activity System

### Event Flow

```
Backend (pi-agent)                    Frontend (web)
─────────────────                    ──────────────
AgentRunner.emit()
    │
    ▼ WebSocket
subagent_activity ──────────────────► useWebSocket.onmessage()
{                                        │
  agent: "Marvin",                       ▼
  type: "reasoning_start",           handleMessage() in agent store
  payload: {}                            │
}                                        ▼
                                     handleSubagentActivity()
                                         │
                                         ├─► pushStage() if new agent
                                         │
                                         └─► Create ActivityBlock
                                                 │
                                                 ▼
                                             SubagentStage renders blocks
```

### Event Types

| Event | Triggers | UI Effect |
|-------|----------|-----------|
| `reasoning_start` | Agent starts thinking | Push SubagentStage, create ReasoningBlock |
| `reasoning_delta` | Streaming reasoning text | Append to ReasoningBlock.content |
| `reasoning_end` | Reasoning complete | Mark block complete, show duration |
| `tool_call` | Tool invoked | Create ToolBlock (pending) |
| `tool_result` | Tool returns | Update ToolBlock with result |
| `response` | Final response | Create ContentBlock |
| `error` | Error occurred | Create ErrorBlock |
| `complete` | Agent finished | Set subagentActive=false, auto-pop stage |

### Activity Blocks (`types/index.ts`)

```typescript
type ActivityBlock = ReasoningBlock | ToolBlock | ContentBlock | ErrorBlock;

interface ReasoningBlock {
  type: 'reasoning';
  content: string;      // Accumulated reasoning text
  isComplete: boolean;
  durationMs?: number;  // From reasoning_end
}

interface ToolBlock {
  type: 'tool';
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result?: string;
  isComplete: boolean;
}

interface ContentBlock {
  type: 'content';
  text: string;
}

interface ErrorBlock {
  type: 'error';
  message: string;
}
```

## Key Components

### Stages (`components/stages/`)

| Component | File | Description |
|-----------|------|-------------|
| `ChatStage` | `ChatStage.tsx` | Realtime Agent conversation with ConversationStream |
| `SubagentStage` | `SubagentStage.tsx` | Activity stream for delegated agents |
| `TerminalStage` | `TerminalStage.tsx` | CLI session output with CRT effect |

### Stores (`stores/`)

| Store | File | Purpose |
|-------|------|---------|
| `useAgentStore` | `agent.ts` | Agent state, transcripts, subagent activities |
| `useStageStore` | `stage.ts` | Stage navigation stack |
| `useSessionsStore` | `sessions.ts` | CLI session management |

### Hooks (`hooks/`)

| Hook | File | Purpose |
|------|------|---------|
| `useWebSocket` | `useWebSocket.ts` | Singleton WebSocket connection |
| `useAudioSession` | `useAudioSession.ts` | Mic/speaker for master clients |

## WebSocket Messages

### Received from Backend

| Message | Handler | Effect |
|---------|---------|--------|
| `welcome` | Set clientId, isMaster | Identity for multi-client |
| `master_changed` | Update isMaster | Audio control handoff |
| `state_change` | Set agent state | UI state indicator |
| `transcript` | Add/update message | Conversation display |
| `subagent_activity` | handleSubagentActivity() | Stage transitions, activity blocks |
| `cli_session_created` | Push terminal stage | Navigate to terminal |
| `cli_session_update` | Update session, auto-pop | Session lifecycle |

### Sent to Backend

| Message | When | Purpose |
|---------|------|---------|
| `request_master` | User clicks "Take Control" | Request audio control |
| Binary audio | Recording active | Mic audio to backend |

## Multi-Client Pattern

The WebSocket server supports multiple browser clients with Master/Replica coordination:

- **Master**: Handles audio I/O (mic capture + speaker playback)
- **Replicas**: Receive state updates but no audio
- First client becomes Master automatically
- "Take Control" button lets replicas request Master role

```typescript
// In useWebSocket.ts - Module-level singleton
let globalWs: WebSocket | null = null;
let globalWsRefCount = 0;

// Prevents duplicate connections from React StrictMode double-mount
```

## Component Dev Environment

Access at `/dev` for isolated component testing with mock data.

```bash
# Run both servers
cd pi-agent && npm run dev &
cd web && npm run dev
open http://localhost:5173/dev
```

See `docs/COMPONENT_DEV.md` for adding new demos.

## Styling Patterns

### Design System Variables

```css
--color-void: #05050a;      /* Darkest background */
--color-abyss: #0a0a12;     /* Dark background */
--color-deep: #0f0f18;      /* Medium background */
--color-surface: #161622;   /* Card background */

--color-cyan: #38bdf8;      /* Terminal, tools */
--color-violet: #8b5cf6;    /* Reasoning, subagent */
--color-emerald: #34d399;   /* Success, content */
--color-amber: #f59e0b;     /* Warning, pending */
--color-rose: #f43f5e;      /* Error */
```

### Animation Patterns

- **Stage transitions**: Framer Motion with `layoutId` for shared element transitions
- **Pulsing indicators**: CSS `@keyframes pulse-glow` for active states
- **Border animations**: `pulse-violet`, `pulse-cyan` for active activity blocks

## File Structure

```
web/src/
├── main.tsx                 # Entry point with routing
├── App.tsx                  # Main layout with ControlBar
├── components/
│   ├── layout/
│   │   └── StageOrchestrator.tsx  # 3-column grid layout
│   ├── stages/
│   │   ├── ChatStage.tsx          # Realtime Agent view
│   │   ├── SubagentStage.tsx      # Delegated agent view
│   │   └── TerminalStage.tsx      # CLI session view
│   ├── rails/
│   │   ├── BackgroundRail.tsx     # Left dock
│   │   └── ThreadRail.tsx         # Right breadcrumb rail
│   ├── overlays/
│   │   └── ...                    # Modal overlays
│   ├── ConversationStream.tsx     # Chat message list
│   ├── ActivityFeed.tsx           # Activity block renderer
│   └── ControlBar.tsx             # Bottom mic/profile controls
├── hooks/
│   ├── useWebSocket.ts            # WebSocket singleton
│   └── useAudioSession.ts         # Audio I/O control
├── stores/
│   ├── agent.ts                   # Agent + subagent state
│   ├── stage.ts                   # Navigation stack
│   └── sessions.ts                # CLI sessions
├── types/
│   ├── index.ts                   # Main types
│   └── stage.ts                   # Stage-specific types
├── dev/                           # Component dev environment
│   ├── DevPage.tsx
│   ├── registry.ts
│   └── demos/
└── styles/
    └── index.css                  # Global styles + CSS vars
```

## Common Patterns

### Adding a New Stage Type

1. Add to `StageType` in `types/stage.ts`
2. Add fields to `StageData` if needed
3. Create `components/stages/NewStage.tsx`
4. Add case in `StageOrchestrator.tsx`
5. Add icon to `ThreadRail.tsx`

### Triggering Stage Navigation

```typescript
// Push new stage (from store handler or component)
import { useStageStore } from '../stores/stage';

useStageStore.getState().pushStage({
  id: 'unique-id',
  type: 'subagent',
  title: 'Agent Name',
  data: { agentName: 'Marvin' },
  status: 'active',
});

// Pop back to parent
useStageStore.getState().popStage();
```

### Handling New WebSocket Events

1. Add type to `WSMessageType` in `types/index.ts`
2. Add payload interface if needed
3. Add case in `handleMessage()` in `stores/agent.ts`
4. Update UI components to reflect new state
