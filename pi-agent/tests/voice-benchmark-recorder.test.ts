import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VoiceSessionBenchmark } from '../src/voice/benchmark-recorder.js';

describe('VoiceSessionBenchmark', () => {
  test('records session metrics and writes a benchmark report file', () => {
    let now = 0;
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-bench-'));

    const benchmark = new VoiceSessionBenchmark({
      sessionId: '12345678-1234-5678-1234-567812345678',
      profile: 'jarvis',
      provider: 'pipecat-rtvi',
      enabled: true,
      outputDir,
      now: () => now,
      thresholds: {
        maxFirstAudioLatencyMs: 5_000,
        maxP95ChunkGapMs: 5_000,
        maxChunkGapMs: 5_000,
        minRealtimeFactor: 0.1,
        maxRealtimeFactor: 5,
        maxDuplicateAssistantFinals: 0,
        maxOutOfOrderAssistantItems: 0,
        maxInterruptionP95Ms: 5_000,
      },
    });

    now = 10;
    benchmark.onStateChange('thinking');
    benchmark.onAssistantItemCreated('assistant-1');

    now = 100;
    benchmark.onAudio({
      data: new ArrayBuffer(4_800),
      sampleRate: 24_000,
      format: 'pcm16',
    });
    benchmark.onTranscriptDelta('Hello', 'assistant', 'assistant-1');

    now = 220;
    benchmark.onAudio({
      data: new ArrayBuffer(4_800),
      sampleRate: 24_000,
      format: 'pcm16',
    });

    now = 330;
    benchmark.markInterruptionRequested();
    now = 380;
    benchmark.markInterruptionStopped();
    benchmark.onTranscriptFinal('Hello world', 'assistant', 'assistant-1');
    benchmark.onStateChange('listening');

    const result = benchmark.finalize('disconnected');
    expect(result).toBeDefined();
    expect(result?.report.pass).toBe(true);
    expect(result?.outputPath).toBeDefined();
    if (result?.outputPath) {
      expect(fs.existsSync(result.outputPath)).toBe(true);
    }
  });
});
