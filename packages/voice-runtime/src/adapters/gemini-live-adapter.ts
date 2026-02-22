import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import { StreamResampler } from '../media/stream-resampler.js';
import { parseGeminiProviderConfig } from '../provider-config.js';
import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import type {
  AudioFrame,
  AudioNegotiation,
  EventHandler,
  GeminiProviderConfig,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfigSchema,
  SessionInput,
  ToolCallContext,
  ToolCallResult,
  ToolDefinition,
  VoiceHistoryItem,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
}

interface GeminiModelTurn {
  parts?: GeminiPart[];
}

interface GeminiServerContent {
  modelTurn?: GeminiModelTurn;
  turnComplete?: boolean;
  generationComplete?: boolean;
  interrupted?: boolean;
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
}

interface GeminiFunctionCall {
  id?: string;
  name?: string;
  args?: unknown;
}

interface GeminiToolCall {
  functionCalls?: GeminiFunctionCall[];
}

interface GeminiToolCallCancellation {
  ids?: string[];
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  responseTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GeminiEnvelope {
  setupComplete?: Record<string, unknown>;
  serverContent?: GeminiServerContent;
  toolCall?: GeminiToolCall;
  toolCallCancellation?: GeminiToolCallCancellation;
  error?: { code?: number; message?: string; status?: string };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiFunctionResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
  scheduling?: 'INTERRUPT' | 'WHEN_IDLE' | 'SILENT';
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  behavior?: 'NON_BLOCKING';
}

interface ResolvedGeminiVadConfig {
  mode: 'server' | 'manual';
  silenceDurationMs?: number;
  prefixPaddingMs?: number;
  threshold?: number;
  startOfSpeechSensitivity?: 'high' | 'low';
  endOfSpeechSensitivity?: 'high' | 'low';
}

const GEMINI_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_INPUT_RATE = 16000;
const GEMINI_OUTPUT_RATE = 24000;
const GEMINI_MANUAL_VAD_DEFAULT_SILENCE_MS = 450;
const GEMINI_MANUAL_VAD_DEFAULT_THRESHOLD = 0.005;
const GEMINI_MANUAL_VAD_MIN_SPEECH_MS = 80;
const GEMINI_MANUAL_VAD_DEFAULT_PREFIX_PADDING_MS = 120;
const GEMINI_MODEL_ALIASES: Record<string, string> = {
  'gemini-2.5-flash-native-audio-preview': 'gemini-2.5-flash-native-audio-latest',
};

const GEMINI_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['websocket'],
  audioNegotiation: true,
  vadModes: ['server', 'manual'],
  interruptionModes: ['barge-in', 'no-interruption'],

  toolTimeout: false,
  asyncTools: true,
  toolCancellation: true,
  toolScheduling: true,
  toolReaction: false,
  precomputableTools: false,
  toolApproval: false,
  mcpTools: false,
  serverSideTools: false,

  sessionResumption: true,
  midSessionConfigUpdate: false,
  contextCompression: true,

  forceAgentMessage: false,
  outputMediumSwitch: false,
  callState: false,
  deferredText: false,
  callStages: false,
  proactivity: false,
  usageMetrics: true,
  orderedTranscripts: false,
  ephemeralTokens: true,
  nativeTruncation: false,
  wordLevelTimestamps: false,
};

const GEMINI_CONFIG_SCHEMA: ProviderConfigSchema = {
  providerId: 'gemini-live',
  displayName: 'Gemini Live',
  fields: [
    {
      key: 'vad.mode',
      label: 'VAD Mode',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'manual', label: 'Manual activity signals (recommended)' },
        { value: 'server', label: 'Server VAD (auto detection)' },
      ],
      defaultValue: 'manual',
      description:
        'Manual mode sends activityStart/activityEnd from the runtime to improve transcript quality.',
    },
    {
      key: 'noInterruption',
      label: 'Interruption Mode',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'false', label: 'Allow interruptions (barge-in)' },
        { value: 'true', label: 'No interruption' },
      ],
      defaultValue: 'false',
      description: 'Whether user speech can interrupt the agent.',
    },
    {
      key: 'vad.startOfSpeechSensitivity',
      label: 'Start-of-Speech Sensitivity',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'high', label: 'High (more triggers)' },
        { value: 'low', label: 'Low (fewer false starts)' },
      ],
      defaultValue: 'high',
      description: 'How readily speech start is detected.',
    },
    {
      key: 'vad.endOfSpeechSensitivity',
      label: 'End-of-Speech Sensitivity',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'high', label: 'High (faster response)' },
        { value: 'low', label: 'Low (more patient)' },
      ],
      defaultValue: 'high',
      description: 'How readily speech end is detected.',
    },
    {
      key: 'vad.silenceDurationMs',
      label: 'Silence Duration (ms)',
      type: 'number',
      group: 'vad',
      min: 50,
      max: 5000,
      step: 50,
      defaultValue: 450,
      description: 'Silence required to commit end-of-speech.',
    },
    {
      key: 'vad.threshold',
      label: 'Manual VAD Threshold',
      type: 'number',
      group: 'vad',
      min: 0.001,
      max: 0.05,
      step: 0.001,
      defaultValue: 0.005,
      description: 'RMS threshold used for local speech detection in manual VAD mode.',
      dependsOn: { field: 'vad.mode', value: 'manual' },
    },
    {
      key: 'contextWindowCompressionTokens',
      label: 'Context Compression (tokens)',
      type: 'number',
      group: 'advanced',
      min: 0,
      max: 50000,
      step: 1000,
      defaultValue: 10000,
      description: 'Sliding window token count for long conversations. 0 = disabled.',
    },
    {
      key: 'enableInputTranscription',
      label: 'Transcribe User Audio',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
    },
    {
      key: 'enableOutputTranscription',
      label: 'Transcribe Agent Audio',
      type: 'boolean',
      group: 'advanced',
      defaultValue: true,
    },
  ],
  voices: [
    { id: 'Puck', name: 'Puck', language: 'multi', gender: 'male' },
    { id: 'Charon', name: 'Charon', language: 'multi', gender: 'male' },
    { id: 'Kore', name: 'Kore', language: 'multi', gender: 'female' },
    { id: 'Fenrir', name: 'Fenrir', language: 'multi', gender: 'male' },
    { id: 'Aoede', name: 'Aoede', language: 'multi', gender: 'female' },
    { id: 'Leda', name: 'Leda', language: 'multi', gender: 'female' },
    { id: 'Orus', name: 'Orus', language: 'multi', gender: 'male' },
    { id: 'Zephyr', name: 'Zephyr', language: 'multi', gender: 'neutral' },
  ],
};

export class GeminiLiveAdapter implements ProviderAdapter {
  readonly id = 'gemini-live' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private socket: WebSocket | null = null;
  private input: SessionInput | null = null;
  private state: VoiceState = 'idle';
  private history: VoiceHistoryItem[] = [];
  private nextUserIndex = 0;
  private nextAssistantIndex = 0;
  private activeUserItemId: string | null = null;
  private activeUserText = '';
  private activeAssistantItemId: string | null = null;
  private activeAssistantText = '';
  private setupPromise: Promise<void> | null = null;
  private resolveSetup: (() => void) | null = null;
  private rejectSetup: ((error: Error) => void) | null = null;
  private pendingResumeHandle: string | null = null;
  private manualVadEnabled = false;
  private manualVadActive = false;
  private manualVadThreshold = GEMINI_MANUAL_VAD_DEFAULT_THRESHOLD;
  private inputResampler: StreamResampler | null = null;
  private manualVadSilenceDurationMs = GEMINI_MANUAL_VAD_DEFAULT_SILENCE_MS;
  private manualVadPrefixPaddingMs = GEMINI_MANUAL_VAD_DEFAULT_PREFIX_PADDING_MS;
  private manualVadPendingSpeechMs = 0;
  private manualVadPendingSilenceMs = 0;
  private manualVadPrerollFrames: AudioFrame[] = [];
  private manualVadPrerollDurationMs = 0;
  private manualVadAutoEndTimer: ReturnType<typeof setTimeout> | null = null;
  private turnCompletionEmitted = false;

  capabilities(): ProviderCapabilities {
    return GEMINI_CAPABILITIES;
  }

  configSchema(): ProviderConfigSchema {
    return GEMINI_CONFIG_SCHEMA;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.input = input;
    this.history = [];
    this.nextUserIndex = 0;
    this.nextAssistantIndex = 0;
    this.activeUserItemId = null;
    this.activeUserText = '';
    this.activeAssistantItemId = null;
    this.activeAssistantText = '';
    this.turnCompletionEmitted = false;

    const providerConfig = this.getProviderConfig(input);
    this.resetManualVadState(input, providerConfig);
    const apiKey = providerConfig.apiKey;
    if (!apiKey) {
      throw new Error('Gemini adapter requires providerConfig.apiKey');
    }

    const endpoint = providerConfig.endpoint ?? GEMINI_ENDPOINT;
    const url = new URL(endpoint);
    if (!providerConfig.useEphemeralToken) {
      url.searchParams.set('key', apiKey);
    } else {
      // Ephemeral tokens are passed as key-compatible values.
      url.searchParams.set('key', apiKey);
    }

    this.socket = new WebSocket(url.toString());
    this.socket.binaryType = 'arraybuffer';

    await this.waitForOpen();
    this.bindSocketHandlers();

    this.setupPromise = new Promise<void>((resolve, reject) => {
      this.resolveSetup = resolve;
      this.rejectSetup = reject;
    });

    this.sendJson(this.buildSetupMessage(input, providerConfig));

    await Promise.race([
      this.setupPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini setup timeout')), 12_000)
      ),
    ]);

    this.setState('listening');
    this.events.emit('connected');

    // Pre-warm stream resampler for 24kHz → 16kHz input conversion
    this.inputResampler = new StreamResampler(24000, GEMINI_INPUT_RATE);
    await this.inputResampler.init();

    return {
      providerInputRate: GEMINI_INPUT_RATE,
      providerOutputRate: GEMINI_OUTPUT_RATE,
      preferredClientInputRate: 24000,
      preferredClientOutputRate: 24000,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    this.finalizeActiveUserTranscript();
    this.finalizeAssistantTranscript();
    this.endManualActivity();
    this.clearManualVadTimer();
    this.manualVadPrerollFrames = [];
    this.manualVadPrerollDurationMs = 0;
    this.manualVadPendingSpeechMs = 0;
    this.manualVadPendingSilenceMs = 0;

    if (!this.socket) {
      this.setState('idle');
      this.events.emit('disconnected');
      return;
    }

    try {
      this.socket.close();
    } catch {
      // ignore
    }
    this.socket = null;
    this.setState('idle');
    this.events.emit('disconnected');
  }

  sendAudio(frame: AudioFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const providerFrame =
      frame.sampleRate === GEMINI_INPUT_RATE ? frame : resamplePcm16Mono(frame, GEMINI_INPUT_RATE);
    if (this.manualVadEnabled) {
      this.sendAudioWithManualVad(providerFrame);
      return;
    }
    this.sendRealtimeAudio(providerFrame);
  }

  sendText(text: string, options?: { defer?: boolean }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const itemId = this.nextUserItemId();
    this.events.emit('userItemCreated', itemId);
    this.events.emit('transcript', trimmed, 'user', itemId);
    this.history.push({
      id: itemId,
      role: 'user',
      text: trimmed,
      createdAt: Date.now(),
    });
    this.events.emit('historyUpdated', [...this.history]);

    this.sendJson({
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: options?.defer ? false : true,
      },
    });
  }

  interrupt(): void {
    this.events.emit('audioInterrupted');
    this.setState('listening');
  }

  sendToolResult(result: ToolCallResult): void {
    const callId = result.invocationId;
    this.sendFunctionResponses([
      {
        id: callId,
        name: 'tool_result',
        response: normalizeToolResponse(result),
        scheduling: toGeminiScheduling(result.scheduling),
      },
    ]);
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

  async resume(handle: string): Promise<void> {
    this.pendingResumeHandle = handle;
  }

  private waitForOpen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Gemini websocket missing'));
        return;
      }

      const onOpen = () => {
        this.socket?.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        this.socket?.removeEventListener('open', onOpen);
        const message = (event as ErrorEvent).message || 'Gemini websocket connection failed';
        reject(new Error(message));
      };

      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('error', onError, { once: true });
    });
  }

  private bindSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.addEventListener('message', (event: MessageEvent) => {
      void this.handleRawMessage(event.data);
    });

    this.socket.addEventListener('close', (event: CloseEvent) => {
      if (this.rejectSetup) {
        const reason = event.reason ? ` ${event.reason}` : '';
        this.rejectSetup(
          new Error(`Gemini websocket closed during setup (${event.code})${reason}`)
        );
        this.resolveSetup = null;
        this.rejectSetup = null;
      }
      this.setState('idle');
      this.events.emit('disconnected', 'socket_closed');
    });

    this.socket.addEventListener('error', (event: Event) => {
      const message = (event as ErrorEvent).message || 'Gemini websocket error';
      const error = new Error(message);
      if (this.rejectSetup) {
        this.rejectSetup(error);
        this.resolveSetup = null;
        this.rejectSetup = null;
      }
      this.events.emit('error', error);
    });
  }

  private async handleRawMessage(data: unknown): Promise<void> {
    let rawText = '';

    if (typeof data === 'string') {
      rawText = data;
    } else if (data instanceof ArrayBuffer) {
      rawText = new TextDecoder().decode(data);
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      rawText = await data.text();
    } else if (data instanceof Uint8Array) {
      rawText = new TextDecoder().decode(data);
    } else {
      return;
    }

    if (!rawText) return;

    let message: GeminiEnvelope;
    try {
      message = JSON.parse(rawText) as GeminiEnvelope;
    } catch {
      return;
    }

    this.handleEnvelope(message);
  }

  private handleEnvelope(message: GeminiEnvelope): void {
    if (message.error) {
      const code = typeof message.error.code === 'number' ? message.error.code : 'unknown';
      const details = message.error.message ?? message.error.status ?? 'Unknown Gemini error';
      const error = new Error(`Gemini Live error (${code}): ${details}`);
      if (this.rejectSetup) {
        this.rejectSetup(error);
        this.resolveSetup = null;
        this.rejectSetup = null;
      }
      this.events.emit('error', error);
      return;
    }

    if (message.setupComplete && this.resolveSetup) {
      this.resolveSetup();
      this.resolveSetup = null;
      this.rejectSetup = null;
    }

    if (message.usageMetadata) {
      this.events.emit('usage', {
        inputTokens: message.usageMetadata.promptTokenCount,
        outputTokens: message.usageMetadata.responseTokenCount,
        totalTokens: message.usageMetadata.totalTokenCount,
        inputTokenDetails: {
          cachedTokens: message.usageMetadata.cachedContentTokenCount,
        },
      });
    }

    if (message.sessionResumptionUpdate?.newHandle) {
      this.pendingResumeHandle = message.sessionResumptionUpdate.newHandle;
      this.events.emit('latency', {
        stage: 'connection',
        durationMs: 0,
        provider: 'gemini-live',
        details: {
          resumable: message.sessionResumptionUpdate.resumable ?? false,
          handle: this.pendingResumeHandle,
        },
      });
    }

    if (message.goAway) {
      this.events.emit('latency', {
        stage: 'connection',
        durationMs: 0,
        provider: 'gemini-live',
        details: {
          goAway: true,
          timeLeft: message.goAway.timeLeft ?? null,
        },
      });
    }

    if (message.toolCall?.functionCalls?.length) {
      void this.handleToolCall(message.toolCall.functionCalls);
    }

    if (message.toolCallCancellation?.ids?.length) {
      this.events.emit('toolCancelled', message.toolCallCancellation.ids);
    }

    if (message.serverContent) {
      this.handleServerContent(message.serverContent);
    }
  }

  private handleServerContent(content: GeminiServerContent): void {
    if (content.interrupted) {
      this.events.emit('audioInterrupted');
      this.setState('listening');
    }

    const inputText = content.inputTranscription?.text;
    if (inputText) {
      this.ensureActiveUserItem();
      const next = mergeTranscript(this.activeUserText, inputText);
      this.activeUserText = next.combined;
      const delta = next.delta;
      if (delta) {
        this.events.emit('transcriptDelta', delta, 'user', this.activeUserItemId ?? undefined);
      }
    }

    const outputText = content.outputTranscription?.text;
    if (outputText) {
      this.ensureActiveAssistantItem();
      const next = mergeTranscript(this.activeAssistantText, outputText);
      this.activeAssistantText = next.combined;
      const delta = next.delta;
      if (delta) {
        this.events.emit(
          'transcriptDelta',
          delta,
          'assistant',
          this.activeAssistantItemId ?? undefined
        );
      }
    }

    const parts = content.modelTurn?.parts ?? [];
    if (parts.length > 0) {
      this.ensureActiveAssistantItem();
    }

    for (const part of parts) {
      if (part.inlineData?.data) {
        const sampleRate = parseSampleRate(part.inlineData.mimeType) ?? GEMINI_OUTPUT_RATE;
        this.setState('speaking');
        this.events.emit('audio', {
          data: decodeBase64(part.inlineData.data),
          sampleRate,
          format: 'pcm16',
        });
      }

    }

    if (content.turnComplete || content.generationComplete) {
      this.finalizeActiveUserTranscript();
      this.finalizeAssistantTranscript();
      this.setState('listening');
      if (!this.turnCompletionEmitted) {
        this.events.emit('turnComplete');
        this.turnCompletionEmitted = true;
      }
    }
  }

  private async handleToolCall(functionCalls: GeminiFunctionCall[]): Promise<void> {
    if (!this.input?.toolHandler) {
      const fallbackResponses = functionCalls
        .filter((call): call is GeminiFunctionCall & { id: string; name: string } =>
          typeof call.id === 'string' && typeof call.name === 'string'
        )
        .map((call) => ({
          id: call.id,
          name: call.name,
          response: {
            error: true,
            message: `No toolHandler registered for ${call.name}`,
          },
        }));
      if (fallbackResponses.length > 0) {
        this.sendFunctionResponses(fallbackResponses);
      }
      return;
    }

    for (const call of functionCalls) {
      const callId = typeof call.id === 'string' ? call.id : `gemini-tool-${Date.now()}`;
      const name = typeof call.name === 'string' ? call.name : 'unknown_tool';
      const args = toObject(call.args);

      this.events.emit('toolStart', name, args, callId);

      try {
        const context: ToolCallContext = {
          providerId: this.id,
          callId,
          invocationId: callId,
          history: [...this.history],
        };
        const rawResult = await this.input.toolHandler(name, args, context);
        const normalized = normalizeToolResult(callId, rawResult);
        this.sendFunctionResponses([
          {
            id: callId,
            name,
            response: normalizeToolResponse(normalized),
            scheduling: toGeminiScheduling(normalized.scheduling),
          },
        ]);
        this.events.emit('toolEnd', name, normalized.result, callId);
      } catch (error) {
        const message = (error as Error).message;
        this.sendFunctionResponses([
          {
            id: callId,
            name,
            response: {
              error: true,
              message,
            },
          },
        ]);
        this.events.emit('toolEnd', name, message, callId);
        this.events.emit('error', error as Error);
      }
    }
  }

  private sendFunctionResponses(responses: GeminiFunctionResponse[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.sendJson({
      toolResponse: {
        functionResponses: responses,
      },
    });
  }

  private ensureActiveUserItem(): void {
    if (this.activeUserItemId) return;
    this.turnCompletionEmitted = false;
    this.activeUserItemId = this.nextUserItemId();
    this.activeUserText = '';
    this.events.emit('userItemCreated', this.activeUserItemId);
  }

  private finalizeActiveUserTranscript(): void {
    if (!this.activeUserItemId) return;
    const finalText = this.activeUserText.trim();
    if (finalText) {
      this.events.emit('transcript', finalText, 'user', this.activeUserItemId);
      this.history.push({
        id: this.activeUserItemId,
        role: 'user',
        text: finalText,
        createdAt: Date.now(),
      });
      this.events.emit('historyUpdated', [...this.history]);
    }
    this.activeUserItemId = null;
    this.activeUserText = '';
  }

  private ensureActiveAssistantItem(): void {
    if (this.activeAssistantItemId) return;
    this.turnCompletionEmitted = false;
    this.finalizeActiveUserTranscript();
    this.activeAssistantItemId = this.nextAssistantItemId();
    this.activeAssistantText = '';
    this.events.emit('assistantItemCreated', this.activeAssistantItemId);
    this.events.emit('turnStarted');
    this.setState('thinking');
  }

  private finalizeAssistantTranscript(): void {
    if (!this.activeAssistantItemId) return;
    const finalText = this.activeAssistantText.trim();
    if (finalText) {
      this.events.emit('transcript', finalText, 'assistant', this.activeAssistantItemId);
      this.history.push({
        id: this.activeAssistantItemId,
        role: 'assistant',
        text: finalText,
        createdAt: Date.now(),
      });
      this.events.emit('historyUpdated', [...this.history]);
    }
    this.activeAssistantItemId = null;
    this.activeAssistantText = '';
  }

  private nextUserItemId(): string {
    this.nextUserIndex += 1;
    return `gemini-user-${this.nextUserIndex}`;
  }

  private nextAssistantItemId(): string {
    this.nextAssistantIndex += 1;
    return `gemini-assistant-${this.nextAssistantIndex}`;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private resetManualVadState(input: SessionInput, config: GeminiProviderConfig): void {
    const resolvedVad = this.resolveVadConfig(input, config);
    this.manualVadEnabled = resolvedVad.mode === 'manual';
    this.manualVadActive = false;
    this.manualVadPendingSpeechMs = 0;
    this.manualVadPendingSilenceMs = 0;
    this.manualVadPrerollFrames = [];
    this.manualVadPrerollDurationMs = 0;
    this.clearManualVadTimer();

    const threshold = resolvedVad.threshold;
    this.manualVadThreshold =
      typeof threshold === 'number' && Number.isFinite(threshold) && threshold > 0
        ? threshold
        : GEMINI_MANUAL_VAD_DEFAULT_THRESHOLD;

    const silenceDurationMs = resolvedVad.silenceDurationMs;
    this.manualVadSilenceDurationMs =
      typeof silenceDurationMs === 'number' &&
      Number.isFinite(silenceDurationMs) &&
      silenceDurationMs > 0
        ? silenceDurationMs
        : GEMINI_MANUAL_VAD_DEFAULT_SILENCE_MS;

    const prefixPaddingMs = resolvedVad.prefixPaddingMs;
    this.manualVadPrefixPaddingMs =
      typeof prefixPaddingMs === 'number' &&
      Number.isFinite(prefixPaddingMs) &&
      prefixPaddingMs >= 0
        ? prefixPaddingMs
        : GEMINI_MANUAL_VAD_DEFAULT_PREFIX_PADDING_MS;
  }

  private resolveVadConfig(
    input: SessionInput,
    config: GeminiProviderConfig
  ): ResolvedGeminiVadConfig {
    const inputMode = input.vad?.mode;
    const mode: ResolvedGeminiVadConfig['mode'] =
      inputMode === 'manual'
        ? 'manual'
        : inputMode === 'server'
          ? 'server'
          : config.vadMode ?? 'manual';

    return {
      mode,
      silenceDurationMs: input.vad?.silenceDurationMs ?? config.vadSilenceDurationMs,
      prefixPaddingMs: input.vad?.prefixPaddingMs ?? config.vadPrefixPaddingMs,
      threshold: input.vad?.threshold ?? config.vadThreshold,
      startOfSpeechSensitivity:
        input.vad?.startOfSpeechSensitivity ?? config.vadStartOfSpeechSensitivity,
      endOfSpeechSensitivity:
        input.vad?.endOfSpeechSensitivity ?? config.vadEndOfSpeechSensitivity,
    };
  }

  private sendAudioWithManualVad(frame: AudioFrame): void {
    const frameDurationMs = computeFrameDurationMs(frame);
    if (frameDurationMs <= 0) return;

    const rms = computeRmsPcm16(frame.data);
    const hasSpeech = rms >= this.manualVadThreshold;

    if (!this.manualVadActive) {
      this.enqueueManualPrerollFrame(frame, frameDurationMs);
      this.manualVadPendingSpeechMs = hasSpeech ? this.manualVadPendingSpeechMs + frameDurationMs : 0;

      if (this.manualVadPendingSpeechMs >= GEMINI_MANUAL_VAD_MIN_SPEECH_MS) {
        this.manualVadPendingSpeechMs = 0;
        this.startManualActivity();
        this.flushManualPrerollFrames();
        this.armManualVadTimer();
      }
      return;
    }

    this.sendRealtimeAudio(frame);

    if (hasSpeech) {
      this.manualVadPendingSilenceMs = 0;
    } else {
      this.manualVadPendingSilenceMs += frameDurationMs;
      if (this.manualVadPendingSilenceMs >= this.manualVadSilenceDurationMs) {
        this.endManualActivity();
        return;
      }
    }

    this.armManualVadTimer();
  }

  private enqueueManualPrerollFrame(frame: AudioFrame, frameDurationMs: number): void {
    const copy: AudioFrame = {
      data: frame.data.slice(0),
      sampleRate: frame.sampleRate,
      format: frame.format,
    };
    this.manualVadPrerollFrames.push(copy);
    this.manualVadPrerollDurationMs += frameDurationMs;

    while (
      this.manualVadPrerollFrames.length > 1 &&
      this.manualVadPrerollDurationMs > this.manualVadPrefixPaddingMs
    ) {
      const oldest = this.manualVadPrerollFrames.shift();
      if (!oldest) break;
      this.manualVadPrerollDurationMs -= computeFrameDurationMs(oldest);
    }
  }

  private flushManualPrerollFrames(): void {
    for (const frame of this.manualVadPrerollFrames) {
      this.sendRealtimeAudio(frame);
    }
    this.manualVadPrerollFrames = [];
    this.manualVadPrerollDurationMs = 0;
  }

  private startManualActivity(): void {
    if (this.manualVadActive) return;
    this.manualVadActive = true;
    this.manualVadPendingSilenceMs = 0;
    this.sendJson({
      realtimeInput: {
        activityStart: {},
      },
    });
  }

  private endManualActivity(): void {
    if (!this.manualVadActive) return;
    this.clearManualVadTimer();
    this.manualVadActive = false;
    this.manualVadPendingSpeechMs = 0;
    this.manualVadPendingSilenceMs = 0;
    this.sendJson({
      realtimeInput: {
        activityEnd: {},
      },
    });
  }

  private armManualVadTimer(): void {
    if (!this.manualVadActive) return;
    this.clearManualVadTimer();
    this.manualVadAutoEndTimer = setTimeout(() => {
      if (!this.manualVadActive) return;
      this.endManualActivity();
    }, this.manualVadSilenceDurationMs);
  }

  private clearManualVadTimer(): void {
    if (!this.manualVadAutoEndTimer) return;
    clearTimeout(this.manualVadAutoEndTimer);
    this.manualVadAutoEndTimer = null;
  }

  private sendRealtimeAudio(frame: AudioFrame): void {
    this.sendJson({
      realtimeInput: {
        audio: {
          data: encodeBase64(frame.data),
          mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
        },
      },
    });
  }

  private buildSetupMessage(
    input: SessionInput,
    config: GeminiProviderConfig
  ): Record<string, unknown> {
    const resolvedVad = this.resolveVadConfig(input, config);
    const declarations = (input.tools ?? []).map((tool) =>
      this.toFunctionDeclaration(tool)
    );

    const setup: Record<string, unknown> = {
      model: normalizeGeminiModel(input.model),
      generationConfig: {
        responseModalities: ['AUDIO'],
        temperature: input.temperature ?? 0.8,
        maxOutputTokens: input.maxOutputTokens,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: input.voice,
            },
          },
          // Note: languageCode is NOT set here — native-audio models reject
          // non-English codes (e.g. "de") with WebSocket close 1007.
          // Set language via systemInstruction instead.
        },
      },
      systemInstruction: {
        parts: [{ text: input.instructions }],
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: resolvedVad.mode === 'manual',
          ...(resolvedVad.silenceDurationMs != null ? { silenceDurationMs: resolvedVad.silenceDurationMs } : {}),
          ...(resolvedVad.prefixPaddingMs != null ? { prefixPaddingMs: resolvedVad.prefixPaddingMs } : {}),
          ...(resolvedVad.startOfSpeechSensitivity != null
            ? {
                startOfSpeechSensitivity:
                  resolvedVad.startOfSpeechSensitivity === 'high'
                    ? 'START_SENSITIVITY_HIGH'
                    : 'START_SENSITIVITY_LOW',
              }
            : {}),
          ...(resolvedVad.endOfSpeechSensitivity != null
            ? {
                endOfSpeechSensitivity:
                  resolvedVad.endOfSpeechSensitivity === 'high'
                    ? 'END_SENSITIVITY_HIGH'
                    : 'END_SENSITIVITY_LOW',
              }
            : {}),
        },
        activityHandling: config.noInterruption
          ? 'NO_INTERRUPTION'
          : 'START_OF_ACTIVITY_INTERRUPTS',
      },
    };

    if (declarations.length > 0) {
      setup.tools = [{ functionDeclarations: declarations }];
    }

    if (config.enableInputTranscription !== false) {
      setup.inputAudioTranscription = {};
    }

    if (config.enableOutputTranscription !== false) {
      setup.outputAudioTranscription = {};
    }

    const resumeHandle = config.sessionResumptionHandle ?? this.pendingResumeHandle;
    if (resumeHandle) {
      setup.sessionResumption = { handle: resumeHandle };
    }

    if (typeof config.contextWindowCompressionTokens === 'number') {
      setup.contextWindowCompression = {
        slidingWindow: { targetTokens: config.contextWindowCompressionTokens },
      };
    }

    return { setup };
  }

  private toFunctionDeclaration(tool: ToolDefinition): GeminiFunctionDeclaration {
    const parameters = sanitizeGeminiSchema(tool.parameters);
    const declaration: GeminiFunctionDeclaration = {
      name: tool.name,
      description: tool.description,
      ...(parameters ? { parameters } : {}),
    };
    if (tool.nonBlocking) {
      declaration.behavior = 'NON_BLOCKING';
    }
    return declaration;
  }

  private getProviderConfig(input: SessionInput): GeminiProviderConfig {
    return parseGeminiProviderConfig(input.providerConfig);
  }
}

function parseSampleRate(mimeType?: string): number | null {
  if (!mimeType) return null;
  const match = mimeType.match(/rate=(\d+)/);
  if (!match) return null;
  const rateText = match[1];
  if (!rateText) return null;
  const parsed = Number.parseInt(rateText, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeGeminiModel(model: string): string {
  const bare = model.startsWith('models/') ? model.slice('models/'.length) : model;
  const normalized = GEMINI_MODEL_ALIASES[bare] ?? bare;
  return `models/${normalized}`;
}

function computeFrameDurationMs(frame: AudioFrame): number {
  if (!Number.isFinite(frame.sampleRate) || frame.sampleRate <= 0) return 0;
  const samples = frame.data.byteLength / 2;
  if (!Number.isFinite(samples) || samples <= 0) return 0;
  return (samples / frame.sampleRate) * 1000;
}

function computeRmsPcm16(data: ArrayBuffer): number {
  const pcm = new Int16Array(data);
  if (pcm.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const normalized = pcm[i]! / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / pcm.length);
}

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function mergeTranscript(previous: string, nextChunk: string): { combined: string; delta: string } {
  if (!previous) {
    return { combined: nextChunk, delta: nextChunk };
  }

  if (nextChunk.startsWith(previous)) {
    const delta = nextChunk.slice(previous.length);
    return { combined: nextChunk, delta };
  }

  if (previous.endsWith(nextChunk)) {
    return { combined: previous, delta: '' };
  }

  return {
    combined: `${previous}${nextChunk}`,
    delta: nextChunk,
  };
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeToolResult(
  invocationId: string,
  result: ToolCallResult | string | undefined
): ToolCallResult {
  if (!result) {
    return {
      invocationId,
      result: '',
    };
  }

  if (typeof result === 'string') {
    return {
      invocationId,
      result,
    };
  }

  return {
    ...result,
    invocationId,
    result: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
  };
}

function normalizeToolResponse(result: ToolCallResult): Record<string, unknown> {
  const response: Record<string, unknown> = {
    output: result.result,
    isError: result.isError ?? false,
  };
  if (result.errorMessage) {
    response.errorMessage = result.errorMessage;
  }
  return response;
}

function sanitizeGeminiSchema(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const sanitized = sanitizeGeminiValue(value);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return undefined;
  return sanitized as Record<string, unknown>;
}

function sanitizeGeminiValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const sanitized = value
      .map((item) => sanitizeGeminiValue(item))
      .filter((item) => item !== undefined);
    return sanitized.length > 0 ? sanitized : undefined;
  }

  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      if (key.startsWith('$')) continue;
      if (isGeminiUnsupportedSchemaKey(key)) continue;
      const sanitizedChild = sanitizeGeminiValue(child);
      if (sanitizedChild === undefined) continue;
      output[key] = sanitizedChild;
    }

    normalizeGeminiSchemaNode(output);
    if (Object.keys(output).length === 0) return undefined;
    return output;
  }

  return value;
}

function isGeminiUnsupportedSchemaKey(key: string): boolean {
  return (
    key === 'additionalProperties' ||
    key === 'unevaluatedProperties' ||
    key === 'patternProperties' ||
    key === 'propertyNames' ||
    key === 'dependencies' ||
    key === 'dependentRequired' ||
    key === 'dependentSchemas' ||
    key === 'if' ||
    key === 'then' ||
    key === 'else' ||
    key === 'allOf' ||
    key === 'not' ||
    key === 'contains' ||
    key === 'minContains' ||
    key === 'maxContains'
  );
}

function normalizeGeminiSchemaNode(node: Record<string, unknown>): void {
  const rawType = node.type;
  if (Array.isArray(rawType)) {
    const typeEntries = rawType.filter((entry): entry is string => typeof entry === 'string');
    if (typeEntries.length > 0) {
      const nonNull = typeEntries.find((entry) => entry !== 'null');
      if (nonNull) node.type = nonNull;
      if (typeEntries.includes('null')) node.nullable = true;
    } else {
      delete node.type;
    }
  }

  if (Array.isArray(node.required)) {
    const required = node.required.filter((entry): entry is string => typeof entry === 'string');
    const properties = node.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const known = new Set(Object.keys(properties as Record<string, unknown>));
      node.required = required.filter((entry) => known.has(entry));
    } else {
      node.required = required;
    }
    if ((node.required as string[]).length === 0) {
      delete node.required;
    }
  }
}

function toGeminiScheduling(
  scheduling: ToolCallResult['scheduling']
): 'INTERRUPT' | 'WHEN_IDLE' | 'SILENT' | undefined {
  if (scheduling === 'interrupt') return 'INTERRUPT';
  if (scheduling === 'when_idle') return 'WHEN_IDLE';
  if (scheduling === 'silent') return 'SILENT';
  return undefined;
}
