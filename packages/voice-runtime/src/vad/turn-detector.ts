import { RnnoiseProcessor } from './rnnoise-processor.js';
import { WebRtcVadProcessor } from './webrtc-vad-processor.js';

export type DecomposedVadEngine = 'rms' | 'rnnoise' | 'webrtc-vad';

const DEFAULT_RMS_ECHO_MULTIPLIER = 3.8;
const DEFAULT_ASSISTANT_RMS_MULTIPLIER = 3.0;
const DEFAULT_ASSISTANT_RMS_OFFSET = 0.02;
const RNNOISE_ECHO_ASSISTANT_RMS_MULTIPLIER = 1.7;
const RNNOISE_ECHO_ASSISTANT_RMS_OFFSET = 0.008;

export interface TurnDetectorInput {
  frameData: ArrayBuffer;
  frameSampleRate: number;
  minRms: number;
  assistantRms: number;
  echoSensitivePhase: boolean;
}

export interface TurnDetectorResult {
  hasSpeech: boolean;
  processedFrameData: ArrayBuffer;
  rms: number;
  speechThreshold: number;
  speechProbability?: number;
}

export interface TurnDetector {
  detect(input: TurnDetectorInput): TurnDetectorResult;
  destroy(): void;
}

export interface RmsDetectorOptions {
  echoRmsMultiplier?: number;
  assistantRmsMultiplier?: number;
  assistantRmsOffset?: number;
}

export interface RnnoiseDetectorOptions extends RmsDetectorOptions {
  speechThreshold: number;
  echoSpeechThresholdBoost: number;
  applyNeuralFilter: boolean;
}

export interface WebRtcVadDetectorOptions extends RmsDetectorOptions {
  mode: 0 | 1 | 2 | 3;
  speechRatioThreshold: number;
  echoSpeechRatioBoost: number;
  applyNeuralFilter: boolean;
  frameMs?: 10 | 20 | 30;
  sampleRate?: 8_000 | 16_000 | 32_000 | 48_000;
}

export async function createTurnDetector(
  engine: DecomposedVadEngine,
  options: {
    rmsOptions?: RmsDetectorOptions;
    rnnoiseOptions?: RnnoiseDetectorOptions;
    webrtcVadOptions?: WebRtcVadDetectorOptions;
  }
): Promise<TurnDetector> {
  if (engine === 'webrtc-vad' && options.webrtcVadOptions) {
    return WebRtcVadTurnDetector.create(options.webrtcVadOptions);
  }
  if (engine === 'rnnoise' && options.rnnoiseOptions) {
    return new RnnoiseTurnDetector(options.rnnoiseOptions);
  }
  return new RmsTurnDetector(options.rmsOptions ?? {});
}

export class RmsTurnDetector implements TurnDetector {
  private readonly echoRmsMultiplier: number;
  private readonly assistantRmsMultiplier: number;
  private readonly assistantRmsOffset: number;

  constructor(options: RmsDetectorOptions) {
    this.echoRmsMultiplier = options.echoRmsMultiplier ?? DEFAULT_RMS_ECHO_MULTIPLIER;
    this.assistantRmsMultiplier =
      options.assistantRmsMultiplier ?? DEFAULT_ASSISTANT_RMS_MULTIPLIER;
    this.assistantRmsOffset = options.assistantRmsOffset ?? DEFAULT_ASSISTANT_RMS_OFFSET;
  }

  detect(input: TurnDetectorInput): TurnDetectorResult {
    const rms = computeRmsPcm16(input.frameData);
    const speechThreshold = input.echoSensitivePhase
      ? Math.max(
          input.minRms * this.echoRmsMultiplier,
          input.assistantRms * this.assistantRmsMultiplier + this.assistantRmsOffset
        )
      : input.minRms;

    return {
      hasSpeech: rms >= speechThreshold,
      processedFrameData: input.frameData,
      rms,
      speechThreshold,
    };
  }

  destroy(): void {
    // no-op
  }
}

export class RnnoiseTurnDetector implements TurnDetector {
  private readonly fallbackRmsDetector: RmsTurnDetector;
  private readonly rnnoise: RnnoiseProcessor;
  private readonly speechThreshold: number;
  private readonly echoSpeechThresholdBoost: number;
  private readonly applyNeuralFilter: boolean;
  private disabled = false;
  private warnedFrameFallback = false;

  constructor(options: RnnoiseDetectorOptions) {
    this.fallbackRmsDetector = new RmsTurnDetector(options);
    this.speechThreshold = options.speechThreshold;
    this.echoSpeechThresholdBoost = options.echoSpeechThresholdBoost;
    this.applyNeuralFilter = options.applyNeuralFilter;
    this.rnnoise = new RnnoiseProcessor();

    if (!this.rnnoise.isAvailable()) {
      this.disabled = true;
      console.warn(
        '[RnnoiseTurnDetector] RNNoise runtime unavailable; using RMS fallback detector.'
      );
    }
  }

  isUsingRmsFallback(): boolean {
    return this.disabled;
  }

  detect(input: TurnDetectorInput): TurnDetectorResult {
    if (this.disabled) {
      return this.fallbackRmsDetector.detect(input);
    }

    const filtered = this.rnnoise.process(input.frameData, input.frameSampleRate);
    if (!filtered) {
      if (!this.warnedFrameFallback) {
        this.warnedFrameFallback = true;
        console.warn(
          '[RnnoiseTurnDetector] RNNoise frame processing unavailable; falling back to RMS for current session.'
        );
      }
      return this.fallbackRmsDetector.detect(input);
    }

    const processedFrameData = this.applyNeuralFilter ? filtered.filtered : input.frameData;
    const rms = computeRmsPcm16(processedFrameData);
    const rmsFallback = this.fallbackRmsDetector.detect({
      ...input,
      frameData: processedFrameData,
    });

    const threshold = input.echoSensitivePhase
      ? Math.min(0.99, this.speechThreshold + this.echoSpeechThresholdBoost)
      : this.speechThreshold;

    const probabilityPass = filtered.speechProbability >= threshold;
    const minRmsGate = input.echoSensitivePhase
      ? Math.max(input.minRms * 0.75, 0.006)
      : Math.max(input.minRms * 0.6, 0.004);
    const assistantEchoGate = input.echoSensitivePhase
      ? Math.max(
          minRmsGate,
          input.assistantRms * RNNOISE_ECHO_ASSISTANT_RMS_MULTIPLIER +
            RNNOISE_ECHO_ASSISTANT_RMS_OFFSET
        )
      : minRmsGate;

    const hasSpeech = input.echoSensitivePhase
      ? probabilityPass && rms >= assistantEchoGate
      : probabilityPass || rmsFallback.hasSpeech;

    return {
      hasSpeech,
      processedFrameData,
      rms,
      speechThreshold: threshold,
      speechProbability: filtered.speechProbability,
    };
  }

  destroy(): void {
    this.rnnoise.destroy();
  }
}

export class WebRtcVadTurnDetector implements TurnDetector {
  private readonly fallbackRmsDetector: RmsTurnDetector;
  private readonly webrtcVad: WebRtcVadProcessor;
  private readonly rnnoiseFilter: RnnoiseProcessor | null;
  private readonly speechRatioThreshold: number;
  private readonly echoSpeechRatioBoost: number;
  private disabled = false;
  private warnedFrameFallback = false;

  private constructor(
    options: WebRtcVadDetectorOptions,
    processor: WebRtcVadProcessor
  ) {
    this.fallbackRmsDetector = new RmsTurnDetector(options);
    this.speechRatioThreshold = options.speechRatioThreshold;
    this.echoSpeechRatioBoost = options.echoSpeechRatioBoost;
    this.rnnoiseFilter = options.applyNeuralFilter ? new RnnoiseProcessor() : null;
    this.webrtcVad = processor;

    if (!this.webrtcVad.isAvailable()) {
      this.disabled = true;
      console.warn(
        '[WebRtcVadTurnDetector] WebRTC VAD runtime unavailable; using RMS fallback detector.'
      );
    }

    if (this.rnnoiseFilter && !this.rnnoiseFilter.isAvailable()) {
      console.warn(
        '[WebRtcVadTurnDetector] RNNoise prefilter unavailable; using raw input frames for VAD.'
      );
    }
  }

  static async create(options: WebRtcVadDetectorOptions): Promise<WebRtcVadTurnDetector> {
    const processor = await WebRtcVadProcessor.create({
      mode: options.mode,
      frameMs: options.frameMs ?? 20,
      sampleRate: options.sampleRate ?? 16_000,
    });
    return new WebRtcVadTurnDetector(options, processor);
  }

  isUsingRmsFallback(): boolean {
    return this.disabled;
  }

  detect(input: TurnDetectorInput): TurnDetectorResult {
    if (this.disabled) {
      return this.fallbackRmsDetector.detect(input);
    }

    let processedFrameData = input.frameData;
    if (this.rnnoiseFilter?.isAvailable()) {
      const filtered = this.rnnoiseFilter.process(input.frameData, input.frameSampleRate);
      if (filtered) {
        processedFrameData = filtered.filtered;
      }
    }

    const vadResult = this.webrtcVad.process(processedFrameData, input.frameSampleRate);
    if (!vadResult) {
      if (!this.warnedFrameFallback) {
        this.warnedFrameFallback = true;
        console.warn(
          '[WebRtcVadTurnDetector] WebRTC VAD frame processing unavailable; falling back to RMS for current session.'
        );
      }
      return this.fallbackRmsDetector.detect({
        ...input,
        frameData: processedFrameData,
      });
    }

    const threshold = input.echoSensitivePhase
      ? Math.min(0.99, this.speechRatioThreshold + this.echoSpeechRatioBoost)
      : this.speechRatioThreshold;
    const hasSpeech = vadResult.totalFrames > 0 && vadResult.speechProbability >= threshold;
    const rms = computeRmsPcm16(processedFrameData);

    return {
      hasSpeech,
      processedFrameData,
      rms,
      speechThreshold: threshold,
      speechProbability: vadResult.speechProbability,
    };
  }

  destroy(): void {
    this.webrtcVad.destroy();
    this.rnnoiseFilter?.destroy();
  }
}

function computeRmsPcm16(input: ArrayBuffer): number {
  const bytes = new DataView(input);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = bytes.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}
