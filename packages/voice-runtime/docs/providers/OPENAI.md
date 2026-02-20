# OpenAI Realtime Provider Notes

Wraps the `@openai/agents` Realtime SDK for voice-to-voice interaction.

## 1. Code Location

- Adapter: `packages/voice-runtime/src/adapters/openai-sdk-adapter.ts`
- Config parser: `parseOpenAIProviderConfig()` in `provider-config.ts`

## 2. Architecture

The adapter delegates transport management entirely to the OpenAI Realtime SDK (`RealtimeSession` from `@openai/agents/realtime`). The SDK manages WebSocket or WebRTC connections underneath.

```
SessionInput --> RealtimeAgent + RealtimeSession --> OpenAI Realtime API
                      |
                 SDK events --> normalized VoiceSessionEvents
```

## 3. Session Flow

1. `connect()` creates a `RealtimeAgent` with instructions, voice, and tools.
2. Creates a `RealtimeSession` with model, API key, and session config.
3. Calls `session.connect({ apiKey })` to establish the connection.
4. SDK handles the WebSocket handshake and session negotiation.
5. Session events are bound and normalized to `VoiceSessionEvents`.

## 4. Transport

| Property | Value |
|----------|-------|
| Transport kind | SDK-managed (WebSocket default) |
| Input format | PCM16 @ 24kHz |
| Output format | PCM16 @ 24kHz (negotiable via session config) |
| Audio encoding | `pcm16` (also supports `g711_ulaw`, `g711_alaw`) |

The adapter sends GA-style audio config with explicit PCM rate to avoid playback-speed mismatches:

```typescript
audio: {
  input: { format: { type: 'audio/pcm', rate: 24000 } },
  output: { format: { type: 'audio/pcm', rate: 24000 } },
}
```

Output sample rate is updated dynamically from `session.created` / `session.updated` transport events.

## 5. Capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| Tool calling | Yes | Via SDK `tool()` wrapper |
| Transcript deltas | Yes | `response.output_audio_transcript.delta` events |
| Interruption | Yes | `session.interrupt()` |
| Usage metrics | Yes | From SDK events |
| Native truncation | Yes | SDK handles on interrupt |
| Tool approval | Yes | `tool_approval_requested` event |
| MCP tools | Yes | Via SDK |
| Ephemeral tokens | Yes | Key passed as ephemeral-compatible value |
| VAD modes | `server`, `semantic`, `manual`, `disabled` |
| Mid-session config update | Yes | `updateConfig()` supported |
| Session resumption | No | |
| Context compression | No | |
| Proactivity | No | |

## 6. VAD / Turn Detection

Turn detection is configured from `SessionInput.vad`:

| VAD Mode | Turn Detection Type | Description |
|----------|-------------------|-------------|
| `semantic` | `semantic_vad` | Context-aware silence detection (default) |
| `server` | `server_vad` | Standard server VAD |
| `manual` | `null` | No automatic turn detection |
| (default) | From `providerConfig.turnDetection` or `semantic_vad` | |

Configurable parameters:
- `silence_duration_ms` -- how long silence triggers a turn
- `threshold` -- VAD sensitivity

## 7. Event Normalization

### SDK Events to VoiceSessionEvents

| SDK Event | Emitted As | Notes |
|-----------|-----------|-------|
| `audio` | `audio` | PCM frames with resolved sample rate |
| `audio_interrupted` | `audioInterrupted` | Barge-in while speaking |
| `audio_stopped` | state -> `listening` | |
| `agent_start` | `turnStarted`, state -> `thinking` | |
| `agent_end` | `turnComplete`, `transcript` (final) | |
| `agent_tool_start` | `toolStart` | Parses callId and args |
| `agent_tool_end` | `toolEnd` | |
| `tool_approval_requested` | Auto-approved | Calls `approve()` |
| `history_updated` | `historyUpdated` | Maps `RealtimeItem[]` to `VoiceHistoryItem[]` |
| `error` | `error` | |

### Transport Events (raw)

| Transport Event | Handling |
|----------------|----------|
| `session.created` / `session.updated` | Updates output sample rate |
| `input_audio_buffer.speech_started` | Emits `audioInterrupted` if speaking, sets state to `listening` |
| `conversation.item.added` | Emits `userItemCreated` or `assistantItemCreated` |
| `response.output_audio_transcript.delta` | Emits `transcriptDelta` for assistant |
| `conversation.item.input_audio_transcription.completed` | Emits `transcript` for user |

## 8. Tools

Tools are wrapped using the SDK's `tool()` helper:

```typescript
tool({
  name: definition.name,
  description: definition.description,
  strict: false,
  parameters: definition.parameters,
  execute: async (rawInput, _context, details) => {
    // calls input.toolHandler(name, args, context)
    return resultString;
  },
});
```

Tool results are returned as strings directly to the SDK, which feeds them back into the conversation.

## 9. Configuration

`OpenAIProviderConfig` fields:

| Field | Default | Description |
|-------|---------|-------------|
| `apiKey` | (required) | OpenAI API key |
| `turnDetection` | `'semantic_vad'` | Turn detection type |
| `transcriptionModel` | `'gpt-4o-mini-transcribe'` | Input audio transcription model |
| `language` | (from `SessionInput`) | Language for transcription |

## 10. Text Input

`sendText()` sends a user message via:

```typescript
session.sendMessage({
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text }],
});
```

The `defer` option is logged as a latency event but does not change SDK behavior.
