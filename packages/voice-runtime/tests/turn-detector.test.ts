import { describe, expect, test } from 'bun:test';
import { createTurnDetector } from '../src/vad/turn-detector.js';

describe('turn-detector', () => {
  test('rms detector detects high-energy speech frames', async () => {
    const detector = await createTurnDetector('rms', {});
    const pcm = new Int16Array(960);
    for (let i = 0; i < pcm.length; i += 1) {
      pcm[i] = i % 2 === 0 ? 12_000 : -12_000;
    }

    const result = detector.detect({
      frameData: pcm.buffer,
      frameSampleRate: 24_000,
      minRms: 0.015,
      assistantRms: 0,
      echoSensitivePhase: false,
    });

    expect(result.hasSpeech).toBe(true);
    expect(result.rms).toBeGreaterThan(0.015);
    detector.destroy();
  });

  test('rnnoise detector returns stable output for silence', async () => {
    const detector = await createTurnDetector('rnnoise', {
      rnnoiseOptions: {
        speechThreshold: 0.62,
        echoSpeechThresholdBoost: 0.12,
        applyNeuralFilter: true,
      },
    });

    const silence = new Int16Array(960);
    const result = detector.detect({
      frameData: silence.buffer,
      frameSampleRate: 24_000,
      minRms: 0.015,
      assistantRms: 0.1,
      echoSensitivePhase: true,
    });

    expect(result.processedFrameData.byteLength).toBeGreaterThan(0);
    expect(result.rms).toBeGreaterThanOrEqual(0);
    if (typeof result.speechProbability === 'number') {
      expect(result.speechProbability).toBeGreaterThanOrEqual(0);
      expect(result.speechProbability).toBeLessThanOrEqual(1);
    }
    expect(result.hasSpeech).toBe(false);
    detector.destroy();
  });

  test('webrtc-vad detector returns stable output for silence', async () => {
    const detector = await createTurnDetector('webrtc-vad', {
      webrtcVadOptions: {
        mode: 3,
        speechRatioThreshold: 0.7,
        echoSpeechRatioBoost: 0.15,
        applyNeuralFilter: true,
      },
    });

    const silence = new Int16Array(960);
    const result = detector.detect({
      frameData: silence.buffer,
      frameSampleRate: 24_000,
      minRms: 0.015,
      assistantRms: 0.1,
      echoSensitivePhase: true,
    });

    expect(result.processedFrameData.byteLength).toBeGreaterThan(0);
    expect(result.rms).toBeGreaterThanOrEqual(0);
    if (typeof result.speechProbability === 'number') {
      expect(result.speechProbability).toBeGreaterThanOrEqual(0);
      expect(result.speechProbability).toBeLessThanOrEqual(1);
    }
    expect(result.hasSpeech).toBe(false);
    detector.destroy();
  });
});
