import { createRequire } from 'module';
import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import type { AudioFrame } from '../types.js';

export interface WebRtcVadProcessResult {
  speechProbability: number;
  voicedFrames: number;
  totalFrames: number;
}

export interface WebRtcVadProcessorOptions {
  mode: 0 | 1 | 2 | 3;
  sampleRate: 8_000 | 16_000 | 32_000 | 48_000;
  frameMs: 10 | 20 | 30;
}

const DEFAULT_OPTIONS: WebRtcVadProcessorOptions = {
  mode: 3,
  sampleRate: 16_000,
  frameMs: 20,
};
const require = createRequire(import.meta.url);

interface FvadModule {
  HEAP16: Int16Array;
  _fvad_new(): number;
  _fvad_free(instancePtr: number): void;
  _fvad_set_mode(instancePtr: number, mode: number): number;
  _fvad_set_sample_rate(instancePtr: number, sampleRate: number): number;
  _fvad_process(instancePtr: number, framePtr: number, frameLengthSamples: number): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
}

export class WebRtcVadProcessor {
  private readonly module: FvadModule | null;
  private readonly instancePtr: number;
  private readonly framePtr: number;
  private readonly options: WebRtcVadProcessorOptions;
  private pendingBytes = new Uint8Array(0);

  private constructor(
    module: FvadModule | null,
    options: WebRtcVadProcessorOptions,
    instancePtr = 0,
    framePtr = 0
  ) {
    this.module = module;
    this.options = options;
    this.instancePtr = instancePtr;
    this.framePtr = framePtr;
  }

  static async create(
    inputOptions: Partial<WebRtcVadProcessorOptions> = {}
  ): Promise<WebRtcVadProcessor> {
    const options: WebRtcVadProcessorOptions = {
      ...DEFAULT_OPTIONS,
      ...inputOptions,
    };

    try {
      const modulePath = require.resolve('@echogarden/fvad-wasm/fvad.js');
      const imported = (await import(modulePath)) as {
        default?: (moduleArg?: Record<string, unknown>) => Promise<FvadModule>;
      };
      const createFvadModule = imported.default;
      if (typeof createFvadModule !== 'function') {
        return new WebRtcVadProcessor(null, options);
      }
      const module = (await createFvadModule()) as FvadModule;
      const instancePtr = module._fvad_new();
      if (!instancePtr) {
        return new WebRtcVadProcessor(null, options);
      }

      const modeResult = module._fvad_set_mode(instancePtr, options.mode);
      const sampleRateResult = module._fvad_set_sample_rate(instancePtr, options.sampleRate);
      const frameSamples = Math.floor((options.sampleRate * options.frameMs) / 1000);
      const framePtr = module._malloc(frameSamples * Int16Array.BYTES_PER_ELEMENT);

      if (modeResult !== 0 || sampleRateResult !== 0 || !framePtr) {
        if (framePtr) {
          module._free(framePtr);
        }
        module._fvad_free(instancePtr);
        return new WebRtcVadProcessor(null, options);
      }

      return new WebRtcVadProcessor(module, options, instancePtr, framePtr);
    } catch {
      return new WebRtcVadProcessor(null, options);
    }
  }

  isAvailable(): boolean {
    return this.module !== null && this.instancePtr !== 0 && this.framePtr !== 0;
  }

  process(input: ArrayBuffer, sampleRate: number): WebRtcVadProcessResult | null {
    if (!this.module || sampleRate <= 0 || input.byteLength === 0 || input.byteLength % 2 !== 0) {
      return null;
    }

    const frame: AudioFrame = {
      data: input,
      sampleRate,
      format: 'pcm16',
    };
    const vadRate = this.options.sampleRate;
    const normalized = sampleRate === vadRate ? frame : resamplePcm16Mono(frame, vadRate);
    const normalizedBytes = new Uint8Array(normalized.data);
    if (normalizedBytes.byteLength === 0) {
      return null;
    }

    const merged = new Uint8Array(this.pendingBytes.length + normalizedBytes.length);
    merged.set(this.pendingBytes, 0);
    merged.set(normalizedBytes, this.pendingBytes.length);

    const frameSamples = Math.floor((vadRate * this.options.frameMs) / 1000);
    const frameBytes = frameSamples * Int16Array.BYTES_PER_ELEMENT;
    const totalFrames = Math.floor(merged.byteLength / frameBytes);
    if (totalFrames <= 0) {
      this.pendingBytes = merged;
      return {
        speechProbability: 0,
        voicedFrames: 0,
        totalFrames: 0,
      };
    }

    let voicedFrames = 0;
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const byteOffset = frameIndex * frameBytes;
      const samples = new Int16Array(
        merged.buffer,
        merged.byteOffset + byteOffset,
        frameSamples
      );
      this.module.HEAP16.set(samples, this.framePtr >> 1);
      const vadResult = this.module._fvad_process(this.instancePtr, this.framePtr, frameSamples);
      if (vadResult === 1) {
        voicedFrames += 1;
      }
    }

    const remainderOffset = totalFrames * frameBytes;
    this.pendingBytes = merged.slice(remainderOffset);

    return {
      speechProbability: voicedFrames / totalFrames,
      voicedFrames,
      totalFrames,
    };
  }

  destroy(): void {
    if (!this.module) {
      return;
    }
    if (this.framePtr) {
      this.module._free(this.framePtr);
    }
    if (this.instancePtr) {
      this.module._fvad_free(this.instancePtr);
    }
    this.pendingBytes = new Uint8Array(0);
  }
}
