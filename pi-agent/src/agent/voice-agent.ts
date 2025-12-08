/**
 * Voice Agent - Main orchestrator for the voice assistant.
 *
 * Handles:
 * - Profile-based activation via wake word
 * - Session lifecycle management
 * - Event routing to consumers
 */

import { VoiceSession, type AgentState } from '../realtime/session.js';
import {
  profiles,
  createAgentFromProfile,
  getProfileByWakeword,
  type AgentProfile,
} from './profiles.js';
import type { TransportLayerAudio, RealtimeItem } from '@openai/agents/realtime';

export interface VoiceAgentEvents {
  stateChange: (state: AgentState, profile: string | null) => void;
  audio: (audio: TransportLayerAudio) => void;
  transcript: (text: string, role: 'user' | 'assistant') => void;
  error: (error: Error) => void;
}

export class VoiceAgent {
  private session: VoiceSession | null = null;
  private currentProfile: AgentProfile | null = null;
  private state: AgentState = 'idle';
  private eventHandlers: Partial<VoiceAgentEvents> = {};

  on<K extends keyof VoiceAgentEvents>(event: K, handler: VoiceAgentEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  private emit<K extends keyof VoiceAgentEvents>(
    event: K,
    ...args: Parameters<VoiceAgentEvents[K]>
  ): void {
    const handler = this.eventHandlers[event];
    if (handler) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (handler as (...a: any[]) => void)(...args);
    }
  }

  getState(): AgentState {
    return this.state;
  }

  getCurrentProfile(): AgentProfile | null {
    return this.currentProfile;
  }

  /**
   * Activate the agent with a specific wake word.
   * This looks up the profile and starts a conversation.
   */
  async activateWithWakeword(wakeword: string): Promise<boolean> {
    const profile = getProfileByWakeword(wakeword);
    if (!profile) {
      console.error(`Unknown wakeword: ${wakeword}`);
      return false;
    }
    return this.activateProfile(profile);
  }

  /**
   * Activate with a profile name (e.g., 'jarvis', 'marvin').
   */
  async activate(profileName: string): Promise<boolean> {
    // Look up by wake word first, then by profile name
    const profile =
      profiles[profileName] ?? profiles[`hey_${profileName.toLowerCase()}`];
    if (!profile) {
      console.error(`Unknown profile: ${profileName}`);
      return false;
    }
    return this.activateProfile(profile);
  }

  private async activateProfile(profile: AgentProfile): Promise<boolean> {
    // Disconnect existing session if any
    if (this.session) {
      this.session.disconnect();
    }

    this.currentProfile = profile;
    console.log(`[Agent] Activating profile: ${profile.name}`);

    const agent = createAgentFromProfile(profile);
    this.session = new VoiceSession(agent, profile);

    // Wire up events
    this.session.on('stateChange', (state) => {
      this.state = state;
      this.emit('stateChange', state, this.currentProfile?.name ?? null);
    });

    this.session.on('audio', (audio) => {
      this.emit('audio', audio);
    });

    this.session.on('transcript', (text, role) => {
      this.emit('transcript', text, role);
    });

    this.session.on('error', (error) => {
      this.emit('error', error);
    });

    this.session.on('disconnected', () => {
      this.state = 'idle';
      this.emit('stateChange', 'idle', null);
    });

    try {
      await this.session.connect();
      return true;
    } catch (error) {
      console.error('Failed to connect session:', error);
      this.emit('error', error as Error);
      return false;
    }
  }

  sendAudio(audio: ArrayBuffer): void {
    this.session?.sendAudio(audio);
  }

  sendMessage(text: string): void {
    this.session?.sendMessage(text);
  }

  interrupt(): void {
    this.session?.interrupt();
  }

  getHistory(): RealtimeItem[] {
    return this.session?.getHistory() ?? [];
  }

  deactivate(): void {
    if (this.session) {
      this.session.disconnect();
      this.session = null;
    }
    this.currentProfile = null;
    this.state = 'idle';
    this.emit('stateChange', 'idle', null);
  }

  isActive(): boolean {
    return this.session?.isConnected() ?? false;
  }
}
