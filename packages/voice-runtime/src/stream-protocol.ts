import type {
  LatencyMetric,
  SpokenWordCue,
  SpokenWordCueUpdate,
  VoiceState,
} from './types.js';

/**
 * Precision level for spoken transcript synchronization.
 */
export type SpokenPrecision =
  | 'ratio'
  | 'segment'
  | 'aligned'
  | 'provider-word-timestamps';

export interface AISDKFinishStepUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

/**
 * Unified stream event contract shared by voice-agent and web-ui.
 * The runtime is the source of truth for voice event normalization.
 */
export type AISDKStreamEvent =
  | {
      type: 'text-delta';
      textDelta: string;
      itemId?: string;
      order?: number;
      channel?: 'generated' | 'spoken';
    }
  | {
      type: 'spoken-delta';
      textDelta: string;
      itemId?: string;
      order?: number;
      spokenChars?: number;
      spokenWords?: number;
      playbackMs?: number;
      precision?: SpokenPrecision;
      wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>;
      wordCues?: SpokenWordCue[];
      wordCueUpdate?: SpokenWordCueUpdate;
    }
  | {
      type: 'spoken-progress';
      itemId: string;
      spokenChars: number;
      spokenWords: number;
      playbackMs: number;
      precision: SpokenPrecision;
    }
  | {
      type: 'spoken-final';
      text: string;
      itemId?: string;
      order?: number;
      spokenChars?: number;
      spokenWords?: number;
      playbackMs?: number;
      precision?: SpokenPrecision;
      wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>;
      wordCues?: SpokenWordCue[];
      wordCueUpdate?: SpokenWordCueUpdate;
    }
  | { type: 'user-transcript'; text: string; itemId?: string; order?: number }
  | { type: 'user-placeholder'; itemId: string; previousItemId?: string; order?: number }
  | {
      type: 'assistant-placeholder';
      itemId: string;
      previousItemId?: string;
      order?: number;
    }
  | { type: 'tool-call'; toolName: string; toolCallId: string; input: unknown }
  | { type: 'tool-result'; toolName: string; toolCallId: string; output: unknown }
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-end'; text: string; durationMs?: number }
  | { type: 'start' }
  | { type: 'start-step' }
  | {
      type: 'finish-step';
      finishReason?: string;
      usage?: AISDKFinishStepUsage;
    }
  | { type: 'finish'; finishReason: string }
  | { type: 'error'; error: string }
  | {
      type: 'latency';
      stage: LatencyMetric['stage'];
      durationMs: number;
      provider?: string;
      model?: string;
      details?: Record<string, unknown>;
    }
  | {
      type: 'process-status';
      processName: string;
      sessionId: string;
      status: 'completed' | 'error';
      summary?: string;
    };

export interface StreamChunkMessage {
  type: 'stream_chunk';
  sessionId: string;
  event: AISDKStreamEvent;
  timestamp: number;
}

export type StreamSessionStatus = 'running' | 'finished' | 'error' | 'cancelled';

export interface StreamSessionMeta {
  sessionId: string;
  agentName: string;
  status: StreamSessionStatus;
}

export function createStreamChunk(
  sessionId: string,
  event: AISDKStreamEvent
): StreamChunkMessage {
  return {
    type: 'stream_chunk',
    sessionId,
    event,
    timestamp: Date.now(),
  };
}

/**
 * Voice-agent WebSocket envelope contract used by web-ui.
 */
export type WSMessageType =
  | 'state_change'
  | 'transcript'
  | 'audio_start'
  | 'audio_end'
  | 'tool_start'
  | 'tool_end'
  | 'item_pending'
  | 'item_completed'
  | 'cli_session_update'
  | 'cli_session_created'
  | 'cli_session_output'
  | 'subagent_activity'
  | 'request_master'
  | 'welcome'
  | 'stream_chunk'
  | 'session_tree_update'
  | 'master_changed'
  | 'service_state_changed'
  | 'audio_control'
  | 'session_started'
  | 'session_ended'
  | 'cli_session_deleted'
  | 'error';

export interface WSMessage<TPayload = unknown> {
  type: WSMessageType;
  payload: TPayload;
  timestamp: number;
}

export interface WelcomePayload {
  clientId: string;
  isMaster: boolean;
  serviceActive: boolean;
  audioMode: 'web' | 'local';
}

export interface ServiceStateChangedPayload {
  active: boolean;
  mode: 'web' | 'local';
}

export interface MasterChangedPayload {
  masterId: string;
}

export interface StateChangePayload {
  state: VoiceState;
  profile: string | null;
}

export interface SessionStartedPayload {
  sessionId?: string;
  profile?: string;
}

export interface AudioControlPayload {
  action: 'start' | 'stop' | 'interrupt';
}

export interface StreamChunkPayload {
  sessionId: string;
  event: AISDKStreamEvent;
}
