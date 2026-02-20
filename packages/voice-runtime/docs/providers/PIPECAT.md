# Pipecat RTVI Provider Notes

This document describes the `pipecat-rtvi` adapter integration in the extracted runtime.

Capability matrix and cross-provider comparisons live in `docs/voice-runtime/PROVIDERS.md`.

## 1. Code Locations

- adapter: `packages/voice-runtime/src/adapters/pipecat-rtvi-adapter.ts`
- runtime registration: `pi-agent/src/voice/factory.ts`
- config resolution: `pi-agent/src/voice/config.ts`, `pi-agent/src/voice/settings.ts`

## 2. Session Flow

1. `VoiceSession.connect()` calls adapter `connect()`.
2. Adapter opens websocket to `providerConfig.serverUrl`.
3. Adapter sends:
   - `client-ready`
   - `describe-actions`
   - `describe-config`
   - bootstrap `client-message`
4. Adapter waits for `bot-ready` (timeout default: 12s).
5. Runtime moves to `listening`.

## 3. Normalized Events

The adapter maps RTVI messages to `VoiceSessionEvents`:

- state: listening/thinking/speaking/idle
- transcripts: user + assistant delta/final
- audio: binary frames and base64 audio messages
- tools: `toolStart`/`toolEnd`/`toolCancelled`
- metrics: latency + usage

Turn lifecycle is deduplicated so `turnComplete` is emitted once per turn.

## 4. Tools

`llm-function-call*` events are normalized into one callback path:

- call -> `toolHandler(name, args, context)`
- result -> `llm-function-call-result`

`autoToolExecution` defaults to `true`. Set `false` to execute tools externally and return results with `sendToolResult`.

## 5. Reconnect + Keepalive

- unexpected close -> bounded exponential reconnect attempts
- keepalive ping (default 15s) after `bot-ready`
- keepalive config:
  - `keepAliveIntervalMs` (set `0` to disable)
  - `pingMessageType` (default: `ping`)

## 6. Provider Config Fields

`PipecatProviderConfig`:

- `serverUrl`
- `transport`
- `inputSampleRate`, `outputSampleRate`
- `audioInputEncoding`, `audioInputMessageType`
- `readyTimeoutMs`
- `reconnect`
- `clientVersion`
- `autoToolExecution`
- `bootstrapMessageType`
- `keepAliveIntervalMs`, `pingMessageType`
- `pipeline`, `botId`

## 7. Operational Checklist

1. Confirm Pipecat server is reachable from `pi-agent`.
2. Start with websocket transport first (`transport: "websocket"`).
3. Validate handshake and first turn in logs.
4. Enable benchmark capture (`VOICE_BENCHMARK_ENABLED=true`) and confirm no ordering/latency violations.
5. Only then switch profile defaults/UI config to `pipecat-rtvi`.
