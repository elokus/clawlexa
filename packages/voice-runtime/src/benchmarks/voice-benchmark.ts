import type { AudioFrame } from '../types.js';

export interface BenchmarkAudioChunk {
  emittedAtMs: number;
  byteLength: number;
  sampleRate: number;
}

export interface BenchmarkTranscriptEvent {
  emittedAtMs: number;
  role: 'user' | 'assistant';
  kind: 'delta' | 'final';
  text: string;
  itemId?: string;
}

export interface BenchmarkAssistantItemEvent {
  emittedAtMs: number;
  itemId: string;
}

export interface BenchmarkInterruptionSample {
  requestedAtMs: number;
  stoppedAtMs: number;
}

export interface VoiceBenchmarkInput {
  turnStartedAtMs?: number;
  audioChunks: BenchmarkAudioChunk[];
  transcripts: BenchmarkTranscriptEvent[];
  assistantItems?: BenchmarkAssistantItemEvent[];
  interruptions?: BenchmarkInterruptionSample[];
}

export interface VoiceBenchmarkThresholds {
  maxFirstAudioLatencyMs?: number;
  maxP95ChunkGapMs?: number;
  maxChunkGapMs?: number;
  minRealtimeFactor?: number;
  maxRealtimeFactor?: number;
  maxDuplicateAssistantFinals?: number;
  maxOutOfOrderConversationItems?: number;
  maxOutOfOrderAssistantItems?: number;
  maxOrphanAssistantItems?: number;
  maxInterruptionP95Ms?: number;
}

export interface VoiceBenchmarkReport {
  pass: boolean;
  violations: string[];
  firstAudioLatencyMs?: number;
  chunkCadence: {
    medianGapMs: number;
    p95GapMs: number;
    maxGapMs: number;
    p95JitterMs: number;
  };
  realtimeFactor?: number;
  transcriptOrdering: {
    duplicateAssistantFinals: number;
    outOfOrderConversationItems: number;
    outOfOrderAssistantItems: number;
    orphanAssistantItems: number;
  };
  interruption: {
    count: number;
    medianMs: number;
    p95Ms: number;
    maxMs: number;
  };
}

const DEFAULT_THRESHOLDS: Required<VoiceBenchmarkThresholds> = {
  maxFirstAudioLatencyMs: 1_500,
  maxP95ChunkGapMs: 280,
  maxChunkGapMs: 550,
  minRealtimeFactor: 0.85,
  maxRealtimeFactor: 1.35,
  maxDuplicateAssistantFinals: 0,
  maxOutOfOrderConversationItems: 0,
  maxOutOfOrderAssistantItems: 0,
  maxOrphanAssistantItems: 0,
  maxInterruptionP95Ms: 220,
};

export function evaluateVoiceBenchmark(
  input: VoiceBenchmarkInput,
  thresholds: VoiceBenchmarkThresholds = {}
): VoiceBenchmarkReport {
  const config = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };
  const violations: string[] = [];

  const sortedAudio = [...input.audioChunks].sort((a, b) => a.emittedAtMs - b.emittedAtMs);
  const gaps = computeGaps(sortedAudio.map((chunk) => chunk.emittedAtMs));
  const medianGapMs = percentile(gaps, 50);
  const p95GapMs = percentile(gaps, 95);
  const maxGapMs = gaps.length > 0 ? Math.max(...gaps) : 0;
  const jitter = gaps.map((gap) => Math.abs(gap - medianGapMs));
  const p95JitterMs = percentile(jitter, 95);

  let firstAudioLatencyMs: number | undefined;
  if (typeof input.turnStartedAtMs === 'number' && sortedAudio.length > 0) {
    const firstAudio = sortedAudio[0];
    if (firstAudio) {
      firstAudioLatencyMs = Math.max(0, firstAudio.emittedAtMs - input.turnStartedAtMs);
    }
    if (
      typeof firstAudioLatencyMs === 'number' &&
      firstAudioLatencyMs > config.maxFirstAudioLatencyMs
    ) {
      violations.push(
        `First-audio latency ${firstAudioLatencyMs.toFixed(1)}ms exceeds ${config.maxFirstAudioLatencyMs}ms`
      );
    }
  }

  if (p95GapMs > config.maxP95ChunkGapMs) {
    violations.push(`Audio chunk p95 gap ${p95GapMs.toFixed(1)}ms exceeds ${config.maxP95ChunkGapMs}ms`);
  }
  if (maxGapMs > config.maxChunkGapMs) {
    violations.push(`Audio max chunk gap ${maxGapMs.toFixed(1)}ms exceeds ${config.maxChunkGapMs}ms`);
  }

  const realtimeFactor = computeRealtimeFactor(sortedAudio);
  if (typeof realtimeFactor === 'number') {
    if (realtimeFactor < config.minRealtimeFactor || realtimeFactor > config.maxRealtimeFactor) {
      violations.push(
        `Realtime factor ${realtimeFactor.toFixed(3)} outside [${config.minRealtimeFactor}, ${config.maxRealtimeFactor}]`
      );
    }
  }

  const duplicateAssistantFinals = countDuplicateAssistantFinals(input.transcripts);
  if (duplicateAssistantFinals > config.maxDuplicateAssistantFinals) {
    violations.push(
      `Duplicate assistant finals ${duplicateAssistantFinals} exceeds ${config.maxDuplicateAssistantFinals}`
    );
  }

  const outOfOrderConversationItems = countOutOfOrderConversationItems(input.transcripts);
  if (outOfOrderConversationItems > config.maxOutOfOrderConversationItems) {
    violations.push(
      `Out-of-order conversation items ${outOfOrderConversationItems} exceeds ${config.maxOutOfOrderConversationItems}`
    );
  }

  const outOfOrderAssistantItems = countOutOfOrderAssistantItems(
    input.assistantItems ?? collectAssistantItems(input.transcripts)
  );
  if (outOfOrderAssistantItems > config.maxOutOfOrderAssistantItems) {
    violations.push(
      `Out-of-order assistant items ${outOfOrderAssistantItems} exceeds ${config.maxOutOfOrderAssistantItems}`
    );
  }

  const orphanAssistantItems = countOrphanAssistantItems(
    input.assistantItems ?? collectAssistantItems(input.transcripts),
    input.transcripts
  );
  if (orphanAssistantItems > config.maxOrphanAssistantItems) {
    violations.push(
      `Orphan assistant items ${orphanAssistantItems} exceeds ${config.maxOrphanAssistantItems}`
    );
  }

  const interruptionLatencies = (input.interruptions ?? [])
    .map((sample) => sample.stoppedAtMs - sample.requestedAtMs)
    .filter((latency) => latency >= 0);
  const interruptionMedianMs = percentile(interruptionLatencies, 50);
  const interruptionP95Ms = percentile(interruptionLatencies, 95);
  const interruptionMaxMs =
    interruptionLatencies.length > 0 ? Math.max(...interruptionLatencies) : 0;
  if (
    interruptionLatencies.length > 0 &&
    interruptionP95Ms > config.maxInterruptionP95Ms
  ) {
    violations.push(
      `Interruption p95 ${interruptionP95Ms.toFixed(1)}ms exceeds ${config.maxInterruptionP95Ms}ms`
    );
  }

  return {
    pass: violations.length === 0,
    violations,
    firstAudioLatencyMs,
    chunkCadence: {
      medianGapMs,
      p95GapMs,
      maxGapMs,
      p95JitterMs,
    },
    realtimeFactor,
    transcriptOrdering: {
      duplicateAssistantFinals,
      outOfOrderConversationItems,
      outOfOrderAssistantItems,
      orphanAssistantItems,
    },
    interruption: {
      count: interruptionLatencies.length,
      medianMs: interruptionMedianMs,
      p95Ms: interruptionP95Ms,
      maxMs: interruptionMaxMs,
    },
  };
}

export class VoiceBenchmarkRecorder {
  private turnStartedAtMs?: number;
  private readonly audioChunks: BenchmarkAudioChunk[] = [];
  private readonly transcripts: BenchmarkTranscriptEvent[] = [];
  private readonly assistantItems: BenchmarkAssistantItemEvent[] = [];
  private readonly interruptionRequests: number[] = [];
  private readonly interruptions: BenchmarkInterruptionSample[] = [];
  private readonly now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  markTurnStarted(timestampMs = this.now()): void {
    this.turnStartedAtMs = timestampMs;
  }

  recordAudio(frame: AudioFrame, timestampMs = this.now()): void {
    this.audioChunks.push({
      emittedAtMs: timestampMs,
      byteLength: frame.data.byteLength,
      sampleRate: frame.sampleRate,
    });
  }

  recordTranscript(
    kind: 'delta' | 'final',
    text: string,
    role: 'user' | 'assistant',
    itemId?: string,
    timestampMs = this.now()
  ): void {
    this.transcripts.push({
      emittedAtMs: timestampMs,
      kind,
      text,
      role,
      itemId,
    });
  }

  recordAssistantItem(itemId: string, timestampMs = this.now()): void {
    this.assistantItems.push({
      emittedAtMs: timestampMs,
      itemId,
    });
  }

  markInterruptionRequested(timestampMs = this.now()): void {
    this.interruptionRequests.push(timestampMs);
  }

  markInterruptionStopped(timestampMs = this.now()): void {
    const requestedAtMs = this.interruptionRequests.shift();
    if (typeof requestedAtMs !== 'number') return;
    this.interruptions.push({
      requestedAtMs,
      stoppedAtMs: timestampMs,
    });
  }

  buildInput(): VoiceBenchmarkInput {
    return {
      turnStartedAtMs: this.turnStartedAtMs,
      audioChunks: [...this.audioChunks],
      transcripts: [...this.transcripts],
      assistantItems: [...this.assistantItems],
      interruptions: [...this.interruptions],
    };
  }

  evaluate(thresholds?: VoiceBenchmarkThresholds): VoiceBenchmarkReport {
    return evaluateVoiceBenchmark(this.buildInput(), thresholds);
  }
}

function computeRealtimeFactor(chunks: BenchmarkAudioChunk[]): number | undefined {
  if (chunks.length < 2) return undefined;
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (!first || !last) return undefined;

  const wallDurationMs = Math.max(1, last.emittedAtMs - first.emittedAtMs);
  const audioDurationMs = chunks.reduce((sum, chunk) => {
    if (chunk.sampleRate <= 0) return sum;
    return sum + (chunk.byteLength / 2 / chunk.sampleRate) * 1000;
  }, 0);

  return audioDurationMs / wallDurationMs;
}

function countDuplicateAssistantFinals(events: BenchmarkTranscriptEvent[]): number {
  const finals = events.filter((event) => event.role === 'assistant' && event.kind === 'final');
  const byItem = new Map<string, number>();
  let duplicates = 0;

  for (const event of finals) {
    const key = event.itemId ?? `${event.text}:${event.emittedAtMs}`;
    const seen = byItem.get(key) ?? 0;
    if (seen > 0) duplicates += 1;
    byItem.set(key, seen + 1);
  }

  return duplicates;
}

function collectAssistantItems(events: BenchmarkTranscriptEvent[]): BenchmarkAssistantItemEvent[] {
  return events
    .filter((event) => event.role === 'assistant' && typeof event.itemId === 'string')
    .map((event) => ({
      itemId: event.itemId as string,
      emittedAtMs: event.emittedAtMs,
    }));
}

function countOutOfOrderConversationItems(events: BenchmarkTranscriptEvent[]): number {
  if (events.length <= 1) return 0;
  const ordered = [...events].sort((a, b) => a.emittedAtMs - b.emittedAtMs);
  const firstSeenItemIds: string[] = [];
  const seen = new Set<string>();

  for (const event of ordered) {
    if ((event.role !== 'assistant' && event.role !== 'user') || typeof event.itemId !== 'string') {
      continue;
    }
    if (seen.has(event.itemId)) continue;
    seen.add(event.itemId);
    firstSeenItemIds.push(event.itemId);
  }

  let outOfOrder = 0;
  let lastNumeric = Number.NEGATIVE_INFINITY;
  for (const itemId of firstSeenItemIds) {
    const numeric = parseTrailingNumber(itemId);
    if (numeric === null) continue;
    if (numeric < lastNumeric) {
      outOfOrder += 1;
    }
    lastNumeric = Math.max(lastNumeric, numeric);
  }
  return outOfOrder;
}

function countOutOfOrderAssistantItems(events: BenchmarkAssistantItemEvent[]): number {
  if (events.length <= 1) return 0;
  const ordered = [...events].sort((a, b) => a.emittedAtMs - b.emittedAtMs);
  let outOfOrder = 0;
  let lastNumeric = Number.NEGATIVE_INFINITY;

  for (const event of ordered) {
    const numeric = parseTrailingNumber(event.itemId);
    if (numeric === null) continue;
    if (numeric < lastNumeric) {
      outOfOrder += 1;
    }
    lastNumeric = Math.max(lastNumeric, numeric);
  }

  return outOfOrder;
}

function countOrphanAssistantItems(
  assistantItems: BenchmarkAssistantItemEvent[],
  transcripts: BenchmarkTranscriptEvent[]
): number {
  if (assistantItems.length === 0) return 0;

  const assistantItemIds = new Set(assistantItems.map((event) => event.itemId));
  const itemIdsWithMeaningfulText = new Set<string>();

  for (const event of transcripts) {
    if (event.role !== 'assistant') continue;
    if (typeof event.itemId !== 'string') continue;
    if (!assistantItemIds.has(event.itemId)) continue;
    if (event.text.trim().length === 0) continue;
    itemIdsWithMeaningfulText.add(event.itemId);
  }

  let orphanCount = 0;
  for (const itemId of assistantItemIds) {
    if (!itemIdsWithMeaningfulText.has(itemId)) {
      orphanCount += 1;
    }
  }
  return orphanCount;
}

function parseTrailingNumber(value: string): number | null {
  const uvxMatch = value.match(/^(?:assistant|user)-(\d+)$/);
  if (uvxMatch?.[1]) {
    const parsed = Number.parseInt(uvxMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const decomposedMatch = value.match(/^decomp-(?:assistant|user|context)-(\d+)-[a-z0-9]+$/i);
  if (decomposedMatch?.[1]) {
    const parsed = Number.parseInt(decomposedMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function computeGaps(values: number[]): number[] {
  if (values.length < 2) return [];
  const gaps: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1];
    const current = values[i];
    if (typeof previous !== 'number' || typeof current !== 'number') continue;
    gaps.push(Math.max(0, current - previous));
  }
  return gaps;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const normalized = Math.min(100, Math.max(0, percentileValue));
  const index = Math.floor((normalized / 100) * (sorted.length - 1));
  const value = sorted[index];
  return typeof value === 'number' ? value : 0;
}
