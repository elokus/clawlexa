# Voice Provider Integration Guide

This repo now supports a configurable voice layer with:

- Voice-to-voice providers: `openai-realtime`, `ultravox-realtime` (and `gemini-live` scaffold)
- Decomposed providers: `stt + llm + tts` with current tested path:
  - `deepgram` STT
  - `gpt-4.1` LLM
  - `deepgram` TTS

## 1. Config Files

Runtime config lives in JSON files at repo root:

- `.voiceclaw/voice.config.json`
- `.voiceclaw/auth-profiles.json`

Examples:

- `.voiceclaw/voice.config.example.json`
- `.voiceclaw/auth-profiles.example.json`

`voice.config.json` controls mode/provider/model/turn behavior.
`auth-profiles.json` controls API credentials and default provider->profile mapping.

## 2. UI Configuration

The web dashboard now has a `Voice Runtime` panel above the control bar:

- switch mode (`voice-to-voice` / `decomposed`)
- switch provider and model
- save to `.voiceclaw/voice.config.json`

Saved changes apply to new sessions.

## 3. Backend Config APIs

- `GET /api/config/voice`
- `GET /api/config/voice/effective?profile=jarvis|marvin`
- `GET /api/config/voice/catalog`
- `PUT /api/config/voice`
- `GET /api/config/auth-profiles`
- `PUT /api/config/auth-profiles`
- `POST /api/config/auth-profiles/test`

`/api/config/voice/effective` returns the fully resolved runtime for a profile
after mode/provider/profile overrides are applied.

`/api/config/voice/catalog` returns provider-native model/voice lists used by UI selectors.

## 4. Provider Endpoint Map

### Ultravox (voice-to-voice)

- Create call: `POST https://api.ultravox.ai/api/calls`
- Join realtime socket: `joinUrl` from create response
- Model discovery: `GET https://api.ultravox.ai/api/models`

Current runtime uses `medium.serverWebSocket` and sends/receives audio over WebSocket.

### Deepgram STT (decomposed)

- Transcribe audio: `POST https://api.deepgram.com/v1/listen`
- Required auth header: `Authorization: Token <DEEPGRAM_API_KEY>`

### Deepgram TTS (decomposed)

- Synthesize speech: `POST https://api.deepgram.com/v1/speak`
- Current runtime query params:
  - `model=<voice/model>`
  - `encoding=linear16`
  - `sample_rate=24000`
  - `container=none` (runtime) or `wav` (scratch roundtrip)

### OpenAI LLM (decomposed)

- Chat completions: `POST https://api.openai.com/v1/chat/completions`
- Current tested model: `gpt-4.1`

## 5. Pipecat-Style Turn Completion

In decomposed mode, turn completion markers are enabled:

- `✓` complete turn
- `○` incomplete short pause
- `◐` incomplete long pause

Behavior:

- `✓`: continue with normal response + TTS
- `○` / `◐`: suppress spoken response, schedule reprompt timeout

Relevant runtime: `pi-agent/src/voice/decomposed-runtime.ts`

## 6. Scratch Test Harness

### Main end-to-end lab

`pi-agent/src/scratch-voice-pipeline.ts`

Commands:

- `bun run scratch:voice auth`
- `bun run scratch:voice ultravox`
- `bun run scratch:voice deepgram`
- `bun run scratch:voice decomposed`
- `bun run scratch:voice all`

What it validates:

- auth resolution from `auth-profiles.json`
- Ultravox call creation + websocket handshake
- Deepgram TTS->STT roundtrip
- Decomposed path `Deepgram STT -> GPT-4.1 marker output -> Deepgram TTS`

### Provider contract checker

`pi-agent/src/scratch-provider-contract.ts`

Command example:

- `bun run scratch:provider deepgram`
- `bun run scratch:provider ultravox`

This validates auth + minimal contract endpoint per provider and prints current runtime config mapping.

## 7. Reproducible Onboarding for New Providers

When adding a new STT/TTS/STS provider:

1. Add auth mapping in `auth-profiles.json` (`profiles` + `defaults`).
2. Add provider options to `voice.config.json`.
3. Implement adapter/runtime branch under `pi-agent/src/voice/`.
4. Add provider contract in `scratch-provider-contract.ts`.
5. Add roundtrip/smoke path in `scratch-voice-pipeline.ts`.
6. Run:
   - `bun run scratch:provider <provider>`
   - `bun run scratch:voice all`
7. Verify UI save/apply flow in web dashboard.

## 8. Source Links

- Ultravox docs: https://docs.ultravox.ai/
- Deepgram STT docs: https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
- Deepgram lower-level WebSocket docs: https://developers.deepgram.com/docs/lower-level-websockets
- Deepgram TTS docs: https://developers.deepgram.com/docs/streaming-text-to-speech
