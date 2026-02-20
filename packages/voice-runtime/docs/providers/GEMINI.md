# Gemini Live Provider Notes

Google Gemini Live adapter using the `BidiGenerateContent` WebSocket API.

## 1. Code Location

- Adapter: `packages/voice-runtime/src/adapters/gemini-live-adapter.ts`
- Config parser: `parseGeminiProviderConfig()` in `provider-config.ts`

## 2. Session Flow

### WebSocket + Setup Handshake

1. Open WebSocket to the Gemini endpoint with API key as query param:
   ```
   wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=<apiKey>
   ```
2. Wait for `open` event.
3. Send `setup` message with full session configuration (model, tools, voice, instructions, etc.).
4. Wait for `setupComplete` response (12s timeout).
5. Move to `listening` state and emit `connected`.

The setup message is a single JSON envelope containing everything Gemini needs:
- Model reference (auto-prefixed with `models/` if needed)
- System instruction
- Generation config (voice, temperature, max tokens, response modalities)
- Realtime input config (VAD, interruption handling)
- Tool declarations
- Transcription settings
- Session resumption handle
- Context window compression settings
- Proactivity settings

## 3. Audio Format

| Direction | Rate | Format |
|-----------|------|--------|
| Input (mic -> Gemini) | 16kHz | Base64-encoded PCM16 with `audio/pcm;rate=16000` mime |
| Output (Gemini -> speaker) | 24kHz | Base64-encoded PCM16 inline data |
| Preferred client rate | 24kHz | Adapter resamples input from 24kHz to 16kHz |

Audio is sent as JSON with base64-encoded data (not raw binary):

```typescript
{
  realtimeInput: {
    audio: {
      data: '<base64>',
      mimeType: 'audio/pcm;rate=16000',
    },
  },
}
```

Output audio arrives in `serverContent.modelTurn.parts[].inlineData` with base64 data and a mime type containing the sample rate.

## 4. Capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| Tool calling | Yes | `functionCalls` in `toolCall` envelope |
| Tool cancellation | Yes | `toolCallCancellation` with cancelled IDs |
| Tool scheduling | Yes | `INTERRUPT` / `WHEN_IDLE` / `SILENT` |
| Non-blocking tools | Yes | `behavior: 'NON_BLOCKING'` on declaration |
| Transcript deltas | Yes | Input/output transcription |
| Interruption | Yes | `serverContent.interrupted` flag |
| Session resumption | Yes | Via `sessionResumptionUpdate.newHandle` |
| Context compression | Yes | Sliding window with target token count |
| Proactivity | Yes | `proactiveAudio: true` |
| Usage metrics | Yes | `usageMetadata` with token counts |
| Ephemeral tokens | Yes | API key passed as ephemeral-compatible value |
| VAD modes | `server`, `manual` | `automaticActivityDetection.disabled` for manual |
| Interruption modes | `barge-in`, `no-interruption` | `activityHandling` config |
| Async tools | Yes | |
| Tool timeout | No | |
| Tool reaction | No | |
| Precomputable tools | No | |
| MCP tools | No | |
| Ordered transcripts | No | |

## 5. Session Resumption

Gemini supports resuming sessions after disconnection:

1. During a session, the server sends `sessionResumptionUpdate` with a `newHandle`.
2. The adapter stores this handle in `pendingResumeHandle`.
3. On reconnect, the handle is included in the setup message:
   ```typescript
   setup.sessionResumption = { handle: resumeHandle };
   ```
4. The `resume(handle)` method allows external callers to set the handle before reconnecting.

The adapter emits latency events when a new resume handle is received, including the `resumable` flag.

## 6. Context Window Compression

Gemini supports sliding-window context compression to manage long conversations:

```typescript
setup.contextWindowCompression = {
  slidingWindow: { targetTokens: config.contextWindowCompressionTokens },
};
```

Configure via `GeminiProviderConfig.contextWindowCompressionTokens` (number of tokens to target).

## 7. Proactivity

When enabled, Gemini can proactively generate audio without user input:

```typescript
setup.proactivity = { proactiveAudio: true };
```

Configure via `GeminiProviderConfig.proactivity: true`.

## 8. Transcript Handling

### Input Transcription

Arrives in `serverContent.inputTranscription.text`. The adapter:
1. Creates a user item if none is active (`ensureActiveUserItem`).
2. Computes delta from previous text using prefix matching.
3. Emits `transcriptDelta` for incremental updates.
4. Finalizes on `turnComplete` / `generationComplete`.

### Output Transcription

Arrives in `serverContent.outputTranscription.text`. Same delta computation as input.

### Model Turn Text

Text in `serverContent.modelTurn.parts[].text` is also accumulated as assistant transcript deltas.

## 9. Tool Handling

### Function Declarations

Tools are sent in the setup message as `functionDeclarations`:

```typescript
{
  name: 'tool_name',
  description: 'What the tool does',
  parameters: { type: 'object', properties: { ... } },
  behavior: 'NON_BLOCKING',  // optional
}
```

### Tool Call Protocol

```
Gemini sends:    { toolCall: { functionCalls: [{ id, name, args }] } }
Adapter calls:   toolHandler(name, args, context) for each call
Adapter sends:   { toolResponse: { functionResponses: [{ id, name, response, scheduling }] } }
```

### Tool Cancellation

```
Gemini sends:    { toolCallCancellation: { ids: ['call-1', 'call-2'] } }
Adapter emits:   'toolCancelled' event with the cancelled IDs
```

### Tool Scheduling

Tool results can specify when Gemini should process them:

| Value | Gemini Value | Description |
|-------|-------------|-------------|
| `'interrupt'` | `INTERRUPT` | Process immediately, interrupt current output |
| `'when_idle'` | `WHEN_IDLE` | Process when not speaking |
| `'silent'` | `SILENT` | Process silently without generating output |

## 10. Server Content Handling

The `serverContent` envelope contains:

| Field | Description |
|-------|-------------|
| `modelTurn.parts[]` | Audio (inlineData) and text parts |
| `turnComplete` | Model turn is complete |
| `generationComplete` | Full generation is complete |
| `interrupted` | Model was interrupted by user |
| `inputTranscription.text` | User speech transcription |
| `outputTranscription.text` | Model speech transcription |

On `turnComplete` or `generationComplete`:
1. Finalize any active user transcript.
2. Finalize any active assistant transcript.
3. Set state to `listening`.
4. Emit `turnComplete`.

## 11. GoAway Handling

The server may send `goAway` with a `timeLeft` field indicating the session will close soon. The adapter emits this as a latency event for monitoring.

## 12. Configuration

`GeminiProviderConfig` fields:

| Field | Default | Description |
|-------|---------|-------------|
| `apiKey` | (required) | Google AI API key |
| `endpoint` | Gemini Live WS endpoint | Custom WebSocket URL |
| `useEphemeralToken` | `false` | Treat apiKey as ephemeral token |
| `noInterruption` | `false` | Use `NO_INTERRUPTION` activity handling |
| `enableInputTranscription` | `true` | Enable user speech transcription |
| `enableOutputTranscription` | `true` | Enable model speech transcription |
| `sessionResumptionHandle` | (none) | Resume handle from previous session |
| `contextWindowCompressionTokens` | (none) | Target token count for sliding window |
| `proactivity` | `false` | Enable proactive audio generation |
