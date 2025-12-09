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
    │   │   └── webhooks.ts        # Mac daemon webhook receiver
    │   │
    │   └── tools/             # Agent tools
    │       ├── index.ts           # Tool registry
    │       ├── todo.ts            # Todo list (add, view, delete)
    │       ├── timer.ts           # Timers (set, list, cancel)
    │       ├── web-search.ts      # Web search via Responses API
    │       ├── govee.ts           # Govee light control
    │       ├── reasoning.ts       # Deep thinking tool
    │       ├── mac-client.ts      # Mac daemon HTTP client
    │       ├── cli-agent.ts       # CLI orchestration agent (GPT-4.1)
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
│  │   Tools     │    │           CLI Tools                  │             │
│  │  - todo     │    │  developer_session ──▶ CLI Agent    │             │
│  │  - timer    │    │                        (GPT-4.1)    │             │
│  │  - search   │    │                            │        │             │
│  │  - lights   │    │                            ▼        │             │
│  └─────────────┘    │                     Mac Daemon      │             │
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
| `web_search` | Search web via Responses API + gpt-4.1-mini |
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
│  CLI Orchestration Agent (GPT-4.1)      │
│  - Knows project locations              │
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

## Database

SQLite at `~/voice-agent.db`:

| Table | Purpose |
|-------|---------|
| `cli_sessions` | Mac CLI session metadata |
| `cli_events` | Session event log |
| `timers` | Timers and reminders |
| `agent_runs` | Conversation history |

## Development Commands

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

## Notes

- See `/home/elokus/CLAUDE.md` for device-level documentation
- Audio: Jabra Speak2 55 MS via PipeWire
- Wake word detection runs locally (Porcupine)
- Conversation timeout: 60 seconds of silence
- Default model: gpt-4o-mini-realtime (cost-effective)
- Webhook server on Pi: port 3000 (for Mac daemon callbacks)
