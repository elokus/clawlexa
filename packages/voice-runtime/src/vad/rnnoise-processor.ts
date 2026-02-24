import { createRequire } from 'module';
import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import type { AudioFrame } from '../types.js';

interface RnnoiseWasmModule {
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _rnnoise_create(modelPtr: number): number;
  _rnnoise_destroy(statePtr: number): void;
  _rnnoise_process_frame(statePtr: number, outPtr: number, inPtr: number): number;
}

export interface RnnoiseProcessResult {
  filtered: ArrayBuffer;
  speechProbability: number;
}

const RNNOISE_SAMPLE_RATE = 48_000;
const RNNOISE_FRAME_SAMPLES = 480; // 10ms at 48kHz
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const require = createRequire(import.meta.url);

/**
 * Lightweight RNNoise wrapper used as an optional pre-VAD neural filter.
 * Falls back cleanly if initialization fails.
 */
export class RnnoiseProcessor {
  private readonly module: RnnoiseWasmModule | null;
  private readonly statePtr: number;
  private readonly inPtr: number;
  private readonly outPtr: number;

  constructor() {
    try {
      const rnnoisePackage = require('@jitsi/rnnoise-wasm') as {
        createRNNWasmModuleSync?: () => unknown;
      };
      const moduleFactory = rnnoisePackage.createRNNWasmModuleSync;
      if (typeof moduleFactory !== 'function') {
        throw new Error('createRNNWasmModuleSync is unavailable');
      }
      const module = moduleFactory() as RnnoiseWasmModule;
      const statePtr = module._rnnoise_create(0);
      if (!statePtr) {
        throw new Error('rnnoise_create returned null pointer');
      }
      const inPtr = module._malloc(RNNOISE_FRAME_SAMPLES * FLOAT32_BYTES);
      const outPtr = module._malloc(RNNOISE_FRAME_SAMPLES * FLOAT32_BYTES);
      if (!inPtr || !outPtr) {
        if (inPtr) module._free(inPtr);
        if (outPtr) module._free(outPtr);
        module._rnnoise_destroy(statePtr);
        throw new Error('rnnoise malloc failed');
      }

      this.module = module;
      this.statePtr = statePtr;
      this.inPtr = inPtr;
      this.outPtr = outPtr;
    } catch {
      this.module = null;
      this.statePtr = 0;
      this.inPtr = 0;
      this.outPtr = 0;
    }
  }

  isAvailable(): boolean {
    return this.module !== null;
  }

  process(input: ArrayBuffer, sampleRate: number): RnnoiseProcessResult | null {
    if (!this.module || sampleRate <= 0 || input.byteLength === 0) {
      return null;
    }
    if (input.byteLength % 2 !== 0) {
      return null;
    }

    const frame: AudioFrame = {
      data: input,
      sampleRate,
      format: 'pcm16',
    };
    const at48k = sampleRate === RNNOISE_SAMPLE_RATE
      ? frame
      : resamplePcm16Mono(frame, RNNOISE_SAMPLE_RATE);

    const inputPcm = new Int16Array(at48k.data);
    if (inputPcm.length === 0) {
      return null;
    }

    const denoised = new Float32Array(inputPcm.length);
    let speechProbabilitySum = 0;
    let speechProbabilityFrames = 0;

    for (let offset = 0; offset < inputPcm.length; offset += RNNOISE_FRAME_SAMPLES) {
      const size = Math.min(RNNOISE_FRAME_SAMPLES, inputPcm.length - offset);
      const heapOffsetIn = this.inPtr >> 2;
      const heapOffsetOut = this.outPtr >> 2;

      for (let i = 0; i < RNNOISE_FRAME_SAMPLES; i += 1) {
        const sample =
          i < size
            ? (inputPcm[offset + i] ?? 0) / 32768
            : 0;
        this.module.HEAPF32[heapOffsetIn + i] = sample;
      }

      const speechProbability = this.module._rnnoise_process_frame(
        this.statePtr,
        this.outPtr,
        this.inPtr
      );
      if (Number.isFinite(speechProbability)) {
        speechProbabilitySum += speechProbability;
        speechProbabilityFrames += 1;
      }

      for (let i = 0; i < size; i += 1) {
        denoised[offset + i] = this.module.HEAPF32[heapOffsetOut + i] ?? 0;
      }
    }

    const denoisedPcm48k = float32ToPcm16ArrayBuffer(denoised);
    const backToInputRate = sampleRate === RNNOISE_SAMPLE_RATE
      ? denoisedPcm48k
      : resamplePcm16Mono(
          { data: denoisedPcm48k, sampleRate: RNNOISE_SAMPLE_RATE, format: 'pcm16' },
          sampleRate
        ).data;

    const averageSpeechProbability =
      speechProbabilityFrames > 0
        ? speechProbabilitySum / speechProbabilityFrames
        : 0;

    return {
      filtered: backToInputRate,
      speechProbability: clamp01(averageSpeechProbability),
    };
  }

  destroy(): void {
    if (!this.module) {
      return;
    }
    this.module._free(this.inPtr);
    this.module._free(this.outPtr);
    this.module._rnnoise_destroy(this.statePtr);
  }
}

function float32ToPcm16ArrayBuffer(input: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    pcm[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return pcm.buffer;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
