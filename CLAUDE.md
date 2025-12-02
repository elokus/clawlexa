# Voice Agent - OpenAI Realtime API

Real-time voice agent running on Raspberry Pi 5 using OpenAI's Realtime API with wake word detection and tool support.

## Quick Start

```bash
# Run the voice agent
uv run python main.py

# Say "Hey Jarvis" to activate, then speak your request
# Say "Ich möchte Anforderungen sammeln" to start a braindump session
```

## Project Setup

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
├── main.py             # Entry point
├── pyproject.toml      # Project dependencies
├── .env                # API keys (not in git)
├── .venv/              # Virtual environment
├── docs/               # Documentation
└── src/
    └── voice_agent/
        ├── __init__.py
        ├── agent.py    # Main VoiceAgent class with state machine
        ├── audio.py    # AudioCapture and AudioPlayer classes
        ├── wakeword.py # Wake word detection using openwakeword
        ├── realtime.py # OpenAI Realtime WebSocket client with function calling
        ├── tts.py      # OpenAI TTS client for tool output (cost-efficient)
        ├── led.py      # Status LED control
        └── tools/      # Tool system for agent capabilities
            ├── __init__.py
            ├── base.py       # BaseTool, ToolResult, ToolRegistry
            └── summarize.py  # SummarizeRequirementsTool
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
│              │SummarizeRequirements│       │   Future Tools   │    │
│              │ - Whisper STT      │       │                   │    │
│              │ - GPT-4 summary    │       │                   │    │
│              │ - Result to TTS    │       │                   │    │
│              └───────────────────┘       └───────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Tool System

Tools extend agent capabilities using a cost-efficient handoff pattern.

### Cost-Efficient Tool Handoff

When a tool is called, the agent disconnects from the expensive Realtime API to save costs:

```
┌─────────────────────────────────────────────────────────────────┐
│  TOOL HANDOFF FLOW                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User request processed by Realtime API                      │
│     └─> Model decides to call a tool                            │
│                                                                 │
│  2. 🔌 DISCONNECT Realtime (stop paying!)                       │
│                                                                 │
│  3. Tool executes independently:                                │
│     └─> Whisper STT for audio input (~$0.006/min)              │
│     └─> GPT-4o-mini for processing (~$0.15/1M tokens)          │
│                                                                 │
│  4. 🔊 TTS API speaks result (~$0.015/1K chars)                │
│                                                                 │
│  5. 🔌 RECONNECT Realtime for continued conversation            │
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
3. **Realtime disconnects** (cost saving starts)
4. Tool captures audio using shared AudioCapture
5. Audio transcribed via Whisper API
6. Transcript summarized via GPT-4o-mini
7. Summary spoken via TTS API (tts-1 model)
8. **Realtime reconnects** for continued conversation

Stop words: "fertig", "done", "ende", or 3 seconds of silence.

### Adding New Tools

1. Create a new file in `src/voice_agent/tools/`
2. Extend `BaseTool` class
3. Implement `execute(arguments)` method
4. Use `self.audio_capture` for audio input (shared with agent)
5. Use `self._status(msg)` for user feedback
6. Register in `VoiceAgent._register_tools()`
7. Update instructions to inform the model about the tool

## Development Commands

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
- `instructions`: System prompt for the assistant (include tool descriptions)

## Notes

- See `/home/elokus/CLAUDE.md` for device-level documentation
- Jabra speaker tested and working
- Use PipeWire commands (`wpctl`) for audio debugging
- Wake word detection runs locally (no cloud needed)
- Conversation auto-disconnects after 60s of silence
- Uses gpt-4o-mini-realtime by default for cost efficiency
- Tool execution uses separate Whisper + GPT-4 calls (not realtime API)
