# @voiceclaw/voice-agent

Backend for the voice agent. Handles wake word detection, voice runtime management, session lifecycle, tool execution, subagent orchestration, and the WebSocket/HTTP API layer.

## Quick Start

```bash
bun install
bun run dev
```

For local Mac development with the web dashboard:

```bash
# Terminal 1: Backend
SKIP_STATIC_SERVER=true TRANSPORT_MODE=web bun run dev

# Terminal 2: Web dashboard
cd ../web-ui && bun run dev
```

## Architecture

```
src/
├── agent/          # VoiceAgent orchestrator, profile definitions
├── api/            # WebSocket server, webhook server, static file server
├── audio/          # TTS playback (speak utility)
├── context/        # HandoffPacket (voice -> subagent context transfer)
├── db/             # SQLite database, migrations, repositories
├── logging/        # Per-session JSONL debug logs
├── processes/      # ProcessManager (async background task tracking)
├── prompts/        # Centralized prompt directory with versioning
├── realtime/       # OpenAI Realtime SDK + AI SDK adapter
├── scheduler/      # Timer/reminder scheduler
├── subagents/      # CLI orchestrator, web search, background tasks
├── tools/          # Voice agent tools (todo, timer, light, search, dev session)
├── transport/      # Audio transport layer (local device, WebSocket)
├── utils/          # Session name generator/resolver
├── voice/          # Voice runtime factory, config resolution, benchmarks
├── wakeword/       # Porcupine wake word detection
├── config.ts       # Environment config loader
└── index.ts        # Entry point, service state machine
```

## Documentation

| Document | Description |
|----------|-------------|
| [DATABASE.md](docs/DATABASE.md) | SQLite schema, migrations, repositories, patterns |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Config hierarchy, JSON files, env vars, profiles, API endpoints |
| [SESSIONS.md](docs/SESSIONS.md) | Session types, hierarchy, naming, lifecycle, ProcessManager |

## Commands

```bash
bun run dev          # Development mode
bun test             # Run tests (26 tests)
bun run typecheck    # TypeScript type checking

# Scratch utilities
bun run scratch:voice [auth|ultravox|deepgram|decomposed|all]
bun run scratch:provider <openai|openrouter|google|deepgram|ultravox>
bun run scratch:benchmark [list|latest|<report.json>]
```

## Key Concepts

- **Service State Machine**: DORMANT (off) / RUNNING (active) with web/local audio modes
- **Session Tree**: voice -> subagent -> terminal hierarchy, all persisted in SQLite
- **Session Names**: Adjective-noun pairs ("swift-falcon") with fuzzy voice resolution
- **HandoffPacket**: Structured context transfer preventing information loss at handoff boundaries
- **ProcessManager**: Fire-and-forget background tasks with completion notifications
- **AI SDK Data Stream Protocol**: Unified event streaming for all agent types via WebSocket
