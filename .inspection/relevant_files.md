# Codebase Inspection

**Request:** Assess monorepo extraction plan for voice runtime layering package, ensure compatibility with current architecture and support adapter pattern for different voice APIs including configurable sample rates/transport constraints.

---

This analysis maps the existing system to prepare for extracting a voice runtime package with a pluggable adapter pattern.

### 1) System Architecture Map
*   **Orchestration Layer**: The `VoiceAgent` manages the lifecycle of voice sessions, profile switching (Jarvis/Marvin), and the integration between real-time audio and delegated subagent tasks.
*   **Real-time Voice Interface**: `VoiceSession` wraps the `@openai/agents/realtime` SDK, handling the WebSocket handshake, event state machine (idle/listening/thinking/speaking), and server-side VAD.
*   **Transport Abstraction**: `IAudioTransport` provides a common interface for hardware-level audio (`LocalTransport` via PipeWire/sox) and browser-level audio (`WebSocketTransport`).
*   **Protocol Adapter**: `VoiceAdapter` transforms provider-specific events (OpenAI Realtime) into a unified **AI SDK Data Stream Protocol** format used across the entire monorepo for UI consistency.
*   **Context Management**: `HandoffPacket` serves as the data boundary, capturing voice transcripts and tool results to maintain context when delegating to text-based subagents.

### 2) Existing Flow
*   **Activation**: The flow begins via wake word detection (`WakewordDetector`) or a `start_session` command from the web dashboard.
*   **Session Initialization**: `VoiceAgent` resolves a profile and instantiates a `VoiceSession`, which establishes a WebSocket connection to the OpenAI Realtime API.
*   **Audio Routing**: Incoming audio from the selected `IAudioTransport` is resampled (if necessary) and streamed to the Realtime API; assistant audio is received and routed back to the transport's playback sink.
*   **Turn Management**: Server-side VAD detects speech boundaries, triggering state transitions between `listening` and `thinking`.
*   **Tool Execution**: Real-time tool calls (e.g., `developer_session`) are intercepted, packaged into a `HandoffPacket`, and executed asynchronously via the `ProcessManager`.
*   **Event Propagation**: All transcription and tool events are adapted by `VoiceAdapter` and broadcast via the central WebSocket server to connected dashboard clients.

### 3) Relevant Code Locations

**Entrypoints & Orchestration**
*   `pi-agent/src/agent/voice-agent.ts`: The primary controller for session lifecycles and transport hotswapping.
*   `pi-agent/src/index.ts`: The main service entry point that coordinates the state machine between dormant and running states.

**Voice & Adapter Logic**
*   `pi-agent/src/realtime/session.ts`: Current implementation of the voice session; contains the core OpenAI-specific logic to be abstracted.
*   `pi-agent/src/realtime/ai-sdk-adapter.ts`: Defines how voice events map to the unified stream protocol; critical for maintaining compatibility after extraction.
*   `.plan/orchestration-plan-claude.md`: Section 3 specifically outlines the proposed `IVoiceProvider` interface and adapter factory pattern.

**Audio & Transport**
*   `pi-agent/src/transport/types.ts`: Defines `IAudioTransport` and `AUDIO_CONFIG` (sample rates, channels, bit depth).
*   `pi-agent/src/transport/local.ts`: Hardware-specific audio I/O using `pw-cat` (Pi) and `sox` (Mac).
*   `pi-agent/src/transport/websocket.ts`: Manages binary audio streaming between the server and web clients.
*   `pi-agent/src/audio/resample.ts`: Contains linear interpolation logic for sample rate conversion (16kHz ↔ 24kHz).

**Context & Integration**
*   `pi-agent/src/context/handoff.ts`: Defines the `HandoffPacket` structure for context persistence during provider transitions.
*   `pi-agent/src/api/websocket.ts`: Central hub for broadcasting stream chunks and managing client `Master/Replica` audio roles.
*   `pi-agent/src/db/repositories/cli-sessions.ts`: Persists session metadata, essential for tracking the tree hierarchy (Voice → Subagent → Terminal).