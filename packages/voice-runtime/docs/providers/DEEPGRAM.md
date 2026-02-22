# Deepgram Provider Notes

Deepgram is used within the **decomposed adapter** for both STT (speech-to-text) and TTS (text-to-speech). It is not a standalone voice-to-voice provider.

## 1. Code Location

- Decomposed adapter: `packages/voice-runtime/src/adapters/decomposed-adapter.ts`
- STT: `transcribeWithDeepgram()` (HTTP)
- TTS: `ensureDeepgramTtsConnection()`, `speakWithDeepgramLiveSegment()`, `generateAssistantResponseStreamingWithDeepgram()` (WebSocket)

## 2. TTS: WebSocket Continuous Streaming (CRITICAL)

**Deepgram TTS uses WebSocket streaming (`wss://api.deepgram.com/v1/speak`), NOT HTTP.**

This was a real bug -- HTTP TTS does not work for streaming LLM output because it requires the full text up front. The WebSocket transport allows sending text deltas as they arrive from the LLM, producing audio in parallel.

```
LLM stream delta --> connection.sendText(delta) --> Deepgram WS --> Audio events
```

The adapter enforces this: `deepgramTtsTransport` must be `'websocket'`. Attempting HTTP Deepgram TTS throws:

```
Decomposed Deepgram TTS requires websocket transport (no HTTP fallback).
```

## 3. Connection Lifecycle

### Lazy Connect with Dedup Promise

`ensureDeepgramTtsConnection()` manages the connection:

1. If an active connection exists and `isConnected()` returns true, reuse it.
2. If a connection attempt is already in progress (`deepgramTtsConnectionReady` promise), await it (dedup).
3. Otherwise, create a new connection via the `@deepgram/sdk`:

```typescript
deepgram.speak.live({
  model,
  encoding: 'linear16',
  sample_rate: 24000,
  container: 'none',
}, endpoint);
```

4. Wait for `LiveTTSEvents.Open` (10s timeout).
5. On close, the cached reference is cleared so the next call reconnects.

### Connection Reuse

The connection persists across segments within a turn. The `deepgramTtsRequestQueue` serializes concurrent TTS requests so only one is active at a time.

### Cleanup

`closeDeepgramTtsConnection()` calls `requestClose()` then `disconnect()`, clearing both the connection reference and the ready promise.

## 4. Continuous Turn Streaming

When both LLM and TTS use streaming, `generateAssistantResponseStreamingWithDeepgram()` runs them in parallel:

1. Start LLM streaming (`generateAssistantTextStream`).
2. For each LLM text delta:
   - Emit `transcriptDelta` event (text appears in UI immediately).
   - If `deepgramTtsPunctuationChunkingEnabled` is `true` (default):
     - Buffer deltas.
     - Flush chunk packets at punctuation/threshold boundaries.
   - If `deepgramTtsPunctuationChunkingEnabled` is `false`:
     - Buffer deltas.
     - Flush chunk packets by size/whitespace thresholds (not punctuation-driven).
3. Deepgram returns audio chunks via `LiveTTSEvents.Audio`.
4. Audio chunks are enqueued into an `audioPipeline` promise chain.
5. When LLM finishes, send a final flush and wait for all audio to drain.

This achieves parallel text + audio streaming -- the user sees text and hears audio as the LLM generates.

## 5. Flush Strategy

Flushing tells Deepgram to synthesize all buffered text and return audio.

When `deepgramTtsPunctuationChunkingEnabled` is `true`, the runtime uses:

`shouldFlushDeepgramStream(delta, pendingChars, completedFlushes)` with:

| Condition | Threshold | Purpose |
|-----------|-----------|---------|
| Sentence boundary (`.!?;\n`) | 24 chars (first flush), 64 chars (subsequent) | Natural pause points |
| Minor boundary (`,`) | 96 chars | Longer clauses |
| Force flush (no boundary) | 180 chars | Prevent unbounded buffering |

The first flush uses a lower threshold (24 chars) to minimize time-to-first-audio.

When `deepgramTtsPunctuationChunkingEnabled` is `false`, punctuation-based chunking is disabled. The runtime still streams continuously by flushing on size/whitespace thresholds instead of punctuation.

Each flush increments `expectedFlushes`. The turn resolves only when `receivedFlushes >= expectedFlushes` and the audio pipeline has drained.

## 6. Audio Pipeline

### Format

- PCM16 mono, 24kHz sample rate
- `encoding: 'linear16'`, `container: 'none'`

### Chunking and Pacing

Raw audio from Deepgram is chunked into `PCM_BYTES_PER_100MS` (4800 bytes = 100ms at 24kHz mono 16-bit) segments.

Each chunk is emitted with a 20ms inter-chunk delay (`await sleep(20)`) to prevent buffer overrun on the client.

### Interruption

When the user interrupts (barge-in):
1. `interrupted` flag is set to `true`.
2. `audioInterrupted` event is emitted.
3. Audio pipeline checks `interrupted` before each chunk; if true, sets `aborted = true` and closes the connection.
4. The streaming turn resolves without waiting for remaining audio.

## 7. STT: HTTP POST

Deepgram STT uses a simple HTTP POST (not WebSocket):

```
POST https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true
Authorization: Token <deepgramApiKey>
Content-Type: audio/wav
Body: WAV-encoded PCM16 mono audio
```

The adapter encodes raw PCM into WAV format before sending.

## 8. Events

| Event | Source | Description |
|-------|--------|-------------|
| `LiveTTSEvents.Open` | Connection setup | Connection ready for text |
| `LiveTTSEvents.Audio` | During streaming | Raw PCM audio data |
| `LiveTTSEvents.Flushed` | After `flush()` | All buffered text has been synthesized |
| `LiveTTSEvents.Warning` | Deepgram server | Non-fatal warnings |
| `LiveTTSEvents.Error` | Deepgram server | Fatal errors, triggers connection close |
| `LiveTTSEvents.Close` | Connection teardown | Connection closed |

## 9. Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `deepgramTtsTransport` | `'websocket'` | Must be `'websocket'` (HTTP not supported) |
| `deepgramTtsWsUrl` | `'wss://api.deepgram.com/v1/speak'` | WebSocket endpoint URL |
| `deepgramTtsPunctuationChunkingEnabled` | `true` | `true`: flush on punctuation/thresholds; `false`: flush on size/whitespace thresholds |
| `ttsModel` | `'aura-2-thalia-en'` | Deepgram TTS model/voice |
| `sttModel` | `'nova-3'` | Deepgram STT model (when sttProvider is deepgram) |
| `deepgramApiKey` | (required) | API key for authentication |

## 10. Timeouts

| Timeout | Duration | Scope |
|---------|----------|-------|
| Connection open | 10s | `ensureDeepgramTtsConnection` |
| Segment flush | 10s | `speakWithDeepgramLiveSegment` |
| Streaming turn | 30s | `generateAssistantResponseStreamingWithDeepgram` |

## 11. Error Handling

`toDeepgramLiveError()` normalizes Deepgram error events (which may be plain objects with `message`/`description`/`code` fields) into standard `Error` objects.

On error during streaming:
1. Connection is closed immediately.
2. The turn promise rejects.
3. The adapter emits an `error` event.
