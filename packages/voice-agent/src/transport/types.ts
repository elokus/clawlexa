/**
 * Audio Transport Interface - Abstract audio I/O for different platforms.
 *
 * Implementations:
 * - LocalTransport: Hardware audio (Pi via PipeWire, Mac via sox)
 * - WebSocketTransport: Browser-based audio via WebSocket
 */

import { EventEmitter } from 'events';

export interface IAudioTransport extends EventEmitter {
  /**
   * Start capturing/handling audio.
   * For local transport: starts microphone recording.
   * For WebSocket transport: signals UI to start recording.
   */
  start(): void;

  /**
   * Stop capturing/handling audio.
   * For local transport: stops microphone recording.
   * For WebSocket transport: signals UI to stop recording.
   */
  stop(): void;

  /**
   * Play raw PCM16 24kHz mono audio.
   * For local transport: outputs to speakers.
   * For WebSocket transport: sends to connected browser clients.
   */
  play(audio: ArrayBuffer): void;

  /**
   * Check if transport is actively capturing audio.
   */
  isActive(): boolean;

  /**
   * Interrupt any currently playing audio.
   */
  interrupt(): void;
}

/**
 * Events emitted by IAudioTransport:
 * - 'audio': (chunk: ArrayBuffer) => void - Incoming audio from user (Mic/Browser)
 * - 'error': (error: Error) => void - Transport error
 * - 'interrupted': () => void - Audio playback was interrupted
 */
export interface AudioTransportEvents {
  audio: (chunk: ArrayBuffer) => void;
  error: (error: Error) => void;
  interrupted: () => void;
}

/**
 * Audio configuration constants.
 */
export const AUDIO_CONFIG = {
  /** OpenAI Realtime API sample rate */
  API_SAMPLE_RATE: 24000,
  /** Channels (mono) */
  CHANNELS: 1,
  /** Bit depth */
  BIT_DEPTH: 16,
  /** Format identifier */
  FORMAT: 's16' as const,
} as const;
