# Codebase Inspection

**Request:** Find remaining provider-specific logic hardcoded outside packages/voice-runtime in voice-agent and web-ui, especially ordering, routing, catalog/auth handling.

---

This analysis identifies provider-specific logic, hardcoded model identifiers, and ordering heuristics currently residing outside the `packages/voice-runtime` boundary, specifically within `packages/voice-agent` and `packages/web-ui`.

### 1) Scan & Map
*   **Three-Plane Architecture**: The system is transitioning to a model where `voice-runtime` owns the **Provider Plane** (protocol/SDKs), `voice-agent` owns the **Control Plane** (orchestration/profiles), and `web-ui` handles the **Presentation Plane**.
*   **The Bridge Pattern**: `PackageBackedVoiceRuntime` and `LegacyAudioTransportBridge` in `voice-agent` act as translation layers between the new runtime package and legacy app-level expectations (like 24kHz fixed audio).
*   **Normalized Event Stream**: All agents communicate via the **AI SDK Data Stream Protocol**. The `ai-sdk-adapter` is responsible for converting raw provider events into this unified format.
*   **State Reducers**: `web-ui` uses a central Zustand store (`unified-sessions.ts`) that reconstructs conversation state from the stream, currently relying on some provider-native metadata for sequence.
*   **Constraints**: Current effort is focused on "Phase 1: Ordering Contract," moving away from parsing provider IDs (e.g., `assistant-1`) toward using normalized `order` metadata.

### 2) Existing Flow
*   **Initialization**: `VoiceAgent` (agent) uses a factory to create a runtime, passing an `AgentProfile` which contains hardcoded instructions and tool sets.
*   **Handshake**: The runtime adapter (e.g., `UltravoxWsAdapter`) manages REST-to-WS transitions and negotiates sample rates, providing a `NegotiatedAudioConfig`.
*   **Streaming**: Real-time events (transcripts/deltas) are passed from the adapter to the `VoiceSessionImpl`, then through the `PackageBackedVoiceRuntime` bridge.
*   **Adaptation**: The `createVoiceAdapter` (agent) creates `user-placeholder` and `assistant-placeholder` events to reserve timeline positions.
*   **UI Routing**: The `message-handler` (web) receives these chunks and updates the `voiceTimeline`, using `itemId` and `order` to determine placement.
*   **Handoff**: Specialized subagents (CLI, Web Search) are triggered via `HandoffPacket`, which carries its own model-specific configurations.

### 3) Relevant Code Locations

**Entrypoints & Orchestration (voice-agent)**
*   `packages/voice-agent/src/config.ts`: Contains hardcoded fallback model versions for OpenAI, Gemini, and Decomposed modes (e.g., `gpt-realtime-mini-2025-10-06`).
*   `packages/voice-agent/src/agent/profiles.ts`: Hardcodes voice selections (`echo`, `ash`) and tool lists per profile.
*   `packages/voice-agent/src/voice/factory.ts`: Orchestrates the mapping of `AgentProfile` to `SessionInput`, including hardcoded tool execution logic.
*   `packages/voice-agent/src/voice/settings.ts`: Defines `DEFAULT_VOICE_CONFIG` containing hardcoded provider IDs and model strings.

**Domain Logic & Bridging (voice-agent)**
*   `packages/voice-agent/src/realtime/session.ts`: Direct dependency on `@openai/agents/realtime` and hardcoded transcription model strings.
*   `packages/voice-agent/src/realtime/ai-sdk-adapter.ts`: Defines how tool calls and transcripts are normalized; contains logic for synthetic `voice-tool-N` ID generation.
*   `packages/voice-agent/src/voice/package-backed-runtime.ts`: Manages the transition from package events to application state, including history mapping.

**State & UI (web-ui)**
*   `packages/web-ui/src/stores/message-handler.ts`: Contains critical ordering logic that parses `itemId` patterns (e.g., `assistant-` prefix) and handles placeholder insertions.
*   `packages/web-ui/src/stores/unified-sessions.ts`: Logic for `findMessageIndexByItemId` and `updateTranscriptDelta` which relies on provider-specific item identifiers.
*   `packages/web-ui/src/lib/voice-config-api.ts`: Duplicates `VoiceConfigDocument` and `VoiceMode` types which are functionally hardcoded to match the backend.
*   `packages/web-ui/src/components/VoiceRuntimePanel.tsx`: Hardcoded logic for path traversal (e.g., `voice.voiceToVoice.provider`) and stage descriptions.

**TUI & Subagents (voice-agent)**
*   `packages/voice-agent/src/tui/inspector/state.ts`: Implements `findTranscriptInsertIndex` using `previousItemId`, mimicking the web UI's provider-specific ordering heuristics.
*   `packages/voice-agent/src/subagents/cli/config.json`: Hardcoded subagent model `x-ai/grok-code-fast-1`.
*   `packages/voice-agent/src/subagents/web-search/config.json`: Hardcoded subagent model `x-ai/grok-4.1-fast:online`.

**Guardrails & Testing**
*   `scripts/check-runtime-provider-boundary.ts`: An automated list of blocked literals (e.g., `'openai-realtime'`, `'gpt-4o-mini-transcribe'`) currently being enforced as a boundary guard.