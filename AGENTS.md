# VoiceClaw - Configurable Voice Agent Platform

Real-time voice agent with pluggable voice backends, wake word detection, tool support, and decomposed STT/LLM/TTS pipelines.

## Module Responsibilities

This is a Bun monorepo. Each module owns its domain and has its own README and docs.

**Always read the module-specific README when working in that module.**

| Module | Path | Owns | Docs |
|--------|------|------|------|
| **voice-runtime** | `packages/voice-runtime/` | Provider adapters, audio transcoding, session API, benchmarks | [`packages/voice-runtime/docs/`](packages/voice-runtime/docs/) |
| **voice-agent** | `packages/voice-agent/` | Voice agent orchestration, session management, DB, config, tools, subagents | [`packages/voice-agent/docs/`](packages/voice-agent/docs/) |
| **web-ui** | `packages/web-ui/` | React dashboard, WebSocket client, audio session, Zustand store | [`packages/web-ui/CLAUDE.md`](packages/web-ui/CLAUDE.md) |
| **terminal-host** | `packages/terminal-host/` | Mac-side tmux/CLI manager for remote terminal sessions | [`packages/terminal-host/README.md`](packages/terminal-host/README.md) |

### voice-runtime (`packages/voice-runtime/`)

Provider-agnostic voice runtime package. Provides a stable `VoiceSession` API across all voice providers.

**Owns:**
- Provider adapter lifecycle (connect, disconnect, interrupt, tool callbacks)
- Audio boundary normalization and resampling (PCM16 mono)
- Normalized stream events (transcripts, tool calls, latency, usage, state)
- Framework-level interruption resolution (spoken vs full generated text)
- Capability-first feature gating per provider
- Benchmark recording and evaluation

**Does NOT own:** wake word, session persistence, DB, WebSocket broadcasting, profile orchestration, config resolution.

**Boundary rule (strict):**
- `voice-runtime` must expose one provider-agnostic session/event contract to all consumers.
- Provider quirks (ordering, role mapping, transcript protocol differences, tool wire format) must be normalized in adapters/runtime internals.
- `voice-agent`, `web-ui`, and TUI must not contain provider-specific parsing or fallback logic.
- Shared integration/contract tests must assert unified behavior; provider-specific assertions belong only in adapter-focused tests.

**Adapters:** `openai-sdk`, `ultravox-ws`, `gemini-live`, `decomposed`, `pipecat-rtvi`

**Adding a new provider?** Start with the [Provider Integration Guide](packages/voice-runtime/docs/PROVIDER_INTEGRATION_GUIDE.md) — research checklist, test scenarios, and implementation pipeline.

See: [`packages/voice-runtime/docs/`](packages/voice-runtime/docs/)

### voice-agent (`packages/voice-agent/`)

Voice agent backend. Orchestrates sessions, resolves config, manages tools and subagents.

**Owns:**
- VoiceAgent class (profile activation, session lifecycle, event routing)
- Session hierarchy (voice → subagent → terminal) with SQLite persistence
- Configuration resolution (.voiceclaw/ JSON + env vars + profile overrides)
- AI SDK adapter bridge (voice events → AI SDK Data Stream Protocol)
- Tool definitions and execution (todo, timer, lights, search, CLI)
- Subagent orchestration (CLI via Grok, web-search via Grok:online)
- HandoffPacket context transfer (voice → subagents)
- ProcessManager (async non-blocking tool execution)
- WebSocket server + webhook API
- Wake word detection (Porcupine)
- Audio transport (local PipeWire / web WebSocket)

**Does NOT own:** provider protocol implementation (that's voice-runtime).

See: [`packages/voice-agent/docs/`](packages/voice-agent/docs/)

### web-ui (`packages/web-ui/`)

React dashboard for the voice agent. Pluggable UI interface.

**Owns:**
- Unified Zustand store (sessions, voice state, activities)
- WebSocket client with Master/Replica pattern
- Audio session (mic/speaker for master clients)
- AgentStage (unified voice + subagent renderer)
- TerminalStage (PTY via xterm.js)
- ThreadRail / BackgroundRail navigation
- Component dev environment (/dev)

See: [`packages/web-ui/CLAUDE.md`](packages/web-ui/CLAUDE.md)

## Quick Start

```bash
# Install workspace dependencies
bun install

# Terminal 1: Backend
cd packages/voice-agent
SKIP_STATIC_SERVER=true TRANSPORT_MODE=web bun run dev

# Terminal 2: Frontend
cd packages/web-ui
bun run dev
```

Open `http://localhost:5173`.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  voice-runtime (packages/voice-runtime/)                                │
│  Provider adapters: OpenAI SDK │ Ultravox WS │ Gemini Live │           │
│                     Decomposed (STT+LLM+TTS) │ Pipecat RTVI           │
│  ─────────────────── stable VoiceSession API ──────────────────────    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ creates sessions
┌────────────────────────────────┴────────────────────────────────────────┐
│  voice-agent (packages/voice-agent/)                                     │
│                                                                         │
│  Porcupine ──▶ VoiceAgent ◀──▶ SQLite DB                              │
│                    │                                                    │
│            ┌───────┴───────┐                                           │
│            ▼               ▼                                           │
│     VoiceSession       Scheduler                                       │
│     (via runtime)      (Timers)                                        │
│            │                                                           │
│     ┌──────┴──────┐                                                    │
│     ▼              ▼                                                   │
│  Tools          Subagents                                              │
│  (todo,timer,   CLI Agent (Grok) ──▶ Terminal Host                    │
│   search,light) Web Search (Grok:online)                               │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │ WebSocket + AI SDK stream events
            ┌──────────┴──────────┐
            ▼                     ▼
┌─────────────────────────┐  ┌──────────────────┐
│  web-ui                 │  │  TUI (planned)   │
│  (packages/web-ui/)     │  │  Terminal UI     │
│  React dashboard        │  │                  │
└─────────────────────────┘  └──────────────────┘
            │ HTTP
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  terminal-host (packages/terminal-host/)                                │
│  Manages tmux sessions, runs Claude Code CLI (port 3100)               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Session Types

| Type | Description | Parent | Protocol |
|------|-------------|--------|----------|
| `voice` | Root conversation (provider via VoiceRuntime) | none | AI SDK via adapter |
| `subagent` | Delegated agent (CLI, web_search) | voice or subagent | AI SDK native |
| `terminal` | PTY process (tmux + Claude Code) | subagent | Binary PTY stream |

All agents emit **AI SDK Data Stream Protocol** events via WebSocket `stream_chunk`.

### Key Patterns

- **HandoffPacket**: Structured context transfer from voice → subagents (prevents information loss)
- **ProcessManager**: EventEmitter-based async process management (non-blocking tools)
- **Session Names**: Adjective-noun pairs (e.g. "swift-fox") with fuzzy resolution
- **Master/Replica**: Multi-client WebSocket with single audio master
- **Capability-first**: Provider features are explicit via `ProviderCapabilities`, not implicit

## Wake Words & Profiles

| Wake Word | Profile | Voice | Capabilities |
|-----------|---------|-------|--------------|
| **"Jarvis"** | Jarvis | echo | Todos, timers, lights, web search |
| **"Computer"** | Marvin | ash | CLI sessions, coding tasks on Mac |

## Development Commands

```bash
# voice-agent
cd packages/voice-agent
bun run dev                    # Development server
bun test                       # Run tests
bun run typecheck              # TypeScript check
bun run scratch:voice [mode]   # Voice API smoke lab
bun run scratch:provider [p]   # Provider contract check
bun run scratch:benchmark      # Inspect benchmark reports

# web-ui
cd packages/web-ui
bun run dev                    # Dev server with HMR
bun run build                  # Production build
bun run typecheck              # TypeScript check

# voice-runtime
bunx tsc -p packages/voice-runtime/tsconfig.json --noEmit
bun test packages/voice-runtime/tests/*.test.ts

# terminal-host
cd packages/terminal-host
bun run dev                    # Port 3100
```

## Documentation Map

```
docs/                              # System-level architecture
├── sessions.md                    # Session model and lifecycle
└── tools-and-subagents.md         # Tool execution and subagent flow

packages/voice-runtime/docs/       # Voice runtime internals
├── README.md                      # Package overview and reading order
├── ARCHITECTURE.md                # Three-plane model (control/media/provider)
├── PROVIDERS.md                   # Adapter catalog and capabilities
├── PROVIDER_INTEGRATION_GUIDE.md  # ★ Adding new providers: research pipeline & test scenarios
├── CONFIGURATION.md               # App-level config and control APIs
├── INTERRUPTION_TRACKING.md       # Spoken text vs full text alignment
├── BENCHMARKS.md                  # Metrics, thresholds, report workflow
└── providers/                     # Provider-specific deep dives
    ├── DEEPGRAM.md                # TTS WebSocket streaming, STT
    ├── OPENAI.md                  # Realtime SDK adapter
    ├── ULTRAVOX.md                # WebSocket protocol
    ├── GEMINI.md                  # Gemini Live adapter
    ├── DECOMPOSED.md              # STT+LLM+TTS pipeline
    └── PIPECAT.md                 # RTVI protocol adapter

packages/voice-agent/docs/         # Backend-specific docs
├── DATABASE.md                    # SQLite schema, migrations, repositories
├── CONFIGURATION.md               # Config resolution, .voiceclaw/, env vars
├── SESSIONS.md                    # Session lifecycle, hierarchy, naming
└── voice-runtime-integration.md   # How voice-agent integrates voice-runtime

packages/web-ui/CLAUDE.md          # Web dashboard architecture
packages/web-ui/docs/
└── component-dev.md               # Frontend component dev environment

packages/terminal-host/README.md   # Terminal host API and tmux integration
packages/voice-agent/prompts/      # Agent prompt versions (jarvis/, marvin/, etc.)
.plan/                             # Architecture decisions and feature specs
```

## Configuration

Configuration details live in the module that owns them:
- **Voice runtime config**: See [`packages/voice-runtime/docs/CONFIGURATION.md`](packages/voice-runtime/docs/CONFIGURATION.md)
- **Voice-agent config**: See [`packages/voice-agent/docs/CONFIGURATION.md`](packages/voice-agent/docs/CONFIGURATION.md)
- **Web config**: See [`packages/web-ui/CLAUDE.md`](packages/web-ui/CLAUDE.md)

### Environment Variables (.env)

```bash
OPENAI_API_KEY=sk-proj-...         # Required
PICOVOICE_ACCESS_KEY=...           # Required (wake word)
MAC_DAEMON_URL=http://...          # Mac daemon endpoint
OPEN_ROUTER_API_KEY=...            # For subagents (Grok)
DEEPGRAM_API_KEY=...               # Optional (decomposed STT/TTS)
ULTRAVOX_API_KEY=...               # Optional (Ultravox provider)
```

### Runtime Config (`.voiceclaw/`)

JSON-backed runtime configuration:
- `.voiceclaw/voice.config.json` — mode, provider, model, turn settings
- `.voiceclaw/auth-profiles.json` — API credentials and provider defaults

See templates: `.voiceclaw/*.example.json`

## Runtime & Tooling

- **Runtime**: Bun 1.2+
- **Package manager**: bun (workspace monorepo)
- **Database**: SQLite via `bun:sqlite`
- **Wake word**: Porcupine (Picovoice, local)
- **Agent framework**: `@openai/agents`
- **Web**: Bun fullstack dev server + React + Tailwind

## Development Patterns

Hard-won patterns from development. Each entry: problem, fix, file reference.

### WebSocket

- **StrictMode singleton**: React StrictMode double-mounts create duplicate WebSocket connections. Fix: module-level singleton with ref counting + delayed close (500ms). See `packages/web-ui/src/hooks/useWebSocket.ts`.
- **Binary detection**: `Buffer.isBuffer(data)` is wrong for detecting binary WS messages (text also arrives as Buffer in Node `ws`). Fix: only use the `isBinary` flag. See `packages/voice-agent/src/api/websocket.ts`.

### Audio

- **Buffering during connection**: Browser sends mic audio before OpenAI session connects. Fix: buffer audio in `VoiceSession` during connection, flush when ready. See `packages/voice-agent/src/realtime/session.ts`.
- **Echo prevention**: Don't send mic audio while agent is speaking/thinking. Fix: gate `sendBinary()` on `stateRef.current`. See `packages/web-ui/src/hooks/useAudioSession.ts`.
- **Interruption handling**: Buffered TTS continues playing during barge-in. Fix: propagate `audio_interrupted` through transport layer to frontend `audioController.interrupt()`. See `packages/voice-agent/src/agent/voice-agent.ts`.
- **Playback scheduling**: Checking `playbackStartTime < currentTime` resets scheduling in tight loops. Fix: check if scheduled END time is in the past. See `packages/web-ui/src/hooks/useAudioSession.ts`.
- **Spoken highlight source of truth**: When `wordCues`/word timestamps are present, highlight progression must follow cue end-times only (ignore `spokenWords`/`spokenChars` as cursor drivers). `spoken-final` is for turn completion/truncation metadata, not per-word progression. Also force-complete highlighting when playback reaches the final cue boundary (small ms tolerance) to avoid the last word getting stuck. See `packages/web-ui/src/hooks/useSpokenHighlight.ts`, `packages/web-ui/src/components/ai-elements/spoken-highlight.tsx`.

### React

- **State transition detection**: Auto-stop on state change triggers on initial mount. Fix: track previous state with `useRef`, only act on actual transitions. See `packages/web-ui/src/hooks/useAudioSession.ts`.
- **Demo mode check**: Don't use absence of env vars. Fix: explicit `process.env.PUBLIC_DEMO_MODE === 'true'` check.

### Terminal

- **PTY multiplexing**: Multiple WS connections to same terminal each spawned new `tmux attach-session`. Fix: one PTY per session, multiple WS viewers via `viewers.add(ws)`. See `packages/terminal-host/src/pty/manager.ts`.
- **Client singleton**: React StrictMode creates multiple terminal WS connections. Fix: module-level singleton map keyed by sessionId with ref counting + delayed cleanup. See `packages/web-ui/src/lib/terminal-client.ts`.

### AI SDK

- **Transcript roles**: User and assistant transcripts concatenated into one message. Fix: send user transcripts as custom `user-transcript` event, assistant as `text-delta`. See `packages/voice-agent/src/realtime/ai-sdk-adapter.ts`.
- **Assistant double-emit guard**: OpenAI realtime emits both streamed deltas (with `item_id`) and final `agent_end` (without `itemId`). Fix: drop final transcript if deltas already seen; don't reset dedupe on state transition. See `packages/voice-agent/src/agent/voice-agent.ts`.
- **Ultravox client tool contract**: Ultravox uses `role: "agent"` (not `assistant`), `delta` field for partials. Fix: map `agent` to assistant, register tools via `selectedTools.temporaryTool`, round-trip `client_tool_result` with `invocationId`. See `packages/voice-runtime/src/adapters/ultravox-ws-adapter.ts`.
- **Barge-in / turn-lag**: Mic suppression during speaking + 100ms chunk size adds latency. Fix: always stream mic (provider handles interruption), reduce chunk to 40ms, use negotiated sample rates. See `packages/web-ui/src/hooks/useAudioSession.ts`, `packages/voice-runtime/src/adapters/ultravox-ws-adapter.ts`.

### CSS

- **3D perspective nesting**: Nested `perspective` + `preserve-3d` cause compounded transforms. Fix: apply `perspective` to ONE ancestor only, cap depth effects at index 5.
- **shadcn dark mode**: CSS variables in `:root` are light mode; dark mode is scoped under `.dark`. Fix: apply `class="dark"` to the HTML element.

## Notes

- Audio: Jabra Speak2 55 MS via PipeWire
- Wake word detection runs locally (Porcupine)
- Conversation timeout: 60 seconds of silence
- Default model: gpt-4o-mini-realtime (cost-effective)
- See device-level docs on Pi at `/home/elokus/CLAUDE.md`
