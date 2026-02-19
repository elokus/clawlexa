import type {
  ProviderCapabilities,
  VoiceProviderId,
  VoiceState,
} from '../../src/types.js';
import type { VoiceBenchmarkThresholds } from '../../src/benchmarks/voice-benchmark.js';

export type ReplayFixtureEvent =
  | {
      atMs: number;
      type: 'state';
      state: VoiceState;
    }
  | {
      atMs: number;
      type: 'turn_started' | 'turn_complete' | 'audio_interrupted';
    }
  | {
      atMs: number;
      type: 'assistant_item' | 'user_item';
      itemId: string;
      previousItemId?: string;
    }
  | {
      atMs: number;
      type: 'transcript_delta' | 'transcript_final';
      role: 'user' | 'assistant';
      text: string;
      itemId?: string;
    }
  | {
      atMs: number;
      type: 'audio';
      durationMs: number;
      sampleRate?: number;
    }
  | {
      atMs: number;
      type: 'tool_start';
      name: string;
      callId: string;
      args?: Record<string, unknown>;
    }
  | {
      atMs: number;
      type: 'tool_end';
      name: string;
      callId: string;
      result: string;
    };

export interface ProviderContractCase {
  id: string;
  fixtureFile: string;
  requirements?: Partial<Pick<ProviderCapabilities, 'toolCalling'>>;
  expected: {
    turnStarted: number;
    turnComplete: number;
    toolStarts: number;
    toolEnds: number;
    assistantFinals: string[];
  };
  thresholds?: VoiceBenchmarkThresholds;
  expectedBenchmarkPass?: boolean;
  expectedBenchmarkViolations?: string[];
  timeoutMs?: number;
}

export interface ProviderContractTimelineEntry {
  index: number;
  kind:
    | 'assistant_item'
    | 'user_item'
    | 'assistant_delta'
    | 'assistant_final'
    | 'user_delta'
    | 'user_final'
    | 'tool_start'
    | 'tool_end'
    | 'turn_started'
    | 'turn_complete';
  itemId?: string;
  callId?: string;
  text?: string;
}

export interface ProviderContractResult {
  providerId: VoiceProviderId;
  skipped: boolean;
  skipReason?: string;
  turnStarted: number;
  turnComplete: number;
  toolStarts: number;
  toolEnds: number;
  assistantFinals: string[];
  timeline: ProviderContractTimelineEntry[];
  benchmarkPass: boolean;
  benchmarkViolations: string[];
}
