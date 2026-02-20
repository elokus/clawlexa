import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import { parsePipecatProviderConfig } from '../provider-config.js';
import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import type {
  AudioFrame,
  AudioNegotiation,
  EventHandler,
  PipecatProviderConfig,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfigSchema,
  SessionInput,
  ToolCallContext,
  ToolCallResult,
  VoiceHistoryItem,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';
import { BaseWebSocketAdapter } from './base-websocket-adapter.js';

interface PipecatRtviAdapterOptions {
  config?: PipecatProviderConfig;
  capabilitiesOverride?: Partial<ProviderCapabilities>;
  socketFactory?: (url: string) => WebSocketLike;
  now?: () => number;
  maxReconnectRetries?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

interface WebSocketLike {
  readyState: number;
  binaryType?: 'blob' | 'arraybuffer';
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    handler: (event: unknown) => void,
    options?: AddEventListenerOptions
  ): void;
  removeEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    handler: (event: unknown) => void
  ): void;
}

interface RtviEnvelope<T = unknown> {
  id?: string;
  label?: string;
  type: string;
  data?: T;
}

interface RtviMessageData {
  t?: string;
  d?: unknown;
}

interface UserTranscriptionData {
  text?: string;
  final?: boolean;
  user_id?: string;
}

interface BotOutputData {
  text?: string;
  final?: boolean;
  aggregated_by?: string;
}

interface LlmFunctionCallData {
  function_name?: string;
  tool_call_id?: string;
  call_id?: string;
  name?: string;
  arguments?: unknown;
  args?: unknown;
}

interface LlmFunctionCallStoppedData {
  tool_call_id?: string;
  call_id?: string;
  cancelled?: boolean;
  result?: string;
  function_name?: string;
}

interface MetricsData {
  processing?: Array<{ processor?: string; value?: number; model?: string }>;
  ttfb?: Array<{ processor?: string; value?: number; model?: string }>;
  characters?: Array<{ processor?: string; value?: number }>;
}

interface AudioMessageData {
  audio?: string;
  data?: string;
  chunk?: string;
  sample_rate?: number;
  sampleRate?: number;
}

interface PendingUserTranscript {
  itemId: string;
  text: string;
}

interface PendingAssistantTranscript {
  itemId: string;
  text: string;
}

const DEFAULT_READY_TIMEOUT_MS = 12_000;
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 15_000;

function buildCapabilities(
  transport: PipecatProviderConfig['transport'],
  dynamic: Partial<ProviderCapabilities>,
  override?: Partial<ProviderCapabilities>
): ProviderCapabilities {
  const base: ProviderCapabilities = {
    toolCalling: true,
    transcriptDeltas: true,
    interruption: true,
    providerTransportKinds: [transport === 'webrtc' ? 'webrtc' : 'websocket'],
    audioNegotiation: true,
    vadModes: ['server', 'manual', 'disabled'],
    interruptionModes: ['barge-in'],
    toolTimeout: false,
    asyncTools: true,
    toolCancellation: true,
    toolScheduling: true,
    toolReaction: false,
    precomputableTools: false,
    toolApproval: false,
    mcpTools: false,
    serverSideTools: false,
    sessionResumption: false,
    midSessionConfigUpdate: true,
    contextCompression: false,
    forceAgentMessage: true,
    outputMediumSwitch: true,
    callState: true,
    deferredText: true,
    callStages: false,
    proactivity: false,
    usageMetrics: true,
    orderedTranscripts: true,
    ephemeralTokens: false,
    nativeTruncation: false,
    wordLevelTimestamps: false,
  };

  return {
    ...base,
    ...dynamic,
    ...(override ?? {}),
  };
}

function isVoiceState(value: unknown): value is VoiceState {
  return value === 'idle' || value === 'listening' || value === 'thinking' || value === 'speaking';
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJsonEnvelope(raw: string): RtviEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const object = parseObject(parsed);
    if (!object) return null;
    if (typeof object.type !== 'string') return null;
    return {
      id: typeof object.id === 'string' ? object.id : undefined,
      label: typeof object.label === 'string' ? object.label : undefined,
      type: object.type,
      data: object.data,
    };
  } catch {
    return null;
  }
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { raw: value };
    }
  }
  return {};
}

function normalizeToolResult(invocationId: string, value: ToolCallResult | string): ToolCallResult {
  if (typeof value === 'string') {
    return {
      invocationId,
      result: value,
    };
  }
  return {
    ...value,
    invocationId,
    result:
      typeof value.result === 'string'
        ? value.result
        : value.result === undefined
          ? ''
          : JSON.stringify(value.result),
  };
}

function computeDelta(previous: string, next: string): string {
  if (!previous) return next;
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  return next;
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function nowMs(now: () => number): number {
  return Math.floor(now());
}

function toCallId(value?: string): string {
  if (value && value.trim()) return value;
  return `pipecat-call-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function parseMetricDurationMs(value: number): number {
  // Pipecat metrics values are typically seconds (0.13), but some integrations
  // report milliseconds. Normalize heuristically to milliseconds.
  if (value <= 20) return value * 1000;
  return value;
}

const PIPECAT_CONFIG_SCHEMA: ProviderConfigSchema = {
  providerId: 'pipecat-rtvi',
  displayName: 'Pipecat RTVI',
  fields: [
    {
      key: 'readyTimeoutMs',
      label: 'Ready Timeout (ms)',
      type: 'number',
      group: 'advanced',
      min: 1000,
      max: 60000,
      step: 1000,
      defaultValue: 12000,
      description: 'Timeout waiting for bot-ready signal.',
    },
    {
      key: 'keepAliveIntervalMs',
      label: 'Keep-Alive Interval (ms)',
      type: 'number',
      group: 'advanced',
      min: 0,
      max: 60000,
      step: 1000,
      defaultValue: 15000,
      description: 'Ping interval. 0 = disabled.',
    },
  ],
  // Pipecat voices/VAD are configured server-side
};

export class PipecatRtviAdapter extends BaseWebSocketAdapter implements ProviderAdapter {
  readonly id = 'pipecat-rtvi' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private readonly options: PipecatRtviAdapterOptions;
  private readonly now: () => number;
  private socket: WebSocketLike | null = null;
  private config: PipecatProviderConfig | null = null;
  private input: SessionInput | null = null;
  private state: VoiceState = 'idle';
  private ready = false;
  private turnInProgress = false;
  private messageCounter = 0;
  private dynamicCapabilities: Partial<ProviderCapabilities> = {};

  private history: VoiceHistoryItem[] = [];
  private pendingUserByKey = new Map<string, PendingUserTranscript>();
  private pendingAssistant: PendingAssistantTranscript | null = null;
  private userSequence = 0;
  private assistantSequence = 0;
  private pendingTools = new Map<string, string>();
  private toolInFlight = new Set<string>();

  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: PipecatRtviAdapterOptions) {
    super({
      maxReconnectRetries: options?.maxReconnectRetries,
      reconnectBaseDelayMs: options?.reconnectBaseDelayMs,
      reconnectMaxDelayMs: options?.reconnectMaxDelayMs,
    });
    this.options = options ?? {};
    this.now = options?.now ?? (() => Date.now());
  }

  capabilities(): ProviderCapabilities {
    const transport = this.config?.transport ?? this.options.config?.transport ?? 'websocket';
    return buildCapabilities(transport, this.dynamicCapabilities, this.options.capabilitiesOverride);
  }

  configSchema(): ProviderConfigSchema {
    return PIPECAT_CONFIG_SCHEMA;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.input = input;
    this.config = this.resolveConfig(input);
    this.history = [];
    this.pendingUserByKey.clear();
    this.pendingAssistant = null;
    this.pendingTools.clear();
    this.toolInFlight.clear();
    this.dynamicCapabilities = {};
    this.ready = false;
    this.turnInProgress = false;

    await this.openAndHandshake();
    this.events.emit('connected');
    this.setState('listening');

    return {
      providerInputRate: this.config.inputSampleRate ?? DEFAULT_SAMPLE_RATE,
      providerOutputRate: this.config.outputSampleRate ?? DEFAULT_SAMPLE_RATE,
      preferredClientInputRate: DEFAULT_SAMPLE_RATE,
      preferredClientOutputRate: DEFAULT_SAMPLE_RATE,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    this.markDisconnecting(true);
    this.ready = false;
    this.turnInProgress = false;
    this.clearKeepAlive();
    this.rejectReady?.(new Error('Disconnected'));
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;

    if (!this.socket) {
      this.setState('idle');
      this.events.emit('disconnected');
      return;
    }

    try {
      this.sendEnvelope({
        type: 'disconnect-bot',
      });
    } catch {
      // ignore
    }

    this.socket.close();
    this.socket = null;
    this.setState('idle');
    this.events.emit('disconnected');
  }

  sendAudio(frame: AudioFrame): void {
    if (!this.socket || this.socket.readyState !== 1 || !this.config) return;
    const inputRate = this.config.inputSampleRate ?? DEFAULT_SAMPLE_RATE;
    const normalized = frame.sampleRate === inputRate ? frame : resamplePcm16Mono(frame, inputRate);

    if (this.config.audioInputEncoding === 'client-message-base64') {
      this.sendEnvelope({
        type: 'client-message',
        data: {
          t: this.config.audioInputMessageType ?? 'audio-input',
          d: {
            data: encodeBase64(normalized.data),
            sampleRate: normalized.sampleRate,
            format: normalized.format,
          },
        },
      });
      return;
    }

    this.socket.send(normalized.data);
  }

  sendText(text: string, options?: { defer?: boolean }): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.sendEnvelope({
      type: 'send-text',
      data: {
        text: trimmed,
        run_immediately: !(options?.defer ?? false),
        audio_response: true,
      },
    });
  }

  interrupt(): void {
    this.sendEnvelope({
      type: 'client-message',
      data: {
        t: 'interrupt-bot',
        d: {},
      },
    });
    this.events.emit('audioInterrupted');
    this.setState('listening');
  }

  truncateOutput(input: { itemId: string; audioEndMs: number }): void {
    this.sendEnvelope({
      type: 'client-message',
      data: {
        t: 'truncate-output',
        d: input,
      },
    });
  }

  sendToolResult(result: ToolCallResult): void {
    const callId = toCallId(result.invocationId);
    const name = this.pendingTools.get(callId) ?? 'tool';
    this.sendFunctionCallResult(name, callId, result);
    this.events.emit('toolEnd', name, result.result, callId);
    this.pendingTools.delete(callId);
    this.toolInFlight.delete(callId);
  }

  updateConfig(config: Partial<SessionInput>): void {
    this.sendEnvelope({
      type: 'update-config',
      data: config,
    });
  }

  forceAgentMessage(
    text: string,
    options?: { uninterruptible?: boolean; urgency?: 'immediate' | 'soon' }
  ): void {
    this.sendEnvelope({
      type: 'client-message',
      data: {
        t: 'force-agent-message',
        d: {
          text,
          uninterruptible: options?.uninterruptible ?? false,
          urgency: options?.urgency ?? 'soon',
        },
      },
    });
  }

  setOutputMedium(medium: 'voice' | 'text'): void {
    this.sendEnvelope({
      type: 'client-message',
      data: {
        t: 'set-output-medium',
        d: { medium },
      },
    });
  }

  async resume(handle: string): Promise<void> {
    this.sendEnvelope({
      type: 'client-message',
      data: {
        t: 'resume-session',
        d: { handle },
      },
    });
  }

  mute(muted: boolean): void {
    this.sendEnvelope({
      type: 'client-message',
      data: {
        t: 'set-mute',
        d: { muted },
      },
    });
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

  private async openAndHandshake(): Promise<void> {
    if (!this.config || !this.input) {
      throw new Error('Pipecat adapter missing config or input');
    }

    this.markDisconnecting(false);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    const serverUrl = this.config.serverUrl;
    if (!serverUrl) {
      throw new Error('Pipecat RTVI requires providerConfig.serverUrl');
    }

    await this.openSocket(serverUrl);
    this.sendClientReady();
    this.sendEnvelope({ type: 'describe-actions' });
    this.sendEnvelope({ type: 'describe-config' });
    this.sendBootstrapMessage();

    await this.waitForReady(this.config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
  }

  private async openSocket(url: string): Promise<void> {
    const socket = this.createSocket(url);
    this.socket = socket;
    if (typeof socket.binaryType === 'string') {
      socket.binaryType = 'arraybuffer';
    }

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event: unknown) => {
        socket.removeEventListener('open', onOpen);
        reject(this.toError(event, 'Pipecat RTVI websocket open error'));
      };
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
    });

    this.bindSocketHandlers(socket);
  }

  private bindSocketHandlers(socket: WebSocketLike): void {
    socket.addEventListener('message', (event: unknown) => {
      void this.handleSocketMessage(event);
    });

    socket.addEventListener('close', (_event: unknown) => {
      this.clearKeepAlive();
      this.socket = null;
      if (this.disconnecting) {
        return;
      }
      const closeEvent = parseObject(_event);
      const code = typeof closeEvent?.code === 'number' ? closeEvent.code : undefined;
      const reason =
        typeof closeEvent?.reason === 'string' && closeEvent.reason
          ? closeEvent.reason
          : undefined;
      void this.handleUnexpectedClose(code, reason);
    });

    socket.addEventListener('error', (event: unknown) => {
      const error = this.toError(event, 'Pipecat RTVI websocket error');
      if (!this.ready) {
        this.rejectReady?.(error);
      }
      this.events.emit('error', error);
    });
  }

  private async handleUnexpectedClose(code?: number, reason?: string): Promise<void> {
    this.ready = false;
    this.turnInProgress = false;
    const closeReason = [code ? `code=${code}` : null, reason ?? null]
      .filter((part): part is string => Boolean(part))
      .join(' ');
    this.events.emit(
      'error',
      new Error(
        closeReason
          ? `Pipecat RTVI websocket closed unexpectedly (${closeReason})`
          : 'Pipecat RTVI websocket closed unexpectedly'
      )
    );

    if (this.config?.reconnect === false) {
      this.setState('idle');
      this.events.emit('disconnected', closeReason ? `unexpected_close:${closeReason}` : 'unexpected_close');
      return;
    }

    const recovered = await this.tryReconnect(async () => {
      await this.openAndHandshake();
    });

    if (recovered) {
      this.events.emit('connected');
      this.setState('listening');
      return;
    }

    this.setState('idle');
    this.events.emit('disconnected', closeReason ? `reconnect_failed:${closeReason}` : 'reconnect_failed');
  }

  private async handleSocketMessage(rawEvent: unknown): Promise<void> {
    const data = this.extractMessageData(rawEvent);
    if (typeof data === 'string') {
      this.handleJsonMessage(data);
      return;
    }

    if (data instanceof ArrayBuffer) {
      this.emitAudioFrame(data, this.config?.outputSampleRate ?? DEFAULT_SAMPLE_RATE);
      return;
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      const payload = await data.arrayBuffer();
      this.emitAudioFrame(payload, this.config?.outputSampleRate ?? DEFAULT_SAMPLE_RATE);
      return;
    }

    if (data instanceof Uint8Array) {
      const copied = new Uint8Array(data.byteLength);
      copied.set(data);
      const payload = copied.buffer;
      this.emitAudioFrame(payload, this.config?.outputSampleRate ?? DEFAULT_SAMPLE_RATE);
    }
  }

  private handleJsonMessage(raw: string): void {
    const envelope = parseJsonEnvelope(raw);
    if (!envelope) return;

    switch (envelope.type) {
      case 'bot-ready':
        this.ready = true;
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
        this.startKeepAlive();
        return;
      case 'error':
      case 'error-response': {
        const data = parseObject(envelope.data);
        const message =
          (data && typeof data.message === 'string' && data.message) || 'Pipecat RTVI error';
        const error = new Error(message);
        if (!this.ready) {
          this.rejectReady?.(error);
        }
        this.events.emit('error', error);
        return;
      }
      case 'action-response':
        this.handleActionResponse(envelope.data);
        return;
      case 'user-started-speaking':
        this.events.emit('audioInterrupted');
        this.setState('listening');
        return;
      case 'user-stopped-speaking':
        this.setState('thinking');
        return;
      case 'bot-llm-started':
        this.startTurn('thinking');
        return;
      case 'bot-started-speaking':
        this.ensureAssistantItem();
        this.startTurn('speaking');
        return;
      case 'bot-stopped-speaking':
        this.finalizeAssistantItem();
        this.completeTurn();
        return;
      case 'bot-llm-stopped':
        if (this.state !== 'speaking') {
          this.finalizeAssistantItem();
          this.completeTurn();
        }
        return;
      case 'bot-interrupted':
        this.finalizeAssistantItem();
        this.completeTurn();
        this.events.emit('audioInterrupted');
        return;
      case 'user-transcription':
        this.handleUserTranscription(envelope.data);
        return;
      case 'bot-output':
      case 'bot-transcription':
      case 'bot-llm-text':
      case 'bot-tts-text':
        this.handleAssistantText(envelope.type, envelope.data);
        return;
      case 'llm-function-call':
      case 'llm-function-call-in-progress':
        void this.handleFunctionCall(envelope.data);
        return;
      case 'llm-function-call-stopped':
        this.handleFunctionCallStopped(envelope.data);
        return;
      case 'metrics':
        this.handleMetrics(envelope.data);
        return;
      case 'server-message':
        this.handleServerMessage(envelope.data);
        return;
      default:
        return;
    }
  }

  private handleActionResponse(rawData: unknown): void {
    const data = parseObject(rawData);
    if (!data) return;
    const actionsRaw = Array.isArray(data.actions) ? data.actions : [];
    const actions = actionsRaw
      .map((item) => {
        if (typeof item === 'string') return item;
        const object = parseObject(item);
        if (!object) return null;
        if (typeof object.action === 'string') return object.action;
        if (typeof object.service_action === 'string') return object.service_action;
        return null;
      })
      .filter((name): name is string => typeof name === 'string');

    if (actions.length === 0) return;

    this.dynamicCapabilities = {
      ...this.dynamicCapabilities,
      midSessionConfigUpdate: actions.includes('update-config'),
      sessionResumption:
        this.dynamicCapabilities.sessionResumption || actions.includes('resume-session'),
      forceAgentMessage:
        this.dynamicCapabilities.forceAgentMessage || actions.includes('force-agent-message'),
      outputMediumSwitch:
        this.dynamicCapabilities.outputMediumSwitch || actions.includes('set-output-medium'),
    };
  }

  private handleUserTranscription(rawData: unknown): void {
    const data = parseObject(rawData) as UserTranscriptionData | null;
    if (!data) return;
    const text = typeof data.text === 'string' ? data.text : '';
    if (!text) return;

    const key = typeof data.user_id === 'string' && data.user_id ? data.user_id : 'default';
    const pending = this.pendingUserByKey.get(key) ?? this.createPendingUser(key);
    const delta = computeDelta(pending.text, text);
    if (delta) {
      this.events.emit('transcriptDelta', delta, 'user', pending.itemId);
    }
    pending.text = text;
    this.pendingUserByKey.set(key, pending);

    if (data.final === true) {
      this.emitFinalUserTranscript(key, pending);
    }
  }

  private createPendingUser(key: string): PendingUserTranscript {
    this.userSequence += 1;
    const itemId = `pipecat-user-${key}-${this.userSequence}`;
    this.events.emit('userItemCreated', itemId);
    return {
      itemId,
      text: '',
    };
  }

  private emitFinalUserTranscript(key: string, pending: PendingUserTranscript): void {
    const finalText = pending.text.trim();
    if (!finalText) {
      this.pendingUserByKey.delete(key);
      return;
    }
    this.events.emit('transcript', finalText, 'user', pending.itemId);
    this.history.push({
      id: pending.itemId,
      role: 'user',
      text: finalText,
      createdAt: nowMs(this.now),
    });
    this.events.emit('historyUpdated', [...this.history]);
    this.pendingUserByKey.delete(key);
  }

  private handleAssistantText(type: string, rawData: unknown): void {
    if (type === 'bot-transcription' || type === 'bot-llm-text' || type === 'bot-tts-text') {
      const data = parseObject(rawData);
      const text = data && typeof data.text === 'string' ? data.text : '';
      if (!text) return;
      this.appendAssistantText(text);
      return;
    }

    const data = parseObject(rawData) as BotOutputData | null;
    if (!data) return;
    const text = typeof data.text === 'string' ? data.text : '';
    if (!text) return;

    this.appendAssistantText(text);
    if (data.final === true) {
      this.finalizeAssistantItem();
      if (this.state !== 'speaking') {
        this.completeTurn();
      }
    }
  }

  private appendAssistantText(text: string): void {
    const pending = this.ensureAssistantItem();
    const delta = computeDelta(pending.text, text);
    if (text.startsWith(pending.text)) {
      pending.text = text;
    } else {
      pending.text += delta;
    }
    if (delta) {
      this.events.emit('transcriptDelta', delta, 'assistant', pending.itemId);
    }
  }

  private ensureAssistantItem(): PendingAssistantTranscript {
    if (this.pendingAssistant) return this.pendingAssistant;
    if (!this.turnInProgress) {
      this.startTurn('thinking');
    }
    this.assistantSequence += 1;
    const itemId = `pipecat-assistant-${this.assistantSequence}`;
    this.pendingAssistant = {
      itemId,
      text: '',
    };
    this.events.emit('assistantItemCreated', itemId);
    return this.pendingAssistant;
  }

  private finalizeAssistantItem(): void {
    if (!this.pendingAssistant) return;
    const finalText = this.pendingAssistant.text.trim();
    if (finalText) {
      this.events.emit('transcript', finalText, 'assistant', this.pendingAssistant.itemId);
      this.history.push({
        id: this.pendingAssistant.itemId,
        role: 'assistant',
        text: finalText,
        createdAt: nowMs(this.now),
      });
      this.events.emit('historyUpdated', [...this.history]);
    }
    this.pendingAssistant = null;
  }

  private async handleFunctionCall(rawData: unknown): Promise<void> {
    const data = parseObject(rawData) as LlmFunctionCallData | null;
    if (!data) return;

    const callId = toCallId(data.tool_call_id ?? data.call_id);
    const name =
      (typeof data.function_name === 'string' && data.function_name) ||
      (typeof data.name === 'string' && data.name) ||
      'pipecat_tool';
    const args = parseToolArguments(data.arguments ?? data.args);

    if (!this.pendingTools.has(callId)) {
      this.pendingTools.set(callId, name);
      this.events.emit('toolStart', name, args, callId);
    }

    const toolHandlerEnabled = this.config?.autoToolExecution !== false && this.input?.toolHandler;
    if (!toolHandlerEnabled || this.toolInFlight.has(callId) || !this.input?.toolHandler) {
      return;
    }

    this.toolInFlight.add(callId);
    try {
      const context: ToolCallContext = {
        providerId: this.id,
        callId,
        invocationId: callId,
        history: [...this.history],
      };
      const rawResult = await this.input.toolHandler(name, args, context);
      const normalized = normalizeToolResult(callId, rawResult);
      this.sendFunctionCallResult(name, callId, normalized);
      this.events.emit('toolEnd', name, normalized.result, callId);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.sendFunctionCallResult(name, callId, {
        invocationId: callId,
        result: errorMessage,
        isError: true,
      });
      this.events.emit('toolEnd', name, errorMessage, callId);
      this.events.emit('error', error as Error);
    } finally {
      this.toolInFlight.delete(callId);
      this.pendingTools.delete(callId);
    }
  }

  private handleFunctionCallStopped(rawData: unknown): void {
    const data = parseObject(rawData) as LlmFunctionCallStoppedData | null;
    if (!data) return;
    const callId = toCallId(data.tool_call_id ?? data.call_id);
    const knownCall = this.pendingTools.has(callId) || this.toolInFlight.has(callId);

    if (data.cancelled) {
      if (knownCall) {
        this.events.emit('toolCancelled', [callId]);
      }
      this.pendingTools.delete(callId);
      this.toolInFlight.delete(callId);
      return;
    }

    if (!knownCall || typeof data.result !== 'string') return;

    const name = this.pendingTools.get(callId) ?? data.function_name ?? 'pipecat_tool';
    this.events.emit('toolEnd', name, data.result, callId);
    this.pendingTools.delete(callId);
    this.toolInFlight.delete(callId);
  }

  private sendFunctionCallResult(
    name: string,
    callId: string,
    result: ToolCallResult
  ): void {
    const response = {
      output: maybeParseJson(result.result),
      is_error: result.isError ?? false,
      error_message: result.errorMessage,
      scheduling: result.scheduling,
      state_update: result.stateUpdate,
      stage_transition: result.stageTransition ?? false,
    };

    this.sendEnvelope({
      type: 'llm-function-call-result',
      data: {
        function_name: name,
        tool_call_id: callId,
        result: response,
        run_llm: result.agentReaction !== 'listens',
      },
    });
  }

  private handleMetrics(rawData: unknown): void {
    const data = parseObject(rawData) as MetricsData | null;
    if (!data) return;

    const processing = Array.isArray(data.processing) ? data.processing : [];
    for (const metric of processing) {
      if (!metric || typeof metric.value !== 'number') continue;
      this.events.emit('latency', {
        stage: 'turn',
        durationMs: parseMetricDurationMs(metric.value),
        provider: 'pipecat-rtvi',
        model: metric.model,
        details: {
          processor: metric.processor,
          metric: 'processing',
        },
      });
    }

    const ttfb = Array.isArray(data.ttfb) ? data.ttfb : [];
    for (const metric of ttfb) {
      if (!metric || typeof metric.value !== 'number') continue;
      this.events.emit('latency', {
        stage: 'tts',
        durationMs: parseMetricDurationMs(metric.value),
        provider: 'pipecat-rtvi',
        model: metric.model,
        details: {
          processor: metric.processor,
          metric: 'ttfb',
        },
      });
    }

    const characters = Array.isArray(data.characters) ? data.characters : [];
    if (characters.length > 0) {
      const outputChars = characters.reduce((sum, item) => {
        if (!item || typeof item.value !== 'number') return sum;
        return sum + item.value;
      }, 0);
      this.events.emit('usage', {
        outputTokenDetails: {
          textTokens: outputChars,
        },
      });
    }
  }

  private handleServerMessage(rawData: unknown): void {
    const payload = parseObject(rawData) as RtviMessageData | null;
    if (!payload || typeof payload.t !== 'string') return;
    switch (payload.t) {
      case 'bot-audio':
      case 'bot-tts-audio':
      case 'audio':
        this.handleAudioMessage(payload.d);
        return;
      case 'state': {
        const statePayload = parseObject(payload.d);
        if (!statePayload) return;
        const state = statePayload.state;
        if (isVoiceState(state)) {
          this.setState(state);
        }
        return;
      }
      case 'tool-call':
        void this.handleFunctionCall(payload.d);
        return;
      case 'user-transcription':
        this.handleUserTranscription(payload.d);
        return;
      case 'bot-output':
        this.handleAssistantText('bot-output', payload.d);
        return;
      default:
        return;
    }
  }

  private handleAudioMessage(rawData: unknown): void {
    const data = parseObject(rawData) as AudioMessageData | null;
    if (!data) return;
    const base64Audio =
      (typeof data.audio === 'string' && data.audio) ||
      (typeof data.data === 'string' && data.data) ||
      (typeof data.chunk === 'string' && data.chunk) ||
      '';
    if (!base64Audio) return;
    const sampleRate =
      (typeof data.sample_rate === 'number' && data.sample_rate > 0 && data.sample_rate) ||
      (typeof data.sampleRate === 'number' && data.sampleRate > 0 && data.sampleRate) ||
      this.config?.outputSampleRate ||
      DEFAULT_SAMPLE_RATE;
    this.emitAudioFrame(decodeBase64(base64Audio), sampleRate);
  }

  private emitAudioFrame(data: ArrayBuffer, sampleRate: number): void {
    this.events.emit('audio', {
      data,
      sampleRate,
      format: 'pcm16',
    });
  }

  private sendClientReady(): void {
    this.sendEnvelope({
      type: 'client-ready',
      data: {
        version: this.config?.clientVersion ?? '0.0.1',
        client: 'voice-runtime',
        transport: this.config?.transport ?? 'websocket',
      },
    });
  }

  private sendBootstrapMessage(): void {
    if (!this.input || !this.config) return;
    this.sendEnvelope({
      type: 'client-message',
      data: {
        t: this.config.bootstrapMessageType ?? 'voice-runtime-start',
        d: {
          instructions: this.input.instructions,
          model: this.input.model,
          voice: this.input.voice,
          language: this.input.language,
          temperature: this.input.temperature,
          maxOutputTokens: this.input.maxOutputTokens,
          tools: this.input.tools ?? [],
          pipeline: this.config.pipeline,
          botId: this.config.botId,
        },
      },
    });
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    if (this.ready) return;
    if (!this.readyPromise) {
      throw new Error('Pipecat ready promise not initialized');
    }

    await Promise.race([
      this.readyPromise,
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Pipecat RTVI bot-ready timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }

  private sendEnvelope(payload: RtviEnvelope): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.messageCounter += 1;
    const envelope: RtviEnvelope = {
      id: payload.id ?? `rtvi-${Date.now()}-${this.messageCounter}`,
      label: payload.label ?? 'rtvi-ai',
      ...payload,
    };
    this.socket.send(JSON.stringify(envelope));
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);
  }

  private startTurn(state: VoiceState): void {
    if (!this.turnInProgress) {
      this.turnInProgress = true;
      this.events.emit('turnStarted');
    }
    this.setState(state);
  }

  private completeTurn(): void {
    if (!this.turnInProgress) {
      this.setState('listening');
      return;
    }
    this.turnInProgress = false;
    this.setState('listening');
    this.events.emit('turnComplete');
  }

  private extractMessageData(rawEvent: unknown): unknown {
    const event = parseObject(rawEvent);
    if (event && 'data' in event) {
      return event.data;
    }
    return rawEvent;
  }

  private resolveConfig(input: SessionInput): PipecatProviderConfig {
    if (this.options.config) {
      const parsed = parsePipecatProviderConfig(this.options.config);
      if (!parsed.serverUrl) {
        throw new Error('Pipecat RTVI requires providerConfig.serverUrl or adapter constructor config');
      }
      return parsed;
    }

    const raw = parsePipecatProviderConfig(input.providerConfig);
    const serverUrl = raw.serverUrl;
    if (!serverUrl) {
      throw new Error('Pipecat RTVI requires providerConfig.serverUrl or adapter constructor config');
    }

    return {
      serverUrl,
      transport: raw.transport ?? 'websocket',
      inputSampleRate: raw.inputSampleRate,
      outputSampleRate: raw.outputSampleRate,
      audioInputEncoding: raw.audioInputEncoding,
      audioInputMessageType: raw.audioInputMessageType,
      readyTimeoutMs: raw.readyTimeoutMs,
      reconnect: raw.reconnect,
      clientVersion: raw.clientVersion,
      autoToolExecution: raw.autoToolExecution,
      bootstrapMessageType: raw.bootstrapMessageType,
      keepAliveIntervalMs: raw.keepAliveIntervalMs,
      pingMessageType: raw.pingMessageType,
      pipeline: raw.pipeline,
      botId: raw.botId,
    };
  }

  private createSocket(url: string): WebSocketLike {
    if (this.options.socketFactory) {
      return this.options.socketFactory(url);
    }
    return new WebSocket(url) as unknown as WebSocketLike;
  }

  private toError(raw: unknown, fallback: string): Error {
    const event = parseObject(raw);
    if (!event) return new Error(fallback);

    if (typeof event.message === 'string' && event.message) {
      return new Error(event.message);
    }

    const innerError = parseObject(event.error);
    if (innerError && typeof innerError.message === 'string' && innerError.message) {
      return new Error(innerError.message);
    }

    return new Error(fallback);
  }

  private startKeepAlive(): void {
    this.clearKeepAlive();
    const intervalMs =
      this.config?.keepAliveIntervalMs === undefined
        ? DEFAULT_KEEPALIVE_INTERVAL_MS
        : this.config.keepAliveIntervalMs;
    if (!intervalMs || intervalMs <= 0) return;
    this.keepAliveTimer = setInterval(() => {
      this.sendEnvelope({
        type: 'client-message',
        data: {
          t: this.config?.pingMessageType ?? 'ping',
          d: {
            ts: Date.now(),
          },
        },
      });
    }, intervalMs);
  }

  private clearKeepAlive(): void {
    if (!this.keepAliveTimer) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }
}

function maybeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
