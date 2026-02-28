import { parseDecomposedProviderConfig } from '../provider-config.js';
import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import {
  createTurnDetector,
  type DecomposedVadEngine,
  RnnoiseTurnDetector,
  WebRtcVadTurnDetector,
  type TurnDetector,
} from '../vad/turn-detector.js';
import { createClient, LiveTTSEvents, type SpeakLiveClient } from '@deepgram/sdk';
import { createLlmRuntime } from '@voiceclaw/llm-runtime';
import { DecomposedSpokenWordBuffer } from './decomposed-spoken-buffer.js';
import {
  defaultTtsModelForProvider,
  isRealtimeStreamingTtsProvider,
  synthesizeTtsSegment,
} from './decomposed-tts/index.js';
import type {
  DecomposedTtsProvider,
  SegmentSynthesisResult,
} from './decomposed-tts/types.js';
import type {
  AudioFrame,
  AudioNegotiation,
  DecomposedProviderConfig,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfigSchema,
  SessionInput,
  ToolCallContext,
  ToolDefinition,
  ToolCallResult,
  VoiceHistoryItem,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';

const AUDIO_SAMPLE_RATE = 24000;
const PCM_BYTES_PER_100MS = (AUDIO_SAMPLE_RATE * 2) / 10;

/**
 * RMS threshold for detecting speech onset in PCM16 audio.
 * Values below this are considered silence (Deepgram TTS preamble).
 * PCM16 range is [-32768, 32767]; a typical quiet signal has RMS < 200.
 */
const SPEECH_ONSET_RMS_THRESHOLD = 300;

/**
 * Detect the sample offset within a PCM16 chunk where speech begins.
 * Returns the byte offset relative to the chunk start, or -1 if the
 * entire chunk is silence.  Uses a small sliding window (128 samples ≈ 5ms)
 * to avoid triggering on isolated clicks/pops.
 */
function detectSpeechOnsetInChunk(chunk: ArrayBuffer): number {
  const samples = new Int16Array(chunk);
  const windowSize = Math.min(128, samples.length);
  if (windowSize === 0) return -1;

  let sumSquares = 0;
  // Seed the sliding window
  for (let i = 0; i < windowSize; i++) {
    const s = samples[i]!;
    sumSquares += s * s;
  }
  if (Math.sqrt(sumSquares / windowSize) >= SPEECH_ONSET_RMS_THRESHOLD) {
    return 0; // Speech starts at the very beginning
  }

  // Slide the window forward one sample at a time
  for (let i = windowSize; i < samples.length; i++) {
    const entering = samples[i]!;
    const leaving = samples[i - windowSize]!;
    sumSquares += entering * entering - leaving * leaving;
    const rms = Math.sqrt(Math.max(0, sumSquares) / windowSize);
    if (rms >= SPEECH_ONSET_RMS_THRESHOLD) {
      // Speech starts at the leading edge of this window
      const onsetSample = i - windowSize + 1;
      return onsetSample * 2; // Convert sample offset → byte offset (PCM16 = 2 bytes/sample)
    }
  }

  return -1; // Entire chunk is silence
}
const MIN_BARGE_IN_MS = 360;
const DEEPGRAM_FLUSH_FALLBACK_POLL_MS = 500;
const DEEPGRAM_FLUSH_FALLBACK_IDLE_MS = 1200;
const DEEPGRAM_FLUSH_FALLBACK_FORCE_MS = 1400;
const MIC_ECHO_COOLDOWN_MS = 520;
const SPEAKING_START_COOLDOWN_MS = 220;
const ASSISTANT_RMS_DECAY_MS = 420;
const LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS = 120;
const LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS = 4000;
const LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS = 220;
const LOCAL_QWEN_ADAPTIVE_START_BUFFER_WAIT_CAP_MS = 4500;
const LOCAL_QWEN_ADAPTIVE_UNDERRUN_THRESHOLD_MS = -40;
const LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS = 220;
const LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN = 0.6;
const LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX = 4.0;
const LOCAL_QWEN_ADAPTIVE_INTERVAL_STEP = 0.1;
const LOCAL_QWEN_ADAPTIVE_BOOTSTRAP_INTERVAL_MULTIPLIER = 2.0;
const LOCAL_QWEN_ADAPTIVE_RTF_EMA_ALPHA = 0.35;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_DEFAULT = 60;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MIN = 16;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MAX = 220;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_EMA_ALPHA = 0.25;
const TURN_MARKERS = ['✓', '○', '◐'] as const;
const decomposedLlmRuntime = createLlmRuntime();

type TurnMarker = (typeof TURN_MARKERS)[number];
type ConversationRole = 'user' | 'assistant' | 'system';

interface DecomposedOptions {
  sttProvider: 'openai' | 'deepgram' | 'local';
  sttModel: string;
  customSttMode: 'provider' | 'custom' | 'hybrid';
  llmProvider: 'openai' | 'openrouter' | 'anthropic' | 'google';
  llmModel: string;
  ttsProvider: DecomposedTtsProvider;
  ttsModel: string;
  ttsVoice: string;
  deepgramTtsTransport: 'websocket';
  deepgramTtsWsUrl: string;
  deepgramTtsPunctuationChunkingEnabled: boolean;
  inlineTtsChunkingEnabled: boolean;
  cartesiaTtsWsUrl: string;
  fishTtsWsUrl: string;
  rimeTtsWsUrl: string;
  googleChirpEndpoint: string;
  kokoroEndpoint: string;
  pocketTtsEndpoint: string;
  localEndpoint: string;
  localTtsStreamingIntervalSec: number;
  localQwenAdaptiveUnderrunEnabled: boolean;
  silenceMs: number;
  minSpeechMs: number;
  minRms: number;
  bargeInEnabled: boolean;
  speechStartDebounceMs: number;
  vadEngine: DecomposedVadEngine;
  neuralFilterEnabled: boolean;
  rnnoiseSpeechThreshold: number;
  rnnoiseEchoSpeechThresholdBoost: number;
  webrtcVadMode: 0 | 1 | 2 | 3;
  webrtcVadSpeechRatioThreshold: number;
  webrtcVadEchoSpeechRatioBoost: number;
  assistantOutputMinRms: number;
  assistantOutputSilenceMs: number;
  spokenStreamEnabled: boolean;
  wordAlignmentEnabled: boolean;
  llmCompletionEnabled: boolean;
  llmShortTimeoutMs: number;
  llmLongTimeoutMs: number;
  llmShortReprompt: string;
  llmLongReprompt: string;
  language: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  deepgramApiKey?: string;
  cartesiaApiKey?: string;
  fishAudioApiKey?: string;
  rimeApiKey?: string;
}

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatCompletionMessage;
    finish_reason?: string | null;
  }>;
}

interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface ChatCompletionMessage {
  role?: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type?: string; text?: string }> | null;
  tool_calls?: ChatCompletionToolCall[];
  tool_call_id?: string;
}

interface ChatCompletionToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface LlmRequestTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

type LlmMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: ChatCompletionToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

const TURN_COMPLETION_PROMPT = [
  'You must start every response with exactly one marker character:',
  '✓ when the user turn is complete and you should answer now.',
  '○ when the user seems to have paused mid-thought and likely continues soon.',
  '◐ when the user seems to be thinking and may continue after a longer pause.',
  'If you use ○ or ◐, do not include any extra text after the marker.',
  'Never explain the marker. Never output more than one marker.',
].join('\n');

const DECOMPOSED_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['http', 'websocket'],
  audioNegotiation: false,
  vadModes: ['manual'],
  interruptionModes: ['barge-in'],

  toolTimeout: false,
  asyncTools: true,
  toolCancellation: false,
  toolScheduling: false,
  toolReaction: false,
  precomputableTools: false,
  toolApproval: false,
  mcpTools: false,
  serverSideTools: false,

  sessionResumption: false,
  midSessionConfigUpdate: false,
  contextCompression: false,

  forceAgentMessage: false,
  outputMediumSwitch: false,
  callState: false,
  deferredText: false,
  callStages: false,
  proactivity: false,
  usageMetrics: false,
  orderedTranscripts: true,
  ephemeralTokens: false,
  nativeTruncation: false,
  wordLevelTimestamps: false,
};

interface ConversationEntry {
  id: string;
  role: ConversationRole;
  content: string;
}

interface StreamedAssistantTurnResult {
  marker: TurnMarker;
  text: string;
  spokenText: string;
  spokeAudio: boolean;
  llmDurationMs: number;
  interrupted: boolean;
}

interface BufferedSpeechFrame {
  data: Uint8Array;
  durationMs: number;
}

interface SegmentPlaybackResult {
  playbackMs: number;
  wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>;
  wordTimestampsTimeBase?: 'segment' | 'utterance';
  precision: 'segment' | 'provider-word-timestamps';
}

const DECOMPOSED_CONFIG_SCHEMA: ProviderConfigSchema = {
  providerId: 'decomposed',
  displayName: 'Decomposed (STT + LLM + TTS)',
  fields: [
    {
      key: 'turn.silenceMs',
      label: 'Silence Threshold (ms)',
      type: 'number',
      group: 'vad',
      min: 100,
      max: 3000,
      step: 50,
      defaultValue: 700,
      description: 'Duration of silence before finalizing a turn.',
    },
    {
      key: 'turn.minSpeechMs',
      label: 'Minimum Speech (ms)',
      type: 'number',
      group: 'vad',
      min: 50,
      max: 2000,
      step: 50,
      defaultValue: 350,
      description: 'Minimum speech duration to process a turn.',
    },
    {
      key: 'turn.minRms',
      label: 'Minimum RMS Level',
      type: 'number',
      group: 'vad',
      min: 0.001,
      max: 0.1,
      step: 0.001,
      defaultValue: 0.015,
      description: 'Audio level threshold for speech detection.',
    },
    {
      key: 'turn.bargeInEnabled',
      label: 'Barge-In Enabled',
      type: 'boolean',
      group: 'vad',
      defaultValue: true,
      description:
        'When disabled, mic audio is ignored while assistant audio is speaking (no auto interruption).',
    },
    {
      key: 'turn.speechStartDebounceMs',
      label: 'Speech Start Debounce (ms)',
      type: 'number',
      group: 'vad',
      min: 0,
      max: 600,
      step: 10,
      defaultValue: 140,
      description: 'Continuous speech required before opening a mic turn buffer.',
    },
    {
      key: 'turn.vadEngine',
      label: 'VAD Engine',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'webrtc-vad', label: 'WebRTC VAD (proper speech classifier)' },
        { value: 'rnnoise', label: 'RNNoise (neural, recommended)' },
        { value: 'rms', label: 'RMS (legacy fallback)' },
      ],
      defaultValue: 'webrtc-vad',
      description:
        'Speech detector used for turn start/barge-in. WebRTC VAD is recommended for robust speech-vs-noise classification.',
    },
    {
      key: 'turn.neuralFilterEnabled',
      label: 'Neural Input Filter',
      type: 'boolean',
      group: 'vad',
      defaultValue: true,
      description:
        'Denoises microphone audio with RNNoise before VAD/STT capture (fallbacks to raw audio if unavailable).',
    },
    {
      key: 'turn.rnnoiseSpeechThreshold',
      label: 'RNNoise Speech Threshold',
      type: 'range',
      group: 'vad',
      min: 0.2,
      max: 0.99,
      step: 0.01,
      defaultValue: 0.62,
      dependsOn: { field: 'turn.vadEngine', value: 'rnnoise' },
      description: 'Neural speech probability threshold in normal listening mode.',
    },
    {
      key: 'turn.webrtcVadMode',
      label: 'WebRTC VAD Mode',
      type: 'number',
      group: 'vad',
      min: 0,
      max: 3,
      step: 1,
      defaultValue: 3,
      dependsOn: { field: 'turn.vadEngine', value: 'webrtc-vad' },
      description: 'Aggressiveness of WebRTC VAD speech filtering.',
    },
    {
      key: 'turn.webrtcVadSpeechRatioThreshold',
      label: 'WebRTC Speech Ratio Threshold',
      type: 'range',
      group: 'vad',
      min: 0.2,
      max: 0.99,
      step: 0.01,
      defaultValue: 0.7,
      dependsOn: { field: 'turn.vadEngine', value: 'webrtc-vad' },
      description: 'Minimum voiced-frame ratio required to classify chunk as speech.',
    },
    {
      key: 'turn.webrtcVadEchoSpeechRatioBoost',
      label: 'WebRTC Speaking Boost',
      type: 'range',
      group: 'vad',
      min: 0,
      max: 0.4,
      step: 0.01,
      defaultValue: 0.15,
      dependsOn: { field: 'turn.vadEngine', value: 'webrtc-vad' },
      description: 'Extra voiced-ratio required while assistant is speaking.',
    },
    {
      key: 'turn.assistantOutputMinRms',
      label: 'Assistant Output VAD Min RMS',
      type: 'number',
      group: 'vad',
      min: 0.001,
      max: 0.08,
      step: 0.001,
      defaultValue: 0.008,
      description: 'RMS threshold to consider assistant output actively speaking.',
    },
    {
      key: 'turn.assistantOutputSilenceMs',
      label: 'Assistant Output Silence Hold (ms)',
      type: 'number',
      group: 'vad',
      min: 100,
      max: 1200,
      step: 10,
      defaultValue: 350,
      description: 'How long output stays "speaking" after last voiced chunk.',
    },
    {
      key: 'deepgramTtsPunctuationChunkingEnabled',
      label: 'Deepgram Punctuation Chunking',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
      description:
        'When enabled, Deepgram streaming TTS flushes on punctuation for lower latency. Disable for one continuous segment per turn.',
    },
    {
      key: 'inlineTtsChunkingEnabled',
      label: 'Inline TTS Chunking',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
      description:
        'When enabled, inline/non-streaming TTS is synthesized in small segments while text streams in. Disable to synthesize one full utterance per response.',
    },
    {
      key: 'localEndpoint',
      label: 'Local Inference Endpoint',
      type: 'string',
      group: 'advanced',
      defaultValue: 'http://localhost:1060',
      description:
        'Base URL for local STT/TTS provider calls (for example http://localhost:1060).',
    },
    {
      key: 'localTtsStreamingIntervalSec',
      label: 'Local Qwen Streaming Interval (s)',
      type: 'number',
      group: 'advanced',
      min: 0.2,
      max: 4,
      step: 0.1,
      defaultValue: 1.0,
      description:
        'Streaming chunk interval for local Qwen TTS. Lower values reduce first audio latency but can increase chunk overhead.',
    },
    {
      key: 'localQwenAdaptiveUnderrunEnabled',
      label: 'Local Qwen Adaptive Anti-Underrun',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
      description:
        'Dynamically increases startup buffer and streaming interval for local Qwen TTS when generation falls behind playback.',
    },
    // LLM completion fields (enabled, shortTimeoutMs, longTimeoutMs) are managed
    // by the dedicated turn.llmCompletion section in voice.config.json, not providerSettings.
  ],
};

export class DecomposedAdapter implements ProviderAdapter {
  readonly id = 'decomposed' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private input: SessionInput | null = null;
  private options: DecomposedOptions | null = null;
  private state: VoiceState = 'idle';
  private connected = false;
  private history: ConversationEntry[] = [];

  private speechChunks: Uint8Array[] = [];
  private pendingSpeechFrames: BufferedSpeechFrame[] = [];
  private pendingSpeechMs = 0;
  private speechStartedAtMs: number | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private processingTurn = false;
  private interrupted = false;
  private speakingBargeInMs = 0;
  private assistantOutputRms = 0;
  private assistantOutputRmsAtMs = 0;
  private assistantOutputVoiceAtMs = 0;
  private micCaptureCooldownUntilMs = 0;
  private interruptionGeneration = 0;
  private activeLlmAbortController: AbortController | null = null;
  private activeTtsAbortController: AbortController | null = null;
  private assistantTurnQueue: Promise<void> = Promise.resolve();
  private deepgramTtsConnection: SpeakLiveClient | null = null;
  private deepgramTtsConnectionReady: Promise<SpeakLiveClient> | null = null;
  private deepgramTtsRequestQueue: Promise<void> = Promise.resolve();
  private turnDetector: TurnDetector | null = null;
  private localQwenAdaptiveStartBufferMs = LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS;
  private localQwenAdaptiveIntervalSec = 1.0;
  private localQwenAdaptiveProducerRtfEma = 1.0;
  private localQwenAdaptiveAudioMsPerChar = LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_DEFAULT;
  capabilities(): ProviderCapabilities {
    return DECOMPOSED_CAPABILITIES;
  }

  configSchema(): ProviderConfigSchema {
    return DECOMPOSED_CONFIG_SCHEMA;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.input = input;
    this.options = this.resolveOptions(input);
    this.turnDetector?.destroy();
    this.turnDetector = await createTurnDetector(this.options.vadEngine, {
      rnnoiseOptions: {
        speechThreshold: this.options.rnnoiseSpeechThreshold,
        echoSpeechThresholdBoost: this.options.rnnoiseEchoSpeechThresholdBoost,
        applyNeuralFilter: this.options.neuralFilterEnabled,
      },
      webrtcVadOptions: {
        mode: this.options.webrtcVadMode,
        speechRatioThreshold: this.options.webrtcVadSpeechRatioThreshold,
        echoSpeechRatioBoost: this.options.webrtcVadEchoSpeechRatioBoost,
        applyNeuralFilter: this.options.neuralFilterEnabled,
      },
    });
    const runtimeMode = (() => {
      if (this.turnDetector instanceof WebRtcVadTurnDetector) {
        return this.turnDetector.isUsingRmsFallback()
          ? 'rms-fallback'
          : 'webrtc-vad-active';
      }
      if (this.turnDetector instanceof RnnoiseTurnDetector) {
        return this.turnDetector.isUsingRmsFallback()
          ? 'rms-fallback'
          : 'rnnoise-active';
      }
      return 'rms-only';
    })();
    console.log(
      `[DecomposedAdapter] VAD engine: ${this.options.vadEngine}` +
        ` (filter=${this.options.neuralFilterEnabled ? 'on' : 'off'}, runtime=${runtimeMode}, bargeIn=${this.options.bargeInEnabled ? 'on' : 'off'})`
    );
    console.log(`[DecomposedAdapter] Turn completion markers: ${this.options.llmCompletionEnabled ? 'enabled' : 'disabled'}`);
    this.cancelInFlightOutput();
    this.history = [];
    this.speechChunks = [];
    this.resetPendingSpeechStart();
    this.speechStartedAtMs = null;
    this.speakingBargeInMs = 0;
    this.assistantOutputRms = 0;
    this.assistantOutputRmsAtMs = 0;
    this.assistantOutputVoiceAtMs = 0;
    this.micCaptureCooldownUntilMs = 0;
    this.processingTurn = false;
    this.interrupted = false;
    this.interruptionGeneration += 1;
    this.assistantTurnQueue = Promise.resolve();
    this.deepgramTtsRequestQueue = Promise.resolve();
    this.localQwenAdaptiveStartBufferMs = LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS;
    this.localQwenAdaptiveIntervalSec = this.options.localTtsStreamingIntervalSec;
    this.localQwenAdaptiveProducerRtfEma = 1.0;
    this.localQwenAdaptiveAudioMsPerChar = LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_DEFAULT;
    this.closeDeepgramTtsConnection();
    this.connected = true;

    this.setState('listening');
    this.events.emit('connected');

    return {
      providerInputRate: AUDIO_SAMPLE_RATE,
      providerOutputRate: AUDIO_SAMPLE_RATE,
      preferredClientInputRate: AUDIO_SAMPLE_RATE,
      preferredClientOutputRate: AUDIO_SAMPLE_RATE,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    this.clearSilenceTimer();
    this.clearCompletionTimer();
    this.cancelInFlightOutput();
    this.connected = false;
    this.speechChunks = [];
    this.resetPendingSpeechStart();
    this.speechStartedAtMs = null;
    this.speakingBargeInMs = 0;
    this.assistantOutputRms = 0;
    this.assistantOutputRmsAtMs = 0;
    this.assistantOutputVoiceAtMs = 0;
    this.micCaptureCooldownUntilMs = 0;
    this.processingTurn = false;
    this.interrupted = false;
    this.interruptionGeneration += 1;
    this.assistantTurnQueue = Promise.resolve();
    this.deepgramTtsRequestQueue = Promise.resolve();
    this.closeDeepgramTtsConnection();
    this.turnDetector?.destroy();
    this.turnDetector = null;
    this.setState('idle');
    this.events.emit('disconnected');
  }

  sendAudio(frame: AudioFrame): void {
    if (!this.connected || !this.options) return;
    const nowMs = Date.now();
    if (nowMs < this.micCaptureCooldownUntilMs) {
      return;
    }

    // Fast exit: skip all processing (including WASM VAD) when mic input is
    // not needed.  The synchronous WASM turn-detector blocks the event loop;
    // running it during TTS pacing sleep() causes chunk delivery jitter that
    // the browser hears as robotic "drrrrrr" artifacts.
    if (this.state === 'speaking' && !this.options.bargeInEnabled) {
      return;
    }

    // During an in-flight turn, only keep accepting mic audio if we're actively
    // handling barge-in (speaking) or have already interrupted and are capturing
    // the follow-up user utterance.
    if (this.processingTurn && this.state !== 'speaking' && !this.interrupted) {
      return;
    }

    const frameDurationMs = Math.max(
      1,
      Math.floor((frame.data.byteLength / 2 / frame.sampleRate) * 1000)
    );
    const copiedFrame = new Uint8Array(frame.data.slice(0));
    const assistantRms = this.getDecayedAssistantOutputRms(nowMs);
    const echoSensitivePhase =
      this.isAssistantOutputActive(nowMs) ||
      (this.processingTurn && this.interrupted);
    const detection = this.turnDetector?.detect({
      frameData: frame.data,
      frameSampleRate: frame.sampleRate,
      minRms: this.options.minRms,
      assistantRms,
      echoSensitivePhase,
    });
    const hasSpeech = detection?.hasSpeech ?? false;
    const frameForSpeech =
      detection?.processedFrameData instanceof ArrayBuffer
        ? new Uint8Array(detection.processedFrameData.slice(0))
        : copiedFrame;

    if (this.state === 'speaking') {
      if (hasSpeech) {
        this.speakingBargeInMs += frameDurationMs;
        if (this.speakingBargeInMs >= MIN_BARGE_IN_MS) {
          this.interrupt();
        }
      } else {
        this.speakingBargeInMs = 0;
      }

      if (this.state === 'speaking') {
        return;
      }
      this.speakingBargeInMs = 0;
    } else {
      this.speakingBargeInMs = 0;
    }

    if (hasSpeech && this.speechStartedAtMs === null) {
      this.queuePendingSpeechFrame(frameForSpeech, frameDurationMs);
      if (this.pendingSpeechMs >= this.options.speechStartDebounceMs) {
        this.clearCompletionTimer();
        this.speechStartedAtMs = Date.now();
        for (const pending of this.pendingSpeechFrames) {
          this.speechChunks.push(pending.data);
        }
        this.resetPendingSpeechStart();
        this.clearSilenceTimer();
      }
      return;
    }

    if (this.speechStartedAtMs === null) {
      this.resetPendingSpeechStart();
      return;
    }

    this.clearCompletionTimer();
    this.speechChunks.push(frameForSpeech);
    if (hasSpeech) {
      this.clearSilenceTimer();
    } else {
      this.armSilenceTimer();
    }
  }

  sendText(text: string): void {
    if (!this.connected) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    void this.enqueueAssistantTurn(trimmed, {
      emitUserTranscript: false,
    });
  }

  interrupt(): void {
    this.interruptionGeneration += 1;
    this.interrupted = true;
    this.speakingBargeInMs = 0;
    this.micCaptureCooldownUntilMs = Date.now() + MIC_ECHO_COOLDOWN_MS;
    this.clearCompletionTimer();
    this.clearSilenceTimer();
    this.speechChunks = [];
    this.resetPendingSpeechStart();
    this.speechStartedAtMs = null;
    this.assistantOutputVoiceAtMs = 0;
    this.cancelInFlightOutput();
    this.events.emit('audioInterrupted');
    this.setState('listening');
  }

  sendToolResult(_result: ToolCallResult): void {
    // Decomposed adapter currently does not expose provider-native tool callbacks.
  }

  on<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void {
    this.events.on(event, handler);
  }

  off<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void {
    this.events.off(event, handler);
  }

  private clearSilenceTimer(): void {
    if (!this.silenceTimer) return;
    clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private armSilenceTimer(): void {
    if (!this.options || this.silenceTimer) return;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      void this.finalizeSpeechTurn();
    }, this.options.silenceMs);
  }

  private clearCompletionTimer(): void {
    if (!this.completionTimer) return;
    console.log('[DecomposedAdapter] Re-engagement cancelled (user speech or interruption)');
    clearTimeout(this.completionTimer);
    this.completionTimer = null;
  }

  private cancelInFlightOutput(): void {
    this.abortLlmOutput();
    this.abortTtsOutput();
    this.deepgramTtsRequestQueue = Promise.resolve();
    this.closeDeepgramTtsConnection();
  }

  private beginLlmRequest(): AbortController {
    this.abortLlmOutput();
    const controller = new AbortController();
    this.activeLlmAbortController = controller;
    return controller;
  }

  private clearLlmRequest(controller: AbortController): void {
    if (this.activeLlmAbortController !== controller) return;
    this.activeLlmAbortController = null;
  }

  private abortLlmOutput(): void {
    if (!this.activeLlmAbortController) return;
    this.activeLlmAbortController.abort();
    this.activeLlmAbortController = null;
  }

  private beginTtsRequest(): AbortController {
    this.abortTtsOutput();
    const controller = new AbortController();
    this.activeTtsAbortController = controller;
    return controller;
  }

  private clearTtsRequest(controller: AbortController): void {
    if (this.activeTtsAbortController !== controller) return;
    this.activeTtsAbortController = null;
  }

  private abortTtsOutput(): void {
    if (!this.activeTtsAbortController) return;
    this.activeTtsAbortController.abort();
    this.activeTtsAbortController = null;
  }

  private isTurnCurrent(turnGeneration: number): boolean {
    return this.connected && !this.interrupted && this.interruptionGeneration === turnGeneration;
  }

  private isAbortError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return true;
      }
      return /aborted|abort/i.test(error.message);
    }
    return false;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    if (next === 'speaking') {
      this.micCaptureCooldownUntilMs = Math.max(
        this.micCaptureCooldownUntilMs,
        Date.now() + SPEAKING_START_COOLDOWN_MS
      );
    }
    if (next !== 'speaking') {
      this.speakingBargeInMs = 0;
    }
    this.events.emit('stateChange', next);
  }

  private trackAssistantOutput(frame: ArrayBuffer): void {
    if (!this.options) {
      return;
    }
    const nowMs = Date.now();
    const rms = computeRmsPcm16(frame);
    const baseline = this.getDecayedAssistantOutputRms(nowMs);
    const alpha = 0.35;
    this.assistantOutputRms = baseline * (1 - alpha) + rms * alpha;
    this.assistantOutputRmsAtMs = nowMs;
    if (rms >= this.options.assistantOutputMinRms) {
      this.assistantOutputVoiceAtMs = nowMs;
    }
  }

  private getDecayedAssistantOutputRms(nowMs: number): number {
    if (this.assistantOutputRmsAtMs <= 0 || this.assistantOutputRms <= 0) {
      return 0;
    }
    const elapsedMs = Math.max(0, nowMs - this.assistantOutputRmsAtMs);
    const decay = Math.exp(-elapsedMs / ASSISTANT_RMS_DECAY_MS);
    return this.assistantOutputRms * decay;
  }

  private isAssistantOutputActive(nowMs: number): boolean {
    if (!this.options || this.assistantOutputVoiceAtMs <= 0) {
      return false;
    }
    return nowMs - this.assistantOutputVoiceAtMs <= this.options.assistantOutputSilenceMs;
  }

  private queuePendingSpeechFrame(frame: Uint8Array, frameDurationMs: number): void {
    if (!this.options) {
      return;
    }
    this.pendingSpeechFrames.push({
      data: frame,
      durationMs: frameDurationMs,
    });
    this.pendingSpeechMs += frameDurationMs;

    const maxPendingMs = Math.max(this.options.speechStartDebounceMs + 120, 220);
    while (this.pendingSpeechMs > maxPendingMs && this.pendingSpeechFrames.length > 0) {
      const dropped = this.pendingSpeechFrames.shift();
      if (!dropped) {
        break;
      }
      this.pendingSpeechMs = Math.max(0, this.pendingSpeechMs - dropped.durationMs);
    }
  }

  private resetPendingSpeechStart(): void {
    this.pendingSpeechFrames = [];
    this.pendingSpeechMs = 0;
  }

  private emitLatency(metric: {
    stage: 'stt' | 'llm' | 'tts' | 'turn' | 'tool';
    durationMs: number;
    provider?: string;
    model?: string;
    details?: Record<string, unknown>;
  }): void {
    this.events.emit('latency', metric);
  }

  private async finalizeSpeechTurn(): Promise<void> {
    if (!this.options) return;
    if (this.processingTurn) {
      // Keep buffering speech while the current turn is in-flight and finalize once it settles.
      if (this.speechStartedAtMs !== null) {
        this.armSilenceTimer();
      }
      return;
    }

    const turnStartMs = Date.now();
    this.clearSilenceTimer();

    const joined = concatUint8Arrays(this.speechChunks);
    this.speechChunks = [];
    const speechStartedAtMs = this.speechStartedAtMs;
    this.speechStartedAtMs = null;
    if (!speechStartedAtMs || joined.byteLength === 0) return;

    const speechDurationMs = Math.floor((joined.byteLength / 2 / AUDIO_SAMPLE_RATE) * 1000);
    if (speechDurationMs < this.options.minSpeechMs) {
      return;
    }

    this.processingTurn = true;
    try {
      const sttStartMs = Date.now();
      const transcript = await this.transcribeAudio(joined);
      this.emitLatency({
        stage: 'stt',
        durationMs: Date.now() - sttStartMs,
        provider: this.options.sttProvider,
        model: this.options.sttModel,
        details: { transcriptChars: transcript.length },
      });

      if (!transcript) {
        this.setState('listening');
        return;
      }

      const userItemId = makeItemId('decomp-user');
      this.events.emit('userItemCreated', userItemId);
      this.events.emit('transcript', transcript, 'user', userItemId);

      await this.enqueueAssistantTurn(transcript, {
        emitUserTranscript: true,
        previousItemId: userItemId,
      });

      this.emitLatency({
        stage: 'turn',
        durationMs: Date.now() - turnStartMs,
        details: {
          speechDurationMs,
          transcriptChars: transcript.length,
        },
      });
    } catch (error) {
      this.events.emit('error', error as Error);
      this.setState('listening');
    } finally {
      this.processingTurn = false;
    }
  }

  private getHistoryItems(): VoiceHistoryItem[] {
    return this.history.map((entry) => ({
      id: entry.id,
      role: entry.role,
      text: entry.content,
      createdAt: Date.now(),
    }));
  }

  private commitAssistantHistory(itemId: string, text: string): void {
    const content = text.trim();
    if (!content) {
      return;
    }
    const existingIndex = this.history.findIndex((entry) => entry.id === itemId);
    if (existingIndex >= 0) {
      this.history[existingIndex] = {
        ...this.history[existingIndex]!,
        role: 'assistant',
        content,
      };
    } else {
      this.history.push({ id: itemId, role: 'assistant', content });
    }
    this.events.emit('historyUpdated', this.getHistoryItems());
  }

  private async transcribeAudio(pcm: Uint8Array): Promise<string> {
    if (!this.options || !this.input) return '';
    this.setState('thinking');
    if (this.options.sttProvider === 'local') {
      return this.transcribeWithLocal(pcm);
    }
    if (this.options.sttProvider === 'deepgram') {
      return this.transcribeWithDeepgram(pcm);
    }
    return this.transcribeWithOpenAI(pcm);
  }

  private async transcribeWithOpenAI(pcm: Uint8Array): Promise<string> {
    if (!this.options?.openaiApiKey) {
      throw new Error('OpenAI API key is missing for decomposed STT');
    }

    const wav = encodeWavPcm16Mono(pcm, AUDIO_SAMPLE_RATE);
    const form = new FormData();
    form.append('file', new File([wav], 'speech.wav', { type: 'audio/wav' }));
    form.append('model', this.options.sttModel);
    if (this.options.language) {
      form.append('language', this.options.language);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.openaiApiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI STT failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as { text?: string };
    return payload.text?.trim() ?? '';
  }

  private async transcribeWithDeepgram(pcm: Uint8Array): Promise<string> {
    if (!this.options?.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed STT');
    }

    const wav = encodeWavPcm16Mono(pcm, AUDIO_SAMPLE_RATE);
    const url = new URL('https://api.deepgram.com/v1/listen');
    url.searchParams.set('model', this.options.sttModel || 'nova-3');
    url.searchParams.set('language', this.options.language);
    url.searchParams.set('smart_format', 'true');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.options.deepgramApiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: wav,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepgram STT failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as DeepgramListenResponse;
    return payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
  }

  private async transcribeWithLocal(pcm: Uint8Array): Promise<string> {
    if (!this.options) {
      return '';
    }

    const wav = encodeWavPcm16Mono(pcm, AUDIO_SAMPLE_RATE);
    const endpoint = new URL('/v1/audio/transcriptions', this.options.localEndpoint);
    endpoint.searchParams.set('model', this.options.sttModel);
    endpoint.searchParams.set('language', this.options.language);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/wav',
      },
      body: wav,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local STT failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as { text?: string };
    return payload.text?.trim() ?? '';
  }

  private async runAssistantTurn(
    text: string,
    options: { emitUserTranscript: boolean; previousItemId?: string }
  ): Promise<void> {
    if (!this.options || !this.input) return;
    const turnGeneration = this.interruptionGeneration;
    this.interrupted = false;

    const userId =
      options.emitUserTranscript && options.previousItemId
        ? options.previousItemId
        : makeItemId('decomp-context');
    const assistantId = makeItemId('decomp-assistant');

    if (options.emitUserTranscript) {
      this.history.push({ id: userId, role: 'user', content: text });
    } else {
      this.history.push({ id: userId, role: 'system', content: text });
    }
    this.events.emit('historyUpdated', this.getHistoryItems());

    this.setState('thinking');
    this.events.emit('assistantItemCreated', assistantId, options.previousItemId);
    this.events.emit('turnStarted');
    if (this.options.spokenStreamEnabled) {
      // Announce spoken-stream ownership immediately so runtime/UI do not
      // synthesize speculative spoken text before adapter-grounded events arrive.
      this.events.emit('spokenProgress', assistantId, {
        spokenChars: 0,
        spokenWords: 0,
        playbackMs: 0,
        precision: 'segment',
      });
    }

    const systemPrompt = this.options.llmCompletionEnabled
      ? `${this.input.instructions}\n\n${TURN_COMPLETION_PROMPT}`
      : this.input.instructions;

    let marker: TurnMarker = '✓';
    let assistantText = '';
    let spokenText = '';
    let spokeWhileStreaming = false;
    let llmDurationMs = 0;
    let interruptedDuringGeneration = false;

    try {
      const streamed = await this.generateAssistantResponseStreaming(
        systemPrompt,
        assistantId,
        turnGeneration
      );
      assistantText = streamed.text;
      spokenText = streamed.spokenText;
      marker = streamed.marker;
      spokeWhileStreaming = streamed.spokeAudio;
      llmDurationMs = streamed.llmDurationMs;
      interruptedDuringGeneration = streamed.interrupted;
    } catch (error) {
      if (this.isAbortError(error) || !this.isTurnCurrent(turnGeneration)) {
        return;
      }
      this.events.emit('error', error as Error);
      this.setState('listening');
      return;
    }

    if (interruptedDuringGeneration || !this.isTurnCurrent(turnGeneration)) {
      this.commitAssistantHistory(assistantId, spokenText);
      return;
    }

    this.emitLatency({
      stage: 'llm',
      durationMs: llmDurationMs,
      provider: this.options.llmProvider,
      model: this.options.llmModel,
      details: { responseChars: assistantText.length },
    });

    if (this.options.llmCompletionEnabled && marker !== '✓') {
      this.scheduleIncompleteTurnReprompt(marker);
      this.setState('listening');
      return;
    }

    const finalText = assistantText.trim();
    if (!finalText) {
      if (this.isTurnCurrent(turnGeneration)) {
        this.setState('listening');
      }
      return;
    }

    if (!spokeWhileStreaming && this.isTurnCurrent(turnGeneration)) {
      try {
        await this.speak(finalText, turnGeneration, assistantId);
      } catch (error) {
        if (this.isAbortError(error) || !this.isTurnCurrent(turnGeneration)) {
          return;
        }
        this.events.emit('error', error as Error);
        this.setState('listening');
        return;
      }
    }

    if (!this.isTurnCurrent(turnGeneration)) {
      return;
    }

    this.commitAssistantHistory(assistantId, finalText);
    this.events.emit('transcript', finalText, 'assistant', assistantId);
    this.events.emit('turnComplete');
  }

  private enqueueAssistantTurn(
    text: string,
    options: { emitUserTranscript: boolean; previousItemId?: string }
  ): Promise<void> {
    const enqueuedGeneration = this.interruptionGeneration;
    const next = this.assistantTurnQueue.then(async () => {
      if (!this.connected) return;
      if (enqueuedGeneration !== this.interruptionGeneration) return;
      await this.runAssistantTurn(text, options);
    });
    this.assistantTurnQueue = next.catch(() => {});
    return next;
  }

  private async generateAssistantResponseStreaming(
    systemPrompt: string,
    assistantId: string,
    turnGeneration: number
  ): Promise<StreamedAssistantTurnResult> {
    if (!this.options) {
      return {
        marker: '✓',
        text: '',
        spokenText: '',
        spokeAudio: false,
        llmDurationMs: 0,
        interrupted: true,
      };
    }

    const llmController = this.beginLlmRequest();
    try {
      // Streaming tool-calling is available through llm-runtime for supported providers.
      // Keep legacy completion fallback only for non-runtime providers.
      if (this.toolsEnabled() && !this.supportsLlmRuntimePath()) {
        return this.generateAssistantResponseWithTools(
          systemPrompt,
          assistantId,
          llmController.signal,
          turnGeneration
        );
      }

      // Create text stream; detect turn-completion marker when enabled
      const llmStartedAtMs = Date.now();
      let textStream: AsyncGenerator<string> = this.generateAssistantTextStream(
        systemPrompt,
        llmController.signal
      );
      let marker: TurnMarker = '✓';

      if (this.options.llmCompletionEnabled) {
        const peek = await this.peekStreamForMarker(textStream);
        marker = peek.marker;
        if (marker !== '✓') {
          const label = marker === '○' ? 'incomplete-short' : 'incomplete-long';
          console.log(`[DecomposedAdapter] Turn marker: ${marker} (${label}) — suppressing response`);
          return {
            marker,
            text: '',
            spokenText: '',
            spokeAudio: false,
            llmDurationMs: Date.now() - llmStartedAtMs,
            interrupted: !this.isTurnCurrent(turnGeneration),
          };
        }
        console.log(`[DecomposedAdapter] Turn marker: ✓ (complete) — streaming response`);
        textStream = peek.stream;
      }

      if (isRealtimeStreamingTtsProvider(this.options.ttsProvider)) {
        console.log(
          `[DecomposedAdapter] TTS path: provider-streaming (${this.options.ttsProvider})` +
            ` (punctuationChunking=${this.options.deepgramTtsPunctuationChunkingEnabled})`
        );
        const request = this.deepgramTtsRequestQueue.then(() =>
          this.streamTextWithDeepgramTts(textStream, assistantId, llmStartedAtMs, turnGeneration)
        );
        this.deepgramTtsRequestQueue = request.then(() => undefined).catch(() => undefined);
        const result = await request;
        return { ...result, marker };
      }

      console.log(
        `[DecomposedAdapter] TTS path: inline-segment (provider=${this.options.ttsProvider}, chunking=${this.options.inlineTtsChunkingEnabled ? 'on' : 'off'})`
      );
      const result = await this.streamTextWithInlineTts(
        textStream,
        assistantId,
        llmStartedAtMs,
        turnGeneration
      );
      return { ...result, marker };
    } finally {
      this.clearLlmRequest(llmController);
    }
  }

  /**
   * Reads initial tokens from a text stream to detect a turn-completion marker.
   * Buffers until the first non-whitespace character, then:
   * - ✓ → strips marker, returns stream of remaining text
   * - ○/◐ → drains stream, returns empty stream
   * - No marker → treats as ✓, returns full stream
   */
  private async peekStreamForMarker(
    source: AsyncGenerator<string>
  ): Promise<{ marker: TurnMarker; stream: AsyncGenerator<string> }> {
    let buffer = '';

    while (true) {
      const { done, value } = await source.next();
      if (done) {
        const text = buffer.trimStart();
        return { marker: '✓', stream: singleValueGenerator(text) };
      }

      buffer += value;
      const trimmed = buffer.trimStart();
      if (trimmed.length === 0) continue;

      const first = trimmed[0] as string;
      if (TURN_MARKERS.includes(first as TurnMarker)) {
        const marker = first as TurnMarker;
        if (marker !== '✓') {
          // Incomplete turn — drain the stream so the HTTP response closes cleanly
          for await (const _ of source) { /* discard */ }
          return { marker, stream: emptyAsyncGenerator() };
        }
        const afterMarker = trimmed.slice(1).trimStart();
        return { marker: '✓', stream: prependToAsyncGenerator(afterMarker, source) };
      }

      // First character is not a marker — treat as complete
      return { marker: '✓', stream: prependToAsyncGenerator(buffer, source) };
    }
  }

  /**
   * Streams LLM text to TTS via the OpenAI-style segment queue (non-Deepgram path).
   */
  private async streamTextWithInlineTts(
    textStream: AsyncIterable<string>,
    assistantId: string,
    llmStartedAtMs: number,
    turnGeneration: number
  ): Promise<{
    text: string;
    spokenText: string;
    spokeAudio: boolean;
    llmDurationMs: number;
    interrupted: boolean;
  }> {
    let assistantText = '';
    let speechBuffer = '';
    let segmentIndex = 0;
    let speaking = false;
    let spokeAudio = false;
    let spokenText = '';
    let spokenChars = 0;
    let spokenWords = 0;
    let spokenPlaybackMs = 0;
    const spokenStreamEnabled = this.options?.spokenStreamEnabled === true;
    const inlineTtsChunkingEnabled = this.options?.inlineTtsChunkingEnabled !== false;

    let speakQueue: Promise<void> = Promise.resolve();
    const queueSegment = (segmentText: string): void => {
      const normalized = segmentText.trim();
      if (!normalized) return;
      const currentIndex = ++segmentIndex;
      speakQueue = speakQueue.then(async () => {
        if (!this.isTurnCurrent(turnGeneration)) return;
        spokeAudio = true;
        const segmentPlayback = await this.speakSegment(normalized, turnGeneration, {
          segmentIndex: currentIndex,
          onFirstAudio: () => {
            if (!speaking) {
              this.setState('speaking');
              speaking = true;
            }
          },
        });
        // Emit spoken delta AFTER TTS completes so playbackMs is truthful.
        spokenPlaybackMs += Math.max(0, segmentPlayback.playbackMs);
        if (spokenStreamEnabled && this.isTurnCurrent(turnGeneration)) {
          spokenText += normalized;
          spokenChars = spokenText.length;
          spokenWords = countWords(spokenText);
          this.events.emit('spokenDelta', normalized, 'assistant', assistantId, {
            spokenChars,
            spokenWords,
            playbackMs: spokenPlaybackMs,
            precision: segmentPlayback.precision,
            wordTimestamps: segmentPlayback.wordTimestamps,
            wordTimestampsTimeBase: segmentPlayback.wordTimestampsTimeBase,
          });
          this.events.emit('spokenProgress', assistantId, {
            spokenChars,
            spokenWords,
            playbackMs: spokenPlaybackMs,
            precision: 'segment',
          });
        }
      });
    };

    for await (const delta of textStream) {
      if (!this.isTurnCurrent(turnGeneration)) {
        break;
      }
      if (!delta) continue;
      assistantText += delta;
      this.events.emit('transcriptDelta', delta, 'assistant', assistantId);

      speechBuffer += delta;
      if (inlineTtsChunkingEnabled) {
        const split = splitSpeakableText(speechBuffer);
        speechBuffer = split.remainder;
        for (const segment of split.segments) {
          queueSegment(segment);
        }
      }
    }

    const trailing = speechBuffer.trim();
    if (trailing) {
      queueSegment(trailing);
    }

    const llmDurationMs = Date.now() - llmStartedAtMs;
    await speakQueue;

    if (speaking && this.isTurnCurrent(turnGeneration)) {
      this.setState('listening');
    }

    if (spokenStreamEnabled && spokenText && this.isTurnCurrent(turnGeneration)) {
      this.events.emit('spokenFinal', spokenText, 'assistant', assistantId, {
        spokenChars,
        spokenWords,
        playbackMs: spokenPlaybackMs,
        precision: 'segment',
      });
    }

    return {
      text: assistantText,
      spokenText,
      spokeAudio,
      llmDurationMs,
      interrupted: !this.isTurnCurrent(turnGeneration),
    };
  }

  private async generateAssistantResponseWithTools(
    systemPrompt: string,
    assistantId: string,
    signal: AbortSignal,
    turnGeneration: number
  ): Promise<StreamedAssistantTurnResult> {
    const llmStartedAtMs = Date.now();
    const rawText = await this.generateAssistantTextWithTools(systemPrompt, signal);
    const { marker, text } = this.options?.llmCompletionEnabled
      ? parseMarker(rawText, true)
      : { marker: '✓' as TurnMarker, text: rawText };
    if (text && this.isTurnCurrent(turnGeneration)) {
      this.events.emit('transcriptDelta', text, 'assistant', assistantId);
    }
    return {
      marker,
      text,
      spokenText: '',
      spokeAudio: false,
      llmDurationMs: Date.now() - llmStartedAtMs,
      interrupted: !this.isTurnCurrent(turnGeneration),
    };
  }

  private async streamTextWithDeepgramTts(
    textStream: AsyncIterable<string>,
    assistantId: string,
    llmStartedAtMs: number,
    turnGeneration: number
  ): Promise<{
    text: string;
    spokenText: string;
    spokeAudio: boolean;
    llmDurationMs: number;
    interrupted: boolean;
  }> {
    if (!this.options) {
      return { text: '', spokenText: '', spokeAudio: false, llmDurationMs: 0, interrupted: true };
    }

    if (!this.isTurnCurrent(turnGeneration)) {
      return { text: '', spokenText: '', spokeAudio: false, llmDurationMs: 0, interrupted: true };
    }

    const connection = await this.ensureDeepgramTtsConnection();
    if (!this.isTurnCurrent(turnGeneration)) {
      return { text: '', spokenText: '', spokeAudio: false, llmDurationMs: 0, interrupted: true };
    }

    const ttsStartedAtMs = Date.now();
    const punctuationChunkingEnabled = this.options.deepgramTtsPunctuationChunkingEnabled;
    let llmDurationMs = 0;
    let assistantText = '';
    let pendingText = '';
    let speaking = false;
    let spokeAudio = false;
    let pendingChars = 0;
    let expectedFlushes = 0;
    let receivedFlushes = 0;
    let sendingComplete = false;
    let sendingCompleteAtMs: number | null = null;
    let settled = false;
    let aborted = false;
    let emittedAudioBytes = 0;
    let emittedChunks = 0;
    let firstAudioAtMs: number | null = null;
    let lastAudioAtMs: number | null = null;
    let forceReconnectAfterTurn = false;
    let audioPipeline: Promise<void> = Promise.resolve();
    const spokenStreamEnabled = this.options.spokenStreamEnabled === true;

    // Speech onset detection: track where audible speech actually begins
    // in the emitted audio stream (skipping TTS silence preamble).
    let speechOnsetBytes = 0;
    let speechOnsetDetected = false;
    const flushTextQueue: string[] = [];
    let spokenText = '';
    let spokenChars = 0;
    let spokenWords = 0;
    let spokenPlaybackMs = 0;
    const spokenWordBuffer = new DecomposedSpokenWordBuffer();

    // Emit spoken words using the audio-derived playback clock.
    // Pre-audio buffering is handled by DecomposedSpokenWordBuffer.
    const emitSpokenWord = (word: string): void => {
      if (!word || !spokenStreamEnabled || !this.isTurnCurrent(turnGeneration)) return;
      spokenText += word;
      spokenChars = spokenText.length;
      spokenWords = countWords(spokenText);
      const playbackMs = Math.floor((emittedAudioBytes / 2 / AUDIO_SAMPLE_RATE) * 1000);
      const onsetMs = speechOnsetDetected
        ? Math.floor((speechOnsetBytes / 2 / AUDIO_SAMPLE_RATE) * 1000)
        : 0;
      spokenPlaybackMs = playbackMs;
      this.events.emit('spokenDelta', word, 'assistant', assistantId, {
        spokenChars,
        spokenWords,
        playbackMs,
        speechOnsetMs: onsetMs,
        precision: 'segment',
      });
      this.events.emit('spokenProgress', assistantId, {
        spokenChars,
        spokenWords,
        playbackMs,
        precision: 'segment',
      });
    };

    // Flush any words buffered while waiting for audio to start.
    const drainSpokenWordBuffer = (): void => {
      const buffered = spokenWordBuffer.markAudioStarted();
      if (buffered) {
        emitSpokenWord(buffered);
      }
    };

    await new Promise<void>((resolve, reject) => {
      let flushFallbackTimer: ReturnType<typeof setTimeout> | null = null;
      const streamingTimeout = setTimeout(() => {
        this.closeDeepgramTtsConnection();
        rejectOnce(new Error('Deepgram websocket TTS streaming turn timed out'));
      }, 30000);

      const cleanup = (): void => {
        clearTimeout(streamingTimeout);
        if (flushFallbackTimer) {
          clearTimeout(flushFallbackTimer);
          flushFallbackTimer = null;
        }
        connection.off(LiveTTSEvents.Audio, onAudio);
        connection.off(LiveTTSEvents.Flushed, onFlushed);
        connection.off(LiveTTSEvents.Warning, onWarning);
        connection.off(LiveTTSEvents.Close, onClose);
        connection.off(LiveTTSEvents.Error, onError);
      };

      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      // Track audio-sync playback position when a Flush event arrives.
      const updatePlaybackOnFlush = (flushedText: string): void => {
        if (!flushedText || !this.isTurnCurrent(turnGeneration)) {
          return;
        }
        const playbackMs = Math.floor((emittedAudioBytes / 2 / AUDIO_SAMPLE_RATE) * 1000);
        spokenPlaybackMs = playbackMs;
      };

      const drainPendingFlushQueue = (): void => {
        while (flushTextQueue.length > 0) {
          const flushedText = flushTextQueue.shift() ?? '';
          updatePlaybackOnFlush(flushedText);
          receivedFlushes += 1;
        }
      };

      const armFlushFallback = (): void => {
        if (settled || !sendingComplete) {
          return;
        }
        if (receivedFlushes >= expectedFlushes) {
          return;
        }
        if (flushFallbackTimer) {
          clearTimeout(flushFallbackTimer);
          flushFallbackTimer = null;
        }

        flushFallbackTimer = setTimeout(() => {
          flushFallbackTimer = null;
          if (settled) return;
          if (!this.isTurnCurrent(turnGeneration)) {
            resolveOnce();
            return;
          }

          const idleMs =
            lastAudioAtMs === null ? Number.POSITIVE_INFINITY : Date.now() - lastAudioAtMs;
          if (idleMs < DEEPGRAM_FLUSH_FALLBACK_IDLE_MS) {
            armFlushFallback();
            return;
          }

          if (receivedFlushes < expectedFlushes) {
            const connectionAlive =
              typeof connection.isConnected === 'function' ? connection.isConnected() : true;
            const stalledSinceCompleteMs =
              sendingCompleteAtMs === null ? 0 : Date.now() - sendingCompleteAtMs;
            if (
              connectionAlive &&
              stalledSinceCompleteMs < DEEPGRAM_FLUSH_FALLBACK_FORCE_MS
            ) {
              armFlushFallback();
              return;
            }
            drainPendingFlushQueue();
            if (receivedFlushes < expectedFlushes) {
              receivedFlushes = expectedFlushes;
            }
            forceReconnectAfterTurn = true;
          }

          maybeResolve();
        }, DEEPGRAM_FLUSH_FALLBACK_POLL_MS);
      };

      const maybeResolve = (): void => {
        if (settled) return;
        if (aborted) {
          resolveOnce();
          return;
        }
        if (!this.isTurnCurrent(turnGeneration)) {
          resolveOnce();
          return;
        }
        if (!sendingComplete) {
          return;
        }
        if (receivedFlushes < expectedFlushes) {
          return;
        }
        void audioPipeline.then(() => resolveOnce()).catch((error) => {
          rejectOnce(error as Error);
        });
      };

      const emitChunk = async (chunk: ArrayBuffer): Promise<boolean> => {
        if (!this.isTurnCurrent(turnGeneration)) {
          return false;
        }

        // Detect speech onset before advancing the byte counter so the
        // offset is relative to the start of the emitted audio stream.
        let onsetDetectedInChunk = false;
        if (!speechOnsetDetected) {
          const onsetByteInChunk = detectSpeechOnsetInChunk(chunk);
          if (onsetByteInChunk >= 0) {
            speechOnsetBytes = emittedAudioBytes + onsetByteInChunk;
            speechOnsetDetected = true;
            onsetDetectedInChunk = true;
          }
        }

        emittedAudioBytes += chunk.byteLength;
        emittedChunks += 1;
        const isFirstAudio = firstAudioAtMs === null;
        if (isFirstAudio) {
          firstAudioAtMs = Date.now();
          if (!speaking) {
            this.setState('speaking');
            speaking = true;
          }
        }

        this.trackAssistantOutput(chunk);
        this.events.emit('audio', {
          data: chunk,
          sampleRate: AUDIO_SAMPLE_RATE,
          format: 'pcm16',
        });

        // Only release buffered spoken words when actual speech onset is detected.
        // This avoids advancing highlight during leading TTS silence.
        if (onsetDetectedInChunk) {
          drainSpokenWordBuffer();
        }

        // Yield briefly to avoid starving the event loop, but do NOT sleep
        // for the full chunk duration.  The browser's AudioContext handles
        // precise real-time scheduling; the server just needs to deliver
        // chunks promptly.  Sleeping for the full 100ms per chunk means any
        // jitter (event loop, GC, network) causes the browser to run out
        // of pre-scheduled audio → scheduling reset → audible gaps ("drrrrrr").
        await sleep(20);
        return true;
      };

      const enqueueAudio = (payload: Uint8Array | ArrayBuffer): void => {
        audioPipeline = audioPipeline.then(async () => {
          const bytes =
            payload instanceof ArrayBuffer
              ? new Uint8Array(payload)
              : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
          const copied = new Uint8Array(bytes.byteLength);
          copied.set(bytes);
          const chunks = chunkArrayBuffer(copied.buffer, PCM_BYTES_PER_100MS);
          for (const chunk of chunks) {
            if (aborted) return;
            const keepGoing = await emitChunk(chunk);
            if (!keepGoing) {
              aborted = true;
              this.closeDeepgramTtsConnection();
              return;
            }
          }
        });
      };

      const requestFlush = (): void => {
        if (!this.isTurnCurrent(turnGeneration) || pendingChars <= 0) return;
        const flushText = pendingText;
        connection.sendText(flushText);
        flushTextQueue.push(flushText);
        pendingText = '';
        pendingChars = 0;
        expectedFlushes += 1;
        spokeAudio = true;
        connection.flush();
      };

      const onAudio = (payload: unknown): void => {
        const binary = toRawDataUint8Array(payload);
        if (!binary || binary.byteLength === 0) return;
        lastAudioAtMs = Date.now();
        enqueueAudio(binary);
        if (sendingComplete) {
          armFlushFallback();
        }
      };

      const onFlushed = (): void => {
        const flushedText = flushTextQueue.shift() ?? '';
        updatePlaybackOnFlush(flushedText);
        receivedFlushes += 1;
        maybeResolve();
      };

      const onWarning = (event: unknown): void => {
        const warning = this.toDeepgramLiveError(event, 'Deepgram websocket TTS warning');
        this.events.emit('error', warning);
      };

      const onClose = (): void => {
        if (settled) return;
        if (!this.isTurnCurrent(turnGeneration)) {
          resolveOnce();
          return;
        }
        if (sendingComplete) {
          drainPendingFlushQueue();
          if (receivedFlushes < expectedFlushes) {
            receivedFlushes = expectedFlushes;
            forceReconnectAfterTurn = true;
          }
          maybeResolve();
          return;
        }
        rejectOnce(new Error('Deepgram websocket TTS closed before flush completed'));
      };

      const onError = (event: unknown): void => {
        if (settled) return;
        if (!this.isTurnCurrent(turnGeneration)) {
          resolveOnce();
          return;
        }
        const error = this.toDeepgramLiveError(event, 'Deepgram websocket TTS error');
        this.closeDeepgramTtsConnection();
        rejectOnce(error);
      };

      connection.on(LiveTTSEvents.Audio, onAudio);
      connection.on(LiveTTSEvents.Flushed, onFlushed);
      connection.on(LiveTTSEvents.Warning, onWarning);
      connection.on(LiveTTSEvents.Close, onClose);
      connection.on(LiveTTSEvents.Error, onError);

      void (async () => {
        try {
          for await (const delta of textStream) {
            if (!this.isTurnCurrent(turnGeneration)) {
              aborted = true;
              this.closeDeepgramTtsConnection();
              break;
            }
            if (!delta) continue;
            assistantText += delta;
            this.events.emit('transcriptDelta', delta, 'assistant', assistantId);

            // Buffer words from LLM tokens and emit complete-word chunks.
            // Before the first audio chunk, chunks stay buffered so playbackMs
            // remains truthful once emitted.
            if (spokenStreamEnabled) {
              const completeWords = spokenWordBuffer.ingestDelta(delta);
              if (completeWords) {
                emitSpokenWord(completeWords);
              }
            }

            pendingText += delta;
            pendingChars += delta.length;

            if (punctuationChunkingEnabled) {
              // Chunked mode: flush at natural boundaries for lower latency
              // at the cost of prosodic continuity between segments.
              if (
                shouldFlushDeepgramStream(
                  delta,
                  pendingChars,
                  expectedFlushes,
                  true
                )
              ) {
                requestFlush();
              }
            } else {
              // Continuous mode (per Deepgram docs): stream every LLM token
              // directly to Deepgram via sendText WITHOUT flushing.  Deepgram
              // buffers all Speak messages internally and synthesizes as one
              // unit when Flush is sent at the end.  This preserves prosody
              // and voice consistency across the entire response.
              // See: https://developers.deepgram.com/docs/send-llm-outputs-to-the-tts-web-socket
              connection.sendText(delta);
            }
          }

          llmDurationMs = Date.now() - llmStartedAtMs;
          sendingComplete = true;
          sendingCompleteAtMs = Date.now();

          if (!aborted && (pendingChars > 0 || expectedFlushes === 0)) {
            if (!punctuationChunkingEnabled) {
              // Continuous mode: text was already streamed per-token via
              // sendText during the loop above.  Only flush to trigger
              // synthesis — do NOT re-send the text via requestFlush().
              flushTextQueue.push(pendingText);
              pendingText = '';
              pendingChars = 0;
              expectedFlushes += 1;
              spokeAudio = true;
              connection.flush();
            } else {
              // Chunked mode: send any remaining buffered text + flush.
              requestFlush();
            }
          }

          maybeResolve();
          armFlushFallback();
        } catch (error) {
          this.closeDeepgramTtsConnection();
          if (this.isAbortError(error) || !this.isTurnCurrent(turnGeneration)) {
            aborted = true;
            resolveOnce();
            return;
          }
          rejectOnce(this.toDeepgramLiveError(error, 'Deepgram websocket TTS stream failed'));
        }
      })();
    });

    this.emitLatency({
      stage: 'tts',
      durationMs: Date.now() - ttsStartedAtMs,
      provider: this.options.ttsProvider,
      model: this.options.ttsModel || this.options.ttsVoice,
      details: {
        textChars: assistantText.length,
        audioBytes: emittedAudioBytes,
        chunks: emittedChunks,
        firstAudioLatencyMs:
          firstAudioAtMs === null ? null : Math.max(0, firstAudioAtMs - ttsStartedAtMs),
        streaming: true,
        flushes: expectedFlushes,
        flushMode: punctuationChunkingEnabled ? 'punctuation' : 'size-threshold',
      },
    });

    if (this.isTurnCurrent(turnGeneration)) {
      this.setState('listening');
    }

    // If onset was never detected (for example near-silent output), release
    // buffered words at turn end so spoken stream events are still emitted.
    if (!speechOnsetDetected && emittedAudioBytes > 0) {
      drainSpokenWordBuffer();
    }

    // Flush remaining buffered words before spokenFinal.
    const trailingWords = spokenWordBuffer.flushRemainder();
    if (trailingWords) {
      emitSpokenWord(trailingWords);
    }

    if (spokenStreamEnabled && spokenText && this.isTurnCurrent(turnGeneration)) {
      spokenPlaybackMs = Math.floor((emittedAudioBytes / 2 / AUDIO_SAMPLE_RATE) * 1000);
      this.events.emit('spokenFinal', spokenText, 'assistant', assistantId, {
        spokenChars,
        spokenWords,
        playbackMs: spokenPlaybackMs,
        precision: 'segment',
      });
    }

    if (forceReconnectAfterTurn) {
      this.closeDeepgramTtsConnection();
    }

    return {
      text: assistantText,
      spokenText,
      spokeAudio,
      llmDurationMs,
      interrupted: !this.isTurnCurrent(turnGeneration),
    };
  }

  private async *generateAssistantTextStream(
    systemPrompt: string,
    signal: AbortSignal
  ): AsyncGenerator<string> {
    if (!this.options) return;

    if (this.supportsLlmRuntimePath()) {
      yield* this.generateAssistantTextStreamViaLlmRuntime(systemPrompt, signal);
      return;
    }

    const response = await this.requestChatCompletionStream({
      messages: this.buildLlmMessages(systemPrompt),
      stream: true,
    }, signal);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.getLlmProviderDisplayName(this.options.llmProvider)} LLM failed (${response.status}): ${errorText}`
      );
    }

    if (!response.body) {
      const payload = (await response.json()) as ChatCompletionResponse;
      const fallback = extractChatCompletionText(payload);
      if (fallback) {
        yield fallback;
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;
          const payloadText = line.slice(5).trim();
          if (!payloadText || payloadText === '[DONE]') return;

          let chunk: ChatCompletionStreamChunk;
          try {
            chunk = JSON.parse(payloadText) as ChatCompletionStreamChunk;
          } catch {
            continue;
          }

          const deltaText = extractChatCompletionDeltaText(chunk);
          if (deltaText) {
            yield deltaText;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private toolsEnabled(): boolean {
    return Boolean(this.input?.toolHandler && this.input.tools && this.input.tools.length > 0);
  }

  private supportsLlmRuntimePath(): boolean {
    if (!this.options) return false;
    return (
      this.options.llmProvider === 'openrouter' ||
      this.options.llmProvider === 'openai' ||
      this.options.llmProvider === 'anthropic' ||
      this.options.llmProvider === 'google'
    );
  }

  private getLlmProviderDisplayName(provider: DecomposedOptions['llmProvider']): string {
    if (provider === 'openrouter') return 'OpenRouter';
    if (provider === 'openai') return 'OpenAI';
    if (provider === 'anthropic') return 'Anthropic';
    if (provider === 'google') return 'Google';
    return provider;
  }

  private resolveLlmRuntimeApiKey(): string | undefined {
    if (!this.options) return undefined;
    if (this.options.llmProvider === 'openrouter') return this.options.openrouterApiKey;
    if (this.options.llmProvider === 'openai') return this.options.openaiApiKey;
    if (this.options.llmProvider === 'anthropic') return this.options.anthropicApiKey;
    if (this.options.llmProvider === 'google') return this.options.googleApiKey;
    return undefined;
  }

  private getLlmRuntimeMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.history
      .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
      .map((entry) => ({
        role: entry.role as 'user' | 'assistant',
        content: entry.content,
      }));
  }

  private buildLlmRuntimeOptions(
    maxSteps?: number
  ): Record<string, unknown> {
    if (!this.options) return {};

    return {
      apiKey: this.resolveLlmRuntimeApiKey(),
      ...(typeof this.input?.temperature === 'number'
        ? { temperature: this.input.temperature }
        : {}),
      ...(typeof this.input?.maxOutputTokens === 'number'
        ? { maxOutputTokens: this.input.maxOutputTokens }
        : {}),
      ...(typeof maxSteps === 'number' ? { maxSteps } : {}),
    };
  }

  private async invokeLlmRuntimeToolHandler(
    name: string,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolCallResult | string> {
    const callId = context.callId || makeItemId('tool');
    this.events.emit('toolStart', name || 'unknown_tool', args, callId);
    const result = await this.invokeToolHandler(name, args, callId);
    this.events.emit('toolEnd', name || 'unknown_tool', result.result, callId);
    return result;
  }

  private async *generateAssistantTextStreamViaLlmRuntime(
    systemPrompt: string,
    signal: AbortSignal
  ): AsyncGenerator<string> {
    if (!this.options) return;
    const streamWithTools = this.toolsEnabled();

    const stream = decomposedLlmRuntime.stream({
      model: {
        provider: this.options.llmProvider,
        model: this.options.llmModel,
        modality: 'llm',
      },
      context: {
        systemPrompt,
        messages: this.getLlmRuntimeMessages(),
        ...(streamWithTools ? { tools: this.input?.tools } : {}),
      },
      options: this.buildLlmRuntimeOptions(streamWithTools ? 6 : undefined),
      signal,
      ...(streamWithTools
        ? {
            toolHandler: (name, args, context) =>
              this.invokeLlmRuntimeToolHandler(name, args, context),
          }
        : {}),
    });

    for await (const event of stream) {
      if (event.type === 'text-delta') {
        yield event.textDelta;
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    }
  }

  private buildLlmMessages(systemPrompt: string): LlmMessage[] {
    return [
      { role: 'system', content: systemPrompt },
      ...this.history.map((entry) => ({
        role: entry.role === 'system' ? 'user' : entry.role,
        content: entry.content,
      })),
    ];
  }

  private getLlmTools(): LlmRequestTool[] {
    if (!this.toolsEnabled()) {
      return [];
    }
    const tools: ToolDefinition[] = this.input?.tools ?? [];
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? {},
      },
    }));
  }

  private async requestChatCompletion(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const response = await this.sendChatCompletionRequest(body, signal);
    return (await response.json()) as ChatCompletionResponse;
  }

  private async requestChatCompletionStream(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Response> {
    return this.sendChatCompletionRequest(body, signal);
  }

  private async sendChatCompletionRequest(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Response> {
    if (!this.options) {
      throw new Error('Decomposed LLM options are unavailable');
    }
    const { endpoint, apiKey } = this.resolveLlmEndpointAndKey();
    const payload: Record<string, unknown> = {
      model: this.options.llmModel,
      ...body,
    };

    if (typeof this.input?.temperature === 'number') {
      payload.temperature = this.input.temperature;
    }
    if (typeof this.input?.maxOutputTokens === 'number') {
      payload.max_tokens = this.input.maxOutputTokens;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.getLlmProviderDisplayName(this.options.llmProvider)} LLM failed (${response.status}): ${errorText}`
      );
    }

    return response;
  }

  private async generateAssistantTextWithTools(
    systemPrompt: string,
    signal: AbortSignal
  ): Promise<string> {
    if (!this.options) return '';

    if (this.supportsLlmRuntimePath()) {
      const result = await decomposedLlmRuntime.complete({
        model: {
          provider: this.options.llmProvider,
          model: this.options.llmModel,
          modality: 'llm',
        },
        context: {
          systemPrompt,
          messages: this.getLlmRuntimeMessages(),
          tools: this.input?.tools,
        },
        options: this.buildLlmRuntimeOptions(6),
        toolHandler: (name, args, context) =>
          this.invokeLlmRuntimeToolHandler(name, args, context),
        signal,
      });
      return result.text.trim();
    }

    const messages: LlmMessage[] = this.buildLlmMessages(systemPrompt);
    const tools = this.getLlmTools();
    if (tools.length === 0 || !this.input?.toolHandler) {
      const payload = await this.requestChatCompletion({ messages }, signal);
      return extractChatCompletionText(payload);
    }

    const maxToolRounds = 6;

    for (let round = 0; round < maxToolRounds; round += 1) {
      const payload = await this.requestChatCompletion({
        messages,
        tools,
        tool_choice: 'auto',
      }, signal);
      const message = payload.choices?.[0]?.message;
      if (!message) {
        return '';
      }

      const assistantText = extractChatCompletionMessageText(message);
      const toolCalls = sanitizeToolCalls(message.tool_calls);
      if (toolCalls.length === 0) {
        return assistantText.trim();
      }

      messages.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const callId = typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : makeItemId('tool');
        const functionName = toolCall.function?.name?.trim() ?? '';
        const rawArguments = toolCall.function?.arguments ?? '{}';
        const parsedArguments = parseToolArgs(rawArguments);
        this.events.emit('toolStart', functionName || 'unknown_tool', parsedArguments, callId);

        const result = await this.invokeToolHandler(functionName, parsedArguments, callId);
        this.events.emit('toolEnd', functionName || 'unknown_tool', result.result, callId);

        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: result.result,
        });
      }
    }

    throw new Error('Decomposed LLM exceeded maximum tool-call rounds');
  }

  private async invokeToolHandler(
    toolName: string,
    args: Record<string, unknown>,
    callId: string
  ): Promise<ToolCallResult> {
    if (!this.input?.toolHandler) {
      return {
        invocationId: callId,
        result: `Tool handler is not configured (tool: ${toolName || 'unknown'})`,
        isError: true,
      };
    }
    if (!toolName) {
      return {
        invocationId: callId,
        result: 'Tool name is missing in model function call',
        isError: true,
      };
    }

    const startedAtMs = Date.now();
    try {
      const context: ToolCallContext = {
        providerId: this.id,
        callId,
        invocationId: callId,
        history: this.getHistoryItems(),
      };
      const rawResult = await this.input.toolHandler(toolName, args, context);
      const normalized = this.normalizeToolResult(callId, rawResult);
      this.emitLatency({
        stage: 'tool',
        durationMs: Date.now() - startedAtMs,
        provider: this.options?.llmProvider,
        model: this.options?.llmModel,
        details: { toolName, callId, isError: normalized.isError === true },
      });
      return normalized;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Tool execution failed';
      this.emitLatency({
        stage: 'tool',
        durationMs: Date.now() - startedAtMs,
        provider: this.options?.llmProvider,
        model: this.options?.llmModel,
        details: { toolName, callId, isError: true, message },
      });
      return {
        invocationId: callId,
        result: `Tool ${toolName} failed: ${message}`,
        isError: true,
        errorMessage: message,
      };
    }
  }

  private normalizeToolResult(callId: string, result: ToolCallResult | string): ToolCallResult {
    if (typeof result === 'string') {
      return {
        invocationId: callId,
        result,
      };
    }

    const resultText =
      typeof result.result === 'string' ? result.result : safeStringify(result.result);

    return {
      ...result,
      invocationId: callId,
      result: resultText,
    };
  }

  private resolveLlmEndpointAndKey(): { endpoint: string; apiKey: string } {
    if (!this.options) {
      throw new Error('Decomposed LLM options are unavailable');
    }
    if (
      this.options.llmProvider !== 'openrouter' &&
      this.options.llmProvider !== 'openai'
    ) {
      throw new Error(
        `Legacy chat-completions path is only available for openai/openrouter, received ${this.options.llmProvider}`
      );
    }

    const endpoint =
      this.options.llmProvider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
    const apiKey =
      this.options.llmProvider === 'openrouter'
        ? this.options.openrouterApiKey
        : this.options.openaiApiKey;

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.options.llmProvider} decomposed LLM provider`);
    }

    return { endpoint, apiKey };
  }

  private scheduleIncompleteTurnReprompt(marker: TurnMarker): void {
    if (!this.options || !this.connected || this.processingTurn) return;
    this.clearCompletionTimer();

    const timeoutMs = marker === '○' ? this.options.llmShortTimeoutMs : this.options.llmLongTimeoutMs;
    const reprompt = marker === '○' ? this.options.llmShortReprompt : this.options.llmLongReprompt;

    console.log(`[DecomposedAdapter] Scheduling re-engagement in ${timeoutMs}ms (marker: ${marker}, reprompt: "${reprompt}")`);

    this.completionTimer = setTimeout(() => {
      if (!this.connected || this.processingTurn) return;
      console.log(`[DecomposedAdapter] Re-engagement fired — reprompting with: "${reprompt}"`);
      void this.enqueueAssistantTurn(reprompt, {
        emitUserTranscript: false,
      });
    }, timeoutMs);
  }

  private async speak(
    text: string,
    turnGeneration: number,
    assistantId?: string
  ): Promise<void> {
    if (!this.options || !this.isTurnCurrent(turnGeneration)) return;
    this.setState('speaking');
    const spokenText = text.trim();
    const segmentPlayback = await this.speakSegment(text, turnGeneration);
    const playbackMs = segmentPlayback.playbackMs;

    if (
      this.options.spokenStreamEnabled &&
      spokenText &&
      assistantId &&
      this.isTurnCurrent(turnGeneration)
    ) {
      const spokenChars = spokenText.length;
      const spokenWords = countWords(spokenText);
      this.events.emit('spokenDelta', spokenText, 'assistant', assistantId, {
        spokenChars,
        spokenWords,
        playbackMs,
        precision: segmentPlayback.precision,
        wordTimestamps: segmentPlayback.wordTimestamps,
        wordTimestampsTimeBase: segmentPlayback.wordTimestampsTimeBase,
      });
      this.events.emit('spokenProgress', assistantId, {
        spokenChars,
        spokenWords,
        playbackMs,
        precision: 'segment',
      });
      this.events.emit('spokenFinal', spokenText, 'assistant', assistantId, {
        spokenChars,
        spokenWords,
        playbackMs,
        precision: segmentPlayback.precision,
        wordTimestamps: segmentPlayback.wordTimestamps,
        wordTimestampsTimeBase: segmentPlayback.wordTimestampsTimeBase,
      });
    }

    if (this.isTurnCurrent(turnGeneration)) {
      this.setState('listening');
    }
  }

  private async speakSegment(
    text: string,
    turnGeneration: number,
    details?: {
      segmentIndex?: number;
      onFirstAudio?: () => void;
    }
  ): Promise<SegmentPlaybackResult> {
    if (!this.options || !this.isTurnCurrent(turnGeneration)) {
      return { playbackMs: 0, precision: 'segment' };
    }
    const ttsStartMs = Date.now();
    const ttsController = this.beginTtsRequest();
    const { onFirstAudio, ...latencyDetails } = details ?? {};
    let emittedAudioBytes = 0;
    let emittedChunks = 0;
    let firstAudioAtMs: number | null = null;
    let emittedPlaybackMs = 0;
    let chunkIndex = 0;
    let firstChunkArrivedAtMs: number | null = null;
    let firstChunkEmittedAtMs: number | null = null;
    let lastChunkArrivedAtMs: number | null = null;
    let producerAudioMs = 0;
    let worstPlayoutLeadMs = Number.POSITIVE_INFINITY;
    let underrunChunks = 0;
    let finalPlayoutLeadMs = 0;
    let cumulativeGapDeficitMs = 0;
    let maxGapDeficitMs = 0;
    let chunksWithGapDeficit = 0;
    const isAdaptiveLocalQwenTts =
      this.options.ttsProvider === 'local' &&
      this.options.localQwenAdaptiveUnderrunEnabled &&
      isQwenTtsModelId(this.options.ttsModel);
    const configuredIntervalMs =
      clampNumber(
        this.options.localTtsStreamingIntervalSec,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX
      ) * 1000;
    const predictedSegmentAudioMs = Math.max(
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS * 2,
      Math.round(text.length * this.localQwenAdaptiveAudioMsPerChar)
    );
    const predictedDeficitMsFromEma =
      Math.max(0, this.localQwenAdaptiveProducerRtfEma - 1) * predictedSegmentAudioMs;
    const startupFloorFromIntervalMs = Math.round(
      configuredIntervalMs * LOCAL_QWEN_ADAPTIVE_BOOTSTRAP_INTERVAL_MULTIPLIER
    );
    const localQwenAdaptiveState = isAdaptiveLocalQwenTts
      ? {
          startupBufferMs: clampNumber(
            Math.max(
              this.localQwenAdaptiveStartBufferMs,
              startupFloorFromIntervalMs,
              Math.round(LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS + predictedDeficitMsFromEma)
            ),
            LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
            LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
          ),
          intervalSec: clampNumber(
            this.localQwenAdaptiveIntervalSec,
            LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
            LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX
          ),
          released: false,
          releaseAtMs: null as number | null,
          emittedSinceReleaseMs: 0,
          startupBufferedAudioMs: 0,
          predictedSegmentAudioMs,
          queuedChunks: [] as Array<{ chunk: ArrayBuffer; audioMs: number; arrivedAtMs: number }>,
        }
      : null;
    let synthesisResult: SegmentSynthesisResult | null = null;

    const emitAudioChunk = async (
      chunk: ArrayBuffer,
      chunkAudioMs: number,
      arrivedAtMs: number
    ): Promise<boolean> => {
      if (!this.isTurnCurrent(turnGeneration)) {
        return false;
      }

      emittedAudioBytes += chunk.byteLength;
      emittedChunks += 1;
      emittedPlaybackMs += chunkAudioMs;
      chunkIndex += 1;

      const emittedAtMs = Date.now();
      if (firstAudioAtMs === null) {
        firstAudioAtMs = emittedAtMs;
        onFirstAudio?.();
      }
      if (firstChunkEmittedAtMs === null) {
        firstChunkEmittedAtMs = emittedAtMs;
      }

      const interChunkGapMs =
        lastChunkArrivedAtMs === null ? null : Math.max(0, arrivedAtMs - lastChunkArrivedAtMs);
      lastChunkArrivedAtMs = arrivedAtMs;
      const gapDeficitMs =
        interChunkGapMs === null ? 0 : Math.max(0, interChunkGapMs - chunkAudioMs);
      if (gapDeficitMs > 0) {
        cumulativeGapDeficitMs += gapDeficitMs;
        maxGapDeficitMs = Math.max(maxGapDeficitMs, gapDeficitMs);
        chunksWithGapDeficit += 1;
      }

      if (localQwenAdaptiveState && localQwenAdaptiveState.releaseAtMs !== null) {
        localQwenAdaptiveState.emittedSinceReleaseMs += chunkAudioMs;
        const elapsedSinceReleaseMs = Math.max(
          0,
          emittedAtMs - localQwenAdaptiveState.releaseAtMs
        );
        const playoutLeadMs =
          localQwenAdaptiveState.emittedSinceReleaseMs - elapsedSinceReleaseMs;
        finalPlayoutLeadMs = playoutLeadMs;
        worstPlayoutLeadMs = Math.min(worstPlayoutLeadMs, playoutLeadMs);
        if (playoutLeadMs < LOCAL_QWEN_ADAPTIVE_UNDERRUN_THRESHOLD_MS) {
          underrunChunks += 1;
        }
      }

      const producerElapsedMs = Math.max(0, arrivedAtMs - ttsStartMs);
      const producerRtf =
        producerAudioMs > 0 ? producerElapsedMs / producerAudioMs : 0;

      this.emitLatency({
        stage: 'tts',
        durationMs: producerElapsedMs,
        provider: this.options?.ttsProvider,
        model: this.options?.ttsModel || this.options?.ttsVoice,
        details: {
          metric: 'chunk',
          chunkIndex,
          chunkAudioMs: Math.round(chunkAudioMs),
          chunkBytes: chunk.byteLength,
          firstChunkTtfbMs:
            firstChunkArrivedAtMs === null
              ? null
              : Math.max(0, firstChunkArrivedAtMs - ttsStartMs),
          firstChunkEmitLatencyMs:
            firstChunkEmittedAtMs === null
              ? null
              : Math.max(0, firstChunkEmittedAtMs - ttsStartMs),
          producerElapsedMs,
          producerAudioMs: Math.round(producerAudioMs),
          producerRtf: roundTo(producerRtf, 3),
          interChunkGapMs,
          gapDeficitMs: Math.round(gapDeficitMs),
          cumulativeGapDeficitMs: Math.round(cumulativeGapDeficitMs),
          emittedAudioMs: Math.round(emittedPlaybackMs),
          playoutLeadMs: Math.round(finalPlayoutLeadMs),
          adaptiveIntervalSec: localQwenAdaptiveState?.intervalSec ?? null,
          adaptiveStartupBufferMs: localQwenAdaptiveState?.startupBufferMs ?? null,
          segmentIndex: latencyDetails.segmentIndex,
        },
      });

      this.trackAssistantOutput(chunk);
      this.events.emit('audio', {
        data: chunk,
        sampleRate: AUDIO_SAMPLE_RATE,
        format: 'pcm16',
      });

      if (!localQwenAdaptiveState) {
        await sleep(20);
      }
      return true;
    };

    const emitChunk = async (chunk: ArrayBuffer): Promise<boolean> => {
      if (!this.isTurnCurrent(turnGeneration)) {
        return false;
      }
      const nowMs = Date.now();
      if (firstChunkArrivedAtMs === null) {
        firstChunkArrivedAtMs = nowMs;
      }

      const chunkAudioMs = (chunk.byteLength / 2 / AUDIO_SAMPLE_RATE) * 1000;
      producerAudioMs += chunkAudioMs;

      if (localQwenAdaptiveState && !localQwenAdaptiveState.released) {
        localQwenAdaptiveState.queuedChunks.push({
          chunk,
          audioMs: chunkAudioMs,
          arrivedAtMs: nowMs,
        });
        localQwenAdaptiveState.startupBufferedAudioMs += chunkAudioMs;

        const elapsedSinceFirstChunkMs = Math.max(
          0,
          nowMs - (firstChunkArrivedAtMs ?? nowMs)
        );
        const producerElapsedMs = Math.max(0, nowMs - ttsStartMs);
        const producerRtf =
          producerAudioMs > 0 ? producerElapsedMs / producerAudioMs : 0;
        const projectedDeficitMs =
          Math.max(0, producerRtf - 1) * localQwenAdaptiveState.predictedSegmentAudioMs;
        const targetFromRtf =
          LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS + projectedDeficitMs;
        localQwenAdaptiveState.startupBufferMs = clampNumber(
          Math.round(
            localQwenAdaptiveState.startupBufferMs * 0.6 + targetFromRtf * 0.4
          ),
          LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
          LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
        );
        const startupWaitCapMs = Math.min(
          LOCAL_QWEN_ADAPTIVE_START_BUFFER_WAIT_CAP_MS,
          Math.max(1200, Math.round(localQwenAdaptiveState.startupBufferMs + 400))
        );

        const shouldRelease =
          localQwenAdaptiveState.startupBufferedAudioMs >=
            localQwenAdaptiveState.startupBufferMs ||
          elapsedSinceFirstChunkMs >= startupWaitCapMs;

        if (!shouldRelease) {
          return true;
        }

        localQwenAdaptiveState.released = true;
        localQwenAdaptiveState.releaseAtMs = Date.now();
        this.emitLatency({
          stage: 'tts',
          durationMs: Math.max(0, localQwenAdaptiveState.releaseAtMs - ttsStartMs),
          provider: this.options?.ttsProvider,
          model: this.options?.ttsModel || this.options?.ttsVoice,
          details: {
            metric: 'startup-release',
            startupBufferedAudioMs: Math.round(
              localQwenAdaptiveState.startupBufferedAudioMs
            ),
            adaptiveStartupBufferMs: localQwenAdaptiveState.startupBufferMs,
            elapsedSinceFirstChunkMs: Math.round(elapsedSinceFirstChunkMs),
            startupWaitCapMs,
            predictedSegmentAudioMs: localQwenAdaptiveState.predictedSegmentAudioMs,
            adaptiveIntervalSec: localQwenAdaptiveState.intervalSec,
            segmentIndex: latencyDetails.segmentIndex,
          },
        });

        while (localQwenAdaptiveState.queuedChunks.length > 0) {
          const queued = localQwenAdaptiveState.queuedChunks.shift();
          if (!queued) break;
          const keepGoing = await emitAudioChunk(
            queued.chunk,
            queued.audioMs,
            queued.arrivedAtMs
          );
          if (!keepGoing) {
            return false;
          }
        }
        return true;
      }

      return emitAudioChunk(chunk, chunkAudioMs, nowMs);
    };

    try {
      if (this.options.ttsProvider === 'deepgram') {
        await this.speakWithDeepgram(text, emitChunk, turnGeneration);
      } else {
        synthesisResult = await synthesizeTtsSegment({
          text,
          context: {
            provider: this.options.ttsProvider,
            model: this.options.ttsModel,
            voice: this.options.ttsVoice,
            language: this.options.language,
            openaiApiKey: this.options.openaiApiKey,
            deepgramApiKey: this.options.deepgramApiKey,
            googleApiKey: this.options.googleApiKey,
            cartesiaApiKey: this.options.cartesiaApiKey,
            fishAudioApiKey: this.options.fishAudioApiKey,
            rimeApiKey: this.options.rimeApiKey,
            kokoroEndpoint: this.options.kokoroEndpoint,
            pocketTtsEndpoint: this.options.pocketTtsEndpoint,
            localEndpoint: this.options.localEndpoint,
            localTtsStreamingIntervalSec:
              this.options.ttsProvider === 'local' &&
              isQwenTtsModelId(this.options.ttsModel)
                ? this.localQwenAdaptiveIntervalSec
                : this.options.localTtsStreamingIntervalSec,
            googleChirpEndpoint: this.options.googleChirpEndpoint,
            cartesiaTtsWsUrl: this.options.cartesiaTtsWsUrl,
            fishTtsWsUrl: this.options.fishTtsWsUrl,
            rimeTtsWsUrl: this.options.rimeTtsWsUrl,
          },
          emitChunk,
          signal: ttsController.signal,
        });
      }
    } finally {
      this.clearTtsRequest(ttsController);
    }

    if (
      localQwenAdaptiveState &&
      localQwenAdaptiveState.released &&
      localQwenAdaptiveState.queuedChunks.length > 0
    ) {
      while (localQwenAdaptiveState.queuedChunks.length > 0) {
        const queued = localQwenAdaptiveState.queuedChunks.shift();
        if (!queued) break;
        const keepGoing = await emitAudioChunk(
          queued.chunk,
          queued.audioMs,
          queued.arrivedAtMs
        );
        if (!keepGoing) {
          break;
        }
      }
    }

    if (!this.isTurnCurrent(turnGeneration)) {
      return {
        playbackMs: emittedPlaybackMs,
        precision: synthesisResult?.precision ?? 'segment',
        wordTimestamps: synthesisResult?.wordTimestamps,
        wordTimestampsTimeBase: synthesisResult?.wordTimestampsTimeBase,
      };
    }

    if (localQwenAdaptiveState) {
      const producerElapsedMs =
        lastChunkArrivedAtMs === null ? 0 : Math.max(0, lastChunkArrivedAtMs - ttsStartMs);
      const producerRtf =
        producerAudioMs > 0 ? producerElapsedMs / producerAudioMs : 0;

      this.localQwenAdaptiveProducerRtfEma = roundTo(
        clampNumber(
          this.localQwenAdaptiveProducerRtfEma * (1 - LOCAL_QWEN_ADAPTIVE_RTF_EMA_ALPHA) +
            producerRtf * LOCAL_QWEN_ADAPTIVE_RTF_EMA_ALPHA,
          0.7,
          3.0
        ),
        3
      );
      if (text.length > 0 && emittedPlaybackMs > 0) {
        const observedAudioMsPerChar = emittedPlaybackMs / text.length;
        this.localQwenAdaptiveAudioMsPerChar = roundTo(
          clampNumber(
            this.localQwenAdaptiveAudioMsPerChar *
              (1 - LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_EMA_ALPHA) +
              observedAudioMsPerChar * LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_EMA_ALPHA,
            LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MIN,
            LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MAX
          ),
          2
        );
      }

      const requiredBufferFromDeficit =
        cumulativeGapDeficitMs + LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS;
      const requiredBufferFromRtf =
        producerRtf > 1
          ? (producerRtf - 1) * emittedPlaybackMs + LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS
          : LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS;
      const projectedNextAudioMs = Math.max(
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS * 2,
        Math.round(text.length * this.localQwenAdaptiveAudioMsPerChar)
      );
      const requiredBufferFromRtfEma =
        Math.max(0, this.localQwenAdaptiveProducerRtfEma - 1) * projectedNextAudioMs +
        LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS;
      const suggestedStartupBufferMs = Math.max(
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
        requiredBufferFromDeficit,
        requiredBufferFromRtf,
        requiredBufferFromRtfEma
      );

      this.localQwenAdaptiveStartBufferMs = clampNumber(
        Math.round(
          this.localQwenAdaptiveStartBufferMs * 0.25 + suggestedStartupBufferMs * 0.75
        ),
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
      );

      if (
        chunksWithGapDeficit === 0 &&
        producerRtf < 0.95 &&
        finalPlayoutLeadMs > LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS * 2
      ) {
        this.localQwenAdaptiveStartBufferMs = clampNumber(
          this.localQwenAdaptiveStartBufferMs - 40,
          LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
          LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
        );
      }

      const baseInterval = clampNumber(
        this.options.localTtsStreamingIntervalSec,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX
      );
      const intervalMin = Math.max(
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
        roundTo(baseInterval - 0.25, 2)
      );
      const intervalMax = Math.min(
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX,
        roundTo(baseInterval + 2.0, 2)
      );
      const gapPressure =
        emittedPlaybackMs > 0 ? cumulativeGapDeficitMs / emittedPlaybackMs : 0;
      const rtfPressure = Math.max(0, producerRtf - 1);
      const increaseBy = Math.min(
        0.45,
        Math.max(
          LOCAL_QWEN_ADAPTIVE_INTERVAL_STEP,
          rtfPressure * 0.9 + gapPressure * 0.8
        )
      );
      const adjustedInterval =
        chunksWithGapDeficit > 0 || producerRtf > 1.01
          ? localQwenAdaptiveState.intervalSec + increaseBy
          : chunksWithGapDeficit === 0 && producerRtf < 0.9
            ? localQwenAdaptiveState.intervalSec - LOCAL_QWEN_ADAPTIVE_INTERVAL_STEP
            : localQwenAdaptiveState.intervalSec;
      this.localQwenAdaptiveIntervalSec = roundTo(
        clampNumber(
          adjustedInterval,
          intervalMin,
          intervalMax
        ),
        2
      );

      this.emitLatency({
        stage: 'tts',
        durationMs: Math.max(0, Date.now() - ttsStartMs),
        provider: this.options.ttsProvider,
        model: this.options.ttsModel || this.options.ttsVoice,
        details: {
          metric: 'adaptive-update',
          producerRtf: roundTo(producerRtf, 3),
          worstPlayoutLeadMs:
            worstPlayoutLeadMs === Number.POSITIVE_INFINITY
              ? null
              : Math.round(worstPlayoutLeadMs),
          finalPlayoutLeadMs: Math.round(finalPlayoutLeadMs),
          underrunChunks,
          chunksWithGapDeficit,
          cumulativeGapDeficitMs: Math.round(cumulativeGapDeficitMs),
          maxGapDeficitMs: Math.round(maxGapDeficitMs),
          suggestedStartupBufferMs: Math.round(suggestedStartupBufferMs),
          requiredBufferFromRtfEma: Math.round(requiredBufferFromRtfEma),
          adaptiveProducerRtfEma: this.localQwenAdaptiveProducerRtfEma,
          adaptiveAudioMsPerChar: this.localQwenAdaptiveAudioMsPerChar,
          nextStreamingIntervalSec: this.localQwenAdaptiveIntervalSec,
          nextStartupBufferMs: Math.round(this.localQwenAdaptiveStartBufferMs),
          segmentIndex: latencyDetails.segmentIndex,
        },
      });
    }

    this.emitLatency({
      stage: 'tts',
      durationMs: Date.now() - ttsStartMs,
      provider: this.options.ttsProvider,
      model: this.options.ttsModel || this.options.ttsVoice,
      details: {
        textChars: text.length,
        audioBytes: emittedAudioBytes,
        chunks: emittedChunks,
        firstAudioLatencyMs:
          firstAudioAtMs === null ? null : Math.max(0, firstAudioAtMs - ttsStartMs),
        firstChunkTtfbMs:
          firstChunkArrivedAtMs === null
            ? null
            : Math.max(0, firstChunkArrivedAtMs - ttsStartMs),
        producerRtf:
          producerAudioMs > 0 && lastChunkArrivedAtMs !== null
            ? roundTo(
                Math.max(0, lastChunkArrivedAtMs - ttsStartMs) / producerAudioMs,
                3
              )
            : null,
        underrunChunks,
        adaptiveStartupBufferMs: localQwenAdaptiveState
          ? Math.round(this.localQwenAdaptiveStartBufferMs)
          : null,
        adaptiveStreamingIntervalSec: localQwenAdaptiveState
          ? this.localQwenAdaptiveIntervalSec
          : null,
        ...latencyDetails,
      },
    });
    return {
      playbackMs: emittedPlaybackMs,
      precision: synthesisResult?.precision ?? 'segment',
      wordTimestamps: synthesisResult?.wordTimestamps,
      wordTimestampsTimeBase: synthesisResult?.wordTimestampsTimeBase,
    };
  }

  private async speakWithDeepgram(
    text: string,
    emitChunk: (chunk: ArrayBuffer) => Promise<boolean>,
    turnGeneration: number
  ): Promise<void> {
    if (!this.options) {
      return;
    }
    if (!this.options.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed TTS');
    }
    if (this.options.deepgramTtsTransport !== 'websocket') {
      throw new Error('Decomposed Deepgram TTS requires websocket transport (no HTTP fallback).');
    }

    const request = this.deepgramTtsRequestQueue.then(async () => {
      if (!this.isTurnCurrent(turnGeneration)) return;
      await this.speakWithDeepgramLiveSegment(text, emitChunk, turnGeneration);
    });
    this.deepgramTtsRequestQueue = request.catch(() => {});
    await request;
  }

  private async speakWithDeepgramLiveSegment(
    text: string,
    emitChunk: (chunk: ArrayBuffer) => Promise<boolean>,
    turnGeneration: number
  ): Promise<void> {
    const connection = await this.ensureDeepgramTtsConnection();
    if (!this.isTurnCurrent(turnGeneration)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let flushReceived = false;
      let aborted = false;
      let audioPipeline: Promise<void> = Promise.resolve();
      const segmentTimeout = setTimeout(() => {
        this.closeDeepgramTtsConnection();
        rejectOnce(new Error('Deepgram websocket TTS segment timed out waiting for flush'));
      }, 10000);

      const cleanup = (): void => {
        clearTimeout(segmentTimeout);
        connection.off(LiveTTSEvents.Audio, onAudio);
        connection.off(LiveTTSEvents.Flushed, onFlushed);
        connection.off(LiveTTSEvents.Warning, onWarning);
        connection.off(LiveTTSEvents.Close, onClose);
        connection.off(LiveTTSEvents.Error, onError);
      };

      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const maybeResolve = (): void => {
        if (settled) return;
        if (aborted) {
          resolveOnce();
          return;
        }
        if (!flushReceived) {
          return;
        }
        void audioPipeline.then(() => resolveOnce()).catch((error) => {
          rejectOnce(error as Error);
        });
      };

      const enqueueAudio = (payload: ArrayBuffer | Uint8Array): void => {
        audioPipeline = audioPipeline.then(async () => {
          const bytes =
            payload instanceof ArrayBuffer
              ? new Uint8Array(payload)
              : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
          const copied = new Uint8Array(bytes.byteLength);
          copied.set(bytes);
          const audioBuffer = copied.buffer;

          const chunks = chunkArrayBuffer(audioBuffer, PCM_BYTES_PER_100MS);
          for (const chunk of chunks) {
            if (aborted) return;
            const keepGoing = await emitChunk(chunk);
            if (!keepGoing) {
              aborted = true;
              this.closeDeepgramTtsConnection();
              return;
            }
          }
        });
      };

      const onAudio = (payload: unknown): void => {
        const binary = toRawDataUint8Array(payload);
        if (binary) {
          enqueueAudio(binary);
        }
      };

      const onFlushed = (): void => {
        flushReceived = true;
        maybeResolve();
      };

      const onWarning = (event: unknown): void => {
        if (settled) return;
        const error = this.toDeepgramLiveError(event, 'Deepgram websocket TTS warning');
        this.closeDeepgramTtsConnection();
        rejectOnce(error);
      };

      const onClose = (): void => {
        if (settled) return;
        if (!this.isTurnCurrent(turnGeneration)) {
          resolveOnce();
          return;
        }
        rejectOnce(new Error('Deepgram websocket TTS closed before flush completed'));
      };

      const onError = (event: unknown): void => {
        if (settled) return;
        if (!this.isTurnCurrent(turnGeneration)) {
          resolveOnce();
          return;
        }
        const error = this.toDeepgramLiveError(event, 'Deepgram websocket TTS error');
        this.closeDeepgramTtsConnection();
        rejectOnce(error);
      };

      connection.on(LiveTTSEvents.Audio, onAudio);
      connection.on(LiveTTSEvents.Flushed, onFlushed);
      connection.on(LiveTTSEvents.Warning, onWarning);
      connection.on(LiveTTSEvents.Close, onClose);
      connection.on(LiveTTSEvents.Error, onError);

      try {
        connection.sendText(text);
        connection.flush();
      } catch (error) {
        this.closeDeepgramTtsConnection();
        rejectOnce(this.toDeepgramLiveError(error, 'Deepgram websocket TTS send failed'));
        return;
      }
    });
  }

  private async ensureDeepgramTtsConnection(): Promise<SpeakLiveClient> {
    if (!this.options?.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed TTS');
    }

    if (this.deepgramTtsConnection && this.deepgramTtsConnection.isConnected()) {
      return this.deepgramTtsConnection;
    }

    if (this.deepgramTtsConnectionReady) {
      return this.deepgramTtsConnectionReady;
    }

    const connectPromise = new Promise<SpeakLiveClient>((resolve, reject) => {
      if (!this.options?.deepgramApiKey) {
        reject(new Error('Deepgram API key is missing for decomposed TTS'));
        return;
      }

      const connectionTimeout = setTimeout(() => {
        this.closeDeepgramTtsConnection();
        rejectOnce(new Error('Deepgram websocket TTS connect timed out'));
      }, 10000);

      const model = this.options.ttsModel || this.options.ttsVoice;
      const connection = this.createDeepgramTtsConnection(
        this.options.deepgramApiKey,
        model,
        this.options.deepgramTtsWsUrl
      );

      let settled = false;
      const cleanup = (): void => {
        clearTimeout(connectionTimeout);
        connection.off(LiveTTSEvents.Open, onOpen);
        connection.off(LiveTTSEvents.Error, onError);
        connection.off(LiveTTSEvents.Close, onCloseBeforeOpen);
      };

      const resolveOnce = (client: SpeakLiveClient): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(client);
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onOpen = (): void => {
        this.deepgramTtsConnection = connection;

        connection.on(LiveTTSEvents.Close, () => {
          if (this.deepgramTtsConnection === connection) {
            this.deepgramTtsConnection = null;
          }
        });

        resolveOnce(connection);
      };

      const onError = (event: unknown): void => {
        rejectOnce(this.toDeepgramLiveError(event, 'Deepgram websocket TTS connect failed'));
      };

      const onCloseBeforeOpen = (): void => {
        rejectOnce(new Error('Deepgram websocket TTS closed before open'));
      };

      connection.once(LiveTTSEvents.Open, onOpen);
      connection.once(LiveTTSEvents.Error, onError);
      connection.once(LiveTTSEvents.Close, onCloseBeforeOpen);
    });

    this.deepgramTtsConnectionReady = connectPromise;
    try {
      return await connectPromise;
    } finally {
      if (this.deepgramTtsConnectionReady === connectPromise) {
        this.deepgramTtsConnectionReady = null;
      }
    }
  }

  private closeDeepgramTtsConnection(): void {
    const connection = this.deepgramTtsConnection;
    this.deepgramTtsConnection = null;
    this.deepgramTtsConnectionReady = null;
    if (!connection) return;
    try {
      connection.requestClose();
    } catch {
      // ignore close-send failures
    }
    try {
      connection.disconnect();
    } catch {
      // ignore close failures
    }
  }

  private createDeepgramTtsConnection(
    apiKey: string,
    model: string,
    endpoint: string
  ): SpeakLiveClient {
    const deepgram = createClient({
      key: apiKey,
    });
    return deepgram.speak.live(
      {
        model,
        encoding: 'linear16',
        sample_rate: AUDIO_SAMPLE_RATE,
        container: 'none',
      },
      endpoint
    );
  }

  private toDeepgramLiveError(event: unknown, fallback: string): Error {
    if (event instanceof Error) {
      return event;
    }

    const object = event as { message?: unknown; description?: unknown; code?: unknown } | null;
    if (object && typeof object === 'object') {
      const message =
        typeof object.message === 'string'
          ? object.message
          : typeof object.description === 'string'
            ? object.description
            : null;
      const code = typeof object.code === 'string' ? object.code : null;
      if (message && code) {
        return new Error(`${message} (code: ${code})`);
      }
      if (message) {
        return new Error(message);
      }
    }

    return new Error(fallback);
  }

  private resolveOptions(input: SessionInput): DecomposedOptions {
    const providerConfig: DecomposedProviderConfig = parseDecomposedProviderConfig(
      input.providerConfig
    );
    const ttsProvider = (providerConfig.ttsProvider ?? 'openai') as DecomposedTtsProvider;
    const ttsModel = providerConfig.ttsModel ?? defaultTtsModelForProvider(ttsProvider);

    return {
      sttProvider: providerConfig.sttProvider ?? 'openai',
      sttModel: providerConfig.sttModel ?? 'gpt-4o-mini-transcribe',
      customSttMode: providerConfig.customSttMode ?? 'provider',
      llmProvider: providerConfig.llmProvider ?? 'openai',
      llmModel: providerConfig.llmModel ?? input.model,
      ttsProvider,
      ttsModel,
      ttsVoice: providerConfig.ttsVoice ?? input.voice,
      deepgramTtsTransport: providerConfig.deepgramTtsTransport ?? 'websocket',
      deepgramTtsWsUrl: providerConfig.deepgramTtsWsUrl ?? 'wss://api.deepgram.com/v1/speak',
      deepgramTtsPunctuationChunkingEnabled:
        providerConfig.deepgramTtsPunctuationChunkingEnabled ?? true,
      inlineTtsChunkingEnabled:
        providerConfig.inlineTtsChunkingEnabled ??
        defaultInlineTtsChunkingEnabled(ttsProvider, ttsModel),
      cartesiaTtsWsUrl:
        providerConfig.cartesiaTtsWsUrl ?? 'wss://api.cartesia.ai/tts/websocket',
      fishTtsWsUrl: providerConfig.fishTtsWsUrl ?? 'wss://api.fish.audio/v1/tts/live',
      rimeTtsWsUrl: providerConfig.rimeTtsWsUrl ?? 'wss://users-ws.rime.ai/ws2',
      googleChirpEndpoint:
        providerConfig.googleChirpEndpoint ??
        'https://texttospeech.googleapis.com/v1/text:synthesize',
      kokoroEndpoint:
        providerConfig.kokoroEndpoint ?? 'http://localhost:8880/v1/audio/speech',
      pocketTtsEndpoint: providerConfig.pocketTtsEndpoint ?? 'http://localhost:8000/tts',
      localEndpoint: providerConfig.localEndpoint ?? 'http://localhost:1060',
      localTtsStreamingIntervalSec: providerConfig.localTtsStreamingIntervalSec ?? 1.0,
      localQwenAdaptiveUnderrunEnabled: providerConfig.localQwenAdaptiveUnderrunEnabled ?? true,
      silenceMs: providerConfig.turn?.silenceMs ?? 700,
      minSpeechMs: providerConfig.turn?.minSpeechMs ?? 350,
      minRms: providerConfig.turn?.minRms ?? 0.015,
      bargeInEnabled: providerConfig.turn?.bargeInEnabled ?? true,
      speechStartDebounceMs: providerConfig.turn?.speechStartDebounceMs ?? 140,
      vadEngine: providerConfig.turn?.vadEngine ?? 'webrtc-vad',
      neuralFilterEnabled: providerConfig.turn?.neuralFilterEnabled ?? true,
      rnnoiseSpeechThreshold: providerConfig.turn?.rnnoiseSpeechThreshold ?? 0.62,
      rnnoiseEchoSpeechThresholdBoost: providerConfig.turn?.rnnoiseEchoSpeechThresholdBoost ?? 0.12,
      webrtcVadMode: providerConfig.turn?.webrtcVadMode ?? 3,
      webrtcVadSpeechRatioThreshold: providerConfig.turn?.webrtcVadSpeechRatioThreshold ?? 0.7,
      webrtcVadEchoSpeechRatioBoost:
        providerConfig.turn?.webrtcVadEchoSpeechRatioBoost ?? 0.15,
      assistantOutputMinRms: providerConfig.turn?.assistantOutputMinRms ?? 0.008,
      assistantOutputSilenceMs: providerConfig.turn?.assistantOutputSilenceMs ?? 350,
      spokenStreamEnabled: providerConfig.turn?.spokenStreamEnabled ?? false,
      wordAlignmentEnabled: providerConfig.turn?.wordAlignmentEnabled ?? false,
      llmCompletionEnabled: providerConfig.turn?.llmCompletionEnabled ?? false,
      llmShortTimeoutMs: providerConfig.turn?.llmShortTimeoutMs ?? 5000,
      llmLongTimeoutMs: providerConfig.turn?.llmLongTimeoutMs ?? 10000,
      llmShortReprompt:
        providerConfig.turn?.llmShortReprompt ??
        'Can you finish that thought for me?',
      llmLongReprompt:
        providerConfig.turn?.llmLongReprompt ??
        "I'm still here. Continue when you're ready.",
      language: input.language ?? 'en',
      openaiApiKey: providerConfig.openaiApiKey,
      openrouterApiKey: providerConfig.openrouterApiKey,
      anthropicApiKey: providerConfig.anthropicApiKey,
      googleApiKey: providerConfig.googleApiKey,
      deepgramApiKey: providerConfig.deepgramApiKey,
      cartesiaApiKey: providerConfig.cartesiaApiKey,
      fishAudioApiKey: providerConfig.fishAudioApiKey,
      rimeApiKey: providerConfig.rimeApiKey,
    };
  }
}

function toRawDataUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    const views: Uint8Array[] = [];
    let total = 0;
    for (const part of value) {
      if (part instanceof Uint8Array) {
        views.push(part);
        total += part.byteLength;
      } else if (ArrayBuffer.isView(part)) {
        const view = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
        views.push(view);
        total += view.byteLength;
      } else if (part instanceof ArrayBuffer) {
        const view = new Uint8Array(part);
        views.push(view);
        total += view.byteLength;
      }
    }
    if (views.length === 0) return null;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const view of views) {
      merged.set(view, offset);
      offset += view.byteLength;
    }
    return merged;
  }
  return null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = parseJsonObject(raw);
  if (parsed) return parsed;
  return { raw };
}

function sanitizeToolCalls(value: ChatCompletionToolCall[] | undefined): ChatCompletionToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ChatCompletionToolCall[] = [];
  for (const call of value) {
    if (!call || typeof call !== 'object') continue;
    const name = call.function?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    calls.push(call);
  }
  return calls;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized;
    }
    return String(value);
  } catch {
    return String(value);
  }
}

async function* emptyAsyncGenerator(): AsyncGenerator<string> {
  // yields nothing
}

async function* singleValueGenerator(value: string): AsyncGenerator<string> {
  if (value) yield value;
}

async function* prependToAsyncGenerator(
  prefix: string,
  source: AsyncIterable<string>
): AsyncGenerator<string> {
  if (prefix) yield prefix;
  yield* source;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseMarker(
  text: string,
  markerMode: boolean
): { marker: TurnMarker; text: string } {
  const trimmed = text.trim();
  if (!markerMode || trimmed.length === 0) {
    return {
      marker: '✓',
      text: trimmed,
    };
  }

  const marker = trimmed[0] as TurnMarker;
  if (!TURN_MARKERS.includes(marker)) {
    return {
      marker: '✓',
      text: trimmed,
    };
  }

  return {
    marker,
    text: trimmed.slice(1).trimStart(),
  };
}

function makeItemId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function computeRmsPcm16(input: ArrayBuffer): number {
  const bytes = new DataView(input);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = bytes.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function encodeWavPcm16Mono(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const headerSize = 44;
  const wav = new ArrayBuffer(headerSize + pcm.byteLength);
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);

  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, headerSize);

  return wav;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    target[offset + i] = value.charCodeAt(i);
  }
}

function chunkArrayBuffer(input: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
  const bytes = new Uint8Array(input);
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.byteLength);
    chunks.push(bytes.slice(offset, end).buffer);
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractChatCompletionText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function extractChatCompletionMessageText(message: ChatCompletionMessage): string {
  const content = message.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function extractChatCompletionDeltaText(chunk: ChatCompletionStreamChunk): string {
  const content = chunk.choices?.[0]?.delta?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

function splitSpeakableText(buffer: string): { segments: string[]; remainder: string } {
  if (!buffer) {
    return { segments: [], remainder: '' };
  }

  const segments: string[] = [];
  let start = 0;
  let candidate = -1;
  const minSegmentChars = 16;
  const earlySegmentChars = 8;
  const whitespaceSegmentChars = 18;
  const forceFlushChars = 72;
  const firstSegmentForceFlushChars = 28;

  const pushSegment = (endExclusive: number): void => {
    const raw = buffer.slice(start, endExclusive).trim();
    if (raw.length > 0) {
      segments.push(raw);
    }
    start = endExclusive;
    candidate = -1;
  };

  for (let i = 0; i < buffer.length; i += 1) {
    const char = buffer[i];
    if (char === '.' || char === '!' || char === '?' || char === ';' || char === '\n') {
      candidate = i + 1;
    } else if ((char === ',' || char === ':') && i + 1 - start >= 28) {
      candidate = i + 1;
    } else if (char === ' ' && i + 1 - start >= whitespaceSegmentChars) {
      candidate = i + 1;
    }

    const minCharsForSplit = segments.length === 0 ? earlySegmentChars : minSegmentChars;
    if (candidate > start && candidate - start >= minCharsForSplit) {
      pushSegment(candidate);
      continue;
    }

    const forceLimit = segments.length === 0 ? firstSegmentForceFlushChars : forceFlushChars;
    if (i + 1 - start >= forceLimit) {
      let splitAt = buffer.lastIndexOf(' ', i);
      if (splitAt <= start) {
        splitAt = i;
      }
      pushSegment(splitAt + 1);
    }
  }

  const remainder = buffer.slice(start);
  return { segments, remainder };
}

function shouldFlushDeepgramStream(
  delta: string,
  pendingChars: number,
  completedFlushes: number,
  punctuationChunkingEnabled: boolean
): boolean {
  if (pendingChars <= 0) return false;

  if (!punctuationChunkingEnabled) {
    // Favor larger segments when punctuation chunking is disabled so speech
    // cadence sounds less stitched at seam boundaries.
    const baseThreshold = completedFlushes === 0 ? 140 : 220;
    const overflowThreshold = baseThreshold + 72;
    const hasSentenceBoundary = /[.!?;\n]/.test(delta);
    if (pendingChars < baseThreshold) return false;

    if (hasSentenceBoundary) return true;
    // Prefer chunk boundaries at whitespace when punctuation chunking is disabled.
    if (/\s/.test(delta) && pendingChars >= baseThreshold + 12) return true;
    return pendingChars >= overflowThreshold;
  }

  const hasSentenceBoundary = /[.!?;\n]/.test(delta);
  const hasMinorBoundary = /[,]/.test(delta);
  const boundaryThreshold = completedFlushes === 0 ? 24 : 64;
  const hasWhitespaceBoundary = /\s/.test(delta);

  if (hasSentenceBoundary && pendingChars >= boundaryThreshold) {
    return true;
  }
  if (completedFlushes === 0 && hasWhitespaceBoundary && pendingChars >= 32) {
    return true;
  }
  if (hasMinorBoundary && pendingChars >= 96) {
    return true;
  }
  if (completedFlushes === 0 && pendingChars >= 64) {
    return true;
  }
  if (pendingChars >= 180) {
    return true;
  }

  return false;
}

function isQwenTtsModelId(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('qwen3') || normalized.includes('qwen-tts');
}

function defaultInlineTtsChunkingEnabled(
  ttsProvider: DecomposedTtsProvider,
  ttsModel: string
): boolean {
  if (ttsProvider === 'local' && isQwenTtsModelId(ttsModel)) {
    return false;
  }
  return true;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}
