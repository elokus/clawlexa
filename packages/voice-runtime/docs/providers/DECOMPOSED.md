# Decomposed Provider Notes

The decomposed adapter implements a manual STT/LLM/TTS pipeline using HTTP APIs and WebSocket TTS, with layered local VAD (voice activity detection).

## 1. Code Location

- Adapter: `packages/voice-runtime/src/adapters/decomposed-adapter.ts`
- Config parser: `parseDecomposedProviderConfig()` in `provider-config.ts`

## 2. Overview

Unlike voice-to-voice providers (OpenAI Realtime, Ultravox, Gemini Live), the decomposed adapter stitches together separate STT, LLM, and TTS services:

```
Microphone --> Optional neural filter --> Turn detector --> STT --> LLM (streaming + tools) --> TTS --> Speaker
                   |                          |                                              |
                RNNoise                 RNNoise or RMS                                 Deepgram WS or
                                                                                       OpenAI HTTP
```

This gives full control over each component: swap STT/LLM/TTS providers independently, use any LLM via OpenAI-compatible APIs, and tune turn detection for specific environments.

## 3. Pipeline Flow

### 1. Turn Detection (Voice Activity Detection)

The adapter supports three VAD engines:

- `webrtc-vad` (recommended): WebRTC speech classification (voiced/non-voiced frame ratio).
- `rnnoise`: neural speech probability with optional denoised frame path.
- `rms` (legacy): amplitude thresholding with assistant-RMS echo-aware scaling.

In both modes:

1. Incoming PCM16 frame is optionally denoised via RNNoise (`neuralFilterEnabled`).
2. Detector decides speech/non-speech (`vadEngine` specific).
3. If currently speaking and sustained speech is detected, barge-in interruption fires.
   Echo-sensitive gating is only enabled while bot output is actually active
   (assistant output RMS + silence hold), not for the entire speaking state.
4. Speech frames are accumulated in `speechChunks[]`, trailing silence is preserved.
5. `speechStartDebounceMs` requires sustained speech before opening a turn buffer.
6. `silenceMs` finalizes a user turn; turns shorter than `minSpeechMs` are dropped.

### 2. STT (Speech-to-Text)

Two providers available:

| Provider | Endpoint | Auth | Format |
|----------|----------|------|--------|
| OpenAI Whisper | `POST /v1/audio/transcriptions` | `Bearer` token | WAV file upload (FormData) |
| Deepgram Listen | `POST /v1/listen` | `Token` header | WAV binary body |

Both receive WAV-encoded PCM16 mono @ 24kHz. The adapter encodes raw PCM to WAV internally.

### 3. LLM (Language Model)

LLM execution runs through `@voiceclaw/llm-runtime` for supported providers:

| Provider | Runtime Path |
|----------|--------------|
| OpenAI | `llm-runtime` OpenAI adapter |
| OpenRouter | `llm-runtime` OpenRouter adapter |
| Anthropic | `llm-runtime` Anthropic adapter |
| Google | `llm-runtime` Google adapter |

Legacy OpenAI-compatible HTTP fallback (`/chat/completions`) is retained only for OpenAI/OpenRouter compatibility paths.

**Streaming mode** (default): LLM deltas are emitted as `transcriptDelta` events and forwarded to TTS in real-time.

**Tool calling**: Up to 6 tool rounds per turn. The adapter builds `tools` array in OpenAI function-calling format, executes tools via `toolHandler`, and feeds results back as `tool` role messages.

**Turn completion mode** (optional): When `llmCompletionEnabled` is true, the LLM receives a special system prompt asking it to classify the user turn:

| Marker | Meaning | Action |
|--------|---------|--------|
| `✓` | Turn complete | Respond normally |
| `○` | Mid-thought pause | Wait `llmShortTimeoutMs`, then reprompt |
| `◐` | Thinking pause | Wait `llmLongTimeoutMs`, then reprompt |

### 4. TTS (Text-to-Speech)

Providers are now registry-based and mapped in `src/adapters/tts/`:

| Provider | Transport | Streaming | Status |
|----------|-----------|-----------|--------|
| OpenAI | HTTP | segment queue | active |
| Deepgram | WebSocket | full duplex streaming | active |
| Google Chirp | HTTP (Google TTS synth) | segment queue | active |
| Kokoro (local) | HTTP sidecar | segment queue | active |
| Pocket TTS (local) | HTTP sidecar | segment queue | active |
| Cartesia | WebSocket | segment queue over native WS | active |
| Fish Audio | WebSocket/msgpack | segment queue over native WS | active |
| Rime | WebSocket JSON | segment queue over native WS | active |

**Segment queue providers**: Text is split into speakable segments and synthesized sequentially.

**Deepgram WebSocket TTS**: LLM deltas are sent directly to the Deepgram WebSocket as they arrive. Audio is produced in parallel with LLM generation.

`deepgramTtsPunctuationChunkingEnabled` controls flush behavior for streaming Deepgram TTS:
- `true` (default): flush on punctuation/thresholds for lower TTFA.
- `false`: disable punctuation chunking; runtime still streams, but flushes by size/whitespace thresholds instead of punctuation boundaries.

#### Text Segmentation (OpenAI TTS)

`splitSpeakableText()` splits buffered text for segment-by-segment TTS:

| Rule | Threshold | Description |
|------|-----------|-------------|
| Sentence boundary (`.!?;\n`) | 8 chars (first), 16 chars (subsequent) | Primary split points |
| Comma/colon | 28 chars | Secondary split at longer clauses |
| Whitespace | 18 chars | Fallback at word boundaries |
| Force flush (first) | 28 chars | Cap first segment for fast TTFA |
| Force flush (subsequent) | 72 chars | Cap segment length |

## 4. Audio Format

- PCM16 mono @ 24kHz throughout the pipeline
- `PCM_BYTES_PER_100MS` = 4800 bytes (100ms chunks)
- 20ms inter-chunk delay for pacing

## 5. Capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| Tool calling | Yes | Max 6 rounds per turn |
| Transcript deltas | Yes | From LLM streaming |
| Interruption | Yes | Barge-in via VAD |
| Async tools | Yes | |
| Ordered transcripts | Yes | Sequential turns |
| VAD | Manual only | `webrtc-vad`, `rnnoise`, or `rms` |
| Transport | HTTP + WebSocket | STT/LLM over HTTP, TTS optionally WS |
| Session resumption | No | |
| Mid-session config | No | |
| Context compression | No | |
| Usage metrics | No | |
| Ephemeral tokens | No | |
| Proactivity | No | |

## 6. Turn Detection Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `silenceMs` | 700 | Silence duration before finalizing turn (ms) |
| `minSpeechMs` | 350 | Minimum speech duration to process (ms) |
| `minRms` | 0.015 | RMS threshold for speech detection |
| `bargeInEnabled` | `true` | Enable interruption while assistant is speaking (`false` disables auto barge-in) |
| `speechStartDebounceMs` | 140 | Continuous speech required before opening a new mic turn |
| `vadEngine` | `webrtc-vad` | `webrtc-vad` (proper speech classifier), `rnnoise`, or `rms` |
| `neuralFilterEnabled` | `true` | Apply RNNoise denoising before VAD/STT buffering |
| `rnnoiseSpeechThreshold` | `0.62` | Base RNNoise speech probability threshold |
| `rnnoiseEchoSpeechThresholdBoost` | `0.12` | Extra probability required while assistant output is active |
| `webrtcVadMode` | `3` | WebRTC VAD aggressiveness (0-3, higher = stricter) |
| `webrtcVadSpeechRatioThreshold` | `0.7` | Minimum voiced-frame ratio to classify chunk as speech |
| `webrtcVadEchoSpeechRatioBoost` | `0.15` | Extra voiced-frame ratio required while assistant output is active |
| `assistantOutputMinRms` | `0.008` | Output RMS threshold for bot-output speech activity tracking |
| `assistantOutputSilenceMs` | `350` | Hold time after last voiced output chunk before disabling echo-sensitive phase |
| `llmCompletionEnabled` | `false` | Enable LLM-based turn completion classification |
| `llmShortTimeoutMs` | 5000 | Reprompt delay for `○` marker |
| `llmLongTimeoutMs` | 10000 | Reprompt delay for `◐` marker |
| `llmShortReprompt` | `'Can you finish that thought for me?'` | Reprompt text for short pause |
| `llmLongReprompt` | `"I'm still here. Continue when you're ready."` | Reprompt text for long pause |

## 7. Full Configuration

`DecomposedProviderConfig` fields:

| Option | Default | Description |
|--------|---------|-------------|
| `sttProvider` | `'openai'` | STT provider: `'openai'` or `'deepgram'` |
| `sttModel` | `'gpt-4o-mini-transcribe'` | STT model name |
| `llmProvider` | `'openai'` | LLM provider: `'openai'`, `'openrouter'`, `'anthropic'`, or `'google'` |
| `llmModel` | From `SessionInput.model` | LLM model name |
| `ttsProvider` | `'openai'` | TTS provider: `'openai'`, `'deepgram'`, `'cartesia'`, `'fish'`, `'rime'`, `'google-chirp'`, `'kokoro'`, `'pocket-tts'` |
| `ttsModel` | provider-specific default | TTS model (resolved via provider registry) |
| `ttsVoice` | From `SessionInput.voice` | TTS voice name |
| `deepgramTtsTransport` | `'websocket'` | Must be `'websocket'` |
| `deepgramTtsWsUrl` | `'wss://api.deepgram.com/v1/speak'` | Deepgram TTS WebSocket URL |
| `deepgramTtsPunctuationChunkingEnabled` | `true` | Deepgram WS streaming flush mode (`true`: punctuation chunking, `false`: size/whitespace chunking) |
| `cartesiaTtsWsUrl` | `'wss://api.cartesia.ai/tts/websocket'` | Cartesia WebSocket endpoint |
| `fishTtsWsUrl` | `'wss://api.fish.audio/v1/tts/live'` | Fish WebSocket endpoint |
| `rimeTtsWsUrl` | `'wss://users-ws.rime.ai/ws2'` | Rime WebSocket JSON endpoint (supports timestamps) |
| `googleChirpEndpoint` | `'https://texttospeech.googleapis.com/v1/text:synthesize'` | Google TTS synth endpoint |
| `kokoroEndpoint` | `'http://localhost:8880/v1/audio/speech'` | Kokoro sidecar endpoint |
| `pocketTtsEndpoint` | `'http://localhost:8000/tts'` | Pocket TTS sidecar endpoint |
| `openaiApiKey` | (required for OpenAI providers) | OpenAI API key |
| `openrouterApiKey` | (required for OpenRouter) | OpenRouter API key |
| `anthropicApiKey` | (required for Anthropic) | Anthropic API key |
| `googleApiKey` | (required for Google/Gemini) | Google API key |
| `deepgramApiKey` | (required for Deepgram providers) | Deepgram API key |
| `cartesiaApiKey` | (required for Cartesia) | Cartesia API key |
| `fishAudioApiKey` | (required for Fish Audio) | Fish Audio API key |
| `rimeApiKey` | (required for Rime) | Rime API key |
| `language` | `'en'` | Language code for STT |

Plus all turn detection options from the table above.

## 8. Conversation History

The adapter maintains an in-memory `history: ConversationEntry[]` that is:
- Appended with user/system/assistant messages as turns complete.
- Sent as context to the LLM on every request.
- Exposed via `historyUpdated` events for UI rendering.

## 9. Latency Metrics

The adapter emits `latency` events for each pipeline stage:

| Stage | Measured | Details |
|-------|----------|---------|
| `stt` | Transcription time | Provider, model, transcript length |
| `llm` | LLM response time | Provider, model, response length |
| `tts` | Speech synthesis time | Provider, model, text/audio size, first-audio latency, streaming flag |
| `turn` | Full turn time | Speech duration, transcript length |
| `tool` | Tool execution time | Tool name, call ID, error flag |

## 10. When to Use Decomposed vs Voice-to-Voice

**Use decomposed when:**
- You need a specific LLM not available as a voice-to-voice provider (e.g., Grok via OpenRouter).
- You want to mix providers (Deepgram STT + OpenRouter LLM + Deepgram TTS).
- You need fine-grained control over turn detection (WebRTC VAD, RNNoise, or RMS tuning, LLM-based completion).
- You want to benchmark individual pipeline stages independently.

**Use voice-to-voice (OpenAI, Ultravox, Gemini) when:**
- Lowest possible latency is critical (single round-trip vs. three).
- You want server-side VAD with semantic understanding.
- You need provider-specific features (session resumption, context compression, proactivity).
- You want simpler configuration with fewer moving parts.
