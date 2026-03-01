import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import {
  createTurnDetector,
  RnnoiseTurnDetector,
  WebRtcVadTurnDetector,
  type TurnDetector,
} from '../vad/turn-detector.js';
import type { SpeakLiveClient } from '@deepgram/sdk';
import { createLlmRuntime } from '@voiceclaw/llm-runtime';
import {
  isRealtimeStreamingTtsProvider,
} from './tts/index.js';
import {
  LOCAL_QWEN_ADAPTIVE_UNDERRUN_THRESHOLD_MS,
  AdaptiveUnderrunController,
} from './tts/adaptive-underrun.js';
import {
  DeepgramTtsConnectionManager,
  speakWithDeepgramLiveSegment as streamSpeakWithDeepgramLiveSegment,
  streamTextWithDeepgramTts as streamDeepgramStreamingTurn,
} from './tts/deepgram-streaming.js';
import type {
  DecomposedTtsProviderContext,
  SegmentSynthesisResult,
} from './tts/types.js';
import {
  resolveSharedTtsConfig,
  synthesizeWithSharedTts,
  toSharedTtsProviderContext,
  type SharedTtsConfig,
} from './shared/tts-engine.js';
import {
  DECOMPOSED_CAPABILITIES,
  DECOMPOSED_CONFIG_SCHEMA,
  type DecomposedOptions,
  resolveDecomposedOptions,
} from './decomposed-config.js';
import {
  TURN_MARKERS,
  computeRmsPcm16,
  concatUint8Arrays,
  countWords,
  emptyAsyncGenerator,
  extractChatCompletionDeltaText,
  extractChatCompletionMessageText,
  extractChatCompletionText,
  isQwenTtsModelId,
  makeItemId,
  parseMarker,
  parseToolArgs,
  prependToAsyncGenerator,
  roundTo,
  safeStringify,
  sanitizeToolCalls,
  singleValueGenerator,
  sleep,
  splitSpeakableText,
  type ChatCompletionResponse,
  type ChatCompletionStreamChunk,
  type LlmMessage,
  type LlmRequestTool,
  type TurnMarker,
} from './decomposed-utils.js';
import { transcribeWithSharedStt } from './shared/stt-engine.js';
import type {
  AudioFrame,
  AudioNegotiation,
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

const MIN_BARGE_IN_MS = 360;
const MIC_ECHO_COOLDOWN_MS = 520;
const SPEAKING_START_COOLDOWN_MS = 220;
const ASSISTANT_RMS_DECAY_MS = 420;
const LOCAL_TTS_WARMUP_TEXT = 'Ready.';
const decomposedLlmRuntime = createLlmRuntime();

type ConversationRole = 'user' | 'assistant' | 'system';

const TURN_COMPLETION_PROMPT = [
  'You must start every response with exactly one marker character:',
  '✓ when the user turn is complete and you should answer now.',
  '○ when the user seems to have paused mid-thought and likely continues soon.',
  '◐ when the user seems to be thinking and may continue after a longer pause.',
  'If you use ○ or ◐, do not include any extra text after the marker.',
  'Never explain the marker. Never output more than one marker.',
].join('\n');

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
  private localTtsWarmupAbortController: AbortController | null = null;
  private localTtsWarmupPromise: Promise<void> | null = null;
  private assistantTurnQueue: Promise<void> = Promise.resolve();
  private readonly deepgramTtsConnectionManager = new DeepgramTtsConnectionManager();
  private turnDetector: TurnDetector | null = null;
  private readonly adaptiveUnderrun = new AdaptiveUnderrunController();
  capabilities(): ProviderCapabilities {
    return DECOMPOSED_CAPABILITIES;
  }

  configSchema(): ProviderConfigSchema {
    return DECOMPOSED_CONFIG_SCHEMA;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.input = input;
    this.options = resolveDecomposedOptions(input);
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
    this.deepgramTtsConnectionManager.resetQueue();
    this.adaptiveUnderrun.reset(this.options.localTtsStreamingIntervalSec);
    this.closeDeepgramTtsConnection();
    this.cancelLocalTtsWarmup();
    this.connected = true;
    this.startLocalTtsWarmup();

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
    this.cancelLocalTtsWarmup();
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
    this.deepgramTtsConnectionManager.resetQueue();
    this.adaptiveUnderrun.reset(this.options?.localTtsStreamingIntervalSec ?? 1.0);
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
    this.deepgramTtsConnectionManager.resetQueue();
    this.closeDeepgramTtsConnection();
  }

  private cancelLocalTtsWarmup(): void {
    if (this.localTtsWarmupAbortController) {
      this.localTtsWarmupAbortController.abort();
      this.localTtsWarmupAbortController = null;
    }
    this.localTtsWarmupPromise = null;
  }

  private startLocalTtsWarmup(): void {
    if (!this.options || this.options.ttsProvider !== 'local') {
      return;
    }

    this.cancelLocalTtsWarmup();
    const warmupModel = this.options.ttsModel;
    const warmupContext = this.createTtsProviderContext(this.options.localTtsStreamingIntervalSec);
    const warmupEndpoint = this.options.localEndpoint;
    const startedAtMs = Date.now();
    const warmupController = new AbortController();
    this.localTtsWarmupAbortController = warmupController;

    let warmupPromise: Promise<void> | null = null;
    warmupPromise = this.warmupLocalTtsModel({
      model: warmupModel,
      endpoint: warmupEndpoint,
      context: warmupContext,
      signal: warmupController.signal,
    })
      .then(() => {
        const durationMs = Math.max(0, Date.now() - startedAtMs);
        this.emitLatency({
          stage: 'connection',
          durationMs,
          provider: 'local',
          model: warmupModel,
          details: {
            metric: 'ttsWarmup',
            textChars: LOCAL_TTS_WARMUP_TEXT.length,
          },
        });
        console.log(
          `[DecomposedAdapter] Local TTS warmup complete in ${durationMs}ms (model=${warmupModel})`
        );
      })
      .catch((error) => {
        if (this.isAbortError(error)) {
          return;
        }
        console.warn(
          `[DecomposedAdapter] Local TTS warmup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      })
      .finally(() => {
        if (this.localTtsWarmupAbortController === warmupController) {
          this.localTtsWarmupAbortController = null;
        }
        if (this.localTtsWarmupPromise === warmupPromise) {
          this.localTtsWarmupPromise = null;
        }
      });

    this.localTtsWarmupPromise = warmupPromise;
  }

  private async warmupLocalTtsModel(input: {
    model: string;
    endpoint: string;
    context: DecomposedTtsProviderContext;
    signal: AbortSignal;
  }): Promise<void> {
    await this.preloadLocalTtsViaModelLoadApi({
      model: input.model,
      endpoint: input.endpoint,
      signal: input.signal,
    });
    // Warm the actual synthesis path used for realtime turns.
    await this.warmupLocalTtsViaSpeechRequest({
      context: input.context,
      signal: input.signal,
    });
  }

  private async waitForLocalTtsWarmupIfNeeded(): Promise<void> {
    if (!this.options || this.options.ttsProvider !== 'local') {
      return;
    }
    const pendingWarmup = this.localTtsWarmupPromise;
    if (!pendingWarmup) {
      return;
    }
    await pendingWarmup;
  }

  private async preloadLocalTtsViaModelLoadApi(input: {
    model: string;
    endpoint: string;
    signal: AbortSignal;
  }): Promise<boolean> {
    let response: Response;
    try {
      const endpoint = new URL('/v1/models/load', input.endpoint);
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'tts',
          model: input.model,
          warmup: false,
        }),
        signal: input.signal,
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }
      return false;
    }

    if (response.ok) {
      try {
        await response.arrayBuffer();
      } catch {
        // Ignore body read errors from non-standard warmup responses.
      }
      return true;
    }

    return false;
  }

  private async warmupLocalTtsViaSpeechRequest(input: {
    context: DecomposedTtsProviderContext;
    signal: AbortSignal;
  }): Promise<void> {
    await synthesizeWithSharedTts({
      text: LOCAL_TTS_WARMUP_TEXT,
      config: this.resolveSharedTtsConfig(),
      // Drain full audio so local generators are not left mid-stream.
      emitChunk: async () => true,
      signal: input.signal,
      localTtsStreamingIntervalSec: input.context.localTtsStreamingIntervalSec,
    });
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
    stage: 'stt' | 'llm' | 'tts' | 'turn' | 'tool' | 'connection';
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
    return transcribeWithSharedStt({
      pcm,
      config: {
        provider: this.options.sttProvider,
        model: this.options.sttModel,
        language: this.options.language,
        sampleRate: AUDIO_SAMPLE_RATE,
        openaiApiKey: this.options.openaiApiKey,
        deepgramApiKey: this.options.deepgramApiKey,
        localEndpoint: this.options.localEndpoint,
      },
    });
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
        const result = await this.deepgramTtsConnectionManager.enqueueRequest(() =>
          this.streamTextWithDeepgramTts(textStream, assistantId, llmStartedAtMs, turnGeneration)
        );
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

    return streamDeepgramStreamingTurn({
      textStream,
      llmStartedAtMs,
      context: {
        connectionManager: {
          ensure: async () => this.ensureDeepgramTtsConnection(),
          close: () => this.closeDeepgramTtsConnection(),
        },
        options: {
          apiKey: this.options.deepgramApiKey,
          model: this.options.ttsModel || this.options.ttsVoice,
          endpoint: this.options.deepgramTtsWsUrl,
          ttsProvider: this.options.ttsProvider,
          punctuationChunkingEnabled: this.options.deepgramTtsPunctuationChunkingEnabled,
          spokenStreamEnabled: this.options.spokenStreamEnabled === true,
        },
        isTurnCurrent: () => this.isTurnCurrent(turnGeneration),
        setSpeaking: () => this.setState('speaking'),
        setListening: () => this.setState('listening'),
        trackAssistantOutput: (chunk) => this.trackAssistantOutput(chunk),
        emitAudio: (chunk) => {
          this.events.emit('audio', {
            data: chunk,
            sampleRate: AUDIO_SAMPLE_RATE,
            format: 'pcm16',
          });
        },
        emitError: (error) => this.events.emit('error', error),
        emitLatency: (metric) => this.emitLatency(metric),
        emitTranscriptDelta: (delta) =>
          this.events.emit('transcriptDelta', delta, 'assistant', assistantId),
        emitSpokenDelta: (delta, meta) =>
          this.events.emit('spokenDelta', delta, 'assistant', assistantId, meta),
        emitSpokenProgress: (progress) =>
          this.events.emit('spokenProgress', assistantId, progress),
        emitSpokenFinal: (text, meta) =>
          this.events.emit('spokenFinal', text, 'assistant', assistantId, meta),
      },
    });
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
      this.options.llmProvider === 'google' ||
      this.options.llmProvider === 'openclaw-channel'
    );
  }

  private getLlmProviderDisplayName(provider: DecomposedOptions['llmProvider']): string {
    if (provider === 'openrouter') return 'OpenRouter';
    if (provider === 'openai') return 'OpenAI';
    if (provider === 'anthropic') return 'Anthropic';
    if (provider === 'google') return 'Google';
    if (provider === 'openclaw-channel') return 'OpenClaw Channel';
    return provider;
  }

  private resolveLlmRuntimeApiKey(): string | undefined {
    if (!this.options) return undefined;
    if (this.options.llmProvider === 'openrouter') return this.options.openrouterApiKey;
    if (this.options.llmProvider === 'openai') return this.options.openaiApiKey;
    if (this.options.llmProvider === 'anthropic') return this.options.anthropicApiKey;
    if (this.options.llmProvider === 'google') return this.options.googleApiKey;
    if (this.options.llmProvider === 'openclaw-channel') return undefined; // Uses token, not API key
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
    await this.waitForLocalTtsWarmupIfNeeded();
    if (!this.isTurnCurrent(turnGeneration)) {
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
    const localQwenAdaptiveState = this.adaptiveUnderrun.createSegmentState({
      enabled: isAdaptiveLocalQwenTts,
      text,
      configuredIntervalSec: this.options.localTtsStreamingIntervalSec,
    });
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
        const { shouldRelease, startupWaitCapMs } =
          this.adaptiveUnderrun.handleChunkArrival(localQwenAdaptiveState, {
            producerAudioMs,
            producerElapsedMs,
            elapsedSinceFirstChunkMs,
          });

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
        const localTtsStreamingIntervalSec =
          this.options.ttsProvider === 'local' && isQwenTtsModelId(this.options.ttsModel)
            ? this.adaptiveUnderrun.getStreamingIntervalSec()
            : this.options.localTtsStreamingIntervalSec;
        synthesisResult = await synthesizeWithSharedTts({
          text,
          config: this.resolveSharedTtsConfig(),
          emitChunk,
          signal: ttsController.signal,
          localTtsStreamingIntervalSec,
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

    let adaptiveUpdate:
      | ReturnType<AdaptiveUnderrunController['updateAfterSegment']>
      | null = null;
    if (localQwenAdaptiveState) {
      const producerElapsedMs =
        lastChunkArrivedAtMs === null ? 0 : Math.max(0, lastChunkArrivedAtMs - ttsStartMs);
      adaptiveUpdate = this.adaptiveUnderrun.updateAfterSegment({
        state: localQwenAdaptiveState,
        text,
        emittedPlaybackMs,
        producerAudioMs,
        producerElapsedMs,
        cumulativeGapDeficitMs,
        finalPlayoutLeadMs,
        chunksWithGapDeficit,
      });

      this.emitLatency({
        stage: 'tts',
        durationMs: Math.max(0, Date.now() - ttsStartMs),
        provider: this.options.ttsProvider,
        model: this.options.ttsModel || this.options.ttsVoice,
        details: {
          metric: 'adaptive-update',
          producerRtf: roundTo(adaptiveUpdate.producerRtf, 3),
          worstPlayoutLeadMs:
            worstPlayoutLeadMs === Number.POSITIVE_INFINITY
              ? null
              : Math.round(worstPlayoutLeadMs),
          finalPlayoutLeadMs: Math.round(finalPlayoutLeadMs),
          underrunChunks,
          chunksWithGapDeficit,
          cumulativeGapDeficitMs: Math.round(cumulativeGapDeficitMs),
          maxGapDeficitMs: Math.round(maxGapDeficitMs),
          suggestedStartupBufferMs: Math.round(adaptiveUpdate.suggestedStartupBufferMs),
          requiredBufferFromRtfEma: Math.round(adaptiveUpdate.requiredBufferFromRtfEma),
          adaptiveProducerRtfEma: adaptiveUpdate.adaptiveProducerRtfEma,
          adaptiveAudioMsPerChar: adaptiveUpdate.adaptiveAudioMsPerChar,
          nextStreamingIntervalSec: adaptiveUpdate.nextStreamingIntervalSec,
          nextStartupBufferMs: adaptiveUpdate.nextStartupBufferMs,
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
          ? adaptiveUpdate?.nextStartupBufferMs ?? localQwenAdaptiveState.startupBufferMs
          : null,
        adaptiveStreamingIntervalSec: localQwenAdaptiveState
          ? adaptiveUpdate?.nextStreamingIntervalSec ?? localQwenAdaptiveState.intervalSec
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

  private resolveSharedTtsConfig(): SharedTtsConfig {
    if (!this.options) {
      throw new Error('Decomposed TTS options are unavailable');
    }

    return resolveSharedTtsConfig({
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
      localTtsStreamingIntervalSec: this.options.localTtsStreamingIntervalSec,
      voiceRefAudio: this.options.voiceRefAudio,
      voiceRefText: this.options.voiceRefText,
      googleChirpEndpoint: this.options.googleChirpEndpoint,
      cartesiaTtsWsUrl: this.options.cartesiaTtsWsUrl,
      fishTtsWsUrl: this.options.fishTtsWsUrl,
      rimeTtsWsUrl: this.options.rimeTtsWsUrl,
    });
  }

  private createTtsProviderContext(
    localTtsStreamingIntervalSec: number
  ): DecomposedTtsProviderContext {
    return toSharedTtsProviderContext(
      this.resolveSharedTtsConfig(),
      localTtsStreamingIntervalSec
    );
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

    await this.deepgramTtsConnectionManager.enqueueRequest(async () => {
      if (!this.isTurnCurrent(turnGeneration)) return;
      await this.speakWithDeepgramLiveSegment(text, emitChunk, turnGeneration);
    });
  }

  private async speakWithDeepgramLiveSegment(
    text: string,
    emitChunk: (chunk: ArrayBuffer) => Promise<boolean>,
    turnGeneration: number
  ): Promise<void> {
    if (!this.options) {
      return;
    }

    await streamSpeakWithDeepgramLiveSegment({
      text,
      emitChunk,
      context: {
        connectionManager: {
          ensure: async () => this.ensureDeepgramTtsConnection(),
          close: () => this.closeDeepgramTtsConnection(),
        },
        options: {
          apiKey: this.options.deepgramApiKey,
          model: this.options.ttsModel || this.options.ttsVoice,
          endpoint: this.options.deepgramTtsWsUrl,
          ttsProvider: this.options.ttsProvider,
          punctuationChunkingEnabled: this.options.deepgramTtsPunctuationChunkingEnabled,
          spokenStreamEnabled: this.options.spokenStreamEnabled === true,
        },
        isTurnCurrent: () => this.isTurnCurrent(turnGeneration),
        setSpeaking: () => this.setState('speaking'),
        setListening: () => this.setState('listening'),
        trackAssistantOutput: (chunk) => this.trackAssistantOutput(chunk),
        emitAudio: (chunk) => {
          this.events.emit('audio', {
            data: chunk,
            sampleRate: AUDIO_SAMPLE_RATE,
            format: 'pcm16',
          });
        },
        emitError: (error) => this.events.emit('error', error),
        emitLatency: (metric) => this.emitLatency(metric),
        emitTranscriptDelta: () => {},
        emitSpokenDelta: () => {},
        emitSpokenProgress: () => {},
        emitSpokenFinal: () => {},
      },
    });
  }

  private async ensureDeepgramTtsConnection(): Promise<SpeakLiveClient> {
    if (!this.options?.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed TTS');
    }

    return this.deepgramTtsConnectionManager.ensure({
      apiKey: this.options.deepgramApiKey,
      model: this.options.ttsModel || this.options.ttsVoice,
      endpoint: this.options.deepgramTtsWsUrl,
    });
  }

  private closeDeepgramTtsConnection(): void {
    this.deepgramTtsConnectionManager.close();
  }

}
