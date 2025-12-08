/**
 * Porcupine Wake Word Detection
 *
 * Uses Picovoice Porcupine for on-device wake word detection.
 * Runs entirely locally - no audio is sent to the cloud.
 *
 * Audio capture uses pw-record (PipeWire) to avoid conflicts with
 * PipeWire's exclusive device access.
 *
 * Supported built-in keywords:
 * - porcupine, bumblebee, alexa, ok google, hey google, hey siri, jarvis,
 *   picovoice, computer, hey barista, terminator, grapefruit
 *
 * Note: "hey jarvis" is not built-in, but "jarvis" is.
 * For custom wake words like "hey_jarvis", you need to train a model.
 */

import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node';
import { spawn, ChildProcess } from 'child_process';
import { config } from '../config.js';

export type WakewordCallback = (keyword: string, confidence: number) => void;

// Map our profile wake words to Porcupine built-in keywords
const KEYWORD_MAP: Record<string, BuiltinKeyword> = {
  hey_jarvis: BuiltinKeyword.JARVIS, // Using "jarvis" as closest match
  hey_marvin: BuiltinKeyword.COMPUTER, // Using "computer" as fallback for Marvin
  jarvis: BuiltinKeyword.JARVIS,
  computer: BuiltinKeyword.COMPUTER,
  alexa: BuiltinKeyword.ALEXA,
  hey_siri: BuiltinKeyword.HEY_SIRI,
  hey_google: BuiltinKeyword.HEY_GOOGLE,
  ok_google: BuiltinKeyword.OK_GOOGLE,
  picovoice: BuiltinKeyword.PICOVOICE,
  porcupine: BuiltinKeyword.PORCUPINE,
  bumblebee: BuiltinKeyword.BUMBLEBEE,
  terminator: BuiltinKeyword.TERMINATOR,
};

export class WakewordDetector {
  private porcupine: Porcupine | null = null;
  private recorder: ChildProcess | null = null;
  private isRunning = false;
  private callback: WakewordCallback | null = null;
  private keywords: string[];
  private builtinKeywords: BuiltinKeyword[];
  private audioBuffer: Buffer = Buffer.alloc(0);

  constructor(wakewords: string[] = ['hey_jarvis', 'hey_marvin']) {
    this.keywords = wakewords;

    // Map to built-in keywords
    this.builtinKeywords = wakewords.map((ww) => {
      const builtin = KEYWORD_MAP[ww];
      if (!builtin) {
        console.warn(`[Wakeword] No Porcupine mapping for '${ww}', using JARVIS`);
        return BuiltinKeyword.JARVIS;
      }
      return builtin;
    });
  }

  onWakeword(callback: WakewordCallback): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[Wakeword] Already running');
      return;
    }

    const accessKey = config.porcupine.accessKey;
    if (!accessKey) {
      throw new Error('PICOVOICE_ACCESS_KEY not set');
    }

    try {
      // Initialize Porcupine with built-in keywords
      this.porcupine = new Porcupine(
        accessKey,
        this.builtinKeywords,
        this.builtinKeywords.map(() => 0.5) // Sensitivity for each keyword
      );

      const frameLength = this.porcupine.frameLength;
      const sampleRate = this.porcupine.sampleRate;
      console.log(`[Wakeword] Porcupine initialized: frameLength=${frameLength}, sampleRate=${sampleRate}`);

      // Start pw-record for audio capture (works with PipeWire)
      // Porcupine expects 16kHz, 16-bit signed LE, mono
      this.recorder = spawn('pw-record', [
        '--channels', '1',
        '--rate', String(sampleRate),
        '--format', 's16',
        '-',  // Output to stdout
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.recorder.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('opened')) {
          console.error('[Wakeword] pw-record:', msg);
        }
      });

      this.recorder.on('error', (err) => {
        console.error('[Wakeword] pw-record error:', err.message);
      });

      this.recorder.on('exit', (code) => {
        if (this.isRunning) {
          console.error(`[Wakeword] pw-record exited with code ${code}`);
        }
      });

      // Process audio data
      this.recorder.stdout?.on('data', (data: Buffer) => {
        this.processAudioChunk(data);
      });

      this.isRunning = true;
      console.log(
        `[Wakeword] Listening for: ${this.keywords.join(', ')} ` +
          `(mapped to: ${this.builtinKeywords.join(', ')})`
      );
    } catch (error) {
      console.error('[Wakeword] Failed to start:', error);
      this.cleanup();
      throw error;
    }
  }

  private processAudioChunk(data: Buffer): void {
    if (!this.porcupine || !this.isRunning) return;

    // Append new data to buffer
    this.audioBuffer = Buffer.concat([this.audioBuffer, data]);

    const frameLength = this.porcupine.frameLength;
    const bytesPerFrame = frameLength * 2; // 16-bit = 2 bytes per sample

    // Process complete frames
    while (this.audioBuffer.length >= bytesPerFrame) {
      // Extract one frame
      const frameBuffer = this.audioBuffer.subarray(0, bytesPerFrame);
      this.audioBuffer = this.audioBuffer.subarray(bytesPerFrame);

      // Convert to Int16Array for Porcupine
      const pcm = new Int16Array(frameLength);
      for (let i = 0; i < frameLength; i++) {
        pcm[i] = frameBuffer.readInt16LE(i * 2);
      }

      try {
        // Process with Porcupine
        const keywordIndex = this.porcupine.process(pcm);

        if (keywordIndex >= 0) {
          const detectedKeyword = this.keywords[keywordIndex] ?? 'unknown';
          console.log(`[Wakeword] Detected: ${detectedKeyword}`);

          if (this.callback) {
            // Porcupine doesn't provide confidence scores for built-in keywords
            this.callback(detectedKeyword, 1.0);
          }
        }
      } catch (error) {
        if (this.isRunning) {
          console.error('[Wakeword] Processing error:', error);
        }
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    this.cleanup();
    console.log('[Wakeword] Stopped');
  }

  private cleanup(): void {
    if (this.recorder) {
      try {
        this.recorder.kill('SIGTERM');
      } catch {
        // Ignore cleanup errors
      }
      this.recorder = null;
    }

    if (this.porcupine) {
      try {
        this.porcupine.release();
      } catch {
        // Ignore cleanup errors
      }
      this.porcupine = null;
    }

    this.audioBuffer = Buffer.alloc(0);
  }

  isListening(): boolean {
    return this.isRunning;
  }
}
