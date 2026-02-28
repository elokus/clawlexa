import { describe, expect, test } from 'bun:test';
import { AdaptiveUnderrunController } from '../src/adapters/tts/adaptive-underrun.js';

describe('AdaptiveUnderrunController', () => {
  test('creates state only when enabled', () => {
    const controller = new AdaptiveUnderrunController();

    const disabled = controller.createSegmentState({
      enabled: false,
      text: 'hello world',
      configuredIntervalSec: 1.0,
    });
    expect(disabled).toBeNull();

    const enabled = controller.createSegmentState({
      enabled: true,
      text: 'hello world',
      configuredIntervalSec: 1.0,
    });
    expect(enabled).not.toBeNull();
    expect(enabled?.released).toBe(false);
    expect(enabled?.queuedChunks.length).toBe(0);
    expect((enabled?.startupBufferMs ?? 0) > 0).toBe(true);
  });

  test('updates startup release decision from chunk arrival', () => {
    const controller = new AdaptiveUnderrunController();
    const state = controller.createSegmentState({
      enabled: true,
      text: 'short test segment',
      configuredIntervalSec: 1.0,
    });
    expect(state).not.toBeNull();

    if (!state) return;
    state.startupBufferedAudioMs = Math.max(0, state.startupBufferMs - 50);
    const before = controller.handleChunkArrival(state, {
      producerAudioMs: 300,
      producerElapsedMs: 340,
      elapsedSinceFirstChunkMs: 500,
    });
    expect(typeof before.shouldRelease).toBe('boolean');

    state.startupBufferedAudioMs = state.startupBufferMs + 20;
    const after = controller.handleChunkArrival(state, {
      producerAudioMs: 420,
      producerElapsedMs: 500,
      elapsedSinceFirstChunkMs: 800,
    });
    expect(after.shouldRelease).toBe(true);
    expect(after.startupWaitCapMs >= 1200).toBe(true);
  });

  test('updates EMA values and next interval after segment completion', () => {
    const controller = new AdaptiveUnderrunController();
    controller.reset(1.2);
    const state = controller.createSegmentState({
      enabled: true,
      text: 'adaptive controller completion path',
      configuredIntervalSec: 1.2,
    });
    expect(state).not.toBeNull();
    if (!state) return;

    const update = controller.updateAfterSegment({
      state,
      text: 'adaptive controller completion path',
      emittedPlaybackMs: 1800,
      producerAudioMs: 1800,
      producerElapsedMs: 2100,
      cumulativeGapDeficitMs: 120,
      finalPlayoutLeadMs: -20,
      chunksWithGapDeficit: 2,
    });

    expect(update.producerRtf > 1).toBe(true);
    expect(update.nextStreamingIntervalSec >= 0.6).toBe(true);
    expect(update.nextStreamingIntervalSec <= 4.0).toBe(true);
    expect(update.nextStartupBufferMs > 0).toBe(true);
    expect(update.adaptiveProducerRtfEma > 0).toBe(true);
    expect(update.adaptiveAudioMsPerChar > 0).toBe(true);
  });
});
