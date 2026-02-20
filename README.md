# Voice Agent

Realtime voice agent with wake-word activation, pluggable voice providers, tool execution, and web dashboard support.

## Quick Start

```bash
# Install workspace dependencies
bun install

# Backend (Terminal 1)
cd pi-agent
SKIP_STATIC_SERVER=true TRANSPORT_MODE=web bun run dev

# Frontend (Terminal 2)
cd web
bun run dev
```

Open `http://localhost:5173`.

## What This Repo Contains

- `pi-agent`: Bun backend, voice orchestration, tools, session tree, DB.
- `web`: React dashboard and websocket/audio client.
- `mac-daemon`: Mac-side tmux/CLI manager.
- `packages/voice-runtime`: provider-agnostic voice runtime package used by `pi-agent`.

## Documentation

Start at `docs/README.md`.

| Topic | Document |
|---|---|
| Docs index | `docs/README.md` |
| Session architecture | `docs/SESSION_MANAGEMENT.md` |
| Tools and subagents | `docs/TOOLS_AND_SUBAGENTS.md` |
| Code patterns and pitfalls | `docs/CODE_PATTERNS.md` |
| Provider integration | `docs/VOICE_PROVIDER_INTEGRATION.md` |
| Voice runtime package entrypoint | `docs/voice-runtime/README.md` |
| Voice runtime internals | `docs/voice-runtime/ARCHITECTURE.md` |
| Provider adapter details | `docs/voice-runtime/PROVIDERS.md` |
| Interruption tracking | `docs/voice-runtime/INTERRUPTION_TRACKING.md` |
| pi-agent integration with runtime package | `docs/voice-runtime/INTEGRATION.md` |
| Pipecat RTVI provider notes | `docs/PIPECAT_RTVI_PROVIDER.md` |
| Voice benchmark workflow | `docs/VOICE_BENCHMARKS.md` |

## Key Patterns

- `HandoffPacket`: structured context transfer from voice to subagents.
- `ProcessManager`: non-blocking process lifecycle via events.
- Capability-first voice adapters: provider features are explicit, not implicit.
- Framework-level interruption resolution: spoken text vs full generated text.
- Master/replica websocket model for multi-client audio ownership.

See `docs/CODE_PATTERNS.md` and `docs/voice-runtime/README.md`.

## Runtime and Tooling

- Runtime: Bun 1.2+
- Package manager: bun
- DB: SQLite (`bun:sqlite`)
- Wake-word engine: Porcupine
- Agent framework: `@openai/agents`

## Useful Commands

```bash
# Root
bun run typecheck:voice-runtime

# pi-agent
cd pi-agent
bun run dev
bun run typecheck
bun test

# web
cd web
bun run dev
bun run typecheck
bun run build

# mac-daemon
cd mac-daemon
bun run dev
```

## Configuration

- Backend env: `.env` (for API keys and daemon endpoints).
- Runtime JSON config: `.voiceclaw/voice.config.json`.
- Auth profiles: `.voiceclaw/auth-profiles.json`.
- Templates: `.voiceclaw/voice.config.example.json`, `.voiceclaw/auth-profiles.example.json`.
