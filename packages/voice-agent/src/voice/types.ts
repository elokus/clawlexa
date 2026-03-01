import type { IAudioTransport } from '../transport/types.js';
import type {
  LatencyMetric,
  RuntimeProviderName,
  RuntimeResolvedConfig,
  RuntimeVoiceMode,
  SpokenWordCue,
  SpokenWordCueUpdate,
  SpokenWordTimestamp,
} from '@voiceclaw/voice-runtime';

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type VoiceMode = RuntimeVoiceMode;
export type VoiceProviderName = RuntimeProviderName;

export interface VoiceRuntimeAudio {
  data: ArrayBuffer;
  sampleRate?: number;
  format?: 'pcm16';
}

export interface VoiceRuntimeHistoryItem {
  id: string;
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: Array<{ type: 'text'; text: string }>;
}

export interface VoiceRuntimeEvents {
  stateChange: (state: AgentState) => void;
  audio: (audio: VoiceRuntimeAudio) => void;
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
  spokenDelta: (
    delta: string,
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
  spokenProgress: (
    itemId: string,
    progress: {
      spokenChars: number;
      spokenWords: number;
      playbackMs: number;
      precision: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
    }
  ) => void;
  spokenFinal: (
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
  historyUpdated: (history: VoiceRuntimeHistoryItem[]) => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
  toolStart: (name: string, args: Record<string, unknown>, callId?: string) => void;
  toolEnd: (name: string, result: string, callId?: string) => void;
  latency: (metric: LatencyMetric) => void;
}

export interface VoiceRuntime {
  readonly mode: VoiceMode;
  readonly provider: VoiceProviderName;

  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;

  sendAudio(audio: ArrayBuffer): void;
  sendMessage(text: string): void;
  interrupt(): void;

  getState(): AgentState;
  getHistory(): VoiceRuntimeHistoryItem[];
  attachAudioTransport?(transport: IAudioTransport): Promise<void>;
  detachAudioTransport?(): Promise<void>;
  usesInternalTransport?(): boolean;

  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void;
}

export type DecomposedTurnConfig = RuntimeResolvedConfig['turn'];
export type VoiceRuntimeConfig = RuntimeResolvedConfig;
