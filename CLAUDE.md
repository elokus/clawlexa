# Voice Agent - OpenAI Realtime API

Real-time voice agent running on Raspberry Pi 5 using OpenAI's Realtime API with wake word detection and tool support.

## Quick Start

```bash
# Run TypeScript agent (NEW - recommended)
cd pi-agent && npm run dev

# Run Python voice agent (Jarvis) - legacy
uv run python main.py

# Run multi-profile agent (multiple wake words) - legacy
uv run python main.py --multi

# Say "Hey Jarvis" to activate, then speak your request
```

## Project Setup

### TypeScript Agent (pi-agent/)
- **Node.js**: 20.x
- **Package Manager**: npm
- **Framework**: OpenAI Agents SDK (`@openai/agents`)

### Python Agent (legacy)
- **Python**: 3.13.5
- **Package Manager**: uv
- **Virtual Environment**: `.venv/` (created with uv)

## Audio Hardware

- **Device**: Jabra Speak2 55 MS (USB)
- **Configured as**: Default speaker and microphone
- **Audio Stack**: PipeWire 1.4.2

## Wake Word

- **Default**: "Hey Jarvis"
- **Available**: alexa, hey_jarvis, hey_mycroft, hey_marvin
- **Engine**: openwakeword (runs locally, no cloud required)

## Dependencies

Managed via `pyproject.toml`:
- `pyaudio` - Audio capture/playback
- `websockets` - WebSocket client for OpenAI Realtime API
- `openwakeword` - Local wake word detection
- `numpy` - Audio processing
- `python-dotenv` - Environment variable loading
- `openai` - OpenAI API client (Whisper STT, GPT-4 for tools)

## OpenAI Realtime API

The Realtime API uses WebSocket connections for bidirectional audio streaming.

### Models
- **gpt-4o-mini-realtime**: Cost-effective model for routing and simple tasks (default)
- **gpt-4o-realtime**: Full capability model for complex tasks

### Key Concepts
- Audio format: PCM16, 24kHz sample rate, mono
- Server-side VAD for automatic turn detection
- Real-time speech-to-speech with low latency
- Function calling for tool handoffs

### Environment Variables
Store in `.env` file (not in git):
```bash
OPENAI_API_KEY=sk-proj-...
```

## Project Structure

```
voice-agent/
├── CLAUDE.md           # This file
├── .env                # API keys (not in git)
├── docs/               # Documentation
│   └── IMPLEMENTATION_PLAN.md
│
├── pi-agent/           # TypeScript agent (Phase 1 + 2)
│   ├── src/
│   │   ├── index.ts        # Main entry point
│   │   ├── config.ts       # Configuration
│   │   ├── agent/          # Agent definitions
│   │   │   ├── profiles.ts     # Wakeword → profile mapping
│   │   │   └── voice-agent.ts  # Main VoiceAgent class
│   │   ├── realtime/       # OpenAI Realtime SDK wrapper
│   │   │   └── session.ts      # RealtimeSession + state machine
│   │   ├── db/             # SQLite database layer (Phase 2)
│   │   │   ├── index.ts        # Module exports
│   │   │   ├── database.ts     # Connection manager
│   │   │   ├── schema.ts       # Migrations
│   │   │   └── repositories/   # Data access layer
│   │   │       ├── cli-sessions.ts  # CLI session CRUD
│   │   │       ├── cli-events.ts    # Session event log
│   │   │       ├── timers.ts        # Timer/reminder CRUD
│   │   │       └── agent-runs.ts    # Agent run history
│   │   └── tools/          # Agent tools
│   │       ├── todo.ts         # Todo list tools
│   │       ├── web-search.ts   # Web search tool
│   │       └── govee.ts        # Govee light control
│   ├── package.json
│   └── tsconfig.json
│
├── main.py             # Python entry point (legacy)
├── pyproject.toml      # Python dependencies (legacy)
├── .venv/              # Python virtual environment
└── src/
    └── voice_agent/    # Python agent (legacy)
        ├── agent.py        # Single-profile VoiceAgent class
        ├── multi_agent.py  # Multi-profile agent
        ├── profiles.py     # AgentProfile definitions
        ├── audio.py        # AudioCapture and AudioPlayer
        ├── wakeword.py     # Wake word detection
        ├── realtime.py     # OpenAI Realtime WebSocket client
        ├── tts.py          # OpenAI TTS client
        ├── led.py          # Status LED control
        └── tools/          # Tool system
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VoiceAgent                                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    State Machine                               │  │
│  │  LISTENING_FOR_WAKEWORD → CONNECTING → CONVERSATION           │  │
│  │           ↑                    ↓              ↓                │  │
│  │           └──── timeout ←── SPEAKING ←── TOOL_EXECUTING       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │        RealtimeClient (gpt-realtime-mini for routing)          │ │
│  │   - Wake word detected → Connect to cheap mini model           │ │
│  │   - Mini model decides: answer directly OR call tool           │ │
│  │   - Supports function calling for tool handoffs                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│                    ┌─────────┴─────────┐                            │
│                    ▼                   ▼                            │
│          ┌─────────────────┐   ┌───────────────────┐               │
│          │  Direct Answer  │   │   Tool Handoff    │               │
│          │  (mini handles) │   │ (STT→LLM→TTS)     │               │
│          └─────────────────┘   └───────────────────┘               │
│                                        │                            │
│                          ┌─────────────┴─────────────┐             │
│                          ▼                           ▼             │
│              ┌───────────────────┐       ┌───────────────────┐    │
│              │SummarizeRequirements│       │    WebSearch      │    │
│              │ - Whisper STT      │       │ - Responses API   │    │
│              │ - GPT-4 summary    │       │ - gpt-4.1-mini    │    │
│              │ - Result to TTS    │       │ - web_search tool │    │
│              └───────────────────┘       └───────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Tool System

Tools extend agent capabilities using a cost-efficient handoff pattern.

### Cost-Efficient Tool Handoff

When a tool is called, audio input to Realtime is paused (no input tokens = no cost):

```
┌─────────────────────────────────────────────────────────────────┐
│  TOOL HANDOFF FLOW                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User request processed by Realtime API                      │
│     └─> Model decides to call a tool                            │
│                                                                 │
│  2. ⏸️  PAUSE audio input to Realtime (no tokens = no cost)     │
│                                                                 │
│  3. Tool executes independently:                                │
│     └─> Whisper STT for audio input (~$0.006/min)              │
│     └─> GPT-4o-mini for processing (~$0.15/1M tokens)          │
│     └─> Or Responses API with web_search                        │
│                                                                 │
│  4. 🔊 TTS API speaks result (~$0.015/1K chars)                │
│                                                                 │
│  5. 📤 Send result back to Realtime for conversation continuity │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Cost Comparison

| Component | Realtime API | Tool Handoff |
|-----------|--------------|--------------|
| Audio Input | $0.06/min | $0.006/min (Whisper) |
| Processing | included | $0.15/1M tokens (GPT-4o-mini) |
| Audio Output | $0.24/min | $0.015/1K chars (TTS-1) |
| **1-min tool execution** | **~$0.30** | **~$0.02-0.05** |

### SummarizeRequirementsTool

Captures and summarizes braindumps/requirements:

1. User triggers via voice ("Ich möchte Anforderungen sammeln")
2. Realtime API calls the tool via function calling
3. **Audio input paused** (cost saving starts)
4. Tool captures audio using shared AudioCapture
5. Audio transcribed via Whisper API
6. Transcript summarized via GPT-4o-mini
7. Summary spoken via TTS API (tts-1 model)
8. **Result sent back to Realtime** for conversation continuity

Stop words: "fertig", "done", "ende", or 3 seconds of silence.

### WebSearchTool

Searches the web for current information:

1. User asks about news, current events, or live data
2. Realtime API calls the tool with `query` parameter
3. **Audio input paused** (cost saving starts)
4. Tool uses Responses API with `gpt-4.1-mini` + `web_search`
5. Result spoken via TTS API
6. **Result sent back to Realtime** for conversation continuity

Example triggers: "Was gibt es Neues?", "Wie ist das Wetter?", "Aktuelle Nachrichten"

### Todo List Tools

Simple JSON-based task management with three tools:

**add_todo** - Add a new task:
- `task` (required): Task description
- `due_date` (optional): Due date in YYYY-MM-DD format
- `assignee` (optional): "Lukasz" or "Hannah" (default: Lukasz)

**view_todos** - View/query tasks:
- `assignee` (optional): Filter by assignee

**delete_todo** - Delete a task:
- `id` (required): Task ID to delete

Data stored in `~/todos.json`. Each task has: id, task, assignee, created_at, due_date (optional).

Example triggers: "Füge eine Aufgabe hinzu", "Zeige meine Todos", "Lösche Aufgabe 3"

### Adding New Tools

1. Create a new file in `src/voice_agent/tools/`
2. Extend `BaseTool` class
3. Implement `execute(arguments)` method
4. Use `self.audio_capture` for audio input (shared with agent)
5. Use `self._status(msg)` for user feedback
6. Register in `VoiceAgent._register_tools()`
7. Update instructions to inform the model about the tool

## Development Commands

### TypeScript Agent (pi-agent/)

```bash
cd pi-agent

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run text-only test (no audio)
npm run test:text

# Type check
npm run typecheck

# Build for production
npm run build
npm start

# Test wakeword bridge
curl -X POST http://localhost:8765/wakeword \
  -H "Content-Type: application/json" \
  -d '{"wakeword": "hey_jarvis", "timestamp": 1234567890}'
```

### Python Agent (legacy)

```bash
# Install/sync dependencies
uv sync

# Add new dependency
uv add <package>

# Run the agent
uv run python main.py

# Test audio devices
uv run python -c "import pyaudio; p = pyaudio.PyAudio(); [print(p.get_device_info_by_index(i)['name']) for i in range(p.get_device_count())]"

# Test wake word detection
uv run python -c "from src.voice_agent.wakeword import WakeWordDetector; d = WakeWordDetector(); print('Model loaded:', d._model_key)"
```

## Configuration

Edit `src/voice_agent/agent.py` to change:
- `wake_word`: Change wake word (default: "hey_jarvis")
- `wake_word_threshold`: Adjust sensitivity (0-1, default: 0.5)
- `voice`: Change assistant voice (alloy, ash, ballad, coral, echo, sage, shimmer, verse)
- `model`: Realtime model ("mini" for cost-effective, "default" for full capability)
- `conversation_timeout`: Seconds before returning to wake word mode (default: 60)

### Remote Prompt Management

The system prompt is managed remotely via OpenAI's prompt storage:
- **Prompt ID**: `pmpt_693042aafdcc8194bfd305307bcda48f0aace211731a2053`
- **Version**: Always uses latest (no pinned version)
- Configure in `src/voice_agent/realtime.py` `_configure_session()` method

## Database (Phase 2)

SQLite database at `~/voice-agent.db` serves as the control plane for the system.

### Tables

| Table | Purpose |
|-------|---------|
| `cli_sessions` | Mac CLI session metadata |
| `cli_events` | Session event log |
| `timers` | Timers and reminders |
| `agent_runs` | Agent interaction history |

### Usage

```typescript
import { getDatabase, CliSessionsRepository, TimersRepository } from './db/index.js';

// Database auto-initializes on first access
const db = getDatabase();

// Use repositories for CRUD operations
const sessions = new CliSessionsRepository(db);
const session = sessions.create({ goal: 'Implement feature X' });
sessions.updateStatus(session.id, 'running');

const timers = new TimersRepository(db);
const timer = timers.create({
  fire_at: new Date(Date.now() + 60000),
  message: 'Reminder!',
  mode: 'tts'
});
```

### Test Commands

```bash
cd pi-agent

# Test database functionality
npm run test:db
```

## Notes

- See `/home/elokus/CLAUDE.md` for device-level documentation
- Jabra speaker tested and working
- Use PipeWire commands (`wpctl`) for audio debugging
- Wake word detection runs locally (no cloud needed)
- Conversation auto-disconnects after 60s of silence
- Uses gpt-4o-mini-realtime by default for cost efficiency
- Tool execution uses separate Whisper + GPT-4 calls (not realtime API)
