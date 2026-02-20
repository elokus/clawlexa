/**
 * Local Audio Transport - Hardware audio via PipeWire (Linux) or sox (macOS).
 *
 * Handles both microphone capture and speaker playback using native tools:
 * - Linux (Pi): pw-cat for PipeWire
 * - macOS: sox (rec/play commands)
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AUDIO_CONFIG, type IAudioTransport } from './types.js';

const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';

export interface LocalAudioDeviceInfo {
  inputDevices: string[];
  outputDevices: string[];
  defaultInputDevice: string;
  defaultOutputDevice: string;
}

export interface LocalTransportOptions {
  inputDevice?: string;
  outputDevice?: string;
}

export function parseMacAudioDevices(systemProfilerOutput: string): LocalAudioDeviceInfo {
  const inputSet = new Set<string>();
  const outputSet = new Set<string>();
  let currentDevice: string | null = null;
  let defaultInput: string | null = null;
  let defaultOutput: string | null = null;

  for (const line of systemProfilerOutput.split('\n')) {
    const deviceLine = line.match(/^ {8}(.+):$/);
    if (deviceLine?.[1]) {
      currentDevice = deviceLine[1].trim();
      continue;
    }

    const trimmed = line.trim();
    if (!currentDevice || !trimmed) continue;

    if (trimmed === 'Default Input Device: Yes') {
      defaultInput = currentDevice;
      inputSet.add(currentDevice);
      continue;
    }
    if (trimmed === 'Default Output Device: Yes') {
      defaultOutput = currentDevice;
      outputSet.add(currentDevice);
      continue;
    }
    if (trimmed.startsWith('Input Channels:')) {
      inputSet.add(currentDevice);
      continue;
    }
    if (trimmed.startsWith('Output Channels:')) {
      outputSet.add(currentDevice);
    }
  }

  const inputDevices = [...inputSet];
  const outputDevices = [...outputSet];
  const defaultInputDevice = defaultInput ?? inputDevices[0] ?? 'default';
  const defaultOutputDevice = defaultOutput ?? outputDevices[0] ?? 'default';

  return {
    inputDevices: inputDevices.length > 0 ? inputDevices : ['default'],
    outputDevices: outputDevices.length > 0 ? outputDevices : ['default'],
    defaultInputDevice,
    defaultOutputDevice,
  };
}

function parseLinuxAudioDevices(): LocalAudioDeviceInfo {
  try {
    const sourcesRaw = execSync('pactl list short sources', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const sinksRaw = execSync('pactl list short sinks', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const infoRaw = execSync('pactl info', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

    const inputDevices = sourcesRaw
      .split('\n')
      .map((line) => line.split('\t')[1]?.trim())
      .filter((name): name is string => Boolean(name));
    const outputDevices = sinksRaw
      .split('\n')
      .map((line) => line.split('\t')[1]?.trim())
      .filter((name): name is string => Boolean(name));

    const defaultInputDevice =
      infoRaw.match(/^Default Source:\s*(.+)$/m)?.[1]?.trim() ??
      inputDevices[0] ??
      'default';
    const defaultOutputDevice =
      infoRaw.match(/^Default Sink:\s*(.+)$/m)?.[1]?.trim() ??
      outputDevices[0] ??
      'default';

    return {
      inputDevices: inputDevices.length > 0 ? inputDevices : ['default'],
      outputDevices: outputDevices.length > 0 ? outputDevices : ['default'],
      defaultInputDevice,
      defaultOutputDevice,
    };
  } catch {
    return {
      inputDevices: ['default'],
      outputDevices: ['default'],
      defaultInputDevice: 'default',
      defaultOutputDevice: 'default',
    };
  }
}

export class LocalTransport extends EventEmitter implements IAudioTransport {
  private static readonly PLAYBACK_WARMUP_MS = 80;
  private static readonly MAX_QUEUE_BYTES = 1024 * 1024; // 1MB safety cap

  private recorder: ChildProcess | null = null;
  private player: ChildProcess | null = null;
  private isRecording = false;
  private isPlaying = false;
  private captureEnabled = true;
  private playbackSampleRate: number = AUDIO_CONFIG.API_SAMPLE_RATE;
  private inputDevice: string;
  private outputDevice: string;
  private captureFallbackAttempted = false;
  private playbackFallbackAttempted = false;
  private playbackReady = false;
  private playbackWarmupTimer: NodeJS.Timeout | null = null;
  private playbackQueue: Buffer[] = [];
  private queuedPlaybackBytes = 0;
  private flushScheduled = false;

  constructor(options?: LocalTransportOptions) {
    super();
    this.inputDevice = options?.inputDevice ?? 'default';
    this.outputDevice = options?.outputDevice ?? 'default';

    if (!isLinux && !isMac) {
      console.warn(`[LocalTransport] Unsupported platform: ${process.platform}`);
    }
  }

  static listAudioDevices(): LocalAudioDeviceInfo {
    if (isMac) {
      try {
        const output = execSync('system_profiler SPAudioDataType 2>/dev/null', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return parseMacAudioDevices(output);
      } catch {
        return {
          inputDevices: ['default'],
          outputDevices: ['default'],
          defaultInputDevice: 'default',
          defaultOutputDevice: 'default',
        };
      }
    }

    if (isLinux) {
      return parseLinuxAudioDevices();
    }

    return {
      inputDevices: ['default'],
      outputDevices: ['default'],
      defaultInputDevice: 'default',
      defaultOutputDevice: 'default',
    };
  }

  /**
   * Start capturing microphone audio.
   */
  start(): void {
    if (this.isRecording) {
      return;
    }
    this.captureFallbackAttempted = false;

    if (isLinux) {
      this.startLinuxCapture();
    } else if (isMac) {
      this.startMacCapture();
    } else {
      this.emit('error', new Error(`Unsupported platform: ${process.platform}`));
      return;
    }

    this.isRecording = true;
    console.log(
      `[LocalTransport] Capture started (${AUDIO_CONFIG.API_SAMPLE_RATE}Hz pcm16, input=${this.inputDevice})`
    );
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
   *
   * We omit -r from rec options so sox captures at the device's native rate
   * (Bluetooth devices like Bose QC45 may not support 24kHz natively).
   * The `rate` effect then resamples to the target sample rate.
   */
  private startMacCapture(): void {
    if (this.inputDevice === 'default') {
      this.recorder = spawn('rec', [
        '-t', 'raw',           // Raw PCM output
        '-e', 'signed',        // Signed integers
        '-b', String(AUDIO_CONFIG.BIT_DEPTH),
        '-c', String(AUDIO_CONFIG.CHANNELS),
        '-q',                  // Quiet mode (suppress progress)
        '-',                   // Output to stdout
        'rate', String(AUDIO_CONFIG.API_SAMPLE_RATE),  // Resample to target rate
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      this.recorder = spawn('sox', [
        '-q',
        '-t', 'coreaudio',
        this.inputDevice,
        '-t', 'raw',
        '-e', 'signed',
        '-b', String(AUDIO_CONFIG.BIT_DEPTH),
        '-c', String(AUDIO_CONFIG.CHANNELS),
        '-',
        'rate', String(AUDIO_CONFIG.API_SAMPLE_RATE),
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

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
      if (
        this.isRecording &&
        isMac &&
        code !== 0 &&
        this.inputDevice !== 'default' &&
        !this.captureFallbackAttempted
      ) {
        const failedDevice = this.inputDevice;
        this.captureFallbackAttempted = true;
        this.inputDevice = 'default';
        console.error(
          `[LocalTransport] input device "${failedDevice}" failed; retrying with default input`
        );
        this.emit(
          'error',
          new Error(`Input device "${failedDevice}" unavailable; switched to default input`)
        );
        this.startMacCapture();
        this.isRecording = true;
        return;
      }

      if (this.isRecording && code !== 0) {
        console.error(`[LocalTransport] ${name} exited with code ${code}`);
      }
      this.isRecording = false;
    });

    this.recorder.stdout?.on('data', (data: Buffer) => {
      if (!this.captureEnabled) {
        return;
      }
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
    const hadCaptureOrPlayback = this.isRecording || this.isPlaying;

    this.isRecording = false;

    if (this.recorder) {
      this.recorder.kill('SIGTERM');
      this.recorder = null;
    }

    // Also stop playback when capture stops
    this.stopPlayback();

    if (hadCaptureOrPlayback) {
      console.log('[LocalTransport] Stopped');
    }
  }

  /**
   * Play PCM16 mono audio. Accepts an optional sample rate from the provider;
   * defaults to AUDIO_CONFIG.API_SAMPLE_RATE (24kHz).
   */
  play(audio: ArrayBuffer, sampleRate?: number): void {
    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);

    if (!this.player) {
      this.startPlayback(sampleRate);
    }

    this.enqueuePlaybackBuffer(buffer);
    this.schedulePlaybackFlush();
  }

  /**
   * Start the playback process.
   */
  private startPlayback(sampleRate?: number): void {
    if (this.player) {
      return;
    }

    this.playbackSampleRate = sampleRate ?? AUDIO_CONFIG.API_SAMPLE_RATE;
    this.playbackFallbackAttempted = false;

    if (isLinux) {
      this.startLinuxPlayback();
    } else if (isMac) {
      this.startMacPlayback();
    } else {
      this.emit('error', new Error(`Unsupported platform: ${process.platform}`));
      return;
    }

    this.isPlaying = true;
    this.playbackReady = false;
    console.log(
      `[LocalTransport] Playback started (${this.playbackSampleRate}Hz pcm16, output=${this.outputDevice})`
    );

    // CoreAudio sinks can exit prematurely if stdin is written immediately
    // after spawn. Buffer initial chunks and flush after a short warmup.
    this.clearPlaybackWarmupTimer();
    this.playbackWarmupTimer = setTimeout(() => {
      this.playbackReady = true;
      this.schedulePlaybackFlush();
    }, LocalTransport.PLAYBACK_WARMUP_MS);
  }

  /**
   * Start Linux playback using pw-cat (PipeWire).
   */
  private startLinuxPlayback(): void {
    this.player = spawn('pw-cat', [
      '--playback',
      '--raw',
      '--channels', String(AUDIO_CONFIG.CHANNELS),
      '--rate', String(this.playbackSampleRate),
      '--format', AUDIO_CONFIG.FORMAT,
      '-',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.setupPlayerHandlers('pw-cat');
  }

  /**
   * Start macOS playback using a direct SoX CoreAudio sink.
   *
   * We intentionally avoid the `play` wrapper because under Bun + realtime
   * chunked stdin it can exit early, which truncates assistant utterances.
   */
  private startMacPlayback(): void {
    this.player = spawn('sox', [
      '-q',
      '-t', 'raw',
      '-r', String(this.playbackSampleRate),
      '-e', 'signed',
      '-b', String(AUDIO_CONFIG.BIT_DEPTH),
      '-c', String(AUDIO_CONFIG.CHANNELS),
      '-',
      '-t', 'coreaudio',
      this.outputDevice,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.setupPlayerHandlers('sox coreaudio');
  }

  /**
   * Set up event handlers for the player process.
   */
  private setupPlayerHandlers(name: string): void {
    if (!this.player) return;

    this.player.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[LocalTransport] ${name} stderr:`, msg);
      }
    });

    this.player.on('error', (err) => {
      console.error(`[LocalTransport] ${name} error:`, err.message);
      if (
        isMac &&
        this.isPlaying &&
        this.outputDevice !== 'default' &&
        !this.playbackFallbackAttempted
      ) {
        const failedDevice = this.outputDevice;
        this.playbackFallbackAttempted = true;
        this.outputDevice = 'default';
        console.error(
          `[LocalTransport] output device "${failedDevice}" failed; falling back to default output`
        );
        this.emit(
          'error',
          new Error(`Output device "${failedDevice}" unavailable; switched to default output`)
        );
        this.player = null;
        this.startPlayback(this.playbackSampleRate);
        return;
      }
      this.player = null;
      this.isPlaying = false;
      this.playbackReady = false;
      this.clearPlaybackWarmupTimer();
    });

    this.player.on('exit', (code, signal) => {
      if (
        isMac &&
        this.isPlaying &&
        code !== 0 &&
        this.outputDevice !== 'default' &&
        !this.playbackFallbackAttempted
      ) {
        const failedDevice = this.outputDevice;
        this.playbackFallbackAttempted = true;
        this.outputDevice = 'default';
        console.error(
          `[LocalTransport] output device "${failedDevice}" exited with code ${code}; retrying default output`
        );
        this.emit(
          'error',
          new Error(`Output device "${failedDevice}" unavailable; switched to default output`)
        );
        this.player = null;
        this.startPlayback(this.playbackSampleRate);
        return;
      }
      console.error(`[LocalTransport] ${name} exited: code=${code} signal=${signal} (wasPlaying=${this.isPlaying})`);
      this.player = null;
      this.isPlaying = false;
      this.playbackReady = false;
      this.clearPlaybackWarmupTimer();
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
    this.playbackReady = false;
    this.clearPlaybackWarmupTimer();
    this.playbackQueue = [];
    this.queuedPlaybackBytes = 0;
    this.flushScheduled = false;

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
   * Enable/disable forwarding captured mic audio to listeners.
   * Capture process remains running; this only gates emitted chunks.
   */
  setCaptureEnabled(enabled: boolean): void {
    this.captureEnabled = enabled;
  }

  setInputDevice(device: string): void {
    const normalized = device.trim() || 'default';
    if (normalized === this.inputDevice) return;
    this.inputDevice = normalized;
    if (this.isRecording) {
      this.restartCapture();
    }
  }

  setOutputDevice(device: string): void {
    const normalized = device.trim() || 'default';
    if (normalized === this.outputDevice) return;
    this.outputDevice = normalized;
    // Restart playback pipe; next chunk continues on selected output.
    this.stopPlayback();
  }

  getSelectedDevices(): { inputDevice: string; outputDevice: string } {
    return { inputDevice: this.inputDevice, outputDevice: this.outputDevice };
  }

  /**
   * Check if transport is currently playing audio.
   */
  isPlayingAudio(): boolean {
    return this.isPlaying;
  }

  private restartCapture(): void {
    if (this.recorder) {
      try {
        this.recorder.kill('SIGTERM');
      } catch {
        // Ignore
      }
      this.recorder = null;
    }

    if (isLinux) {
      this.startLinuxCapture();
    } else if (isMac) {
      this.captureFallbackAttempted = false;
      this.startMacCapture();
    } else {
      this.emit('error', new Error(`Unsupported platform: ${process.platform}`));
      return;
    }

    this.isRecording = true;
    console.log(`[LocalTransport] Capture input switched to ${this.inputDevice}`);
  }

  private enqueuePlaybackBuffer(buffer: Buffer): void {
    this.playbackQueue.push(buffer);
    this.queuedPlaybackBytes += buffer.byteLength;

    // Keep most-recent audio if writer stalls.
    while (this.queuedPlaybackBytes > LocalTransport.MAX_QUEUE_BYTES && this.playbackQueue.length > 0) {
      const dropped = this.playbackQueue.shift();
      if (!dropped) break;
      this.queuedPlaybackBytes -= dropped.byteLength;
    }
  }

  private schedulePlaybackFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flushPlaybackQueue();
    });
  }

  private flushPlaybackQueue(): void {
    if (!this.player || !this.playbackReady || !this.player.stdin?.writable) {
      return;
    }

    while (this.playbackQueue.length > 0) {
      const chunk = this.playbackQueue[0];
      if (!chunk) break;
      const writable = this.player.stdin.write(chunk);
      this.playbackQueue.shift();
      this.queuedPlaybackBytes -= chunk.byteLength;

      if (!writable) {
        this.player.stdin.once('drain', () => this.flushPlaybackQueue());
        break;
      }
    }
  }

  private clearPlaybackWarmupTimer(): void {
    if (!this.playbackWarmupTimer) return;
    clearTimeout(this.playbackWarmupTimer);
    this.playbackWarmupTimer = null;
  }
}
