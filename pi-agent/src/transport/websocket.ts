/**
 * WebSocket Audio Transport - Browser-based audio via WebSocket.
 *
 * Routes audio to/from connected browser clients:
 * - Incoming audio from browser microphone → 'audio' event
 * - Outgoing audio for playback → send binary to clients
 *
 * This allows running the agent on a Mac (or any server) while using
 * the browser as the microphone and speaker.
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { type IAudioTransport, AUDIO_CONFIG } from './types.js';
import { broadcastBinary } from '../api/websocket.js';

// Message types for WebSocket communication (follows WSMessage format)
export interface WSAudioControlPayload {
  action: 'start' | 'stop' | 'interrupt';
}

export interface WSAudioMessage {
  type: 'audio_control';
  payload: WSAudioControlPayload;
  timestamp: number;
}

export class WebSocketTransport extends EventEmitter implements IAudioTransport {
  private active = false;
  private clients: Set<WebSocket>;

  /**
   * Create a WebSocket transport.
   * @param clients - Reference to the set of connected WebSocket clients
   */
  constructor(clients: Set<WebSocket>) {
    super();
    this.clients = clients;
  }

  /**
   * Start capturing audio from browser clients.
   * Sends a 'start' control message to all connected clients.
   */
  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;

    // Notify browser clients to start recording
    this.sendControlMessage('start');

    console.log(`[WebSocketTransport] Started (expecting ${AUDIO_CONFIG.API_SAMPLE_RATE}Hz pcm16)`);
  }

  /**
   * Stop capturing audio from browser clients.
   * Sends a 'stop' control message to all connected clients.
   */
  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    // Notify browser clients to stop recording
    this.sendControlMessage('stop');

    console.log('[WebSocketTransport] Stopped');
  }

  /**
   * Play audio by sending it to browser clients for playback.
   * Sends binary PCM16 24kHz data.
   */
  play(audio: ArrayBuffer): void {
    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
    broadcastBinary(buffer);
  }

  /**
   * Interrupt playback on browser clients.
   */
  interrupt(): void {
    this.sendControlMessage('interrupt');
    this.emit('interrupted');
  }

  /**
   * Check if transport is active.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Handle incoming audio data from a browser client.
   * This should be called by the WebSocket server when it receives binary data.
   */
  handleClientAudio(data: Buffer): void {
    if (!this.active) {
      // Log occasionally to help debug (not every frame to avoid spam)
      if (Math.random() < 0.01) {
        console.log('[WebSocketTransport] Dropping audio - transport not active');
      }
      return;
    }

    // Convert Buffer to ArrayBuffer and emit
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    this.emit('audio', arrayBuffer);
  }

  /**
   * Register a handler for incoming client audio.
   * Used for wiring up the WebSocket server's binary message handler.
   */
  getAudioHandler(): (data: Buffer) => void {
    return (data: Buffer) => this.handleClientAudio(data);
  }

  /**
   * Send a control message to all connected clients.
   * Uses WSMessage format for consistency with other WebSocket messages.
   */
  private sendControlMessage(action: 'start' | 'stop' | 'interrupt'): void {
    if (this.clients.size === 0) {
      return;
    }

    const message: WSAudioMessage = {
      type: 'audio_control',
      payload: { action },
      timestamp: Date.now(),
    };

    const data = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
