export type VoiceProviderId =
  | 'openai-sdk'
  | 'openai-ws'
  | 'ultravox-ws'
  | 'gemini-live'
  | 'decomposed'
  | 'pipecat-rtvi';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type ClientTransportKind = 'local-pcm' | 'ws-pcm' | 'webrtc';
export type ProviderTransportKind = 'websocket' | 'webrtc' | 'http' | 'sdk';

export type EventHandler<Events, K extends keyof Events> =
  NonNullable<Events[K]> extends (...args: infer Args) => void
    ? (...args: Args) => void
    : never;

export interface AudioFrame {
  data: ArrayBuffer;
  sampleRate: number;
  format: 'pcm16';
}

export interface VoiceHistoryItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  createdAt: number;
  providerMeta?: Record<string, unknown>;
}

export interface LatencyMetric {
  stage: 'stt' | 'llm' | 'tts' | 'turn' | 'tool' | 'connection';
  durationMs: number;
  provider?: string;
  model?: string;
  details?: Record<string, unknown>;
}

export interface UsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    textTokens?: number;
    audioTokens?: number;
    cachedTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    audioTokens?: number;
  };
}

export interface ProviderCapabilities {
  toolCalling: boolean;
  transcriptDeltas: boolean;
  interruption: boolean;

  providerTransportKinds: ProviderTransportKind[];
  audioNegotiation: boolean;
  vadModes: Array<'server' | 'semantic' | 'manual' | 'disabled'>;
  interruptionModes: Array<'barge-in' | 'no-interruption'>;

  toolTimeout: boolean;
  asyncTools: boolean;
  toolCancellation: boolean;
  toolScheduling: boolean;
  toolReaction: boolean;
  precomputableTools: boolean;
  toolApproval: boolean;
  mcpTools: boolean;
  serverSideTools: boolean;

  sessionResumption: boolean;
  midSessionConfigUpdate: boolean;
  contextCompression: boolean;

  forceAgentMessage: boolean;
  outputMediumSwitch: boolean;
  callState: boolean;
  deferredText: boolean;
  callStages: boolean;
  proactivity: boolean;
  usageMetrics: boolean;
  orderedTranscripts: boolean;
  ephemeralTokens: boolean;
  nativeTruncation: boolean;
  wordLevelTimestamps: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  precomputable?: boolean;
  timeout?: number;
  defaultReaction?: ToolReaction;
  nonBlocking?: boolean;
}

export type ToolReaction = 'speaks' | 'listens' | 'speaks-once';

export interface ToolCallContext {
  providerId: VoiceProviderId;
  callId: string;
  invocationId: string;
  history: VoiceHistoryItem[];
}

export interface ToolCallResult {
  invocationId: string;
  result: string;
  isError?: boolean;
  errorMessage?: string;
  agentReaction?: 'speaks' | 'listens' | 'speaks-once';
  scheduling?: 'interrupt' | 'when_idle' | 'silent';
  stateUpdate?: Record<string, unknown>;
  stageTransition?: boolean;
}

export type ToolCallHandler = (
  name: string,
  args: Record<string, unknown>,
  context: ToolCallContext
) => Promise<ToolCallResult | string>;

export interface VoiceSessionEvents {
  connected: () => void;
  disconnected: (reason?: string) => void;
  stateChange: (state: VoiceState) => void;

  audio: (frame: AudioFrame) => void;
  audioInterrupted: () => void;

  transcript: (text: string, role: 'user' | 'assistant', itemId?: string) => void;
  transcriptDelta: (delta: string, role: 'user' | 'assistant', itemId?: string) => void;
  userItemCreated: (itemId: string) => void;
  assistantItemCreated: (itemId: string, previousItemId?: string) => void;

  historyUpdated: (history: VoiceHistoryItem[]) => void;

  toolStart: (name: string, args: Record<string, unknown>, callId: string) => void;
  toolEnd: (name: string, result: string, callId: string) => void;
  toolCancelled?: (callIds: string[]) => void;

  latency: (metric: LatencyMetric) => void;
  usage?: (metrics: UsageMetrics) => void;
  interruptionResolved?: (context: InterruptionContext) => void;

  error: (error: Error) => void;
  turnStarted?: () => void;
  turnComplete?: () => void;
}

export interface InterruptionContext {
  itemId?: string;
  fullText: string;
  spokenText: string;
  playbackPositionMs: number;
  truncated: boolean;
}

export interface AudioNegotiation {
  providerInputRate: number;
  providerOutputRate: number;
  preferredClientInputRate?: number;
  preferredClientOutputRate?: number;
  format: 'pcm16';
}

export interface SessionInput {
  provider: VoiceProviderId;
  instructions: string;
  voice: string;
  model: string;
  language?: string;
  temperature?: number;
  maxOutputTokens?: number;

  tools?: ToolDefinition[];
  toolHandler?: ToolCallHandler;

  vad?: {
    mode?: 'server' | 'semantic' | 'manual' | 'disabled';
    silenceDurationMs?: number;
    threshold?: number;
    eagerness?: 'low' | 'medium' | 'high' | 'auto';
    autoResponse?: boolean;
    autoInterrupt?: boolean;
  };

  providerConfig?: Record<string, unknown>;
}

export interface ClientTransportStartConfig {
  inputRate: number;
  outputRate: number;
  format: 'pcm16';
}

export interface ClientTransport {
  readonly kind: ClientTransportKind;
  start(config: ClientTransportStartConfig): Promise<void>;
  stop(): Promise<void>;

  onAudioFrame(handler: (frame: AudioFrame) => void): void;
  offAudioFrame(handler: (frame: AudioFrame) => void): void;

  playAudioFrame(frame: AudioFrame): void;
  interruptPlayback(): void;
  getPlaybackPositionMs?(): number;
}

export interface ProviderAdapter {
  readonly id: VoiceProviderId;
  capabilities(): ProviderCapabilities;

  connect(input: SessionInput): Promise<AudioNegotiation>;
  disconnect(): Promise<void>;

  sendAudio(frame: AudioFrame): void;
  sendText(text: string, options?: { defer?: boolean }): void;
  interrupt(): void;
  truncateOutput?(input: { itemId: string; audioEndMs: number }): void;
  sendToolResult(result: ToolCallResult): void;

  on<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void;
  off<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void;

  updateConfig?(config: Partial<SessionInput>): void;
  forceAgentMessage?(
    text: string,
    options?: { uninterruptible?: boolean; urgency?: 'immediate' | 'soon' }
  ): void;
  setOutputMedium?(medium: 'voice' | 'text'): void;
  resume?(handle: string): Promise<void>;
  mute?(muted: boolean): void;
}

export interface VoiceSession {
  connect(): Promise<void>;
  close(): Promise<void>;

  attachClientTransport(transport: ClientTransport): Promise<void>;
  detachClientTransport(): Promise<void>;

  sendAudio(frame: AudioFrame): void;
  sendText(text: string): void;
  interrupt(): void;

  getState(): VoiceState;
  getHistory(): VoiceHistoryItem[];
  getCapabilities(): ProviderCapabilities;

  on<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void;
  off<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void;

  updateConfig?(config: Partial<SessionInput>): void;
  forceAgentMessage?(
    text: string,
    options?: { uninterruptible?: boolean; urgency?: 'immediate' | 'soon' }
  ): void;
  setOutputMedium?(medium: 'voice' | 'text'): void;
  resume?(handle: string): Promise<void>;
  mute?(muted: boolean): void;
}

export interface ProviderDescriptor {
  id: VoiceProviderId;
  label: string;
  capabilities: ProviderCapabilities;
}

export interface VoiceRuntime {
  listProviders(): ProviderDescriptor[];
  createSession(input: SessionInput): Promise<VoiceSession>;
}

export interface OpenAIProviderConfig extends Record<string, unknown> {
  apiKey?: string;
  language?: string;
  transcriptionModel?: string;
  turnDetection?: 'server_vad' | 'semantic_vad';
}

export interface UltravoxProviderConfig extends Record<string, unknown> {
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  voice?: string;
  clientBufferSizeMs?: number;
  inputSampleRate?: number;
  outputSampleRate?: number;
}

export interface GeminiProviderConfig extends Record<string, unknown> {
  apiKey?: string;
  endpoint?: string;
  apiVersion?: 'v1alpha' | 'v1beta';
  enableInputTranscription?: boolean;
  enableOutputTranscription?: boolean;
  noInterruption?: boolean;
  contextWindowCompressionTokens?: number;
  proactivity?: boolean;
  sessionResumptionHandle?: string;
  useEphemeralToken?: boolean;
}

export interface DecomposedProviderConfig extends Record<string, unknown> {
  openaiApiKey?: string;
  openrouterApiKey?: string;
  deepgramApiKey?: string;
  sttProvider?: 'openai' | 'deepgram';
  sttModel?: string;
  llmProvider?: 'openai' | 'openrouter';
  llmModel?: string;
  ttsProvider?: 'openai' | 'deepgram';
  ttsModel?: string;
  ttsVoice?: string;
  deepgramTtsTransport?: 'websocket';
  deepgramTtsWsUrl?: string;
  turn?: {
    silenceMs?: number;
    minSpeechMs?: number;
    minRms?: number;
    llmCompletionEnabled?: boolean;
    llmShortTimeoutMs?: number;
    llmLongTimeoutMs?: number;
    llmShortReprompt?: string;
    llmLongReprompt?: string;
  };
}

export interface PipecatProviderConfig extends Record<string, unknown> {
  serverUrl?: string;
  transport: 'websocket' | 'webrtc';
  inputSampleRate?: number;
  outputSampleRate?: number;
  audioInputEncoding?: 'binary-pcm16' | 'client-message-base64';
  audioInputMessageType?: string;
  readyTimeoutMs?: number;
  reconnect?: boolean;
  clientVersion?: string;
  autoToolExecution?: boolean;
  bootstrapMessageType?: string;
  keepAliveIntervalMs?: number;
  pingMessageType?: string;
  pipeline?: {
    stt?: { provider: string; model: string };
    llm: { provider: string; model: string };
    tts?: { provider: string; model: string; voice?: string };
  };
  botId?: string;
}
