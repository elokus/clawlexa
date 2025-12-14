/**
 * Audio Transport Layer - Abstracts audio I/O for different platforms.
 *
 * Exports:
 * - IAudioTransport: Interface for audio transport implementations
 * - LocalTransport: Hardware audio (Pi via PipeWire, Mac via sox)
 * - WebSocketTransport: Browser-based audio via WebSocket
 */

export { type IAudioTransport, type AudioTransportEvents, AUDIO_CONFIG } from './types.js';
export { LocalTransport } from './local.js';
export { WebSocketTransport, type WSAudioMessage } from './websocket.js';
