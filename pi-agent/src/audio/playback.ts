/**
 * Audio Playback - Plays audio via PipeWire
 *
 * Uses pw-cat to play audio at 24kHz (Realtime API format).
 * PipeWire handles the resampling to device's native rate.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const API_SAMPLE_RATE = 24000;

export class AudioPlayback extends EventEmitter {
  private player: ChildProcess | null = null;
  private isPlaying = false;

  start(): void {
    if (this.player) {
      return;
    }

    // Use pw-cat at 24kHz - PipeWire handles resampling to device
    this.player = spawn('pw-cat', [
      '--playback',
      '--raw',
      '--channels', '1',
      '--rate', String(API_SAMPLE_RATE),
      '--format', 's16',
      '-',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.player.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error('[AudioPlayback] pw-cat:', msg);
      }
    });

    this.player.on('error', (err) => {
      console.error('[AudioPlayback] Error:', err.message);
      this.player = null;
      this.isPlaying = false;
    });

    this.player.on('exit', (code) => {
      if (this.isPlaying && code !== 0 && code !== null) {
        console.error(`[AudioPlayback] pw-cat exited with code ${code}`);
      }
      this.player = null;
      this.isPlaying = false;
    });

    this.player.stdin?.on('error', () => {
      // Ignore EPIPE errors
    });

    this.isPlaying = true;
    console.log(`[AudioPlayback] Started (${API_SAMPLE_RATE}Hz pcm16)`);
  }

  play(data: ArrayBuffer | Buffer): void {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (!this.player) {
      this.start();
    }

    if (this.player?.stdin?.writable) {
      this.player.stdin.write(buffer);
    }
  }

  stop(): void {
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
    console.log('[AudioPlayback] Stopped');
  }

  interrupt(): void {
    this.stop();
    this.emit('interrupted');
  }

  isActive(): boolean {
    return this.isPlaying;
  }
}
