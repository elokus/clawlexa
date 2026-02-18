import type { RealtimeItem } from '@openai/agents/realtime';
import type { AgentProfile } from '../agent/profiles.js';
import type {
  AgentState,
  VoiceRuntime,
  VoiceRuntimeConfig,
  VoiceRuntimeEvents,
} from './types.js';

/**
 * Phase 3 scaffold.
 * We register the provider and config path now, but keep connect() explicit about
 * missing implementation details (tool translation + bidirectional audio protocol).
 */
export class GeminiLiveRuntime implements VoiceRuntime {
  readonly mode = 'voice-to-voice' as const;
  readonly provider = 'gemini-live' as const;

  private state: AgentState = 'idle';
  private connected = false;
  private eventHandlers: Partial<VoiceRuntimeEvents> = {};

  constructor(_profile: AgentProfile, _runtimeConfig: VoiceRuntimeConfig) {
    // phase-3 scaffold keeps constructor signature for factory parity
  }

  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  async connect(): Promise<void> {
    const error = new Error(
      [
        'Gemini Live runtime is scaffolded but not fully implemented yet.',
        'Phase 3 implementation target: native bidirectional audio + tool-call translation.',
        'Use VOICE_PROVIDER=openai-realtime or VOICE_MODE=decomposed for now.',
      ].join(' ')
    );
    this.emit('error', error);
    throw error;
  }

  disconnect(): void {
    this.connected = false;
    this.state = 'idle';
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendAudio(_audio: ArrayBuffer): void {
    // no-op until protocol implementation lands
  }

  sendMessage(_text: string): void {
    // no-op until protocol implementation lands
  }

  interrupt(): void {
    this.emit('audioInterrupted');
  }

  getState(): AgentState {
    return this.state;
  }

  getHistory(): RealtimeItem[] {
    return [];
  }

  private emit<K extends keyof VoiceRuntimeEvents>(
    event: K,
    ...args: Parameters<VoiceRuntimeEvents[K]>
  ): void {
    const handler = this.eventHandlers[event];
    if (!handler) return;
    (handler as (...eventArgs: Parameters<VoiceRuntimeEvents[K]>) => void)(...args);
  }
}
