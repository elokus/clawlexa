/**
 * Audio Capture - Captures microphone input via PipeWire
 *
 * Uses pw-cat to capture audio at 24kHz (Realtime API format).
 * PipeWire handles the resampling from device's native rate.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const API_SAMPLE_RATE = 24000;

export class AudioCapture extends EventEmitter {
  private recorder: ChildProcess | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) {
      return;
    }

    // Use pw-cat to capture audio at 24kHz - PipeWire handles resampling
    this.recorder = spawn('pw-cat', [
      '--record',
      '--raw',
      '--channels', '1',
      '--rate', String(API_SAMPLE_RATE),
      '--format', 's16',
      '-',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.recorder.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('opened')) {
        console.error('[AudioCapture] pw-cat:', msg);
      }
    });

    this.recorder.on('error', (err) => {
      console.error('[AudioCapture] Error:', err.message);
      this.emit('error', err);
    });

    this.recorder.on('exit', (code) => {
      if (this.isRunning && code !== 0) {
        console.error(`[AudioCapture] pw-cat exited with code ${code}`);
      }
      this.isRunning = false;
    });

    this.recorder.stdout?.on('data', (data: Buffer) => {
      // Convert Buffer to ArrayBuffer and emit
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
      this.emit('audio', arrayBuffer);
    });

    this.isRunning = true;
    console.log(`[AudioCapture] Started (${API_SAMPLE_RATE}Hz pcm16)`);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.recorder) {
      this.recorder.kill('SIGTERM');
      this.recorder = null;
    }

    console.log('[AudioCapture] Stopped');
  }

  isCapturing(): boolean {
    return this.isRunning;
  }
}
