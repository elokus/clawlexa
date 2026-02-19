import {
  resamplePcm16Mono,
  type AudioFrame,
  type ClientTransport,
  type ClientTransportKind,
  type ClientTransportStartConfig,
} from '@voiceclaw/voice-runtime';
import { AUDIO_CONFIG, type IAudioTransport } from '../transport/types.js';

export class LegacyAudioTransportBridge implements ClientTransport {
  readonly kind: ClientTransportKind;

  private readonly transport: IAudioTransport;
  private readonly frameHandlers = new Set<(frame: AudioFrame) => void>();
  private inputRateHz: number = AUDIO_CONFIG.API_SAMPLE_RATE;
  private audioListener: ((chunk: ArrayBuffer) => void) | null = null;
  private playedMs = 0;
  private pendingMs = 0;
  private lastClockMs = Date.now();

  constructor(transport: IAudioTransport, kind?: ClientTransportKind) {
    this.transport = transport;
    this.kind = kind ?? inferTransportKind(transport);
  }

  async start(config: ClientTransportStartConfig): Promise<void> {
    this.inputRateHz = config.inputRate;
    this.resetPlaybackClock();

    if (this.audioListener) {
      this.transport.off('audio', this.audioListener);
      this.audioListener = null;
    }

    this.audioListener = (chunk: ArrayBuffer) => {
      const frame: AudioFrame = {
        data: chunk,
        sampleRate: this.inputRateHz,
        format: 'pcm16',
      };
      for (const handler of this.frameHandlers) {
        handler(frame);
      }
    };

    this.transport.on('audio', this.audioListener);
    if (!this.transport.isActive()) {
      this.transport.start();
    }
  }

  async stop(): Promise<void> {
    if (this.audioListener) {
      this.transport.off('audio', this.audioListener);
      this.audioListener = null;
    }
    if (this.transport.isActive()) {
      this.transport.stop();
    }
    this.resetPlaybackClock();
  }

  onAudioFrame(handler: (frame: AudioFrame) => void): void {
    this.frameHandlers.add(handler);
  }

  offAudioFrame(handler: (frame: AudioFrame) => void): void {
    this.frameHandlers.delete(handler);
  }

  playAudioFrame(frame: AudioFrame): void {
    this.advancePlaybackClock();
    const playbackFrame =
      frame.sampleRate === AUDIO_CONFIG.API_SAMPLE_RATE
        ? frame
        : resamplePcm16Mono(frame, AUDIO_CONFIG.API_SAMPLE_RATE);
    this.pendingMs += frameDurationMs(playbackFrame);
    this.transport.play(playbackFrame.data);
  }

  interruptPlayback(): void {
    this.advancePlaybackClock();
    this.pendingMs = 0;
    this.transport.interrupt();
  }

  getPlaybackPositionMs(): number {
    this.advancePlaybackClock();
    return this.playedMs;
  }

  private resetPlaybackClock(): void {
    this.playedMs = 0;
    this.pendingMs = 0;
    this.lastClockMs = Date.now();
  }

  private advancePlaybackClock(): void {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.lastClockMs);
    const consumedMs = Math.min(elapsedMs, this.pendingMs);
    this.pendingMs -= consumedMs;
    this.playedMs += consumedMs;
    this.lastClockMs = now;
  }
}

function frameDurationMs(frame: AudioFrame): number {
  if (frame.sampleRate <= 0) return 0;
  return (frame.data.byteLength / 2 / frame.sampleRate) * 1000;
}

function inferTransportKind(transport: IAudioTransport): ClientTransportKind {
  const name = transport.constructor.name.toLowerCase();
  if (name.includes('websocket')) return 'ws-pcm';
  return 'local-pcm';
}
