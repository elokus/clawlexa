import type {
  ConfigFieldDescriptor,
  ConfigFieldOption,
  ConfigFieldType,
  DecomposedProviderConfig,
  GeminiProviderConfig,
  OpenAIProviderConfig,
  PipecatProviderConfig,
  ProviderConfigSchema,
  ProviderVoiceEntry,
  ToolCallContext,
  ToolCallHandler,
  ToolCallResult,
  ToolDefinition,
  ToolReaction,
  UltravoxProviderConfig,
  VoiceHistoryItem,
  VoiceProviderId,
} from '@voiceclaw/ai-core/voice';

export type {
  ConfigFieldDescriptor,
  ConfigFieldOption,
  ConfigFieldType,
  DecomposedProviderConfig,
  GeminiProviderConfig,
  OpenAIProviderConfig,
  PipecatProviderConfig,
  ProviderConfigSchema,
  ProviderVoiceEntry,
  ToolCallContext,
  ToolCallHandler,
  ToolCallResult,
  ToolDefinition,
  ToolReaction,
  UltravoxProviderConfig,
  VoiceHistoryItem,
  VoiceProviderId,
};

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

export interface SpokenWordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export type SpokenWordCueSource = 'provider' | 'synthetic';
export type SpokenWordCueTimeBase = 'utterance';

export interface SpokenWordCue {
  word: string;
  startMs: number;
  endMs: number;
  source: SpokenWordCueSource;
  timeBase: SpokenWordCueTimeBase;
}

export interface SpokenWordCueUpdate {
  mode: 'append' | 'replace';
  cues: SpokenWordCue[];
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

export interface VoiceSessionEvents {
  connected: () => void;
  disconnected: (reason?: string) => void;
  stateChange: (state: VoiceState) => void;

  audio: (frame: AudioFrame) => void;
  audioInterrupted: () => void;

  transcript: (
    text: string,
    role: 'user' | 'assistant',
    itemId?: string,
    order?: number
  ) => void;
  transcriptDelta: (
    delta: string,
    role: 'user' | 'assistant',
    itemId?: string,
    order?: number
  ) => void;
  spokenDelta?: (
    delta: string,
    role: 'assistant',
    itemId?: string,
    meta?: {
      spokenChars?: number;
      spokenWords?: number;
      playbackMs?: number;
      speechOnsetMs?: number;
      precision?: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
      wordTimestamps?: SpokenWordTimestamp[];
      wordTimestampsTimeBase?: 'segment' | 'utterance';
      wordCues?: SpokenWordCue[];
      wordCueUpdate?: SpokenWordCueUpdate;
    }
  ) => void;
  spokenProgress?: (
    itemId: string,
    progress: {
      spokenChars: number;
      spokenWords: number;
      playbackMs: number;
      precision: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
    }
  ) => void;
  spokenFinal?: (
    text: string,
    role: 'assistant',
    itemId?: string,
    meta?: {
      spokenChars?: number;
      spokenWords?: number;
      playbackMs?: number;
      precision?: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
      wordTimestamps?: SpokenWordTimestamp[];
      wordTimestampsTimeBase?: 'segment' | 'utterance';
      wordCues?: SpokenWordCue[];
      wordCueUpdate?: SpokenWordCueUpdate;
    }
  ) => void;
  userItemCreated: (itemId: string, order?: number) => void;
  assistantItemCreated: (
    itemId: string,
    previousItemId?: string,
    order?: number
  ) => void;

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
  spokenWordIndex?: number;
  spokenWordCount?: number;
  precision?: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
  spans?: Array<{
    id?: string;
    text: string;
    startMs: number;
    endMs: number;
    type: 'segment' | 'word';
  }>;
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
    prefixPaddingMs?: number;
    startOfSpeechSensitivity?: 'high' | 'low';
    endOfSpeechSensitivity?: 'high' | 'low';
    autoResponse?: boolean;
    autoInterrupt?: boolean;
  };

  providerConfig?: Record<string, unknown>;

  turn?: {
    spokenHighlightMsPerWord?: number;
    spokenHighlightPunctuationPauseMs?: number;
    preferProviderTimestamps?: boolean;
  };
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
  configSchema?(): ProviderConfigSchema;

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
