# Code Patterns & Learnings

Hard-won lessons from development. Each pattern includes the bug, root cause, and fix.

## React StrictMode WebSocket Singleton

React StrictMode double-mounts components in development, which can create duplicate WebSocket connections. Solution: module-level singleton with ref counting.

```typescript
// web/src/hooks/useWebSocket.ts
let globalWs: WebSocket | null = null;
let globalWsRefCount = 0;

export function useWebSocket() {
  useEffect(() => {
    globalWsRefCount++;
    if (globalWs?.readyState === WebSocket.OPEN) {
      wsRef.current = globalWs;
      return;
    }
    // Create new connection...
    return () => {
      globalWsRefCount--;
      if (globalWsRefCount === 0) {
        globalWs?.close();
        globalWs = null;
      }
    };
  }, []);
}
```

Delay socket close to survive StrictMode double-mount:

```typescript
setTimeout(() => {
  if (globalWsRefCount === 0 && socketToClose === globalWs) {
    socketToClose.close();
  }
}, 500);
```

## State Transition Detection

When auto-stopping based on state, check for **transitions** not just current value. Otherwise, effects trigger on initial state.

```typescript
const prevStateRef = useRef<string | null>(null);
useEffect(() => {
  const prevState = prevStateRef.current;
  prevStateRef.current = state;
  if (state === 'idle' && prevState !== null && prevState !== 'idle') {
    stopRecording();
  }
}, [state]);
```

## Demo Mode Check

Always use explicit flag check, not absence of other vars:

```typescript
// CORRECT
const isDemoMode = process.env.PUBLIC_DEMO_MODE === 'true';
// WRONG - breaks when env var is simply unset
const isDemoMode = !process.env.PUBLIC_WS_URL;
```

## Web Audio Transport (Browser as Mic/Speaker)

When `TRANSPORT_MODE=web`, the browser captures audio and sends it to the backend via WebSocket.

### Audio Buffering During Connection

The browser starts sending audio immediately when the user clicks the mic, but the OpenAI session takes time to connect. Solution: buffer audio in `VoiceSession` during connection, then flush when ready.

```typescript
// pi-agent/src/realtime/session.ts
private audioBuffer: ArrayBuffer[] = [];
private isConnecting = true;

sendAudio(audio: ArrayBuffer): void {
  if (this.isConnecting) {
    this.audioBuffer.push(audio);
    return;
  }
  this.session.sendAudio(audio);
}

private flushAudioBuffer(): void {
  for (const chunk of this.audioBuffer) {
    this.session.sendAudio(chunk);
  }
  this.audioBuffer = [];
}
```

### Node.js WebSocket Binary vs Text Detection

**Bug**: Using `Buffer.isBuffer(data)` to detect binary messages is WRONG - text messages in Node.js `ws` library also arrive as Buffers. Only use the `isBinary` flag.

```typescript
ws.on('message', (data, isBinary) => {
  // WRONG: if (isBinary || Buffer.isBuffer(data))
  // CORRECT: only check isBinary
  if (isBinary) {
    handleBinaryAudio(data);
    return;
  }
  const msg = JSON.parse(data.toString());
});
```

### Audio Playback Scheduling

**Bug**: When scheduling multiple audio buffers, checking `playbackStartTime < currentTime` resets scheduling for each buffer in a tight loop.

**Fix**: Check if the END of scheduled audio is in the past, not the start:

```typescript
const scheduledEndTime = this.playbackStartTime + (this.samplesScheduled / TARGET_SAMPLE_RATE);
if (this.samplesScheduled === 0 || scheduledEndTime < currentTime) {
  this.playbackStartTime = currentTime;
  this.samplesScheduled = 0;
}
```

### Echo Prevention

Don't send mic audio while the agent is speaking (prevents feedback loop):

```typescript
audioController.setOnAudio((data) => {
  if (stateRef.current === 'speaking' || stateRef.current === 'thinking') {
    return;
  }
  sendBinary(data);
});
```

### Audio Interruption Handling

**Problem**: When user speaks during agent TTS playback, buffered audio continues playing.

**Solution**: Propagate interruption through the transport layer:

```
OpenAI SDK: audio_interrupted → VoiceSession → VoiceAgent → transport.interrupt()
  → WebSocketTransport: { type: 'audio_control', action: 'interrupt' }
  → Frontend: audioController.interrupt() → close AudioContext + clear queue
```

**Key files**:
- `pi-agent/src/realtime/session.ts`: Emits `audioInterrupted` event
- `pi-agent/src/agent/voice-agent.ts`: Calls `transport.interrupt()`
- `pi-agent/src/transport/websocket.ts`: Sends `audio_control` message
- `web/src/stores/message-handler.ts`: Dispatches event
- `web/src/hooks/useAudioSession.ts`: Calls `audioController.interrupt()`

## PTY Session Multiplexing (Mac Daemon)

**Problem**: Multiple WebSocket connections to the same terminal session each spawned a new `tmux attach-session` process.

**Solution**: One PTY per session, multiple WebSocket viewers:

```typescript
// mac-daemon/src/pty/manager.ts
attach(sessionId: string, ws: WebSocket) {
  const existing = this.connections.get(sessionId);
  if (existing) {
    existing.viewers.add(ws); // Add viewer, DON'T create new PTY
    return;
  }
  // Only spawn tmux attach-session for first connection
}
```

## Terminal Client Singleton Pattern

**Problem**: React StrictMode creates multiple WebSocket connections to the same terminal.

**Solution**: Module-level singleton map keyed by sessionId with ref counting + delayed cleanup.

See `web/src/lib/terminal-client.ts` for implementation.

## CSS 3D Transform Perspective Nesting

**Problem**: Nested `perspective` + `preserve-3d` cause compounded transforms.

**Solution**: Only apply `perspective` to ONE ancestor. Cap depth effects:

```typescript
const cappedIndex = Math.min(index, 5);
const depthZ = -30 * cappedIndex;
const depthOpacity = Math.max(0.3, 1 - cappedIndex * 0.12);
```

## shadcn/ui Dark Mode

When using shadcn/ui with a dark theme, you MUST apply `class="dark"` to the HTML element. CSS variables in `:root` are light mode; dark mode is scoped under `.dark`.

## AI SDK Voice Transcript Role Handling

**Bug**: User and assistant transcripts concatenated into one message.

**Root Cause**: AI SDK `text-delta` is for assistant responses only. User messages need a custom event.

**Fix**: Add `user-transcript` event type. Adapter sends user transcripts as `user-transcript` and assistant transcripts as `text-delta`. Frontend creates separate messages for each.

See `pi-agent/src/realtime/ai-sdk-adapter.ts` and `web/src/stores/unified-sessions.ts`.

## Assistant Transcript Double-Emit Guard (OpenAI Realtime)

**Bug**: Assistant messages appeared twice in UI (one completed + one pending duplicate).

**Root Cause**: OpenAI realtime can emit both:
- streamed assistant deltas (`response.output_audio_transcript.delta`, with `item_id`)
- final `agent_end` transcript (without `itemId`)

If both are forwarded as assistant text events, the frontend creates duplicate assistant blocks.

**Fix**: In `VoiceAgent`, treat assistant final transcript without `itemId` as fallback-only:
- if any assistant deltas were already seen in the current turn, drop the final transcript
- reset the delta flag only when a new assistant item starts (`assistantItemCreated`)

**Ordering caveat**: final assistant transcript can arrive after `speaking -> listening`.
Do **not** reset dedupe state on state transition alone.

See `pi-agent/src/agent/voice-agent.ts`.

## Ultravox Transcript + Client Tool Contract

**Bug**: Ultravox assistant speech was audible, but no assistant transcript/tool execution appeared in stream.

**Root Cause**:
- Ultravox uses `role: "agent"` for assistant transcript events (not always `assistant`)
- partial transcript text is often in `delta`, not `text`
- client tools must be registered via `selectedTools.temporaryTool` and executed by the client after `client_tool_invocation`

**Fix**:
- map `role: "agent"` to assistant
- consume `delta` and final `text` transcript forms
- register local tools on call creation and round-trip `client_tool_result` with `invocationId`

See `packages/voice-runtime/src/adapters/ultravox-ws-adapter.ts`.

## Realtime Barge-In and Turn-Lag

**Bug**: Voice runtime feels laggy and interruptions/turn detection do not behave naturally.

**Root Cause**:
- mic audio was suppressed in frontend while `speaking`/`thinking`
- capture chunk size was 100ms, adding extra upstream latency per turn

**Fix**:
- always stream mic audio while session is active (provider handles interruption)
- reduce capture chunk size to 40ms for faster turn feedback
- for Ultravox websocket calls, set `clientBufferSizeMs` and support `playback_clear_buffer` interrupts
- request Ultravox websocket at `inputSampleRate=48000` and `outputSampleRate=48000`
- use negotiated sample rates from `create call` response (`medium.serverWebSocket`) instead of hardcoding
- normalize for transport by resampling:
  - uplink: 24k transport PCM16 -> Ultravox input sample rate
  - downlink: Ultravox output sample rate -> 24k transport playback

See `web/src/hooks/useAudioSession.ts`, `web/public/audio-processor.js`, `packages/voice-runtime/src/adapters/ultravox-ws-adapter.ts`, `packages/voice-runtime/src/media/resample-pcm16.ts`.
