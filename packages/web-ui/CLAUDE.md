# Web Dashboard - CLAUDE.md

React + Bun + TypeScript web dashboard for the Voice Agent system.

## Quick Start

```bash
cd web
bun install
bun run dev        # Dev server at http://localhost:5173
bun run typecheck  # Type checking
bun run build      # Production build
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
│ BackgroundRail │         │   ActiveStage   │         │   ThreadRail    │
│ (Left 80px)    │         │   (Center)      │         │   (Right 360px) │
│                │         │                 │         │                 │
│ - Minimized    │         │  AgentStage     │         │ - Focus path    │
│   session      │         │  (voice/subagent)│        │ - Child sessions│
│   trees        │         │  ────────────── │         │                 │
│                │         │  TerminalStage  │         │                 │
│                │         │  (terminal)     │         │                 │
└───────────────┘         └─────────────────┘         └─────────────────┘
```

## Session-Centric Architecture

The dashboard uses a **unified session model** where all agent sessions (voice, subagent, terminal) are managed through a single store and rendered by unified components.

### Session Types

| Type | Description | Renderer |
|------|-------------|----------|
| `voice` | Root conversation (OpenAI Realtime API) | AgentStage |
| `subagent` | Delegated agent (CLI, web_search) | AgentStage |
| `terminal` | PTY process (tmux + Claude Code) | TerminalStage |

### Unified Store (`stores/unified-sessions.ts`)

Single Zustand store managing all session/agent state:

```typescript
interface UnifiedSessionsStore {
  // Connection
  clientId: string | null;
  isMaster: boolean;
  wsError: string | null;

  // Voice State
  voiceState: AgentState;        // 'idle' | 'listening' | 'thinking' | 'speaking'
  voiceProfile: string | null;   // 'jarvis' | 'marvin'
  voiceTimeline: TimelineItem[]; // Transcript + tool items
  currentTool: { name, args } | null;

  // Session Tree
  sessionTree: SessionTreeNode | null;
  allTrees: SessionTreeNode[];
  focusedSessionId: string | null;
  backgroundTreeIds: Set<string>;

  // Sessions
  sessions: Map<string, SessionState>;  // O(1) lookup by ID

  // Activities
  activitiesBySession: Map<string, ActivityBlock[]>;
  subagentActive: boolean;
  activeOrchestratorId: string | null;

  // Actions
  handleStreamChunk(sessionId: string, event: AISDKStreamEvent): void;
  handleSessionTreeUpdate(data: SessionTreeUpdatePayload): void;
  focusSession(sessionId: string): void;
  minimizeTree(rootId: string): void;
  restoreTree(rootId: string): void;
  // ...
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
useActiveView()                  // 'sessions' | 'prompts'
usePromptsState()                // { prompts, selectedPromptId, promptContent, ... }
```

## WebSocket Messages (8 Core Types)

| Type | Direction | Purpose |
|------|-----------|---------|
| `welcome` | Server→Client | Client identity on connect |
| `stream_chunk` | Server→Client | All agent events (AI SDK format) |
| `session_tree_update` | Server→Client | Session hierarchy changes |
| `state_change` | Server→Client | Voice UI state |
| `master_changed` | Server→Client | Multi-client coordination |
| `session_started/ended` | Server→Client | Voice session lifecycle |
| `cli_session_deleted` | Server→Client | Terminal session cleanup |
| `error` | Server→Client | Error notification |

### Client → Server

| Type | Purpose |
|------|---------|
| `request_master` | Request audio control |
| `focus_session` | Set focused session |
| `session_input` | Send text to focused subagent |

## Key Components

### Stages (`components/stages/`)

| Component | File | Description |
|-----------|------|-------------|
| `AgentStage` | `AgentStage.tsx` | Unified renderer for voice + subagent sessions |
| `TerminalStage` | `TerminalStage.tsx` | PTY terminal with xterm.js |

### Rails (`components/rails/`)

| Component | File | Description |
|-----------|------|-------------|
| `ThreadRail` | `ThreadRail.tsx` | Session tree navigation (focus path + children) |
| `BackgroundRail` | `BackgroundRail.tsx` | Minimized session trees |

### AI Elements (`components/ai-elements/`)

Vercel AI SDK UI components for streaming message display:

| Component | Purpose |
|-----------|---------|
| `Conversation` | Message list container |
| `Message` | Individual message with parts |
| `Loader` | Loading/streaming states |

### Prompts (`components/prompts/`)

Prompt management UI for editing agent prompts:

| Component | File | Description |
|-----------|------|-------------|
| `PromptsView` | `PromptsView.tsx` | Main 2-panel layout (sidebar + editor) |
| `PromptsSidebar` | `PromptsSidebar.tsx` | Prompt list grouped by type |
| `PromptEditor` | `PromptEditor.tsx` | Version dropdown, save, set active, textarea |

Access via "=" button in BackgroundRail. Uses `activeView` state to toggle between sessions and prompts views.

## Stores (`stores/`)

| Store | File | Purpose |
|-------|------|---------|
| `useUnifiedSessionsStore` | `unified-sessions.ts` | All session/agent state (921 LoC) |
| `handleWebSocketMessage` | `message-handler.ts` | WebSocket event routing |

### Legacy Stores (Deleted)

The following stores were deleted in the Session-Centric refactor:
- ~~`agent.ts`~~ → Use `useUnifiedSessionsStore` + `useVoiceState()`, `useVoiceTimeline()`
- ~~`stage.ts`~~ → Use `useUnifiedSessionsStore` + `useFocusedSession()`, `useFocusPath()`
- ~~`sessions.ts`~~ → Use `useUnifiedSessionsStore.sessions` Map

## Hooks (`hooks/`)

| Hook | File | Purpose |
|------|------|---------|
| `useWebSocket` | `useWebSocket.ts` | Singleton WebSocket connection |
| `useAudioSession` | `useAudioSession.ts` | Mic/speaker for master clients |

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
cd pi-agent && bun run dev &
cd web && bun run dev
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

## File Structure

```
web/src/
├── main.tsx                 # Entry point with routing
├── App.tsx                  # Main layout with ControlBar
├── components/
│   ├── layout/
│   │   └── StageOrchestrator.tsx  # 3-column grid layout
│   ├── stages/
│   │   ├── AgentStage.tsx         # Unified agent view (voice + subagent)
│   │   └── TerminalStage.tsx      # PTY terminal view
│   ├── rails/
│   │   ├── BackgroundRail.tsx     # Left dock (minimized sessions)
│   │   └── ThreadRail.tsx         # Right breadcrumb rail
│   ├── ai-elements/               # AI SDK UI components
│   │   ├── conversation.tsx
│   │   ├── message.tsx
│   │   └── loader.tsx
│   ├── prompts/                   # Prompt management UI
│   │   ├── PromptsView.tsx        # Main 2-panel layout
│   │   ├── PromptsSidebar.tsx     # Prompt list by type
│   │   └── PromptEditor.tsx       # Editor with version control
│   ├── ui/                        # shadcn/ui components
│   └── overlays/                  # Modal overlays
├── hooks/
│   ├── useWebSocket.ts            # WebSocket singleton
│   └── useAudioSession.ts         # Audio I/O control
├── stores/
│   ├── unified-sessions.ts        # All session/agent state
│   ├── message-handler.ts         # WebSocket event routing
│   └── index.ts                   # Store exports + selectors
├── types/
│   ├── index.ts                   # Main types
│   └── stage.ts                   # Stage-specific types
├── lib/
│   ├── utils.ts                   # Utility functions (cn, etc.)
│   └── prompts-api.ts             # Prompts REST API client
├── dev/                           # Component dev environment
│   ├── DevPage.tsx
│   ├── registry.ts
│   └── demos/
└── styles/
    └── index.css                  # Global styles + CSS vars
```

## Common Patterns

### Using the Unified Store

```typescript
import {
  useUnifiedSessionsStore,
  useFocusedSession,
  useFocusPath,
  useVoiceTimeline,
  useSessionActivities,
} from '@/stores';

function MyComponent() {
  // Get current focused session
  const focusedSession = useFocusedSession();

  // Get breadcrumb path
  const focusPath = useFocusPath();

  // Get voice timeline (for voice sessions)
  const voiceTimeline = useVoiceTimeline();

  // Get activities for a specific session
  const activities = useSessionActivities(sessionId);

  // Direct store access for actions
  const focusSession = useUnifiedSessionsStore((s) => s.focusSession);
  const minimizeTree = useUnifiedSessionsStore((s) => s.minimizeTree);

  // ...
}
```

### Handling New WebSocket Events

1. Add type to `WSMessageType` in `types/index.ts`
2. Add handler in `stores/message-handler.ts`
3. Add action/state in `stores/unified-sessions.ts` if needed
4. Update UI components to reflect new state
