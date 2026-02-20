import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import {
  VoiceBenchmarkRecorder,
  evaluateVoiceBenchmark,
  getDefaultRuntimeBenchmarkThresholds,
  type VoiceBenchmarkInput,
  type VoiceBenchmarkReport,
  type VoiceBenchmarkThresholds,
} from '@voiceclaw/voice-runtime';
import type { AgentState, VoiceProviderName, VoiceRuntimeAudio } from './types.js';

interface SessionBenchmarkMeta {
  sessionId: string;
  profile: string;
  provider: VoiceProviderName;
  startedAt: string;
  finishedAt: string;
  reason: 'disconnected' | 'deactivate' | 'connect-failed';
}

interface SessionBenchmarkPayload {
  meta: SessionBenchmarkMeta;
  thresholds: VoiceBenchmarkThresholds;
  input: VoiceBenchmarkInput;
  report: VoiceBenchmarkReport;
}

interface VoiceSessionBenchmarkParams {
  sessionId: string;
  profile: string;
  provider: VoiceProviderName;
  enabled: boolean;
  outputDir: string;
  thresholds: VoiceBenchmarkThresholds;
  now?: () => number;
}

export interface VoiceBenchmarkFinalizeResult {
  report: VoiceBenchmarkReport;
  outputPath?: string;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function parseThresholdOverridesFromEnv(): VoiceBenchmarkThresholds {
  return {
    maxFirstAudioLatencyMs: parseNumber(process.env.VOICE_BENCH_MAX_FIRST_AUDIO_MS),
    maxP95ChunkGapMs: parseNumber(process.env.VOICE_BENCH_MAX_P95_CHUNK_GAP_MS),
    maxChunkGapMs: parseNumber(process.env.VOICE_BENCH_MAX_CHUNK_GAP_MS),
    minRealtimeFactor: parseNumber(process.env.VOICE_BENCH_MIN_RTF),
    maxRealtimeFactor: parseNumber(process.env.VOICE_BENCH_MAX_RTF),
    maxDuplicateAssistantFinals: parseNumber(process.env.VOICE_BENCH_MAX_DUP_ASSISTANT_FINALS),
    maxOutOfOrderAssistantItems: parseNumber(process.env.VOICE_BENCH_MAX_OUT_OF_ORDER_ITEMS),
    maxInterruptionP95Ms: parseNumber(process.env.VOICE_BENCH_MAX_INTERRUPT_P95_MS),
  };
}

export function mergeThresholds(
  provider: VoiceProviderName,
  overrides: VoiceBenchmarkThresholds
): VoiceBenchmarkThresholds {
  return {
    ...getDefaultRuntimeBenchmarkThresholds(provider),
    ...overrides,
  };
}

export function resolveOutputDir(): string {
  if (process.env.VOICE_BENCH_OUTPUT_DIR) {
    return path.resolve(process.cwd(), process.env.VOICE_BENCH_OUTPUT_DIR);
  }

  const cwdBase = path.basename(process.cwd());
  if (cwdBase === 'voice-agent') {
    return path.resolve(process.cwd(), '..', '..', '.benchmarks', 'voice');
  }
  return path.resolve(process.cwd(), '.benchmarks', 'voice');
}

function toTimestampFilePart(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function createVoiceSessionBenchmark(params: {
  sessionId: string;
  profile: string;
  provider: VoiceProviderName;
  now?: () => number;
}): VoiceSessionBenchmark | null {
  const enabled = process.env.VOICE_BENCHMARK_ENABLED === 'true';
  if (!enabled) return null;

  const thresholds = mergeThresholds(params.provider, parseThresholdOverridesFromEnv());
  return new VoiceSessionBenchmark({
    sessionId: params.sessionId,
    profile: params.profile,
    provider: params.provider,
    enabled,
    outputDir: resolveOutputDir(),
    thresholds,
    now: params.now,
  });
}

export class VoiceSessionBenchmark {
  private readonly recorder: VoiceBenchmarkRecorder;
  private readonly params: VoiceSessionBenchmarkParams;
  private readonly startedAtIso: string;
  private finalized = false;
  private turnActive = false;

  constructor(params: VoiceSessionBenchmarkParams) {
    this.params = params;
    this.recorder = new VoiceBenchmarkRecorder(params.now);
    this.startedAtIso = new Date(params.now ? params.now() : Date.now()).toISOString();
  }

  onStateChange(state: AgentState): void {
    if (!this.params.enabled) return;

    if ((state === 'thinking' || state === 'speaking') && !this.turnActive) {
      this.turnActive = true;
      this.recorder.markTurnStarted();
      return;
    }

    if (state === 'listening' || state === 'idle') {
      this.turnActive = false;
    }
  }

  onAudio(audio: VoiceRuntimeAudio): void {
    if (!this.params.enabled || !(audio.data instanceof ArrayBuffer)) return;
    this.recorder.recordAudio({
      data: audio.data,
      sampleRate: audio.sampleRate ?? 24000,
      format: audio.format ?? 'pcm16',
    });
  }

  onTranscriptFinal(text: string, role: 'user' | 'assistant', itemId?: string): void {
    if (!this.params.enabled) return;
    this.recorder.recordTranscript('final', text, role, itemId);
  }

  onTranscriptDelta(delta: string, role: 'user' | 'assistant', itemId?: string): void {
    if (!this.params.enabled) return;
    this.recorder.recordTranscript('delta', delta, role, itemId);
  }

  onAssistantItemCreated(itemId: string): void {
    if (!this.params.enabled) return;
    this.recorder.recordAssistantItem(itemId);
  }

  markInterruptionRequested(): void {
    if (!this.params.enabled) return;
    this.recorder.markInterruptionRequested();
  }

  markInterruptionStopped(): void {
    if (!this.params.enabled) return;
    this.recorder.markInterruptionStopped();
  }

  finalize(reason: SessionBenchmarkMeta['reason']): VoiceBenchmarkFinalizeResult | null {
    if (!this.params.enabled || this.finalized) return null;
    this.finalized = true;

    const input = this.recorder.buildInput();
    const report = evaluateVoiceBenchmark(input, this.params.thresholds);

    const payload: SessionBenchmarkPayload = {
      meta: {
        sessionId: this.params.sessionId,
        profile: this.params.profile,
        provider: this.params.provider,
        startedAt: this.startedAtIso,
        finishedAt: new Date(this.params.now ? this.params.now() : Date.now()).toISOString(),
        reason,
      },
      thresholds: this.params.thresholds,
      input,
      report,
    };

    let outputPath: string | undefined;
    try {
      mkdirSync(this.params.outputDir, { recursive: true });
      const timestampPart = toTimestampFilePart(new Date());
      const fileName = `${timestampPart}-${this.params.provider}-${this.params.sessionId.slice(0, 8)}.json`;
      outputPath = path.join(this.params.outputDir, fileName);
      writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.error(
        `[VoiceBenchmark] failed writing report: ${(error as Error).message}`
      );
    }

    return {
      report,
      outputPath,
    };
  }
}
