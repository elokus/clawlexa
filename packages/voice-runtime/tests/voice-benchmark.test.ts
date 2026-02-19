import { describe, expect, test } from 'bun:test';
import {
  VoiceBenchmarkRecorder,
  evaluateVoiceBenchmark,
  type VoiceBenchmarkInput,
} from '../src/benchmarks/voice-benchmark.js';

function makeAudioChunk(atMs: number, durationMs = 100) {
  const sampleRate = 24_000;
  const bytes = Math.round((durationMs / 1000) * sampleRate) * 2;
  return {
    emittedAtMs: atMs,
    byteLength: bytes,
    sampleRate,
  };
}

describe('evaluateVoiceBenchmark', () => {
  test('passes stable real-time audio stream', () => {
    const input: VoiceBenchmarkInput = {
      turnStartedAtMs: 0,
      audioChunks: [
        makeAudioChunk(120),
        makeAudioChunk(220),
        makeAudioChunk(320),
        makeAudioChunk(420),
      ],
      transcripts: [
        { emittedAtMs: 150, role: 'assistant', kind: 'delta', text: 'Hello', itemId: 'a-1' },
        { emittedAtMs: 450, role: 'assistant', kind: 'final', text: 'Hello there', itemId: 'a-1' },
      ],
      interruptions: [{ requestedAtMs: 300, stoppedAtMs: 360 }],
    };

    const report = evaluateVoiceBenchmark(input);
    expect(report.pass).toBe(true);
    expect(report.violations).toHaveLength(0);
    expect(report.chunkCadence.p95GapMs).toBeLessThanOrEqual(100);
  });

  test('flags slow/choppy audio pacing', () => {
    const input: VoiceBenchmarkInput = {
      turnStartedAtMs: 0,
      audioChunks: [makeAudioChunk(100), makeAudioChunk(280), makeAudioChunk(760), makeAudioChunk(1_350)],
      transcripts: [],
    };

    const report = evaluateVoiceBenchmark(input, {
      maxP95ChunkGapMs: 250,
      maxChunkGapMs: 400,
    });
    expect(report.pass).toBe(false);
    expect(report.violations.some((line) => line.includes('Audio chunk p95 gap'))).toBe(true);
    expect(report.violations.some((line) => line.includes('Audio max chunk gap'))).toBe(true);
  });

  test('flags duplicate assistant finals and ordering regressions', () => {
    const input: VoiceBenchmarkInput = {
      audioChunks: [makeAudioChunk(100), makeAudioChunk(200)],
      transcripts: [
        { emittedAtMs: 110, role: 'assistant', kind: 'final', text: 'A', itemId: 'assistant-2' },
        { emittedAtMs: 120, role: 'assistant', kind: 'final', text: 'A', itemId: 'assistant-2' },
      ],
      assistantItems: [
        { emittedAtMs: 90, itemId: 'assistant-5' },
        { emittedAtMs: 95, itemId: 'assistant-3' },
      ],
    };

    const report = evaluateVoiceBenchmark(input);
    expect(report.pass).toBe(false);
    expect(report.transcriptOrdering.duplicateAssistantFinals).toBe(1);
    expect(report.transcriptOrdering.outOfOrderConversationItems).toBe(0);
    expect(report.transcriptOrdering.outOfOrderAssistantItems).toBe(1);
    expect(report.transcriptOrdering.orphanAssistantItems).toBe(2);
    expect(report.violations.some((line) => line.includes('Orphan assistant items'))).toBe(true);
  });

  test('flags cross-role out-of-order conversation items', () => {
    const input: VoiceBenchmarkInput = {
      audioChunks: [makeAudioChunk(100), makeAudioChunk(200)],
      transcripts: [
        { emittedAtMs: 105, role: 'assistant', kind: 'delta', text: 'Na', itemId: 'assistant-2' },
        { emittedAtMs: 110, role: 'user', kind: 'final', text: 'Hi', itemId: 'user-1' },
        {
          emittedAtMs: 140,
          role: 'assistant',
          kind: 'final',
          text: 'Na, was brauchst du?',
          itemId: 'assistant-2',
        },
      ],
    };

    const report = evaluateVoiceBenchmark(input);
    expect(report.pass).toBe(false);
    expect(report.transcriptOrdering.outOfOrderConversationItems).toBe(1);
    expect(report.violations.some((line) => line.includes('Out-of-order conversation items'))).toBe(
      true
    );
  });

  test('flags orphan assistant placeholders with whitespace-only deltas', () => {
    const input: VoiceBenchmarkInput = {
      audioChunks: [makeAudioChunk(100), makeAudioChunk(200)],
      assistantItems: [
        { emittedAtMs: 95, itemId: 'assistant-1' },
        { emittedAtMs: 100, itemId: 'assistant-2' },
      ],
      transcripts: [
        { emittedAtMs: 96, role: 'assistant', kind: 'delta', text: '\n', itemId: 'assistant-1' },
        { emittedAtMs: 110, role: 'assistant', kind: 'delta', text: 'Na', itemId: 'assistant-2' },
        {
          emittedAtMs: 120,
          role: 'assistant',
          kind: 'final',
          text: 'Na, was brauchst du?',
          itemId: 'assistant-2',
        },
      ],
    };

    const report = evaluateVoiceBenchmark(input);
    expect(report.pass).toBe(false);
    expect(report.transcriptOrdering.orphanAssistantItems).toBe(1);
    expect(report.violations.some((line) => line.includes('Orphan assistant items'))).toBe(true);
  });
});

describe('VoiceBenchmarkRecorder', () => {
  test('records runtime events and computes interruption latency', () => {
    let now = 0;
    const recorder = new VoiceBenchmarkRecorder(() => now);

    recorder.markTurnStarted();

    now = 80;
    recorder.recordAudio({
      data: new ArrayBuffer(4_800),
      sampleRate: 24_000,
      format: 'pcm16',
    });

    now = 180;
    recorder.recordAudio({
      data: new ArrayBuffer(4_800),
      sampleRate: 24_000,
      format: 'pcm16',
    });

    now = 380;
    recorder.recordAudio({
      data: new ArrayBuffer(4_800),
      sampleRate: 24_000,
      format: 'pcm16',
    });

    now = 300;
    recorder.recordAssistantItem('assistant-1');
    recorder.recordTranscript('delta', 'Hello', 'assistant', 'assistant-1');

    now = 320;
    recorder.markInterruptionRequested();

    now = 400;
    recorder.markInterruptionStopped();
    recorder.recordTranscript('final', 'Hello world', 'assistant', 'assistant-1');

    const report = recorder.evaluate({
      maxInterruptionP95Ms: 120,
    });
    expect(report.pass).toBe(true);
    expect(report.firstAudioLatencyMs).toBe(80);
    expect(report.interruption.count).toBe(1);
    expect(report.interruption.medianMs).toBe(80);
  });
});
