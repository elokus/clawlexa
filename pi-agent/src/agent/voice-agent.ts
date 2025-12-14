/**
 * Voice Agent - Main orchestrator for the voice assistant.
 *
 * Handles:
 * - Profile-based activation via wake word
 * - Session lifecycle management
 * - Event routing to consumers
 * - Agent run logging to database
 * - Audio I/O via pluggable transport layer
 */

import { VoiceSession, type AgentState } from '../realtime/session.js';
import {
  profiles,
  createAgentFromProfile,
  getProfileByWakeword,
  type AgentProfile,
} from './profiles.js';
import type { TransportLayerAudio, RealtimeItem } from '@openai/agents/realtime';
import { getDatabase, AgentRunsRepository } from '../db/index.js';
import type { IAudioTransport } from '../transport/types.js';

export interface VoiceAgentEvents {
  stateChange: (state: AgentState, profile: string | null) => void;
  audio: (audio: TransportLayerAudio) => void;
  transcript: (text: string, role: 'user' | 'assistant') => void;
  error: (error: Error) => void;
  toolStart: (name: string, args: Record<string, unknown>) => void;
  toolEnd: (name: string, result: string) => void;
}

export class VoiceAgent {
  private session: VoiceSession | null = null;
  private currentProfile: AgentProfile | null = null;
  private state: AgentState = 'idle';
  private eventHandlers: Partial<VoiceAgentEvents> = {};
  private agentRunsRepo: AgentRunsRepository;
  private transcriptBuffer: string[] = [];
  private transport: IAudioTransport | null = null;

  /**
   * Create a VoiceAgent.
   * @param transport - Optional audio transport. If provided, the agent manages audio I/O internally.
   *                    If not provided, use the 'audio' event and sendAudio() method for external handling.
   */
  constructor(transport?: IAudioTransport) {
    // Initialize database and repositories
    getDatabase();
    this.agentRunsRepo = new AgentRunsRepository();

    // Set up transport if provided
    if (transport) {
      this.transport = transport;
      this.setupTransport();
    }
  }

  /**
   * Wire up transport events for internal audio handling.
   */
  private setupTransport(): void {
    if (!this.transport) return;

    // Route incoming audio from transport to session
    this.transport.on('audio', (chunk: ArrayBuffer) => {
      if (this.session) {
        this.session.sendAudio(chunk);
      }
    });

    this.transport.on('error', (error: Error) => {
      console.error('[VoiceAgent] Transport error:', error.message);
      this.emit('error', error);
    });
  }

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

      // Manage transport based on state (if transport is injected)
      if (this.transport) {
        if (state === 'listening' && !this.transport.isActive()) {
          this.transport.start();
        } else if (state === 'idle') {
          this.transport.stop();
        }
      }
    });

    this.session.on('audio', (audio) => {
      // Route to transport if available, otherwise emit for external handling
      if (this.transport && audio.data) {
        this.transport.play(audio.data);
      }
      this.emit('audio', audio);
    });

    this.session.on('transcript', (text, role) => {
      // Collect transcripts for logging
      this.transcriptBuffer.push(`${role}: ${text}`);
      this.emit('transcript', text, role);
    });

    this.session.on('error', (error) => {
      this.emit('error', error);
    });

    this.session.on('toolStart', (name, args) => {
      this.emit('toolStart', name, args);
    });

    this.session.on('toolEnd', (name, result) => {
      this.emit('toolEnd', name, result);
    });

    this.session.on('disconnected', () => {
      // Log the agent run to database before resetting state
      this.logAgentRun();
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
      // Log the agent run before disconnecting
      this.logAgentRun();
      this.session.disconnect();
      this.session = null;
    }

    // Stop transport if managed internally
    if (this.transport) {
      this.transport.stop();
    }

    this.currentProfile = null;
    this.state = 'idle';
    this.emit('stateChange', 'idle', null);
  }

  /**
   * Log the current agent run to the database.
   */
  private logAgentRun(): void {
    if (this.transcriptBuffer.length === 0) {
      return; // Nothing to log
    }

    try {
      this.agentRunsRepo.create({
        profile: this.currentProfile?.name ?? undefined,
        transcript: this.transcriptBuffer.join('\n'),
      });
      console.log(`[Agent] Logged run for profile: ${this.currentProfile?.name ?? 'unknown'}`);
    } catch (error) {
      console.error('[Agent] Failed to log agent run:', error);
    }

    // Clear the buffer
    this.transcriptBuffer = [];
  }

  isActive(): boolean {
    return this.session?.isConnected() ?? false;
  }

  /**
   * Get the audio transport (if one was injected).
   */
  getTransport(): IAudioTransport | null {
    return this.transport;
  }

  /**
   * Check if the agent is managing audio internally via transport.
   */
  hasTransport(): boolean {
    return this.transport !== null;
  }
}
