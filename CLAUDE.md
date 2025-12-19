# Voice Agent - OpenAI Realtime API

Real-time voice agent running on Raspberry Pi 5 using OpenAI's Realtime API with wake word detection and tool support.

## Quick Start

```bash
cd pi-agent

# Install dependencies
npm install

# Run in development mode
npm run dev

# Say "Jarvis" or "Computer" to activate
```

## Project Setup

- **Runtime**: Node.js 20.x
- **Package Manager**: npm
- **Framework**: OpenAI Agents SDK (`@openai/agents`)
- **Database**: SQLite (better-sqlite3)
- **Wake Word**: Porcupine (Picovoice)

## Audio Hardware

- **Device**: Jabra Speak2 55 MS (USB)
- **Configured as**: Default sink and source via PipeWire
- **Audio Stack**: PipeWire 1.4.2

## Wake Words & Profiles

| Wake Word | Profile | Voice | Capabilities |
|-----------|---------|-------|--------------|
| **"Jarvis"** | Jarvis | echo | Todos, timers, lights, web search |
| **"Computer"** | Marvin | ash | CLI sessions, coding tasks on Mac |

Wake word engine: **Porcupine** (Picovoice, runs locally)

## Project Structure

```
voice-agent/
├── CLAUDE.md              # This file
├── .env                   # API keys (not in git)
├── docs/
│   └── IMPLEMENTATION_PLAN.md
│
├── web/                   # Web Dashboard (React + Vite + Bun)
│   ├── src/
│   │   ├── main.tsx          # Entry point with routing
│   │   ├── App.tsx           # Main dashboard layout
│   │   ├── components/       # UI components
│   │   │   ├── VoiceVisualizer.tsx  # Audio waveform animation
│   │   │   ├── StatusIndicator.tsx  # Connection/state display
│   │   │   ├── TranscriptView.tsx   # Conversation history
│   │   │   ├── SessionSidebar.tsx   # CLI sessions panel
│   │   │   └── EventLog.tsx         # Real-time event stream
│   │   ├── dev/              # Component Dev Environment (/dev)
│   │   │   ├── DevPage.tsx       # Dev page with sidebar
│   │   │   ├── registry.ts       # Demo registration
│   │   │   ├── components/       # Sidebar, Canvas, Controls
│   │   │   ├── hooks/            # Stream simulator
│   │   │   └── demos/            # Component demos
│   │   │       └── activity-feed/
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts      # WebSocket connection
│   │   ├── stores/           # Zustand state management
│   │   │   ├── agent.ts          # Agent state/transcripts
│   │   │   └── sessions.ts       # CLI sessions
│   │   ├── styles/
│   │   │   └── index.css         # Tailwind + dark theme
│   │   └── types/
│   │       └── index.ts          # TypeScript types
│   ├── package.json
│   └── vite.config.ts
│
└── pi-agent/              # TypeScript agent
    ├── src/
    │   ├── index.ts           # Main entry point
    │   ├── config.ts          # Configuration
    │   │
    │   ├── agent/             # Agent definitions
    │   │   ├── profiles.ts        # Wake word → profile mapping
    │   │   └── voice-agent.ts     # Main VoiceAgent class
    │   │
    │   ├── realtime/          # OpenAI Realtime SDK
    │   │   ├── index.ts
    │   │   └── session.ts         # RealtimeSession + state machine
    │   │
    │   ├── wakeword/          # Porcupine wake word detection
    │   │   ├── index.ts
    │   │   └── porcupine.ts       # Porcupine integration
    │   │
    │   ├── audio/             # Audio I/O
    │   │   ├── index.ts
    │   │   ├── capture.ts         # Microphone capture (pw-record)
    │   │   ├── playback.ts        # Speaker output (pw-play)
    │   │   ├── resample.ts        # Sample rate conversion
    │   │   └── tts.ts             # OpenAI TTS client
    │   │
    │   ├── lib/               # Shared utilities
    │   │   └── agent-runner.ts    # Observable agent runner (streaming)
    │   │
    │   ├── subagents/         # Modular subagents (config + prompts)
    │   │   ├── loader.ts          # Load config.json + PROMPT.md
    │   │   ├── cli/               # CLI orchestration agent
    │   │   │   ├── config.json        # Model: grok-code-fast-1
    │   │   │   ├── PROMPT.md          # System instructions + projects
    │   │   │   ├── tools.ts           # Session management tools
    │   │   │   └── index.ts           # handleDeveloperRequest
    │   │   └── web-search/        # Web search agent
    │   │       ├── config.json        # Model: grok-4.1-fast:online
    │   │       ├── PROMPT.md          # Search assistant instructions
    │   │       └── index.ts           # webSearchTool
    │   │
    │   ├── db/                # SQLite database
    │   │   ├── index.ts
    │   │   ├── database.ts        # Connection manager
    │   │   ├── schema.ts          # Migrations
    │   │   └── repositories/
    │   │       ├── cli-sessions.ts
    │   │       ├── cli-events.ts
    │   │       ├── timers.ts
    │   │       └── agent-runs.ts
    │   │
    │   ├── scheduler/         # Timer scheduler
    │   │   ├── index.ts
    │   │   └── time-parser.ts     # Natural language time parsing
    │   │
    │   ├── api/               # HTTP API
    │   │   ├── webhooks.ts        # Mac daemon webhook receiver
    │   │   └── websocket.ts       # WebSocket server for dashboard
    │   │
    │   └── tools/             # Agent tools
    │       ├── index.ts           # Tool registry
    │       ├── todo.ts            # Todo list (add, view, delete)
    │       ├── timer.ts           # Timers (set, list, cancel)
    │       ├── govee.ts           # Govee light control
    │       ├── reasoning.ts       # Deep thinking tool
    │       ├── mac-client.ts      # Mac daemon HTTP client
    │       └── developer-session.ts # Developer session tools
    │
    ├── package.json
    └── tsconfig.json
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RASPBERRY PI                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │   Porcupine     │    │   VoiceAgent    │    │    SQLite DB    │        │
│  │  Wake Word      │───▶│  + Profiles     │◀──▶│  (sessions,     │        │
│  │  Detection      │    │                 │    │   timers, etc)  │        │
│  └─────────────────┘    └────────┬────────┘    └─────────────────┘        │
│                                  │                                         │
│                    ┌─────────────┴─────────────┐                          │
│                    ▼                           ▼                          │
│         ┌─────────────────────┐    ┌─────────────────────┐               │
│         │   RealtimeSession   │    │     Scheduler       │               │
│         │  (OpenAI Realtime)  │    │   (Timer firing)    │               │
│         └──────────┬──────────┘    └─────────────────────┘               │
│                    │                                                      │
│         ┌──────────┴──────────┐                                          │
│         ▼                     ▼                                          │
│  ┌─────────────┐    ┌─────────────────────────────────────┐             │
│  │   Tools     │    │           Subagents                  │             │
│  │  - todo     │    │  developer_session ──▶ CLI Agent    │             │
│  │  - timer    │    │                        (Grok)       │             │
│  │  - search   │    │                            │        │             │
│  │  - lights   │    │  web_search ──▶ Search Agent        │             │
│  └─────────────┘    │                 (Grok:online)       │             │
│                     │                            │        │             │
│                     │                     Mac Daemon      │             │
│                     │                     (HTTP API)      │             │
│                     └─────────────────────────────────────┘             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               MACBOOK                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Mac Daemon (port 3100)                                                     │
│  - Manages tmux sessions                                                    │
│  - Runs Claude Code CLI                                                     │
│  - POST /sessions, GET /sessions/:id/output, etc.                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tools

### Jarvis Profile Tools

| Tool | Description |
|------|-------------|
| `add_todo` | Add task with optional due date and assignee |
| `view_todos` | List tasks, optionally filtered by assignee |
| `delete_todo` | Delete a task by ID |
| `set_timer` | Set timer with natural language time ("in 5 minutes") |
| `list_timers` | Show all active timers |
| `cancel_timer` | Cancel a timer by ID |
| `web_search` | Search web via Grok :online (OpenRouter) |
| `control_light` | Control Govee lights (on/off/brightness/color) |

### Marvin Profile Tools (Developer)

| Tool | Description |
|------|-------------|
| `developer_session` | Start/manage coding session on Mac |
| `check_coding_session` | Check session status and output |
| `send_session_feedback` | Send input to running session |
| `stop_coding_session` | Terminate a session |
| `deep_thinking` | Complex analysis with reasoning model |
| `add_todo`, `view_todos`, `delete_todo` | Task management |

### CLI Session Flow

```
User: "Computer, review the code in Kireon Backend"
         │
         ▼
┌─────────────────────────────────────────┐
│  Marvin (Realtime Agent)                │
│  Calls developer_session tool           │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  CLI Orchestration Agent (Grok)         │
│  - Config: subagents/cli/config.json    │
│  - Prompt: subagents/cli/PROMPT.md      │
│  - Decides: headless vs interactive     │
│  - Calls start_headless_session         │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Mac Daemon                             │
│  Runs: cd ~/Code/Work/kireon/           │
│        kireon-backend && claude -p "..."│
└─────────────────────────────────────────┘
```

**Headless mode** (`claude -p "..."`): Quick tasks (reviews, simple fixes)
**Interactive mode** (`claude --dangerously-skip-permissions`): Feature implementation, refactoring

## Subagent Architecture

Subagents live in `src/subagents/<agent>/` with externalized configuration:

```
subagents/
├── loader.ts              # loadAgentConfig(dirPath) utility
├── cli/
│   ├── config.json        # {"name": "Marvin", "model": "x-ai/grok-code-fast-1", "maxSteps": 3}
│   ├── PROMPT.md          # System instructions + project locations
│   ├── tools.ts           # Session management tools
│   └── index.ts           # handleDeveloperRequest(), isMacDaemonAvailable()
└── web-search/
    ├── config.json        # {"name": "Jarvis", "model": "x-ai/grok-4.1-fast:online"}
    ├── PROMPT.md          # German search assistant instructions
    └── index.ts           # webSearchTool export
```

**Benefits:**
- Config/prompts can be updated without code changes
- Enables future Web UI for dynamic agent configuration
- Clear separation of concerns (config vs logic vs tools)

**Adding a new subagent:**
1. Create `src/subagents/<name>/` directory
2. Add `config.json` with `name`, `model`, `maxSteps`
3. Add `PROMPT.md` with system instructions
4. Create `index.ts` using `loadAgentConfig(import.meta.dirname)`
5. Export tool or handler function

## Database

SQLite at `~/voice-agent.db`:

| Table | Purpose |
|-------|---------|
| `cli_sessions` | Mac CLI session metadata |
| `cli_events` | Session event log |
| `timers` | Timers and reminders |
| `agent_runs` | Conversation history |

## Component Dev Environment

Isolated component development with simulated agent streaming. Access at `/dev`.

```bash
# Start both backend and frontend for dev mode
cd pi-agent && npm run dev &
cd web && npm run dev

# Open component lab
open http://localhost:5173/dev
```

**Features:**
- Sidebar with categorized component list
- Stream playback controls (play/pause/step/reset)
- Speed control (0.5x - 10x)
- Backend/frontend toggle (use real SSE streams or mock data)
- Event inspector panel

**Adding a demo:** See `docs/COMPONENT_DEV.md` for full documentation.

Quick setup:
1. Create `web/src/dev/demos/my-component/`
2. Add `scenarios.ts` with mock event streams
3. Add `component.tsx` wrapper
4. Add `index.ts` to register demo
5. Import in `web/src/dev/demos/index.ts`

## Development Commands

### Local Mac Development (Both Backend + Frontend)

```bash
# Terminal 1: Backend (skip static server to avoid duplicate connections)
cd pi-agent
SKIP_STATIC_SERVER=true TRANSPORT_MODE=web npm run dev

# Terminal 2: Frontend (Vite with HMR + proxy)
cd web
npm run dev
```

Access at `http://localhost:5173` - Vite proxies WebSocket and API to localhost.

### Pi Deployment

```bash
# On Pi: Run backend with local audio
cd pi-agent
TRANSPORT_MODE=local npm run dev

# Web dashboard served at http://marlon.local:8080 (static build)
```

### Pi Agent Commands
```bash
cd pi-agent

# Run in development mode
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build && npm start

# Test database
npm run test:db

# Test timers
npm run test:timer
```

### Web Dashboard Commands
```bash
cd web

# Install dependencies
npm install  # or bun install

# Run development server (accessible at http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Configuration

### Environment Variables (.env)

```bash
# Required
OPENAI_API_KEY=sk-proj-...
PICOVOICE_ACCESS_KEY=...

# Optional
GOVEE_API_KEY=...
MAC_DAEMON_URL=http://MacBook-Pro-von-Lukasz.local:3100
PI_HOSTNAME=marlon.local
WEBHOOK_PORT=3000
WS_PORT=3001
```

### Profile Configuration

Edit `src/agent/profiles.ts`:
- `instructions` - System prompt for the agent
- `voice` - TTS voice (alloy, ash, ballad, coral, echo, sage, shimmer, verse)
- `tools` - Array of tool names enabled for the profile
- `wakeWord` - Wake word that activates this profile

### Adding New Tools

1. Create file in `src/tools/` (e.g., `my-tool.ts`)
2. Use the `tool()` helper from `@openai/agents/realtime`:

```typescript
import { tool } from '@openai/agents/realtime';
import { z } from 'zod';

export const myTool = tool({
  name: 'my_tool',
  description: 'What this tool does',
  parameters: z.object({
    param1: z.string().describe('Parameter description'),
  }),
  async execute({ param1 }) {
    // Tool logic
    return 'Result string (will be spoken)';
  },
});
```

3. Export from `src/tools/index.ts`
4. Add to profile's `tools` array in `src/agent/profiles.ts`

## Mac Daemon Setup

The Mac daemon must be running for CLI session tools:

```bash
# On Mac
cd mac-daemon
npm run dev  # Listens on port 3100
```

Test connection from Pi:
```bash
curl http://MacBook-Pro-von-Lukasz.local:3100/health
```

## Multi-Client WebSocket (Master/Replica Pattern)

The WebSocket server supports multiple browser clients with a Master/Replica pattern:

- **Master**: Only one client handles audio I/O (mic capture + speaker playback)
- **Replicas**: All other clients receive state updates and transcripts but no audio
- First client to connect becomes Master automatically
- When Master disconnects, oldest Replica is promoted
- Replicas can request control via "Take Control" button (disabled during agent activity)

### Key Files

| File | Purpose |
|------|---------|
| `pi-agent/src/api/websocket.ts` | Server-side client state, master assignment, audio filtering |
| `web/src/hooks/useWebSocket.ts` | Client-side singleton, `requestMaster()` function |
| `web/src/stores/agent.ts` | `clientId`, `isMaster` state, `welcome`/`master_changed` handlers |
| `web/src/components/ControlBar.tsx` | Master/Replica indicator, "Take Control" button |

### WebSocket Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `welcome` | Server → Client | Sent on connect with `clientId` and `isMaster` |
| `master_changed` | Server → All | Broadcast when master changes (includes new `masterId`) |
| `request_master` | Client → Server | Request to become master (denied if agent busy) |

## Environment Variables (Web)

The web dashboard uses these env vars in `web/.env`:

```bash
# Demo mode - shows mock data, disables real connections
VITE_DEMO_MODE=true

# WebSocket URL (leave unset for local dev - uses Vite proxy)
# VITE_WS_URL=ws://marlon.local:3001

# API URL (leave unset for local dev - uses Vite proxy)
# VITE_API_URL=http://marlon.local:3000
```

**Important**: For local Mac development, comment out `VITE_WS_URL` and `VITE_API_URL` to use Vite's proxy. Only set them for Pi deployment.

## Code Patterns & Learnings

### React StrictMode WebSocket Singleton

React StrictMode double-mounts components in development, which can create duplicate WebSocket connections. Solution: module-level singleton with ref counting.

```typescript
// web/src/hooks/useWebSocket.ts
let globalWs: WebSocket | null = null;
let globalWsRefCount = 0;

export function useWebSocket() {
  useEffect(() => {
    globalWsRefCount++;

    // Reuse existing connection if available
    if (globalWs?.readyState === WebSocket.OPEN) {
      wsRef.current = globalWs;
      return;
    }

    // Create new connection...

    return () => {
      globalWsRefCount--;
      // Only close if no other instances
      if (globalWsRefCount === 0) {
        globalWs?.close();
        globalWs = null;
      }
    };
  }, []);
}
```

### State Transition Detection

When auto-stopping based on state, check for **transitions** not just current value. Otherwise, effects trigger on initial state.

```typescript
// web/src/hooks/useAudioSession.ts
const prevStateRef = useRef<string | null>(null);

useEffect(() => {
  const prevState = prevStateRef.current;
  prevStateRef.current = state;

  // Only trigger on transition TO idle, not when already idle
  if (state === 'idle' && prevState !== null && prevState !== 'idle') {
    stopRecording();
  }
}, [state]);
```

### Demo Mode Check

Always use explicit flag check, not absence of other vars:

```typescript
// CORRECT - explicit flag
const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

// WRONG - breaks when env var is simply unset
const isDemoMode = !import.meta.env.VITE_WS_URL;
```

### Web Audio Transport (Browser as Mic/Speaker)

When `TRANSPORT_MODE=web`, the browser captures audio and sends it to the backend via WebSocket. Key learnings:

#### Audio Buffering During Connection

The browser starts sending audio immediately when the user clicks the mic, but the OpenAI session takes time to connect. Solution: buffer audio in `VoiceSession` during connection, then flush when ready.

```typescript
// pi-agent/src/realtime/session.ts
private audioBuffer: ArrayBuffer[] = [];
private isConnecting = true; // Start in buffering mode

sendAudio(audio: ArrayBuffer): void {
  if (this.isConnecting) {
    this.audioBuffer.push(audio); // Buffer during connection
    return;
  }
  this.session.sendAudio(audio);
}

// After connect() completes, flush the buffer
private flushAudioBuffer(): void {
  for (const chunk of this.audioBuffer) {
    this.session.sendAudio(chunk);
  }
  this.audioBuffer = [];
}
```

#### Node.js WebSocket Binary vs Text Detection

**Bug**: Using `Buffer.isBuffer(data)` to detect binary messages is WRONG - text messages in Node.js `ws` library also arrive as Buffers. Only use the `isBinary` flag.

```typescript
// pi-agent/src/api/websocket.ts
ws.on('message', (data, isBinary) => {
  // WRONG: if (isBinary || Buffer.isBuffer(data))
  // CORRECT: only check isBinary
  if (isBinary) {
    handleBinaryAudio(data);
    return;
  }
  // Handle JSON text message
  const msg = JSON.parse(data.toString());
});
```

#### Audio Playback Scheduling

**Bug**: When scheduling multiple audio buffers, checking `playbackStartTime < currentTime` resets scheduling for each buffer in a tight loop (because `currentTime` advances by microseconds).

**Fix**: Check if the END of scheduled audio is in the past, not the start:

```typescript
// web/src/lib/audio.ts
const scheduledEndTime = this.playbackStartTime + (this.samplesScheduled / TARGET_SAMPLE_RATE);
if (this.samplesScheduled === 0 || scheduledEndTime < currentTime) {
  // Only reset if truly fallen behind
  this.playbackStartTime = currentTime;
  this.samplesScheduled = 0;
}
```

#### Echo Prevention

Don't send mic audio while the agent is speaking (prevents feedback loop):

```typescript
// web/src/hooks/useAudioSession.ts
const stateRef = useRef<string>('idle');

audioController.setOnAudio((data) => {
  if (stateRef.current === 'speaking' || stateRef.current === 'thinking') {
    return; // Skip sending audio during agent response
  }
  sendBinary(data);
});
```

#### React StrictMode WebSocket Cleanup

Delay socket close to survive StrictMode double-mount:

```typescript
// Cleanup with delay
setTimeout(() => {
  if (globalWsRefCount === 0 && socketToClose === globalWs) {
    socketToClose.close();
  }
}, 500); // 500ms delay for StrictMode
```

### Future Improvement: WebRTC Transport

The current WebSocket-based audio transport has inherent issues (manual scheduling, echo handling). A better approach is to have the browser connect directly to OpenAI via WebRTC:

1. Backend generates ephemeral token via `POST /v1/realtime/sessions`
2. Frontend uses `RTCPeerConnection` to connect directly to OpenAI
3. Built-in echo cancellation, proper audio streaming
4. Backend handles tool execution via server-side events

See: https://platform.openai.com/docs/guides/realtime-webrtc

## Notes

- See `/home/elokus/CLAUDE.md` for device-level documentation
- Audio: Jabra Speak2 55 MS via PipeWire
- Wake word detection runs locally (Porcupine)
- Conversation timeout: 60 seconds of silence
- Default model: gpt-4o-mini-realtime (cost-effective)
- Webhook server on Pi: port 3000 (for Mac daemon callbacks)
