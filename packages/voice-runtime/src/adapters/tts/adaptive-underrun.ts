import { clampNumber, roundTo } from '../decomposed-utils.js';

const LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS = 120;
const LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS = 4000;
const LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS = 220;
const LOCAL_QWEN_ADAPTIVE_START_BUFFER_WAIT_CAP_MS = 4500;
const LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS = 220;
const LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN = 0.6;
const LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX = 4.0;
const LOCAL_QWEN_ADAPTIVE_INTERVAL_STEP = 0.1;
export const LOCAL_QWEN_ADAPTIVE_UNDERRUN_THRESHOLD_MS = -40;
const LOCAL_QWEN_ADAPTIVE_BOOTSTRAP_INTERVAL_MULTIPLIER = 2.0;
const LOCAL_QWEN_ADAPTIVE_RTF_EMA_ALPHA = 0.35;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_DEFAULT = 60;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MIN = 16;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MAX = 220;
const LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_EMA_ALPHA = 0.25;

export interface AdaptiveSegmentState {
  startupBufferMs: number;
  intervalSec: number;
  released: boolean;
  releaseAtMs: number | null;
  emittedSinceReleaseMs: number;
  startupBufferedAudioMs: number;
  predictedSegmentAudioMs: number;
  queuedChunks: Array<{ chunk: ArrayBuffer; audioMs: number; arrivedAtMs: number }>;
}

export interface AdaptiveChunkArrivalMetrics {
  producerAudioMs: number;
  producerElapsedMs: number;
  elapsedSinceFirstChunkMs: number;
}

export interface AdaptiveSegmentCompletionMetrics {
  state: AdaptiveSegmentState;
  text: string;
  emittedPlaybackMs: number;
  producerAudioMs: number;
  producerElapsedMs: number;
  cumulativeGapDeficitMs: number;
  finalPlayoutLeadMs: number;
  chunksWithGapDeficit: number;
}

export interface AdaptiveSegmentUpdate {
  producerRtf: number;
  suggestedStartupBufferMs: number;
  requiredBufferFromRtfEma: number;
  nextStreamingIntervalSec: number;
  nextStartupBufferMs: number;
  adaptiveProducerRtfEma: number;
  adaptiveAudioMsPerChar: number;
}

export class AdaptiveUnderrunController {
  private startBufferMs = LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS;
  private intervalSec = 1.0;
  private producerRtfEma = 1.0;
  private audioMsPerChar = LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_DEFAULT;

  reset(configuredIntervalSec: number): void {
    this.startBufferMs = LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS;
    this.intervalSec = configuredIntervalSec;
    this.producerRtfEma = 1.0;
    this.audioMsPerChar = LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_DEFAULT;
  }

  getStreamingIntervalSec(): number {
    return this.intervalSec;
  }

  createSegmentState(input: {
    enabled: boolean;
    text: string;
    configuredIntervalSec: number;
  }): AdaptiveSegmentState | null {
    if (!input.enabled) {
      return null;
    }

    const configuredIntervalMs =
      clampNumber(
        input.configuredIntervalSec,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX
      ) * 1000;
    const predictedSegmentAudioMs = Math.max(
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS * 2,
      Math.round(input.text.length * this.audioMsPerChar)
    );
    const predictedDeficitMsFromEma =
      Math.max(0, this.producerRtfEma - 1) * predictedSegmentAudioMs;
    const startupFloorFromIntervalMs = Math.round(
      configuredIntervalMs * LOCAL_QWEN_ADAPTIVE_BOOTSTRAP_INTERVAL_MULTIPLIER
    );

    return {
      startupBufferMs: clampNumber(
        Math.max(
          this.startBufferMs,
          startupFloorFromIntervalMs,
          Math.round(LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS + predictedDeficitMsFromEma)
        ),
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
      ),
      intervalSec: clampNumber(
        this.intervalSec,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
        LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX
      ),
      released: false,
      releaseAtMs: null,
      emittedSinceReleaseMs: 0,
      startupBufferedAudioMs: 0,
      predictedSegmentAudioMs,
      queuedChunks: [],
    };
  }

  handleChunkArrival(
    state: AdaptiveSegmentState,
    metrics: AdaptiveChunkArrivalMetrics
  ): { shouldRelease: boolean; startupWaitCapMs: number } {
    const producerRtf =
      metrics.producerAudioMs > 0 ? metrics.producerElapsedMs / metrics.producerAudioMs : 0;
    const projectedDeficitMs =
      Math.max(0, producerRtf - 1) * state.predictedSegmentAudioMs;
    const targetFromRtf = LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS + projectedDeficitMs;

    state.startupBufferMs = clampNumber(
      Math.round(state.startupBufferMs * 0.6 + targetFromRtf * 0.4),
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
    );

    const startupWaitCapMs = Math.min(
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_WAIT_CAP_MS,
      Math.max(1200, Math.round(state.startupBufferMs + 400))
    );

    const shouldRelease =
      state.startupBufferedAudioMs >= state.startupBufferMs ||
      metrics.elapsedSinceFirstChunkMs >= startupWaitCapMs;

    return {
      shouldRelease,
      startupWaitCapMs,
    };
  }

  updateAfterSegment(metrics: AdaptiveSegmentCompletionMetrics): AdaptiveSegmentUpdate {
    const producerRtf =
      metrics.producerAudioMs > 0 ? metrics.producerElapsedMs / metrics.producerAudioMs : 0;

    this.producerRtfEma = roundTo(
      clampNumber(
        this.producerRtfEma * (1 - LOCAL_QWEN_ADAPTIVE_RTF_EMA_ALPHA) +
          producerRtf * LOCAL_QWEN_ADAPTIVE_RTF_EMA_ALPHA,
        0.7,
        3.0
      ),
      3
    );

    if (metrics.text.length > 0 && metrics.emittedPlaybackMs > 0) {
      const observedAudioMsPerChar = metrics.emittedPlaybackMs / metrics.text.length;
      this.audioMsPerChar = roundTo(
        clampNumber(
          this.audioMsPerChar * (1 - LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_EMA_ALPHA) +
            observedAudioMsPerChar * LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_EMA_ALPHA,
          LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MIN,
          LOCAL_QWEN_ADAPTIVE_AUDIO_MS_PER_CHAR_MAX
        ),
        2
      );
    }

    const requiredBufferFromDeficit =
      metrics.cumulativeGapDeficitMs + LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS;
    const requiredBufferFromRtf =
      producerRtf > 1
        ? (producerRtf - 1) * metrics.emittedPlaybackMs + LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS
        : LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS;
    const projectedNextAudioMs = Math.max(
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_DEFAULT_MS * 2,
      Math.round(metrics.text.length * this.audioMsPerChar)
    );
    const requiredBufferFromRtfEma =
      Math.max(0, this.producerRtfEma - 1) * projectedNextAudioMs +
      LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS;
    const suggestedStartupBufferMs = Math.max(
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
      requiredBufferFromDeficit,
      requiredBufferFromRtf,
      requiredBufferFromRtfEma
    );

    this.startBufferMs = clampNumber(
      Math.round(this.startBufferMs * 0.25 + suggestedStartupBufferMs * 0.75),
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
      LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
    );

    if (
      metrics.chunksWithGapDeficit === 0 &&
      producerRtf < 0.95 &&
      metrics.finalPlayoutLeadMs > LOCAL_QWEN_ADAPTIVE_LEAD_TARGET_MS * 2
    ) {
      this.startBufferMs = clampNumber(
        this.startBufferMs - 40,
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_MIN_MS,
        LOCAL_QWEN_ADAPTIVE_START_BUFFER_MAX_MS
      );
    }

    const baseInterval = clampNumber(
      metrics.state.intervalSec,
      LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
      LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX
    );
    const intervalMin = Math.max(
      LOCAL_QWEN_ADAPTIVE_INTERVAL_MIN,
      roundTo(baseInterval - 0.25, 2)
    );
    const intervalMax = Math.min(
      LOCAL_QWEN_ADAPTIVE_INTERVAL_MAX,
      roundTo(baseInterval + 2.0, 2)
    );

    const gapPressure =
      metrics.emittedPlaybackMs > 0 ? metrics.cumulativeGapDeficitMs / metrics.emittedPlaybackMs : 0;
    const rtfPressure = Math.max(0, producerRtf - 1);
    const increaseBy = Math.min(
      0.45,
      Math.max(LOCAL_QWEN_ADAPTIVE_INTERVAL_STEP, rtfPressure * 0.9 + gapPressure * 0.8)
    );
    const adjustedInterval =
      metrics.chunksWithGapDeficit > 0 || producerRtf > 1.01
        ? metrics.state.intervalSec + increaseBy
        : metrics.chunksWithGapDeficit === 0 && producerRtf < 0.9
          ? metrics.state.intervalSec - LOCAL_QWEN_ADAPTIVE_INTERVAL_STEP
          : metrics.state.intervalSec;

    this.intervalSec = roundTo(clampNumber(adjustedInterval, intervalMin, intervalMax), 2);

    return {
      producerRtf,
      suggestedStartupBufferMs,
      requiredBufferFromRtfEma,
      nextStreamingIntervalSec: this.intervalSec,
      nextStartupBufferMs: Math.round(this.startBufferMs),
      adaptiveProducerRtfEma: this.producerRtfEma,
      adaptiveAudioMsPerChar: this.audioMsPerChar,
    };
  }
}
