# Provider Integration Guide

> **This is a living document.** It is the entrypoint for adding new voice providers, modes, or setups to voice-runtime. Update it as you learn — when an API behaves differently than documented, when a new provider emerges, or when a research question gets answered.

## Purpose

Every voice provider has its own API surface, authentication scheme, audio format, WebSocket protocol, and quirks. Before writing a single line of adapter code, you need to **research and experimentally verify** how the provider works. This document is a structured pipeline for that research.

**Non-negotiable boundary:** provider-specific handling must be solved inside adapters/runtime internals. The external runtime interface and shared tests must remain provider-agnostic.

Use this document as a prompt: walk through each section, answer the questions, run the test snippets, and record your findings. By the end you'll have everything needed to implement a `ProviderAdapter`.

## Table of Contents

1. [Research Checklist](#1-research-checklist)
2. [Setup Modes](#2-setup-modes)
3. [Exploration Pipeline](#3-exploration-pipeline)
4. [Multi-Turn Test Scenarios](#4-multi-turn-test-scenarios)
5. [Adapter Implementation Checklist](#5-adapter-implementation-checklist)
6. [Provider Status Matrix](#6-provider-status-matrix)
7. [Gemini Live: Current State & Open Questions](#7-gemini-live-current-state--open-questions)

---

## 1. Research Checklist

For every new provider or mode, answer **all** of these questions before writing adapter code. Mark each as `[x]` answered or `[ ]` unknown.

### 1.1 Authentication & Endpoints

- [ ] **Auth method**: API key? OAuth? Ephemeral token? Bearer token?
- [ ] **Key placement**: Query param? Header (`Authorization: Bearer`)? Custom header (`X-API-Key`)?
- [ ] **Endpoint URL**: WebSocket? REST? gRPC? What's the base URL?
- [ ] **API version**: Is it `v1`, `v1alpha`, `v1beta`? Does version affect features?
- [ ] **Rate limits**: Per-key? Per-org? Concurrent session limits?
- [ ] **Pricing model**: Per-minute? Per-token? Per-session?

### 1.2 Connection & Session Lifecycle

- [ ] **Connection protocol**: Plain WebSocket? WebSocket with handshake? WebRTC? HTTP + SSE?
- [ ] **Session creation**: Connect-then-configure (WebSocket setup message)? REST-create-then-join? SDK-managed?
- [ ] **Session handshake**: What messages must be exchanged before audio flows? Timeout?
- [ ] **Session resumption**: Can you reconnect to an existing session? How (handle/token)?
- [ ] **Session duration limits**: Max session time? GoAway/warning before disconnect?
- [ ] **Graceful shutdown**: How do you cleanly end a session?
- [ ] **Reconnection**: Does the API support transparent reconnection? Do you lose context?

### 1.3 Audio Format & Transport

- [ ] **Input audio format**: PCM16? Opus? MP3? Mulaw? What sample rate?
- [ ] **Output audio format**: Same or different from input? What sample rate?
- [ ] **Audio encoding over wire**: Raw binary frames? Base64 in JSON? Protobuf?
- [ ] **Audio chunking**: Any required chunk size? Maximum frame size?
- [ ] **Sample rate negotiation**: Fixed or configurable? Server-reported?
- [ ] **Voice selection**: How many voices? How selected (name, ID, enum)?
- [ ] **Voice language support**: Per-voice language? Multi-language voices? Language codes format?

### 1.4 Voice Activity Detection (VAD)

- [ ] **VAD modes available**: Server VAD? Semantic VAD? Manual (push-to-talk)?
- [ ] **VAD configuration**: Silence duration? Threshold? Eagerness?
- [ ] **Speech sensitivity**: Start-of-speech / end-of-speech sensitivity controls?
- [ ] **Interruption handling**: Can user interrupt agent? Configurable (barge-in vs no-interruption)?
- [ ] **Interruption signal**: How does server signal interruption (flag, event, truncation)?

### 1.5 Transcription

- [ ] **Input transcription**: Does the API transcribe user speech? Real-time or final-only?
- [ ] **Output transcription**: Does it provide text of what the agent said?
- [ ] **Transcript streaming**: Delta-based (incremental)? Ordinal (sequence numbers)? Final only?
- [ ] **Transcript configuration**: Separate toggle? Always on? Transcription model selection?

### 1.6 Tool Calling

- [ ] **Tool support**: Can you register function/tool definitions?
- [ ] **Tool declaration format**: OpenAI-style? Gemini-style? Custom schema?
- [ ] **Tool call protocol**: How does server request a tool call? How do you send results?
- [ ] **Async tools**: Can tool execution be non-blocking?
- [ ] **Tool cancellation**: Can the server cancel a pending tool call?
- [ ] **Tool scheduling**: Can you specify when results should be processed (interrupt/idle/silent)?
- [ ] **Server-side tools**: Does the provider support tools that execute server-side?
- [ ] **Tool timeout**: Does the provider handle tool execution timeouts?

### 1.7 Context & State

- [ ] **System instructions**: How do you set the initial prompt?
- [ ] **Context window**: Token limit? Context compression support?
- [ ] **Conversation history**: Does the API manage history? Can you inject history?
- [ ] **Temperature / generation config**: What parameters are available?
- [ ] **Model selection**: Which models support realtime voice? Model ID format?

### 1.8 Events & Observability

- [ ] **State signals**: Does the server report state transitions (listening/thinking/speaking)?
- [ ] **Usage metrics**: Token counts? Audio duration? Cost reporting?
- [ ] **Error reporting**: Error format? Error codes? Retry guidance?
- [ ] **Latency signals**: Any built-in latency reporting?

---

## 2. Setup Modes

Different use cases require different integration modes. Each mode has distinct research requirements.

### 2.1 Voice-to-Voice (Realtime)

The provider handles STT + LLM + TTS as a unified pipeline. You send audio, get audio back.

**Research focus:**
- WebSocket protocol specifics
- Audio format negotiation
- Interruption behavior
- State machine (listening → thinking → speaking)

**Current providers:** `openai-sdk`, `ultravox-ws`, `gemini-live`, `pipecat-rtvi`

### 2.2 Decomposed (STT + LLM + TTS)

You orchestrate three separate services. Maximum control but more complexity.

**Research focus per component:**

#### STT (Speech-to-Text)
- [ ] Streaming vs batch endpoint?
- [ ] WebSocket for continuous streaming or HTTP per-utterance?
- [ ] Interim/partial results?
- [ ] VAD built-in or manual?
- [ ] Languages supported?
- [ ] Output: plain text? Timestamped words? Confidence scores?

#### LLM (Language Model)
- [ ] Streaming support (SSE/chunked)?
- [ ] Tool calling support?
- [ ] System prompt format?
- [ ] Context window size?
- [ ] Latency characteristics (time to first token)?

#### TTS (Text-to-Speech)
- [ ] **Critical: Does it support WebSocket streaming?** (Required for low latency)
- [ ] HTTP streaming (chunked response) as fallback?
- [ ] Input: plain text? SSML? Markdown?
- [ ] Output format: PCM16? MP3? Opus? What sample rate?
- [ ] Sentence-level or word-level streaming?
- [ ] Can you stream text in and get audio out incrementally?
- [ ] Voice selection and language support?

**Why WebSocket TTS matters:** In a decomposed pipeline, TTS is the latency bottleneck. HTTP TTS means you wait for the full LLM response (or sentence boundary) before requesting TTS. WebSocket TTS lets you stream LLM tokens directly to TTS for incremental audio generation. This is the difference between 2-3s and 500ms perceived latency.

**TTS streaming approaches (ranked by latency):**
1. **WebSocket bidirectional** — Stream text chunks in, get audio chunks out continuously. Best latency. (Deepgram, ElevenLabs)
2. **HTTP chunked with text streaming** — POST text as it arrives, receive chunked audio response. Good latency. (OpenAI TTS)
3. **HTTP sentence-by-sentence** — Collect complete sentences, request TTS per sentence. Acceptable latency. (Most providers)
4. **HTTP full-response** — Wait for complete LLM response, request TTS once. Poor latency. (Avoid)

**Current providers in decomposed mode:**
- STT: Deepgram, OpenAI Whisper
- LLM: Any OpenAI-compatible (via OpenRouter, direct)
- TTS: Deepgram (WebSocket), OpenAI (HTTP chunked)

### 2.3 Delegated (Protocol Adapters)

A meta-provider that speaks a standard protocol (e.g., RTVI) and delegates to various backends.

**Research focus:**
- Protocol spec
- Which backends are supported
- What config passes through vs what's handled by the protocol layer

**Current:** `pipecat-rtvi`

---

## 3. Exploration Pipeline

Step-by-step process to go from "I have an API key" to "I know enough to build an adapter."

### Step 1: Read the Official Docs

- Find the realtime/streaming voice API docs (not just REST API docs)
- Look for WebSocket protocol references, audio format specs, quickstart guides
- Check for SDK availability (official SDKs can reveal protocol details)
- **Save links** — you'll reference them in your provider doc

### Step 2: Run the Minimal Connection Test

Use the scratch scripts to verify basic connectivity:

```bash
# Generic WebSocket connection test
cd packages/voice-runtime
bun run scratch:provider <provider-id>
```

If no scratch script exists yet, create a minimal one:

```typescript
// packages/voice-runtime/scratch/test-<provider>.ts
// Goal: Connect, send one audio frame, get one response

import WebSocket from 'ws';

const API_KEY = process.env.<PROVIDER>_API_KEY;
const WS_URL = '<provider-websocket-url>';

const ws = new WebSocket(`${WS_URL}?key=${API_KEY}`);

ws.on('open', () => {
  console.log('Connected');
  // Send setup/config message
  ws.send(JSON.stringify({ /* provider-specific setup */ }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', JSON.stringify(msg, null, 2).slice(0, 500));
});

ws.on('error', (err) => console.error('Error:', err));
ws.on('close', (code, reason) => console.log('Closed:', code, reason.toString()));
```

### Step 3: Audio Round-Trip Test

Send real audio and verify you get audio back:

1. Load a test audio file (see [test scenarios](#4-multi-turn-test-scenarios))
2. Send it as the provider expects (base64? binary? with headers?)
3. Log what comes back (audio format, events, transcripts)
4. Play the response audio to verify quality

```typescript
// Read pre-recorded PCM16 audio
const audioFile = await Bun.file('test-audio/greeting.raw').arrayBuffer();
const audioBuffer = Buffer.from(audioFile);

// Send in chunks matching provider's expected format
const CHUNK_SIZE = 4800; // 300ms at 16kHz mono
for (let i = 0; i < audioBuffer.length; i += CHUNK_SIZE) {
  const chunk = audioBuffer.subarray(i, i + CHUNK_SIZE);
  // Provider-specific send...
  await Bun.sleep(150); // Simulate real-time pacing
}
```

### Step 4: Multi-Turn Conversation Test

Run through the [test scenarios](#4-multi-turn-test-scenarios) to verify:
- Turn-taking works (user speaks → agent responds → user speaks again)
- Interruption behavior
- Tool calling (if supported)
- Transcript accuracy

### Step 5: Document Findings

Create a provider doc at `packages/voice-runtime/docs/providers/<PROVIDER>.md` following the existing format (see OPENAI.md, GEMINI.md as templates). Include:
- Exact code locations
- Session flow with wire-level detail
- Audio format table
- Capabilities matrix
- Configuration reference
- Any quirks or gotchas discovered

### Step 6: Record Contract Fixtures

After a successful multi-turn session:
1. Enable event logging in your test script
2. Record all normalized events with timestamps
3. Save as JSONL fixture: `packages/voice-runtime/tests/contracts/fixtures/<provider>-basic.jsonl`
4. Add contract test case in `contract-cases.ts`

### Step 7: Universal Contract Gate (Required)

Before considering a provider integration complete, verify the provider satisfies the same runtime contract used by all consumers.

- [ ] No provider-specific ordering/transcript parsing is required outside `voice-runtime`.
- [ ] Runtime emits normalized ordering metadata (`order`) for item/transcript events.
- [ ] Tool lifecycle ordering is stable: user turn anchor → `toolStart` → `toolEnd` → assistant response.
- [ ] Semantic turn order is stable across repeated runs (wording may differ; ordering must not).
- [ ] Replay contract tests pass (deterministic normalization logic).
- [ ] Live audio integration test passes (real provider session, real audio, real tool calls).
- [ ] Shared tests do not branch on provider-specific protocol shape; provider-specific checks are covered in adapter-level tests.

Run both tiers:

```bash
# Deterministic normalization contract
bun test packages/voice-runtime/tests/provider-contract-replay.test.ts

# Real provider verification (opt-in)
VOICE_RUNTIME_LIVE_PROVIDERS=openai-sdk,gemini-live \
bun run --cwd packages/voice-runtime test:live-ordering
```

Interpretation:
- Replay failure: runtime normalization logic regression.
- Live failure: provider adapter/runtime contract mismatch or provider behavior drift.
- In both cases, fix inside `voice-runtime` first, not in UI/TUI/application code.

Testing policy by layer:
- Adapter tests: may assert provider-specific wire/protocol behavior and normalization hooks.
- Shared contract replay/live tests: assert unified runtime semantics only.
- App/UI/TUI tests: assert consumer behavior against normalized runtime contract, never provider protocol details.

---

## 4. Multi-Turn Test Scenarios

These scenarios are designed to systematically test provider capabilities. Each scenario has a script (what to say) and expected behaviors to verify.

### Recording Test Audio

To create test audio files for automated testing:

```bash
# Create test-audio directory
mkdir -p packages/voice-runtime/test-audio

# Record with sox (install: brew install sox)
# Records 16kHz mono PCM16 (the universal input format)
sox -d -r 16000 -c 1 -b 16 -e signed-integer packages/voice-runtime/test-audio/<scenario>.raw

# Or convert existing audio to PCM16
ffmpeg -i input.wav -ar 16000 -ac 1 -f s16le packages/voice-runtime/test-audio/<scenario>.raw
```

### Scenario 1: Basic Greeting (Connectivity)

**Purpose:** Verify connection, audio round-trip, and basic response.

**Script:**
```
User: "Hello, can you hear me?"
Agent: <should respond with greeting>
```

**Verify:**
- [ ] Connection established within timeout
- [ ] Audio received from provider
- [ ] State transitions: idle → listening → thinking → speaking → listening
- [ ] Transcript captured (both user and agent)

**Audio file:** `test-audio/01-greeting.raw`

---

### Scenario 2: Multi-Turn Context (Memory)

**Purpose:** Verify the provider maintains conversation context across turns.

**Script:**
```
User: "My name is Alex."
Agent: <acknowledges>
User: "What is my name?"
Agent: <should say "Alex">
```

**Verify:**
- [ ] Agent remembers context from turn 1 in turn 2
- [ ] Transcripts show correct turn boundaries
- [ ] No cross-contamination between turns

**Audio files:** `test-audio/02a-my-name.raw`, `test-audio/02b-what-is-my-name.raw`

---

### Scenario 3: Interruption (Barge-In)

**Purpose:** Verify user can interrupt the agent mid-speech.

**Script:**
```
User: "Tell me a long story about a dragon."
Agent: <starts telling story>
User (interrupts after ~2 seconds): "Stop. What color was the dragon?"
Agent: <should stop and answer the question>
```

**Verify:**
- [ ] Agent stops speaking on interruption
- [ ] Interruption signal received (flag, event, truncation)
- [ ] Agent responds to the interrupting question
- [ ] State: speaking → listening (on interrupt) → thinking → speaking

**Audio files:** `test-audio/03a-long-story.raw`, `test-audio/03b-interrupt-stop.raw`

---

### Scenario 4: Tool Calling

**Purpose:** Verify function/tool calling works end-to-end.

**System instructions:**
```
You have a tool called "get_weather" that takes a "city" parameter and returns weather info.
When asked about weather, always use this tool.
```

**Tool definition:**
```json
{
  "name": "get_weather",
  "description": "Get current weather for a city",
  "parameters": {
    "type": "object",
    "properties": {
      "city": { "type": "string", "description": "City name" }
    },
    "required": ["city"]
  }
}
```

**Script:**
```
User: "What's the weather in Berlin?"
Agent: <should call get_weather tool with city="Berlin">
       <receives tool result>
       <speaks the weather information>
```

**Verify:**
- [ ] Tool call received with correct name and arguments
- [ ] Tool result accepted and used in response
- [ ] Agent speaks the tool result naturally
- [ ] State: listening → thinking → (tool call) → thinking → speaking

**Audio file:** `test-audio/04-weather-berlin.raw`

---

### Scenario 5: Rapid Turn-Taking

**Purpose:** Verify the provider handles quick back-and-forth without dropping turns.

**Script:**
```
User: "Count to three."
Agent: "One, two, three."
User: "Now count backwards."
Agent: "Three, two, one."
User: "What number is in the middle?"
Agent: "Two."
```

**Verify:**
- [ ] All three turns complete without overlap or drops
- [ ] Transcripts are ordered correctly
- [ ] No duplicate or missing turn events
- [ ] Latency remains consistent across turns

**Audio files:** `test-audio/05a-count.raw`, `test-audio/05b-backwards.raw`, `test-audio/05c-middle.raw`

---

### Scenario 6: Silence Handling

**Purpose:** Verify VAD handles silence correctly without premature turn-taking.

**Script:**
```
User: "Let me think for a moment..." <5 second pause> "...okay, what is two plus two?"
Agent: <should wait for user to finish, then answer "four">
```

**Verify:**
- [ ] Agent waits during pause (doesn't start responding to partial utterance)
- [ ] Agent responds after user finishes speaking
- [ ] VAD silence threshold behaves as configured

**Audio file:** `test-audio/06-silence-pause.raw`

---

### Scenario 7: Long Response with Details

**Purpose:** Verify streaming audio for longer responses, check for gaps or artifacts.

**Script:**
```
User: "Explain the three laws of thermodynamics in simple terms."
Agent: <extended multi-sentence response>
```

**Verify:**
- [ ] Audio streams smoothly without gaps
- [ ] Chunk cadence is consistent (measure with benchmark recorder)
- [ ] Full transcript matches spoken audio
- [ ] No truncation of long responses

**Audio file:** `test-audio/07-explain-thermo.raw`

---

### Scenario 8: Non-English Language

**Purpose:** Verify multi-language or non-English support.

**Script (German):**
```
User: "Hallo, wie geht es dir?"
Agent: <responds in German>
User: "Kannst du mir einen Witz erzählen?"
Agent: <tells a joke in German>
```

**Verify:**
- [ ] Agent responds in the correct language
- [ ] Transcription handles non-English correctly
- [ ] Voice sounds natural in the target language

**Audio files:** `test-audio/08a-german-hello.raw`, `test-audio/08b-german-joke.raw`

---

## 5. Adapter Implementation Checklist

After research is complete, implement the adapter following this order:

### Phase 1: Scaffold
- [ ] Create `packages/voice-runtime/src/adapters/<provider>-adapter.ts`
- [ ] Define capabilities constant (`<PROVIDER>_CAPABILITIES`)
- [ ] Implement `ProviderAdapter` interface stub
- [ ] Add provider ID to `VoiceProviderId` union in `types.ts`
- [ ] Add config type to `provider-config.ts` with parser
- [ ] Export from `index.ts`

### Phase 2: Connection
- [ ] Implement `connect()` — establish connection, send setup, wait for ready
- [ ] Implement `disconnect()` — clean shutdown
- [ ] Implement `sendAudio()` — send PCM16 frames in provider format
- [ ] Implement `AudioNegotiation` — report provider's expected sample rates
- [ ] Handle connection errors and timeouts

### Phase 3: Events
- [ ] Map provider events to `VoiceSessionEvents`
- [ ] Implement state machine (idle → listening → thinking → speaking)
- [ ] Emit `transcript` and `transcriptDelta` events
- [ ] Emit `audio` events with correct format
- [ ] Handle interruption signals

### Phase 4: Tools
- [ ] Implement tool declaration format conversion
- [ ] Handle incoming tool calls → `toolStart` event
- [ ] Send tool results back in provider format → `toolEnd` event
- [ ] Test with Scenario 4

### Phase 5: Advanced
- [ ] Session resumption (if supported)
- [ ] Context compression (if supported)
- [ ] Usage metrics
- [ ] Provider-specific config schema for UI

### Phase 6: Test & Document
- [ ] Run all 8 test scenarios
- [ ] Record contract fixtures
- [ ] Write provider doc in `docs/providers/<PROVIDER>.md`
- [ ] Update capability matrix in this document
- [ ] Update `PROVIDERS.md`

---

## 6. Provider Status Matrix

Track the integration status of each provider. Update as providers are researched and integrated.

| Provider | Mode | Status | Connection | Audio | Transcripts | Tools | Interruption | Benchmarked | Notes |
|----------|------|--------|------------|-------|-------------|-------|-------------|-------------|-------|
| `openai-sdk` | Voice-to-voice | **Production** | SDK-managed | 24kHz PCM16 | Delta streaming | Full | Native truncation | Yes | Most complete adapter |
| `ultravox-ws` | Voice-to-voice | **Production** | REST+WS join | Negotiated | Ordinal | Server-side | Yes | Yes | Unique server-side tool model |
| `gemini-live` | Voice-to-voice | **Partial** | WS+setup msg | 16kHz→24kHz base64 | Delta (input+output) | Full+scheduling | Yes | No | See [Section 7](#7-gemini-live-current-state--open-questions) |
| `decomposed` | STT+LLM+TTS | **Production** | HTTP+WS mix | Provider-dependent | STT output | Via LLM | Manual VAD | Yes | Deepgram WS TTS, OpenAI HTTP TTS |
| `pipecat-rtvi` | Delegated | **Production** | WS+handshake | Protocol-managed | Via RTVI | Via RTVI | Via RTVI | Yes | Broad backend support |

### Providers to Research

Providers we may want to integrate in the future. Fill in as research happens.

| Provider | Mode | Research Status | Key Question | Doc Link |
|----------|------|----------------|-------------|----------|
| ElevenLabs Conversational | Voice-to-voice | Not started | WebSocket protocol, tool support? | — |
| Cartesia Sonic | TTS (decomposed) | Not started | WebSocket streaming support? Latency? | — |
| Hume EVI | Voice-to-voice | Not started | Emotion detection, WebSocket protocol? | — |
| Anthropic Voice | Voice-to-voice | Not started | When available, protocol details? | — |

---

## 7. Gemini Live: Current State & Findings

Gemini Live has been tested with the multi-turn pipeline. This section documents verified behavior, solved issues, and remaining questions.

> **Last tested**: 2026-02-20 with `gemini-2.5-flash-native-audio-latest` via `v1beta` API.

### What Works

- [x] WebSocket connection with setup handshake (< 300ms)
- [x] Audio I/O: PCM16 16kHz input (base64 in JSON), 24kHz output
- [x] Tool calling with function declarations, scheduling, and cancellation
- [x] Input/output transcription with manual VAD (single-turn and multi-turn)
- [x] State management (idle → listening → thinking → speaking)
- [x] Session resumption handle tracking
- [x] Context window compression config
- [x] Usage metrics (prompt/response/total tokens, modality breakdown)
- [x] Agent understands audio perfectly — correct German responses every time
- [x] Multi-turn context maintained across turns
- [x] Non-English via system instruction (not languageCode)
- [x] Adapter now surfaces setup close reasons immediately (no opaque timeout on setup failure)
- [x] Adapter strips unsupported `$...` keys from tool schemas before setup (fixes `$schema` rejection)
- [x] Adapter normalizes deprecated model alias `gemini-2.5-flash-native-audio-preview` to `...-latest`

### Critical Finding: Auto VAD Breaks Input Transcription

**Problem**: With `automaticActivityDetection: { disabled: false }` (auto VAD, the default), input transcription returns garbage — Arabic/Persian/Norwegian fragments instead of actual speech content. The audio comprehension itself is unaffected (agent responds correctly).

**Root cause**: Auto VAD on `gemini-2.5-flash-native-audio` models triggers premature `interrupted` events while audio is still being streamed. This causes the transcription pipeline to process fragmentary audio, producing nonsense.

This is a **known server-side bug** — reported on Google AI Developer Forum ([input transcription is very weird](https://discuss.ai.google.dev/t/input-transcription-in-gemini-live-api-is-very-weird/112644)).

**Solution**: Use **manual VAD** (`automaticActivityDetection: { disabled: true }`) with explicit `activityStart`/`activityEnd` signals:

```typescript
// Before sending audio:
ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));

// Send audio chunks...

// After all audio sent:
ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
```

**Verified result with manual VAD (single turn):**
```
INPUT TRANSCRIPT: " Hallo"
INPUT TRANSCRIPT: ","
INPUT TRANSCRIPT: " wie"
INPUT TRANSCRIPT: " geht es dir?"
INPUT TRANSCRIPT: " Kannst du mich hören?"
OUTPUT TRANSCRIPT: "Hallo! Mir geht es gut, danke. Ja, ich kann dich hören. Wie geht es dir?"
```
Accurate transcription and clean turn lifecycle.

**Implication for adapter**: The adapter needs to support manual VAD mode and manage `activityStart`/`activityEnd` from the transport layer or voice agent. When using web audio (continuous mic stream), the client or runtime must detect speech boundaries and send these signals.

### Experiment Results Summary

| # | Config | Transcription | Interruptions | Response | Verdict |
|---|--------|--------------|---------------|----------|---------|
| 1 | Auto VAD, 100ms chunks, 2x speed | Garbage (Arabic) | 2+ | Correct German | Fail |
| 2 | Auto VAD, 20ms chunks, 1x speed | Garbage (Arabic) | 2 | Correct German | Fail |
| 3 | Auto VAD, 20ms + audioStreamEnd | Garbage (Arabic) | 2 | Correct German | Fail |
| 4 | WAV mime type | — | — | Rejected | N/A (only audio/pcm supported) |
| 5 | M4A mime type | — | — | Rejected | N/A (only audio/pcm supported) |
| 6 | clientContent delivery | — | — | Internal error / rejected | N/A |
| **Manual VAD** | **20ms chunks, activityStart/End** | **Perfect** | **0** | **Correct German** | **Pass** |
| No transcription | Auto VAD, 20ms chunks | N/A | 2 | Correct German | Pass (if transcription not needed) |

### Multi-Turn Results (Updated Scratch Harness)

Recorded with:
- `bun packages/voice-runtime/scratch/gemini-transcription-test.ts multi-manual --chunk-ms 20 --pace 1.0`
- `bun packages/voice-runtime/scratch/gemini-transcription-test.ts multi-auto --chunk-ms 20 --pace 1.0`

| Mode | Turn-1 Input Match | Turn-2 Input Match | Turn-3 Input Match | Interruptions (T1/T2/T3) |
|------|--------------------|--------------------|--------------------|----------------------------|
| Manual VAD | 100% | 100% | 100% | 0 / 1 / 1 |
| Auto VAD | 0% | 10% | 11% | 2 / 2 / 5 |

Interpretation:
- Manual VAD restores transcription quality on real multi-turn recordings.
- Auto VAD still fragments turns and degrades input transcript quality.
- The occasional interruption in manual multi-turn runs happens at turn boundaries when the next turn starts while output is still active (expected with `START_OF_ACTIVITY_INTERRUPTS`).

### Available Models (as of 2026-02-20)

Only native-audio models support `bidiGenerateContent`:

| Model | Status |
|-------|--------|
| `models/gemini-2.5-flash-native-audio-latest` | Active (recommended) |
| `models/gemini-2.5-flash-native-audio-preview-12-2025` | Active |
| `models/gemini-2.5-flash-native-audio-preview-09-2025` | Deprecated March 2026 |

The old `gemini-2.0-flash-*` live models are **no longer available**.

### API Constraints Discovered

| Constraint | Detail |
|------------|--------|
| **Audio input** | Only `audio/pcm` or `audio/pcm;rate=XXXXX` accepted for `realtimeInput`. WAV, M4A, FLAC etc. rejected. |
| **languageCode** | `speechConfig.languageCode` rejects non-English codes on native-audio models. Use system instruction instead. |
| **responseModalities** | Must be `['AUDIO']` only — including `TEXT` causes immediate disconnect with code 1007. |
| **clientContent + audio** | Sending audio via `clientContent` (ordered delivery) causes `1007 Precondition check failed` or `1011 Internal error`. Use `realtimeInput` only. |
| **Tool schema format** | Gemini rejects unsupported JSON Schema keys in function parameters (e.g. `$schema`, `additionalProperties`) with close `1007`. Sanitize schema before setup. |
| **proactivity field** | `setup.proactivity` is currently rejected (`1007 Unknown name \"proactivity\" at 'setup'`). Do not send it for now. |
| **Model alias** | `models/gemini-2.5-flash-native-audio-preview` now closes with `1008 model not found`. Use `...-latest` or explicit preview versions. |
| **Session limits** | Audio-only: 15 min. Audio+video: 2 min. Connection: ~10 min (use session resumption). |
| **Context window** | 128k tokens. Audio accumulates ~25 tokens/sec. Use `contextWindowCompression` for long sessions. |
| **Chunk size** | Google recommends 20-40ms chunks sent immediately (do not buffer). |

### How to Test

```bash
# Quick text connectivity test
bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --text "Hello"

# Setup schema preflight (run before full app/live test)
bun packages/voice-runtime/scratch/gemini-setup-preflight.ts

# Multi-turn with recorded audio and tools (manual VAD recommended)
bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --multi-turn --tools --vad manual --chunk-ms 20 --pace 1.0 --save-audio

# Compare with auto VAD
bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --multi-turn --tools --vad auto --chunk-ms 20 --pace 1.0 --save-audio

# Single turn test
bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --turn turn-1

# Transcription experiments (manual VAD vs auto VAD)
bun packages/voice-runtime/scratch/gemini-transcription-test.ts multi-manual
bun packages/voice-runtime/scratch/gemini-transcription-test.ts multi-auto
bun packages/voice-runtime/scratch/gemini-transcription-test.ts manual-vad
bun packages/voice-runtime/scratch/gemini-transcription-test.ts with-transcription

# Systematic audio format experiments
bun packages/voice-runtime/scratch/gemini-audio-experiments.ts 1  # baseline
bun packages/voice-runtime/scratch/gemini-audio-experiments.ts 2  # small chunks
bun packages/voice-runtime/scratch/gemini-audio-experiments.ts 3  # with audioStreamEnd

# Full voice agent with Gemini
cd packages/voice-agent
# Set provider to gemini-live in .voiceclaw/voice.config.json
bun run dev
```

### Adapter Changes Status

1. [x] **Manual VAD in runtime**: Adapter now sends `activityStart`/`activityEnd` in manual mode and performs local speech-boundary detection for continuous mic streams.
2. [x] **Remove languageCode**: Adapter no longer sets `speechConfig.languageCode` for native-audio models.
3. [x] **Setup failure visibility**: Setup-time close reasons are surfaced immediately (e.g. invalid model, invalid schema).
4. [x] **Tool schema sanitization**: Adapter strips unsupported schema keys (`$...`, `additionalProperties`, and related unsupported keywords) before Gemini function declaration setup.
5. [x] **Proactivity guard**: Adapter no longer sends `setup.proactivity` (currently rejected by API).
6. [ ] **Contract fixtures**: Still missing clean multi-turn fixture recordings in `tests/contracts/fixtures`.

### Remaining Research Questions

- [ ] **Connection reliability**: Does the WebSocket stay stable for >5 min?
- [ ] **GoAway behavior**: How much warning time? Can you resume?
- [ ] **Manual VAD from web mic**: How to detect speech boundaries in browser audio for activityStart/End?
- [ ] **Context compression in practice**: Does sliding window compression cause coherence issues?
- [ ] **Proactivity**: Re-evaluate only after API accepts `setup.proactivity` for this endpoint/model.
- [ ] **Ephemeral tokens**: Does Gemini support short-lived tokens for browser use?
- [ ] **Rate limits**: Concurrent session limits? Tokens per minute?
- [ ] **Benchmark data**: Record clean sessions with manual VAD for contract fixtures.

---

## Appendix A: Audio Format Reference

Common audio formats across voice providers:

| Format | Description | Typical Rate | Wire Encoding |
|--------|-------------|-------------|---------------|
| PCM16 (s16le) | Raw 16-bit signed little-endian | 16kHz or 24kHz | Binary or Base64 |
| Opus | Compressed, low-latency | 48kHz (decoded to 16/24kHz) | Binary |
| MP3 | Compressed | 24kHz | Binary or HTTP stream |
| G.711 μ-law | Telephony codec | 8kHz | Binary |
| G.711 A-law | Telephony codec (EU) | 8kHz | Binary |

**Our canonical format:** PCM16 mono. The runtime resamples between client rate and provider rate via `resamplePcm16Mono()`.

## Appendix B: Decomposed TTS Provider Research Template

When evaluating a TTS provider for the decomposed pipeline, answer these:

| Question | Answer |
|----------|--------|
| **WebSocket endpoint available?** | |
| **WebSocket URL format** | |
| **Auth for WebSocket** | |
| **Text input format** (plain/SSML/chunks) | |
| **Audio output format** | |
| **Streaming granularity** (word/sentence/chunk) | |
| **Flush/close signal** | |
| **Latency (time to first audio byte)** | |
| **Voice catalog endpoint** | |
| **Max concurrent connections** | |
| **Pricing** | |

### Deepgram TTS (Reference Implementation)

| Question | Answer |
|----------|--------|
| WebSocket endpoint? | Yes: `wss://api.deepgram.com/v1/speak` |
| Auth | `token=<key>` query param |
| Text input | JSON `{ "type": "Speak", "text": "..." }` per chunk |
| Audio output | Raw PCM16 binary frames |
| Streaming | Chunk-level (sends audio as text arrives) |
| Flush/close | `{ "type": "Flush" }` then `{ "type": "Close" }` |
| Latency | ~200ms to first audio byte |
| Voice catalog | REST: `GET /v1/models` |

### OpenAI TTS (Reference Implementation)

| Question | Answer |
|----------|--------|
| WebSocket endpoint? | No (HTTP only) |
| HTTP streaming? | Yes, chunked `audio/pcm` response |
| Auth | `Authorization: Bearer <key>` |
| Text input | Full text per request |
| Audio output | PCM16 at 24kHz (with `response_format=pcm`) |
| Streaming | HTTP chunked (sentence-level internally) |
| Latency | ~400-600ms to first audio byte |
| Voice catalog | Fixed: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer |

---

## Appendix C: Scratch Script Template

Copy this template when starting research on a new provider:

```typescript
// packages/voice-runtime/scratch/test-<provider>.ts
//
// Minimal connectivity and audio test for <Provider>
// Run: bun packages/voice-runtime/scratch/test-<provider>.ts

import WebSocket from 'ws';
import { readFileSync, writeFileSync } from 'fs';

const API_KEY = process.env.<PROVIDER>_API_KEY;
if (!API_KEY) throw new Error('Set <PROVIDER>_API_KEY');

// === STEP 1: Connect ===
const WS_URL = '<endpoint>';
console.log('Connecting to', WS_URL);
const ws = new WebSocket(WS_URL);

const receivedAudio: Buffer[] = [];
let messageCount = 0;

ws.on('open', () => {
  console.log('✓ Connected');

  // === STEP 2: Send setup/config ===
  const setup = {
    // Provider-specific setup message
  };
  ws.send(JSON.stringify(setup));
  console.log('→ Sent setup');
});

ws.on('message', (raw: Buffer) => {
  messageCount++;
  try {
    const msg = JSON.parse(raw.toString());

    // === STEP 3: Handle setup complete ===
    if (msg.setupComplete) {
      console.log('✓ Setup complete');
      sendTestAudio();
      return;
    }

    // === STEP 4: Log events ===
    const keys = Object.keys(msg);
    console.log(`← [${messageCount}] ${keys.join(', ')}`);

    // Collect audio
    // Provider-specific audio extraction...

  } catch {
    console.log(`← [${messageCount}] Binary frame: ${raw.length} bytes`);
    receivedAudio.push(Buffer.from(raw));
  }
});

ws.on('close', (code, reason) => {
  console.log(`Connection closed: ${code} ${reason}`);

  // Save received audio for playback verification
  if (receivedAudio.length > 0) {
    const combined = Buffer.concat(receivedAudio);
    writeFileSync('/tmp/provider-test-output.raw', combined);
    console.log(`Saved ${combined.length} bytes of audio to /tmp/provider-test-output.raw`);
    console.log(`Play with: play -r 24000 -b 16 -c 1 -e signed-integer /tmp/provider-test-output.raw`);
  }
});

ws.on('error', (err) => console.error('✗ Error:', err.message));

// === Audio sender ===
async function sendTestAudio() {
  const testFile = 'packages/voice-runtime/test-audio/01-greeting.raw';
  try {
    const audio = readFileSync(testFile);
    const CHUNK_MS = 100;
    const SAMPLE_RATE = 16000;
    const BYTES_PER_SAMPLE = 2;
    const CHUNK_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_MS) / 1000;

    console.log(`→ Sending ${audio.length} bytes of audio in ${Math.ceil(audio.length / CHUNK_BYTES)} chunks`);

    for (let i = 0; i < audio.length; i += CHUNK_BYTES) {
      const chunk = audio.subarray(i, Math.min(i + CHUNK_BYTES, audio.length));
      // Provider-specific audio send format
      // ws.send(JSON.stringify({ audio: { data: chunk.toString('base64'), ... } }));
      await Bun.sleep(CHUNK_MS / 2); // Send faster than real-time
    }
    console.log('✓ Audio sent');
  } catch (err) {
    console.log(`No test audio file at ${testFile}. Record one first.`);
    console.log('Sending text message instead...');
    // Provider-specific text message
  }
}

// Timeout safety
setTimeout(() => {
  console.log('Timeout — closing');
  ws.close();
}, 30000);
```

---

## Contributing to This Document

When you learn something new about a provider:

1. **Answer a checklist item** — Change `[ ]` to `[x]` and add the answer inline or in a linked provider doc
2. **Update the status matrix** — Reflect current integration state
3. **Add gotchas** — If something behaves unexpectedly, document it here and in the provider doc
4. **Record test results** — After running scenarios, note pass/fail in the provider status
5. **Add new providers** — Add rows to the "Providers to Research" table
