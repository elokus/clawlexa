# Decomposed Provider Notes

The decomposed adapter implements a manual STT/LLM/TTS pipeline using HTTP APIs and WebSocket TTS, with software-based VAD (voice activity detection).

## 1. Code Location

- Adapter: `packages/voice-runtime/src/adapters/decomposed-adapter.ts`
- Config parser: `parseDecomposedProviderConfig()` in `provider-config.ts`

## 2. Overview

Unlike voice-to-voice providers (OpenAI Realtime, Ultravox, Gemini Live), the decomposed adapter stitches together separate STT, LLM, and TTS services:

```
Microphone --> Manual VAD --> STT --> LLM (streaming + tools) --> TTS --> Speaker
                 |                                                   |
            RMS threshold                                    Deepgram WS or
            + silence timer                                  OpenAI HTTP
```

This gives full control over each component: swap STT/LLM/TTS providers independently, use any LLM via OpenAI-compatible APIs, and tune turn detection for specific environments.

## 3. Pipeline Flow

### 1. Manual VAD (Voice Activity Detection)

The adapter performs software-based speech detection on incoming PCM16 audio:

1. Compute RMS (root mean square) energy of each audio frame.
2. If RMS >= `minRms` threshold: speech detected.
   - If currently speaking (assistant output), trigger barge-in interruption.
   - Accumulate audio chunks in `speechChunks[]`.
   - Clear any silence timer.
3. If RMS < `minRms` and speech was active:
   - Continue accumulating audio (captures trailing silence).
   - Start silence timer (`silenceMs` duration).
4. When silence timer fires: finalize the speech turn.
5. If total speech duration < `minSpeechMs`: discard (noise filter).

### 2. STT (Speech-to-Text)

Two providers available:

| Provider | Endpoint | Auth | Format |
|----------|----------|------|--------|
| OpenAI Whisper | `POST /v1/audio/transcriptions` | `Bearer` token | WAV file upload (FormData) |
| Deepgram Listen | `POST /v1/listen` | `Token` header | WAV binary body |

Both receive WAV-encoded PCM16 mono @ 24kHz. The adapter encodes raw PCM to WAV internally.

### 3. LLM (Language Model)

Two providers, both using OpenAI-compatible chat completions API:

| Provider | Endpoint |
|----------|----------|
| OpenAI | `https://api.openai.com/v1/chat/completions` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` |

**Streaming mode** (default): LLM deltas are emitted as `transcriptDelta` events and forwarded to TTS in real-time.

**Tool calling**: Up to 6 tool rounds per turn. The adapter builds `tools` array in OpenAI function-calling format, executes tools via `toolHandler`, and feeds results back as `tool` role messages.

**Turn completion mode** (optional): When `llmCompletionEnabled` is true, the LLM receives a special system prompt asking it to classify the user turn:

| Marker | Meaning | Action |
|--------|---------|--------|
| `✓` | Turn complete | Respond normally |
| `○` | Mid-thought pause | Wait `llmShortTimeoutMs`, then reprompt |
| `◐` | Thinking pause | Wait `llmLongTimeoutMs`, then reprompt |

### 4. TTS (Text-to-Speech)

Two providers:

| Provider | Transport | Streaming | Details |
|----------|-----------|-----------|---------|
| OpenAI | HTTP | Response body streaming | `POST /v1/audio/speech` with `response_format: 'pcm'` |
| Deepgram | WebSocket | Full duplex streaming | See [DEEPGRAM.md](./DEEPGRAM.md) |

**OpenAI HTTP TTS**: Text is split into speakable segments at sentence boundaries, and each segment is synthesized via a separate HTTP request. Segments are queued and spoken sequentially.

**Deepgram WebSocket TTS**: LLM deltas are sent directly to the Deepgram WebSocket as they arrive. Audio is produced in parallel with LLM generation. This is significantly lower latency for streaming use cases.

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
| VAD | Manual only | RMS-based |
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
| `llmProvider` | `'openai'` | LLM provider: `'openai'` or `'openrouter'` |
| `llmModel` | From `SessionInput.model` | LLM model name |
| `ttsProvider` | `'openai'` | TTS provider: `'openai'` or `'deepgram'` |
| `ttsModel` | `'gpt-4o-mini-tts'` (OpenAI) / `'aura-2-thalia-en'` (Deepgram) | TTS model |
| `ttsVoice` | From `SessionInput.voice` | TTS voice name |
| `deepgramTtsTransport` | `'websocket'` | Must be `'websocket'` |
| `deepgramTtsWsUrl` | `'wss://api.deepgram.com/v1/speak'` | Deepgram TTS WebSocket URL |
| `openaiApiKey` | (required for OpenAI providers) | OpenAI API key |
| `openrouterApiKey` | (required for OpenRouter) | OpenRouter API key |
| `deepgramApiKey` | (required for Deepgram providers) | Deepgram API key |
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
- You need fine-grained control over turn detection (custom RMS thresholds, LLM-based completion).
- You want to benchmark individual pipeline stages independently.

**Use voice-to-voice (OpenAI, Ultravox, Gemini) when:**
- Lowest possible latency is critical (single round-trip vs. three).
- You want server-side VAD with semantic understanding.
- You need provider-specific features (session resumption, context compression, proactivity).
- You want simpler configuration with fewer moving parts.
