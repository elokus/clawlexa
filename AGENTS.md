# Voice Agent - OpenAI Realtime API

Real-time voice agent running on Raspberry Pi 5 using OpenAI's Realtime API with wake word detection and tool support.

## Quick Start

```bash
cd pi-agent
bun install
bun run dev
# Say "Jarvis" or "Computer" to activate
```

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/SESSION_MANAGEMENT.md`](docs/SESSION_MANAGEMENT.md) | Session management architecture (primary) |
| [`docs/TOOLS_AND_SUBAGENTS.md`](docs/TOOLS_AND_SUBAGENTS.md) | Tools, subagents, CLI flow, prompt management |
| [`docs/CODE_PATTERNS.md`](docs/CODE_PATTERNS.md) | Hard-won patterns & bug fixes |
| [`docs/COMPONENT_DEV.md`](docs/COMPONENT_DEV.md) | Component development environment |
| [`web/CLAUDE.md`](web/CLAUDE.md) | Web dashboard architecture |

## Project Setup

- **Runtime**: Bun 1.2+
- **Package Manager**: bun
- **Framework**: OpenAI Agents SDK (`@openai/agents`)
- **Database**: SQLite (`bun:sqlite`)
- **Wake Word**: Porcupine (Picovoice, local)
- **Web**: Bun fullstack dev server + React + Tailwind

## Development Workflow

### Atomic Commits

**After every execution step, commit and push:**

```bash
git add . && git commit -m "descriptive message" && git push
```

Each logical change gets its own commit.

### Plans Directory (`.plan/`)

Store architecture decisions, refactoring guides, and feature specs in `.plan/`.

## Wake Words & Profiles

| Wake Word | Profile | Voice | Capabilities |
|-----------|---------|-------|--------------|
| **"Jarvis"** | Jarvis | echo | Todos, timers, lights, web search |
| **"Computer"** | Marvin | ash | CLI sessions, coding tasks on Mac |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RASPBERRY PI                                   │
│                                                                         │
│  Porcupine ──▶ VoiceAgent ◀──▶ SQLite DB                              │
│                    │                                                    │
│            ┌───────┴───────┐                                           │
│            ▼               ▼                                           │
│     RealtimeSession    Scheduler                                       │
│     (OpenAI RT)        (Timers)                                        │
│            │                                                           │
│     ┌──────┴──────┐                                                    │
│     ▼              ▼                                                   │
│  Tools          Subagents                                              │
│  (todo,timer,   CLI Agent (Grok) ──▶ Mac Daemon                       │
│   search,light) Web Search (Grok:online)                               │
└─────────────────────────────────────────────────────────────────────────┘
                              │ HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  MACBOOK - Mac Daemon (port 3100)                                       │
│  Manages tmux sessions, runs Claude Code CLI                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Session Types

| Type | Description | Parent | Protocol |
|------|-------------|--------|----------|
| `voice` | Root conversation (OpenAI Realtime API) | none | AI SDK via adapter |
| `subagent` | Delegated agent (CLI, web_search) | voice or subagent | AI SDK native |
| `terminal` | PTY process (tmux + Claude Code) | subagent | Binary PTY stream |

All agents emit **AI SDK Data Stream Protocol** events via WebSocket `stream_chunk`.

### Key Patterns

- **HandoffPacket**: Structured context transfer from voice → subagents (anti-telephone)
- **ProcessManager**: EventEmitter-based async process management (non-blocking tools)
- **Session Names**: Adjective-noun pairs (e.g. "swift-fox") with fuzzy resolution
- **Master/Replica**: Multi-client WebSocket with single audio master

## Project Structure

```
voice-agent/
├── CLAUDE.md              # This file (entry point)
├── docs/                  # Detailed documentation
├── prompts/               # Agent prompt versions (jarvis/, marvin/, cli-orchestrator/, web-search/)
├── web/                   # Web Dashboard (React + Bun)
│   ├── dev-server.ts          # Bun.serve with WS proxy, API proxy, SPA fallback
│   ├── src/
│   │   ├── components/stages/  # AgentStage (unified), TerminalStage
│   │   ├── components/rails/   # ThreadRail (navigation), BackgroundRail
│   │   ├── stores/             # Zustand unified store + message handler
│   │   └── hooks/              # useWebSocket, useAudioSession
│   └── package.json
├── pi-agent/              # Backend (Bun)
│   ├── src/
│   │   ├── agent/              # VoiceAgent, profiles
│   │   ├── realtime/           # OpenAI Realtime SDK + AI SDK adapter
│   │   ├── api/                # WebSocket server, webhooks, stream types
│   │   ├── context/            # HandoffPacket (anti-telephone)
│   │   ├── processes/          # ProcessManager (async runtime)
│   │   ├── subagents/          # CLI orchestrator, web search
│   │   ├── tools/              # Voice agent tools
│   │   ├── db/                 # SQLite schema + repositories
│   │   └── utils/              # Session names generator/resolver
│   ├── tests/                  # 26 tests (bun test)
│   └── package.json
└── mac-daemon/            # Mac-side tmux/CLI manager
```

## Development Commands

### Local Mac Development

```bash
# Terminal 1: Backend
cd pi-agent
SKIP_STATIC_SERVER=true TRANSPORT_MODE=web bun run dev

# Terminal 2: Frontend
cd web
bun run dev
```

Access at `http://localhost:5173` - Bun dev server proxies WebSocket and API.

### Pi Deployment

```bash
cd pi-agent
TRANSPORT_MODE=local bun run dev
# Web dashboard at http://marlon.local:8080
```

### Commands

```bash
# pi-agent
bun run dev          # Development
bun test             # Run tests (26 tests)
bun run typecheck    # TypeScript check

# web
bun run dev          # Dev server with HMR
bun run build        # Production build
bun run typecheck    # TypeScript check
```

## Configuration

### Environment Variables (.env)

```bash
OPENAI_API_KEY=sk-proj-...     # Required
PICOVOICE_ACCESS_KEY=...       # Required
GOVEE_API_KEY=...              # Optional
MAC_DAEMON_URL=http://MacBook-Pro-von-Lukasz.local:3100
OPEN_ROUTER_API_KEY=...        # For subagents (Grok)
```

### Web Environment (web/.env)

```bash
PUBLIC_DEMO_MODE=true           # Mock data mode
# PUBLIC_WS_URL=ws://marlon.local:3001    # Only for Pi deployment
# PUBLIC_API_URL=http://marlon.local:3000  # Only for Pi deployment
```

Uses `PUBLIC_*` prefix with `process.env.PUBLIC_*` (Bun convention, not Vite's `import.meta.env`).

### Profile Configuration

Edit `pi-agent/src/agent/profiles.ts`: `instructions`, `voice`, `tools`, `wakeWord`.

## Database

SQLite at `~/voice-agent.db` (9 migrations):

| Table | Purpose |
|-------|---------|
| `cli_sessions` | Session metadata + hierarchy + names |
| `cli_events` | Session event log |
| `handoff_packets` | Context handoff persistence |
| `timers` | Timers and reminders |
| `agent_runs` | Conversation history |

## Mac Daemon

```bash
cd mac-daemon
bun run dev  # Port 3100
curl http://MacBook-Pro-von-Lukasz.local:3100/health
```

## WebSocket Messages (10 Core Types)

| Message | Direction | Purpose |
|---------|-----------|---------|
| `welcome` | S→C | Client identity + service state |
| `stream_chunk` | S→C | All agent events (AI SDK format) |
| `session_tree_update` | S→C | Session hierarchy changes |
| `state_change` | S→C | Voice state (listening/thinking/speaking) |
| `master_changed` | S→All | Multi-client master coordination |
| `service_state_changed` | S→All | Service active/dormant + audio mode |
| `audio_control` | S→C | Audio playback (start/stop/interrupt) |
| `session_started` | S→C | Voice session activated |
| `session_ended` | S→C | Voice session deactivated |
| `cli_session_deleted` | S→C | Terminal session cleanup |

## Notes

- Audio: Jabra Speak2 55 MS via PipeWire
- Wake word detection runs locally (Porcupine)
- Conversation timeout: 60 seconds of silence
- Default model: gpt-4o-mini-realtime (cost-effective)
- Webhook server on Pi: port 3000
- See `/home/elokus/CLAUDE.md` for device-level docs
