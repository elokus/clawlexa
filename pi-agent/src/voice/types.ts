import type { RealtimeItem, TransportLayerAudio } from '@openai/agents/realtime';

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type VoiceMode = 'voice-to-voice' | 'decomposed';
export type VoiceProviderName =
  | 'openai-realtime'
  | 'gemini-live'
  | 'ultravox-realtime'
  | 'decomposed';

export interface VoiceRuntimeEvents {
  stateChange: (state: AgentState) => void;
  audio: (audio: TransportLayerAudio) => void;
  audioInterrupted: () => void;
  transcript: (text: string, role: 'user' | 'assistant', itemId?: string) => void;
  transcriptDelta: (delta: string, role: 'user' | 'assistant', itemId?: string) => void;
  userItemCreated: (itemId: string) => void;
  assistantItemCreated: (itemId: string, previousItemId?: string) => void;
  historyUpdated: (history: RealtimeItem[]) => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
  toolStart: (name: string, args: Record<string, unknown>, callId?: string) => void;
  toolEnd: (name: string, result: string, callId?: string) => void;
  latency: (metric: {
    stage: 'stt' | 'llm' | 'tts' | 'turn';
    durationMs: number;
    provider?: string;
    model?: string;
    details?: Record<string, unknown>;
  }) => void;
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
  getHistory(): RealtimeItem[];

  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void;
}

export interface DecomposedTurnConfig {
  strategy: 'provider-native' | 'layered';
  silenceMs: number;
  minSpeechMs: number;
  minRms: number;
  llmCompletionEnabled: boolean;
  llmShortTimeoutMs: number;
  llmLongTimeoutMs: number;
  llmShortReprompt: string;
  llmLongReprompt: string;
}

export interface VoiceRuntimeConfig {
  mode: VoiceMode;
  provider: VoiceProviderName;

  // Common
  language: string;
  voice: string;

  // Voice-to-voice providers
  model: string;
  geminiModel: string;
  geminiVoice: string;
  ultravoxModel: string;

  // Decomposed providers
  decomposedSttProvider: 'deepgram' | 'openai';
  decomposedSttModel: string;
  decomposedLlmProvider: 'openai' | 'openrouter';
  decomposedLlmModel: string;
  decomposedTtsProvider: 'deepgram' | 'openai';
  decomposedTtsModel: string;
  decomposedTtsVoice: string;

  // Auth resolution
  auth: {
    openaiApiKey: string;
    openrouterApiKey: string;
    googleApiKey: string;
    deepgramApiKey: string;
    ultravoxApiKey: string;
  };

  turn: DecomposedTurnConfig;
}
