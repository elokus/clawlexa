import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import SoxrResampler from 'wasm-audio-resampler';
import { SoxrDatatype } from 'wasm-audio-resampler';
import type { AudioFrame } from '../types.js';

/**
 * Pre-load the WASM binary from disk so it works in Bun/Node
 * (Emscripten's default fetch()-based loader fails in Bun).
 */
let wasmBinaryCache: Buffer | null = null;
function getWasmBinary(): Buffer {
  if (!wasmBinaryCache) {
    const require = createRequire(import.meta.url);
    const wasmDir = dirname(require.resolve('wasm-audio-resampler/app/soxr_wasm.js'));
    wasmBinaryCache = readFileSync(resolve(wasmDir, 'soxr_wasm.wasm'));
  }
  return wasmBinaryCache;
}

/**
 * Stateful PCM16 mono stream resampler backed by libsoxr (WASM).
 *
 * Unlike the stateless `resamplePcm16Mono`, this maintains filter state
 * between processChunk() calls so chunk boundaries are seamless — no
 * click artifacts. Uses VHQ (Very High Quality) sinc interpolation
 * internally via libsoxr.
 *
 * Create one instance per audio stream (per rate pair). When the stream
 * ends, call flush() to drain the internal filter buffer.
 *
 * Usage:
 *   const resampler = new StreamResampler(24000, 16000);
 *   await resampler.init();
 *   const out = resampler.process(frame);   // returns resampled AudioFrame
 *   const tail = resampler.flush();          // drain at end of stream
 */
export class StreamResampler {
  private readonly inputRate: number;
  private readonly outputRate: number;
  private resampler: SoxrResampler | null = null;
  private initialized = false;

  constructor(inputRate: number, outputRate: number) {
    if (inputRate <= 0 || outputRate <= 0) {
      throw new Error(`Invalid sample rates: ${inputRate} -> ${outputRate}`);
    }
    this.inputRate = inputRate;
    this.outputRate = outputRate;
  }

  /** Initialize the WASM resampler. Must be called before process(). */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.resampler = new SoxrResampler(
      1, // mono
      this.inputRate,
      this.outputRate,
      SoxrDatatype.SOXR_INT16,
      SoxrDatatype.SOXR_INT16,
    );
    await this.resampler.init(undefined, { wasmBinary: getWasmBinary() });
    this.initialized = true;
  }

  /** Resample an audio frame. Returns a new frame at the output rate. */
  process(frame: AudioFrame): AudioFrame {
    if (!this.initialized || !this.resampler) {
      throw new Error('StreamResampler not initialized — call init() first');
    }
    if (frame.sampleRate !== this.inputRate) {
      throw new Error(
        `StreamResampler expected ${this.inputRate}Hz input, got ${frame.sampleRate}Hz`
      );
    }

    const input = new Uint8Array(frame.data);
    const output = this.resampler.processChunk(input);

    return {
      data: toArrayBuffer(output),
      sampleRate: this.outputRate,
      format: 'pcm16',
    };
  }

  /**
   * Flush remaining samples from the internal filter buffer.
   * Call once at end of stream. Returns null if nothing to flush.
   */
  flush(): AudioFrame | null {
    if (!this.initialized || !this.resampler) return null;
    try {
      const output = this.resampler.processChunk(new Uint8Array(0));
      if (!output || output.byteLength === 0) return null;
      return {
        data: toArrayBuffer(output),
        sampleRate: this.outputRate,
        format: 'pcm16',
      };
    } catch {
      // WASM resampler may throw on flush if internal state is already freed
      return null;
    }
  }

  /** Whether init() has been called successfully. */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /** The configured input sample rate. */
  get sourceRate(): number {
    return this.inputRate;
  }

  /** The configured output sample rate. */
  get targetRate(): number {
    return this.outputRate;
  }
}

/**
 * Lazy-initialized stream resampler factory.
 *
 * Creates and caches StreamResampler instances keyed by rate pair.
 * Handles async init transparently — first call to resample() awaits
 * init, subsequent calls are synchronous.
 */
export class StreamResamplerPool {
  private readonly resamplers = new Map<string, StreamResampler>();
  private readonly pending = new Map<string, Promise<StreamResampler>>();

  private key(inputRate: number, outputRate: number): string {
    return `${inputRate}:${outputRate}`;
  }

  /**
   * Get or create a resampler for the given rate pair.
   * First call for a rate pair is async (WASM init). Subsequent calls
   * return the cached instance synchronously via getSync().
   */
  async get(inputRate: number, outputRate: number): Promise<StreamResampler> {
    const k = this.key(inputRate, outputRate);

    const cached = this.resamplers.get(k);
    if (cached) return cached;

    const existing = this.pending.get(k);
    if (existing) return existing;

    const promise = (async () => {
      const resampler = new StreamResampler(inputRate, outputRate);
      await resampler.init();
      this.resamplers.set(k, resampler);
      this.pending.delete(k);
      return resampler;
    })();

    this.pending.set(k, promise);
    return promise;
  }

  /**
   * Get a previously-initialized resampler synchronously.
   * Returns null if not yet initialized for this rate pair.
   */
  getSync(inputRate: number, outputRate: number): StreamResampler | null {
    return this.resamplers.get(this.key(inputRate, outputRate)) ?? null;
  }

  /** Flush and clear all cached resamplers. */
  clear(): void {
    for (const r of this.resamplers.values()) {
      r.flush();
    }
    this.resamplers.clear();
    this.pending.clear();
  }
}

/** Extract a proper ArrayBuffer from a typed array output. */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}
