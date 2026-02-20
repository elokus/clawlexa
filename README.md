# VoiceClaw

Realtime voice agent with wake-word activation, pluggable voice providers, tool execution, and web dashboard.

## Quick Start

```bash
# Install workspace dependencies
bun install

# Backend (Terminal 1)
cd packages/voice-agent
SKIP_STATIC_SERVER=true TRANSPORT_MODE=web bun run dev

# Frontend (Terminal 2)
cd packages/web-ui
bun run dev
```

Open `http://localhost:5173`.

## Modules

| Module | Path | Purpose |
|--------|------|---------|
| **voice-runtime** | [`packages/voice-runtime/`](packages/voice-runtime/) | Provider-agnostic voice runtime (adapters, audio, benchmarks) |
| **voice-agent** | [`packages/voice-agent/`](packages/voice-agent/) | Voice agent backend (sessions, config, tools, subagents, DB) |
| **web-ui** | [`packages/web-ui/`](packages/web-ui/) | React dashboard (WebSocket client, audio, Zustand store) |
| **terminal-host** | [`packages/terminal-host/`](packages/terminal-host/) | Mac-side tmux/CLI manager |

Each module has its own README and docs directory. Start there when working in a specific module.

## Documentation

| Scope | Location | Content |
|-------|----------|---------|
| **Project overview** | [`AGENTS.md`](AGENTS.md) | Architecture, module map, dev commands |
| **System architecture** | [`docs/`](docs/) | Session management, tools, code patterns |
| **Voice runtime** | [`packages/voice-runtime/docs/`](packages/voice-runtime/docs/) | Provider adapters, benchmarks, interruption tracking |
| **Voice-agent** | [`packages/voice-agent/docs/`](packages/voice-agent/docs/) | Database, configuration, session lifecycle |
| **Web dashboard** | [`packages/web-ui/CLAUDE.md`](packages/web-ui/CLAUDE.md) | Store, components, WebSocket protocol |

## Key Patterns

- **HandoffPacket**: structured context transfer from voice to subagents.
- **ProcessManager**: non-blocking process lifecycle via events.
- **Capability-first adapters**: provider features are explicit, not implicit.
- **Framework-level interruption resolution**: spoken text vs full generated text.
- **Master/replica WebSocket**: multi-client audio ownership.

## Runtime & Tooling

- Runtime: Bun 1.2+
- Package manager: bun (workspace monorepo)
- DB: SQLite (`bun:sqlite`)
- Wake-word: Porcupine (Picovoice)
- Agent framework: `@openai/agents`

## Commands

```bash
# voice-agent
cd packages/voice-agent && bun run dev       # Dev server
cd packages/voice-agent && bun test          # Tests
cd packages/voice-agent && bun run typecheck # Type check

# web-ui
cd packages/web-ui && bun run dev            # Dev server (HMR)
cd packages/web-ui && bun run build          # Production build

# voice-runtime
bun run typecheck:voice-runtime  # Type check
bun test packages/voice-runtime  # Tests

# terminal-host
cd packages/terminal-host && bun run dev     # Port 3100
```

## Configuration

- **Backend env**: `.env` (API keys, daemon endpoints)
- **Runtime config**: `.voiceclaw/voice.config.json` (mode, provider, model)
- **Auth profiles**: `.voiceclaw/auth-profiles.json` (credentials, defaults)
- **Templates**: `.voiceclaw/*.example.json`
