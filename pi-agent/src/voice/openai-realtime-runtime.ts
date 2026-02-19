import type { VoiceAgent } from '../agent/voice-agent.js';
import type { AgentProfile } from '../agent/profiles.js';
import { createAgentFromProfile } from '../agent/profiles.js';
import { VoiceSession } from '../realtime/session.js';
import type {
  VoiceRuntime,
  VoiceRuntimeConfig,
  VoiceRuntimeEvents,
  VoiceRuntimeHistoryItem,
} from './types.js';

/**
 * Phase 1 runtime: wraps the existing VoiceSession implementation with
 * the new VoiceRuntime contract. No behavior change.
 */
export class OpenAIRealtimeRuntime implements VoiceRuntime {
  readonly mode = 'voice-to-voice' as const;
  readonly provider = 'openai-realtime' as const;
  private readonly session: VoiceSession;

  constructor(
    profile: AgentProfile,
    sessionId: string,
    runtimeConfig: VoiceRuntimeConfig,
    voiceAgent?: VoiceAgent
  ) {
    const agent = createAgentFromProfile(profile, sessionId, voiceAgent);
    this.session = new VoiceSession(agent, profile, sessionId, {
      model: runtimeConfig.model,
      voice: runtimeConfig.voice,
      language: runtimeConfig.language,
      openaiApiKey: runtimeConfig.auth.openaiApiKey,
    });
  }

  connect(): Promise<void> {
    return this.session.connect();
  }

  disconnect(): void {
    this.session.disconnect();
  }

  isConnected(): boolean {
    return this.session.isConnected();
  }

  sendAudio(audio: ArrayBuffer): void {
    this.session.sendAudio(audio);
  }

  sendMessage(text: string): void {
    this.session.sendMessage(text);
  }

  interrupt(): void {
    this.session.interrupt();
  }

  getState() {
    return this.session.getState();
  }

  getHistory(): VoiceRuntimeHistoryItem[] {
    return this.session.getHistory() as unknown as VoiceRuntimeHistoryItem[];
  }

  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void {
    if (event === 'latency') {
      // OpenAI realtime pipeline does not currently emit stage latency metrics.
      return;
    }
    this.session.on(event as never, handler as never);
  }
}
