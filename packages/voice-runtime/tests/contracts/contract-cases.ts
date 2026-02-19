import type { ProviderContractCase } from './contract-types.js';

const RELAXED_BENCH_THRESHOLDS = {
  maxFirstAudioLatencyMs: 5_000,
  maxP95ChunkGapMs: 5_000,
  maxChunkGapMs: 5_000,
  minRealtimeFactor: 0.05,
  maxRealtimeFactor: 5,
  maxDuplicateAssistantFinals: 0,
  maxOutOfOrderAssistantItems: 0,
  maxInterruptionP95Ms: 5_000,
};

export const PROVIDER_CONTRACT_CASES: ProviderContractCase[] = [
  {
    id: 'streaming_ordering_basic',
    fixtureFile: 'streaming-ordering-basic.jsonl',
    expected: {
      turnStarted: 1,
      turnComplete: 1,
      toolStarts: 0,
      toolEnds: 0,
      assistantFinals: ['Hello world'],
    },
    thresholds: RELAXED_BENCH_THRESHOLDS,
    timeoutMs: 1_000,
  },
  {
    id: 'tool_call_mid_turn',
    fixtureFile: 'tool-call-mid-turn.jsonl',
    requirements: {
      toolCalling: true,
    },
    expected: {
      turnStarted: 1,
      turnComplete: 1,
      toolStarts: 1,
      toolEnds: 1,
      assistantFinals: ['Checking weather for Berlin.'],
    },
    thresholds: RELAXED_BENCH_THRESHOLDS,
    timeoutMs: 1_000,
  },
];
