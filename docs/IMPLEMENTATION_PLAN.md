# Local-First Developer Assistant System

## Implementation Plan & Specification

---

## Overview

A local-first developer assistant system with:

- **Raspberry Pi ("Brain")**: Realtime voice agent, central database, tools orchestration
- **MacBook ("Worker")**: CLI execution daemon for coding agents
- **Web Frontend**: Session monitoring and control dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    RASPBERRY PI (Control Plane)                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │  Realtime   │  │   Agents    │  │   SQLite    │  │   Timer/   │  │   │
│  │  │  Voice I/O  │  │     SDK     │  │     DB      │  │  Scheduler │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘  │   │
│  │         │                │                │                │         │   │
│  │         └────────────────┴────────────────┴────────────────┘         │   │
│  │                                  │                                    │   │
│  │  ┌──────────────────────────────┴──────────────────────────────┐    │   │
│  │  │                      HTTP/WebSocket API                      │    │   │
│  │  └──────────────────────────────┬──────────────────────────────┘    │   │
│  └─────────────────────────────────┼───────────────────────────────────┘   │
│                                    │                                        │
│            ┌───────────────────────┼───────────────────────┐               │
│            │                       │                       │               │
│            ▼                       ▼                       ▼               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │   MAC DAEMON    │    │  WEB FRONTEND   │    │  HARDWARE I/O   │        │
│  │                 │    │                 │    │                 │        │
│  │  • tmux mgmt    │    │  • Sessions     │    │  • Wakeword     │        │
│  │  • CLI agents   │    │  • Live logs    │    │  • LEDs         │        │
│  │  • HTTP API     │    │  • Controls     │    │  • Buttons      │        │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: TypeScript Migration (Pi)

### Goal
Replace Python realtime agent with TypeScript version using OpenAI Agents SDK.

### Tasks

#### 1.1 Project Setup
- [ ] Initialize Node.js/TypeScript project on Pi
- [ ] Configure `tsconfig.json`, ESLint, environment handling
- [ ] Package structure: `pi-agent/` as main package
- [ ] Dependencies: `@openai/agents`, `ws`, audio libraries

#### 1.2 Realtime Client Implementation
- [ ] WebSocket connection to OpenAI Realtime API
- [ ] Audio format handling: PCM16, 24kHz, mono
- [ ] Initial implementation: text I/O for testing
- [ ] Later: microphone/speaker integration via Pi audio stack

#### 1.3 Session State Machine
```
States: idle → listening → thinking → speaking → idle
```
- [ ] Define state transitions
- [ ] Implement state change handlers
- [ ] Connect states to audio pipeline

#### 1.4 Agents SDK Integration
- [ ] Define first agent with basic tools
- [ ] Flow: Realtime → Agent → Realtime
- [ ] Tool execution within agent context

#### 1.5 Wakeword Bridge (Python ↔ TypeScript)
- [ ] **Option A**: Python sends HTTP/WS event to TS, releases mic
- [ ] **Option B**: TS holds mic, streams frames to Python, receives wake events
- [ ] Initial: Python wakeword triggers TS agent conversation start

### Deliverable
Functional TypeScript realtime agent responding to wakeword with basic conversation capability.

---

## Phase 2: Central Database (Pi)

### Goal
Establish Pi as control plane with local SQLite database.

### Tasks

#### 2.1 Database Schema Design

```sql
-- CLI Sessions metadata
CREATE TABLE cli_sessions (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    mac_session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Session events log
CREATE TABLE cli_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES cli_sessions(id),
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Timers and reminders
CREATE TABLE timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fire_at DATETIME NOT NULL,
    mode TEXT DEFAULT 'tts',
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent interaction history (optional)
CREATE TABLE agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile TEXT,
    transcript TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 2.2 Database Layer
- [ ] SQLite integration (better-sqlite3 or similar)
- [ ] Repository pattern for each table
- [ ] Migration system for schema changes

#### 2.3 Agent ↔ DB Connection
- [ ] Session creation before CLI start
- [ ] Event logging during execution
- [ ] Timer CRUD operations

### Deliverable
Agent with persistent storage for sessions, events, and timers.

---

## Phase 3: Timer/Scheduler Tool (Pi)

### Goal
Robust, local timer/reminder system under agent control.

### Tasks

#### 3.1 Timer Schema
```typescript
interface Timer {
    id: number;
    fire_at: Date;
    mode: 'agent' | 'tts';
    message: string;
    status: 'pending' | 'fired' | 'cancelled';
    created_at: Date;
}
```

#### 3.2 Scheduler Implementation
- [ ] Background loop checking for due timers
- [ ] On fire:
  - Mode `tts`: Direct TTS output
  - Mode `agent`: Inject as synthetic user message
- [ ] Handle missed timers (fire immediately if overdue)

#### 3.3 Agent Tools
```typescript
// Tool definitions
set_timer(time: string, message: string, mode?: 'tts' | 'agent'): Timer
list_timers(): Timer[]
cancel_timer(id: number): boolean
```

- [ ] Natural language time parsing ("in 5 minutes", "at 3pm")
- [ ] Confirmation via TTS
- [ ] Persistence across restarts

### Deliverable
Agent can create, list, cancel timers that fire reliably with TTS or agent notification.

---

## Phase 4: Mac Daemon

### Goal
Mac as CLI execution node controlled via HTTP API.

### Tasks

#### 4.1 Daemon Responsibilities
- Start CLI sessions (Claude Code, other tools)
- Manage tmux sessions per CLI session
- Handle STDIN/STDOUT
- Track session status
- Expose HTTP API

#### 4.2 HTTP API Endpoints

```
POST   /sessions              Create new session
GET    /sessions              List all sessions
GET    /sessions/:id          Get session details
POST   /sessions/:id/input    Send input to session
GET    /sessions/:id/output   Read output buffer
DELETE /sessions/:id          Terminate session
```

#### 4.3 tmux Integration
```bash
# Session naming: dev-assistant-{sessionId}
tmux new-session -d -s "dev-assistant-abc123" "claude"
tmux send-keys -t "dev-assistant-abc123" "user input here" Enter
tmux capture-pane -t "dev-assistant-abc123" -p
```

- [ ] Session creation with unique tmux name
- [ ] Input routing to tmux session
- [ ] Output capture from tmux pane
- [ ] Session cleanup on termination

#### 4.4 Internal State Management
```typescript
interface DaemonSession {
    sessionId: string;        // From Pi
    tmuxSession: string;      // tmux session name
    status: 'running' | 'waiting_for_input' | 'finished' | 'error';
    outputBuffer: string[];   // Recent output lines
    createdAt: Date;
}
```

### Deliverable
Mac daemon managing tmux-backed CLI sessions with HTTP control API.

---

## Phase 5: Pi ↔ Mac Integration

### Goal
Connect agent (Pi) with daemon (Mac) for CLI orchestration.

### Tasks

#### 5.1 Agent Tools for Mac Control
```typescript
// Tools calling Mac daemon
start_cli_session(goal: string): { sessionId: string }
send_cli_input(sessionId: string, input: string): boolean
read_cli_output(sessionId: string): { output: string, status: string }
list_cli_sessions(): Session[]
```

#### 5.2 DB Integration on Tool Calls
- [ ] `start_cli_session`: Create DB entry, call Mac, store mac_session_id
- [ ] `send_cli_input`: Log as event, forward to Mac
- [ ] `read_cli_output`: Fetch from Mac, optionally log to events

#### 5.3 Status Webhooks (Mac → Pi)
```
POST /webhooks/cli-status
{
    "sessionId": "abc123",
    "status": "finished" | "waiting_for_input" | "error",
    "message": "optional details"
}
```

- [ ] Mac daemon sends status changes to Pi
- [ ] Pi updates DB and optionally notifies agent
- [ ] Agent can react to session completion

### Deliverable
Agent orchestrates Mac CLI sessions with full status tracking and DB persistence.

---

## Phase 6: State Management & Hardware

### Goal
Consistent runtime behavior: wakeword, profiles, LEDs, buttons.

### Tasks

#### 6.1 Agent Profiles
```typescript
interface AgentProfile {
    name: string;
    wakeword: string;
    instructions: string;
    tools: string[];
}

const profiles: AgentProfile[] = [
    {
        name: 'todo',
        wakeword: 'hey_jarvis',
        instructions: 'Handle todos and timers...',
        tools: ['set_timer', 'add_todo', 'view_todos']
    },
    {
        name: 'dev',
        wakeword: 'hey_marvin',
        instructions: 'Handle coding tasks...',
        tools: ['start_cli_session', 'send_cli_input', 'read_cli_output']
    }
];
```

#### 6.2 Wakeword Finalization
- [ ] Python wakeword process remains
- [ ] Clear event protocol: `{ wakeword: "hey_jarvis", timestamp: ... }`
- [ ] TS agent selects profile and enters `listening` state

#### 6.3 Hardware Integration

**Buttons:**
- [ ] Cancel conversation
- [ ] Switch profile
- [ ] Manual start/stop

**LEDs:**
```
idle      → dim white / off
listening → pulsing blue
thinking  → pulsing yellow
speaking  → solid green
error     → red flash
```

- [ ] State change triggers LED update
- [ ] GPIO integration on Pi

### Deliverable
Coherent UX with wakeword, multiple profiles, and hardware feedback.

---

## Phase 7: Web Frontend

### Goal
Browser dashboard for session monitoring and control.

### Tasks

#### 7.1 Pi Backend API Extensions
```
GET    /api/cli-sessions              List sessions with status
GET    /api/cli-sessions/:id          Session details + recent logs
GET    /api/cli-events?session=:id    Event history
WS     /api/ws/sessions/:id           Live log stream
POST   /api/cli-sessions/:id/input    Send input (proxied to Mac)
```

#### 7.2 Frontend Structure
```
web-dashboard/
├── src/
│   ├── components/
│   │   ├── SessionList.tsx
│   │   ├── SessionDetail.tsx
│   │   ├── LiveLog.tsx
│   │   └── InputPrompt.tsx
│   ├── hooks/
│   │   ├── useSessions.ts
│   │   └── useWebSocket.ts
│   └── App.tsx
└── package.json
```

#### 7.3 Features
- [ ] Session list with status indicators
- [ ] Detail view with metadata and logs
- [ ] Live log streaming via WebSocket
- [ ] Input field to send prompts to session
- [ ] tmux session name display for manual attach

### Deliverable
Web dashboard showing all sessions with live logs and control capabilities.

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Pi Agent | TypeScript, Node.js, OpenAI Agents SDK |
| Pi Database | SQLite (better-sqlite3) |
| Pi API | Express.js or Fastify |
| Mac Daemon | TypeScript, Node.js, tmux |
| Web Frontend | React/Vue or Vanilla TS |
| Communication | HTTP REST, WebSocket |
| Audio | PipeWire, PyAudio (wakeword) |
| Wakeword | openwakeword (Python) |

---

## Directory Structure (Target)

```
voice-agent/
├── pi-agent/                    # TypeScript agent (Pi)
│   ├── src/
│   │   ├── agent/               # Agent definitions, profiles
│   │   ├── realtime/            # OpenAI Realtime client
│   │   ├── db/                  # SQLite layer
│   │   ├── scheduler/           # Timer/scheduler
│   │   ├── tools/               # Agent tools
│   │   ├── api/                 # HTTP/WS API for frontend
│   │   └── hardware/            # LED, button integration
│   ├── package.json
│   └── tsconfig.json
│
├── mac-daemon/                  # CLI execution daemon (Mac)
│   ├── src/
│   │   ├── api/                 # HTTP API
│   │   ├── tmux/                # tmux session management
│   │   └── sessions/            # Session state
│   ├── package.json
│   └── tsconfig.json
│
├── web-dashboard/               # Frontend (served from Pi)
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
│
├── wakeword/                    # Python wakeword (existing)
│   └── ...
│
└── docs/
    └── IMPLEMENTATION_PLAN.md   # This file
```

---

## Migration Path

### From Current Python Agent

1. **Keep Python wakeword running** - proven, works well
2. **Implement TS agent alongside Python** - test in parallel
3. **Bridge via HTTP/WS** - Python triggers, TS handles conversation
4. **Gradual tool migration** - port tools one by one
5. **Deprecate Python agent** - once TS is stable

### Data Migration
- Export existing todos.json to SQLite
- No breaking changes to user experience

---

## Success Criteria

| Phase | Criteria |
|-------|----------|
| 1 | TS agent responds to wakeword, holds conversation |
| 2 | Sessions persisted in SQLite, survive restart |
| 3 | Timer fires correctly, agent announces |
| 4 | Mac daemon starts Claude Code, captures output |
| 5 | "Start a coding session" works end-to-end |
| 6 | Multiple profiles, LED feedback works |
| 7 | Dashboard shows live session logs |

---

## Future Considerations

- **Cloud Backend**: Move control plane from Pi to cloud
- **Multi-Agent**: Specialized agents cooperating via shared DB
- **More Integrations**: Issue trackers, calendars, build systems
- **Mobile App**: Control and monitor from phone
