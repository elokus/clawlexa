import type { ProviderContractCase } from './contract-types.js';

const RELAXED_BENCH_THRESHOLDS = {
  maxFirstAudioLatencyMs: 5_000,
  maxP95ChunkGapMs: 5_000,
  maxChunkGapMs: 5_000,
  minRealtimeFactor: 0.05,
  maxRealtimeFactor: 5,
  maxDuplicateAssistantFinals: 0,
  maxOutOfOrderConversationItems: 0,
  maxOutOfOrderAssistantItems: 0,
  maxOrphanAssistantItems: 0,
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
  {
    id: 'benchmark_detects_orphan_assistant_item',
    fixtureFile: 'orphan-assistant-item.jsonl',
    expected: {
      turnStarted: 1,
      turnComplete: 1,
      toolStarts: 0,
      toolEnds: 0,
      assistantFinals: ['Na, was brauchst du?'],
    },
    thresholds: RELAXED_BENCH_THRESHOLDS,
    expectedBenchmarkPass: false,
    expectedBenchmarkViolations: ['Orphan assistant items'],
    timeoutMs: 1_000,
  },
  {
    id: 'benchmark_detects_cross_role_ordering_regression',
    fixtureFile: 'out-of-order-cross-role.jsonl',
    expected: {
      turnStarted: 1,
      turnComplete: 1,
      toolStarts: 0,
      toolEnds: 0,
      assistantFinals: ['Na, was brauchst du?'],
    },
    thresholds: RELAXED_BENCH_THRESHOLDS,
    expectedBenchmarkPass: false,
    expectedBenchmarkViolations: ['Out-of-order conversation items'],
    timeoutMs: 1_000,
  },
];
