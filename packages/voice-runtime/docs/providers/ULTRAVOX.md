# Ultravox Provider Notes

Ultravox is a voice-to-voice provider using a REST create-call + WebSocket join protocol.

## 1. Code Location

- Adapter: `packages/voice-runtime/src/adapters/ultravox-ws-adapter.ts`
- Config parser: `parseUltravoxProviderConfig()` in `provider-config.ts`

## 2. Session Flow

### REST Create Call

1. `POST {apiBaseUrl}/api/calls` with `X-API-Key` header.
2. Request body includes: model, systemPrompt, voice, medium (sample rates), and selectedTools.
3. Response contains `joinUrl` (or `websocketUrl`) and negotiated sample rates.

### WebSocket Join

4. Open WebSocket to `joinUrl` with `?apiVersion=1`.
5. Set `binaryType = 'arraybuffer'` (audio is raw binary).
6. Wait for `open` event.
7. Bind message handlers and emit `connected`.

### Disconnect

Sends `{ type: 'hang_up' }` before closing the socket.

## 3. Audio Format

| Direction | Default Rate | Negotiable |
|-----------|-------------|------------|
| Input (mic -> Ultravox) | 48kHz | Yes, via `inputSampleRate` |
| Output (Ultravox -> speaker) | 48kHz | Yes, via `outputSampleRate` |
| Preferred client rate | 24kHz | Adapter resamples automatically |

The adapter uses `resamplePcm16Mono()` to convert between client preferred rate (24kHz) and provider rates (typically 48kHz) in both directions.

Binary WebSocket messages are raw PCM16 audio -- no framing or headers.

## 4. Capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| Tool calling | Yes | Client-side via `client_tool_invocation` / `client_tool_result` |
| Transcript deltas | Yes | Via ordinal-based accumulation |
| Interruption | Yes | `playback_clear_buffer` messages |
| Server-side tools | Yes | Via `temporaryTool` definitions |
| Precomputable tools | Yes | `precomputable: true` on tool definition |
| Tool reaction | Yes | `SPEAKS` / `LISTENS` / `SPEAKS_ONCE` |
| Tool timeout | Yes | Specified as duration string (e.g., `"5000ms"`) |
| Session resumption | Yes | (not yet implemented in adapter) |
| Force agent message | Yes | `forced_agent_message` with urgency |
| Output medium switch | Yes | `set_output_medium` voice/text |
| Call state | Yes | Via `updateCallState` in tool results |
| Deferred text | Yes | `deferred_text_message` type |
| Call stages | Yes | `new-stage` response type in tool results |
| Ordered transcripts | Yes | Via ordinal numbers |
| VAD | Server-only | |
| Proactivity | No | |
| Usage metrics | No | |
| Ephemeral tokens | No | |

## 5. Server-Side Tools

Tools are sent as `selectedTools` in the create-call payload using the `temporaryTool` format:

```typescript
{
  temporaryTool: {
    modelToolName: 'tool_name',
    description: 'What the tool does',
    dynamicParameters: [{
      name: 'param',
      location: 'PARAMETER_LOCATION_BODY',
      schema: { type: 'string' },
      required: true,
    }],
    client: {},                          // marks as client-executed
    precomputable: true,                 // optional
    timeout: '5000ms',                   // optional
    defaultReaction: 'SPEAKS',           // optional: SPEAKS | LISTENS | SPEAKS_ONCE
  }
}
```

### Tool Reactions

Control what the agent does while waiting for the tool result:

| Reaction | Ultravox Value | Description |
|----------|---------------|-------------|
| `speaks` | `SPEAKS` | Agent continues speaking (default) |
| `listens` | `LISTENS` | Agent waits silently |
| `speaks-once` | `SPEAKS_ONCE` | Agent speaks once then waits |

### Tool Result Protocol

```
Ultravox sends:  { type: 'client_tool_invocation', toolName, invocationId, parameters }
Adapter calls:   toolHandler(toolName, args, context)
Adapter sends:   { type: 'client_tool_result', invocationId, result, responseType, ... }
```

`responseType` values:
- `tool-response` -- normal result
- `tool-error` -- error result
- `new-stage` -- triggers a stage transition

Optional fields in result: `updateCallState`, `errorMessage`, `agentReaction`.

## 6. Ordinal Transcript Normalization

Ultravox uses ordinal numbers to identify transcript turns. The adapter maintains a `transcriptsByOrdinal` map to:

1. Accumulate partial transcripts (deltas or full-text updates).
2. Compute deltas when only full text is provided (not delta).
3. Defer assistant item creation until meaningful text arrives (avoids empty bubbles).
4. Emit user items immediately (even before text, for "You: ..." UI feedback).
5. Emit final `transcript` event with accumulated text when `final: true`.

### Role Mapping

Ultravox may use `role: 'agent'` or `speaker: 'agent'` for assistant messages. The adapter normalizes both to `'assistant'`.

## 7. WebSocket Message Types

### Incoming (Ultravox -> Adapter)

| Type | Description |
|------|-------------|
| `state` | Voice state: listening/thinking/speaking |
| `transcript` | Text transcript with ordinal, delta/text, final flag |
| `playback_clear_buffer` | Interruption -- clear audio buffer |
| `client_tool_invocation` | Tool call request |
| (binary) | Raw PCM16 audio data |

### Outgoing (Adapter -> Ultravox)

| Type | Description |
|------|-------------|
| `input_text_message` | Text input from user |
| `deferred_text_message` | Deferred text (context, not immediate) |
| `client_tool_result` | Tool execution result |
| `set_output_medium` | Switch between voice and text output |
| `forced_agent_message` | Force agent to speak specific text |
| `hang_up` | End the call |
| (binary) | Raw PCM16 audio input |

## 8. Configuration

`UltravoxProviderConfig` fields:

| Field | Default | Description |
|-------|---------|-------------|
| `apiKey` | (required) | Ultravox API key (`X-API-Key` header) |
| `apiBaseUrl` | `'https://api.ultravox.ai'` | API base URL |
| `model` | From `SessionInput.model` | Ultravox model name |
| `voice` | From `SessionInput.voice` | Voice identifier |
| `inputSampleRate` | 48000 | Audio input sample rate |
| `outputSampleRate` | 48000 | Audio output sample rate |
| `clientBufferSizeMs` | 30000 | Client-side audio buffer size |
