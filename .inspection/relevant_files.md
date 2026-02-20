# Codebase Inspection

**Request:** Map files and flows for extracting voice runtime into package with provider adapters and pluggable GUI/TUI transports

---

This analysis maps the current voice architecture and data flows to prepare for the extraction of `@voiceclaw/voice-runtime`.

### 1) System Architecture Map
*   **Orchestration Layer (`VoiceAgent`)**: Resides in `pi-agent`; manages profile switching, session tree hierarchy, and maps high-level intents to the voice runtime.
*   **Voice Runtime Interface (`VoiceRuntime`)**: A provider-agnostic boundary in `src/voice` that abstracts specific API protocols into a unified set of events (transcripts, state, audio, tools).
*   **Provider Adapters**: Concrete implementations (OpenAI SDK, Ultravox WebSocket, Decomposed Pipeline) that handle specific wire encodings, auth headers, and VAD quirks.
*   **Media Plane (`IAudioTransport`)**: Separates hardware-level I/O (`PipeWire`, `sox`) and network-level I/O (`WebSocket`) from the agent logic, allowing for pluggable transports.
*   **Configuration Hub**: JSON-backed system (`voice.config.json` and `auth-profiles.json`) for resolving API keys and effective runtime settings per profile.

### 2) Existing Flow
*   **Activation**: Starts at `VoiceAgent.activateProfile()`, which resolves effective config by merging global defaults with profile-specific overrides.
*   **Provider Instantiation**: The `createVoiceRuntime` factory selects an adapter; for OpenAI, it currently wraps a legacy `VoiceSession` that tightly couples the `@openai/agents` SDK.
*   **Handshake & Negotiation**: The runtime performs the provider-specific connection (e.g., Ultravox's REST create → WebSocket join) and determines the negotiated audio sample rates.
*   **Bidirectional Streaming**: Audio flows from `IAudioTransport` through the `VoiceRuntime` to the provider; provider events (deltas) flow back through an adapter to be normalized.
*   **Event Normalization**: The `VoiceAdapter` (specifically `ai-sdk-adapter.ts`) transforms provider events into the **AI SDK Data Stream Protocol** for UI consumption.
*   **Handoffs**: On tool calls, a `HandoffPacket` captures current conversation state to allow subagents to resume the task without context loss.

### 3) Relevant Code Locations

**Entrypoints & Orchestration**
*   `pi-agent/src/agent/voice-agent.ts`: Central orchestrator; controls session lifecycle and transport hotswapping.
*   `pi-agent/src/voice/factory.ts`: Current provider selection logic; target for the new runtime host.

**Domain & Adapter Logic**
*   `pi-agent/src/voice/types.ts`: Contains the primary interface definitions; currently suffers from OpenAI SDK type leaks.
*   `pi-agent/src/voice/openai-realtime-runtime.ts`: The current OpenAI adapter implementation.
*   `pi-agent/src/voice/ultravox-realtime-runtime.ts`: A protocol-based (non-SDK) adapter with complex transcript accumulation logic.
*   `pi-agent/src/voice/decomposed-runtime.ts`: Orchestrates a multi-provider pipeline (STT + LLM + TTS).
*   `pi-agent/src/realtime/ai-sdk-adapter.ts`: The bridge that normalizes voice events into the unified stream protocol.

**Integration & Config**
*   `pi-agent/src/voice/settings.ts`: JSON loading and Zod validation for runtime and auth profiles.
*   `pi-agent/src/voice/config.ts`: Effective config resolver (Cascading: Env -> Profile -> File -> Default).
*   `pi-agent/src/context/handoff.ts`: Defines the data structure for cross-agent context transfer.

**Media & Transports**
*   `pi-agent/src/transport/types.ts`: Defines the audio transport contract and hardcoded 24kHz constants.
*   `pi-agent/src/voice/audio-utils.ts`: Audio processing helpers including PCM resampling and WAV encoding.
*   `web/public/audio-processor.js`: Browser-side AudioWorklet handling 48k to 24k downsampling.

**Tests**
*   `pi-agent/tests/ultravox-runtime.test.ts`: Unit tests for transcript role mapping and tool invocation sequences.
*   `pi-agent/tests/audio-utils.test.ts`: Tests for resampling accuracy across different sample rates.