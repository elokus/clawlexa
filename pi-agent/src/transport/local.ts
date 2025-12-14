/**
 * Local Audio Transport - Hardware audio via PipeWire (Linux) or sox (macOS).
 *
 * Handles both microphone capture and speaker playback using native tools:
 * - Linux (Pi): pw-cat for PipeWire
 * - macOS: sox (rec/play commands)
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AUDIO_CONFIG, type IAudioTransport } from './types.js';

const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';

export class LocalTransport extends EventEmitter implements IAudioTransport {
  private recorder: ChildProcess | null = null;
  private player: ChildProcess | null = null;
  private isRecording = false;
  private isPlaying = false;

  constructor() {
    super();

    if (!isLinux && !isMac) {
      console.warn(`[LocalTransport] Unsupported platform: ${process.platform}`);
    }
  }

  /**
   * Start capturing microphone audio.
   */
  start(): void {
    if (this.isRecording) {
      return;
    }

    if (isLinux) {
      this.startLinuxCapture();
    } else if (isMac) {
      this.startMacCapture();
    } else {
      this.emit('error', new Error(`Unsupported platform: ${process.platform}`));
      return;
    }

    this.isRecording = true;
    console.log(`[LocalTransport] Capture started (${AUDIO_CONFIG.API_SAMPLE_RATE}Hz pcm16)`);
  }

  /**
   * Start Linux capture using pw-cat (PipeWire).
   */
  private startLinuxCapture(): void {
    this.recorder = spawn('pw-cat', [
      '--record',
      '--raw',
      '--channels', String(AUDIO_CONFIG.CHANNELS),
      '--rate', String(AUDIO_CONFIG.API_SAMPLE_RATE),
      '--format', AUDIO_CONFIG.FORMAT,
      '-',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.setupRecorderHandlers('pw-cat');
  }

  /**
   * Start macOS capture using sox (rec command).
   * Requires: brew install sox
   */
  private startMacCapture(): void {
    this.recorder = spawn('rec', [
      '-t', 'raw',           // Raw PCM output
      '-r', String(AUDIO_CONFIG.API_SAMPLE_RATE),
      '-e', 'signed',        // Signed integers
      '-b', String(AUDIO_CONFIG.BIT_DEPTH),
      '-c', String(AUDIO_CONFIG.CHANNELS),
      '-q',                  // Quiet mode (suppress progress)
      '-',                   // Output to stdout
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.setupRecorderHandlers('sox rec');
  }

  /**
   * Set up event handlers for the recorder process.
   */
  private setupRecorderHandlers(name: string): void {
    if (!this.recorder) return;

    this.recorder.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('opened') && !msg.includes('In:')) {
        console.error(`[LocalTransport] ${name}:`, msg);
      }
    });

    this.recorder.on('error', (err) => {
      console.error(`[LocalTransport] ${name} error:`, err.message);
      this.emit('error', err);
    });

    this.recorder.on('exit', (code) => {
      if (this.isRecording && code !== 0) {
        console.error(`[LocalTransport] ${name} exited with code ${code}`);
      }
      this.isRecording = false;
    });

    this.recorder.stdout?.on('data', (data: Buffer) => {
      // Convert Buffer to ArrayBuffer and emit
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
      this.emit('audio', arrayBuffer);
    });
  }

  /**
   * Stop capturing audio.
   */
  stop(): void {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;

    if (this.recorder) {
      this.recorder.kill('SIGTERM');
      this.recorder = null;
    }

    // Also stop playback when capture stops
    this.stopPlayback();

    console.log('[LocalTransport] Stopped');
  }

  /**
   * Play PCM16 24kHz mono audio.
   */
  play(audio: ArrayBuffer): void {
    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);

    if (!this.player) {
      this.startPlayback();
    }

    if (this.player?.stdin?.writable) {
      this.player.stdin.write(buffer);
    }
  }

  /**
   * Start the playback process.
   */
  private startPlayback(): void {
    if (this.player) {
      return;
    }

    if (isLinux) {
      this.startLinuxPlayback();
    } else if (isMac) {
      this.startMacPlayback();
    } else {
      this.emit('error', new Error(`Unsupported platform: ${process.platform}`));
      return;
    }

    this.isPlaying = true;
    console.log(`[LocalTransport] Playback started (${AUDIO_CONFIG.API_SAMPLE_RATE}Hz pcm16)`);
  }

  /**
   * Start Linux playback using pw-cat (PipeWire).
   */
  private startLinuxPlayback(): void {
    this.player = spawn('pw-cat', [
      '--playback',
      '--raw',
      '--channels', String(AUDIO_CONFIG.CHANNELS),
      '--rate', String(AUDIO_CONFIG.API_SAMPLE_RATE),
      '--format', AUDIO_CONFIG.FORMAT,
      '-',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.setupPlayerHandlers('pw-cat');
  }

  /**
   * Start macOS playback using sox (play command).
   * Requires: brew install sox
   */
  private startMacPlayback(): void {
    this.player = spawn('play', [
      '-t', 'raw',           // Raw PCM input
      '-r', String(AUDIO_CONFIG.API_SAMPLE_RATE),
      '-e', 'signed',        // Signed integers
      '-b', String(AUDIO_CONFIG.BIT_DEPTH),
      '-c', String(AUDIO_CONFIG.CHANNELS),
      '-q',                  // Quiet mode (suppress progress)
      '-',                   // Input from stdin
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.setupPlayerHandlers('sox play');
  }

  /**
   * Set up event handlers for the player process.
   */
  private setupPlayerHandlers(name: string): void {
    if (!this.player) return;

    this.player.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('Out:')) {
        console.error(`[LocalTransport] ${name}:`, msg);
      }
    });

    this.player.on('error', (err) => {
      console.error(`[LocalTransport] ${name} error:`, err.message);
      this.player = null;
      this.isPlaying = false;
    });

    this.player.on('exit', (code) => {
      if (this.isPlaying && code !== 0 && code !== null) {
        console.error(`[LocalTransport] ${name} exited with code ${code}`);
      }
      this.player = null;
      this.isPlaying = false;
    });

    this.player.stdin?.on('error', () => {
      // Ignore EPIPE errors
    });
  }

  /**
   * Stop playback.
   */
  private stopPlayback(): void {
    this.isPlaying = false;

    if (this.player) {
      try {
        this.player.stdin?.end();
      } catch {
        // Ignore
      }
      try {
        this.player.kill('SIGTERM');
      } catch {
        // Ignore
      }
      this.player = null;
    }
  }

  /**
   * Interrupt any currently playing audio.
   */
  interrupt(): void {
    this.stopPlayback();
    this.emit('interrupted');
  }

  /**
   * Check if transport is actively capturing audio.
   */
  isActive(): boolean {
    return this.isRecording;
  }

  /**
   * Check if transport is currently playing audio.
   */
  isPlayingAudio(): boolean {
    return this.isPlaying;
  }
}
