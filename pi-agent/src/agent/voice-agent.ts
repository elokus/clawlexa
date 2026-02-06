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

import { randomUUID } from 'crypto';
import { VoiceSession, type AgentState } from '../realtime/session.js';
import {
  profiles,
  createAgentFromProfile,
  getProfileByWakeword,
  type AgentProfile,
} from './profiles.js';
import type { TransportLayerAudio, RealtimeItem } from '@openai/agents/realtime';
import { getDatabase, AgentRunsRepository, CliSessionsRepository } from '../db/index.js';
import type { VoiceProfile } from '../db/index.js';
import type { IAudioTransport } from '../transport/types.js';
import { wsBroadcast } from '../api/websocket.js';
import { createVoiceAdapter, type VoiceAdapter } from '../realtime/ai-sdk-adapter.js';
import type { ManagedProcess } from '../processes/manager.js';
import { buildHandoffPacket, type HandoffPacket, type VoiceContextEntry } from '../context/handoff.js';
import { getProcessManager } from '../processes/manager.js';
import { getSessionLogger, removeSessionLogger } from '../logging/session-logger.js';

export interface VoiceAgentEvents {
  stateChange: (state: AgentState, profile: string | null) => void;
  audio: (audio: TransportLayerAudio) => void;
  transcript: (text: string, role: 'user' | 'assistant') => void;
  transcriptDelta: (delta: string, role: 'user' | 'assistant') => void;
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
  private sessionsRepo: CliSessionsRepository;
  private transcriptBuffer: string[] = [];
  private transport: IAudioTransport | null = null;
  private currentSessionId: string | null = null; // Track current voice session ID for DB
  private adapter: VoiceAdapter | null = null; // AI SDK adapter for unified stream_chunk events
  private pendingNotifications: ManagedProcess[] = [];
  private voiceContext: VoiceContextEntry[] = []; // Accumulated voice context for HandoffPacket
  private readonly MAX_CONTEXT_ENTRIES = 30;

  /**
   * Create a VoiceAgent.
   * @param transport - Optional audio transport. If provided, the agent manages audio I/O internally.
   *                    If not provided, use the 'audio' event and sendAudio() method for external handling.
   */
  constructor(transport?: IAudioTransport) {
    // Initialize database and repositories
    getDatabase();
    this.agentRunsRepo = new AgentRunsRepository();
    this.sessionsRepo = new CliSessionsRepository();

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

    // Generate session ID at the orchestrator level
    // This ID is propagated to:
    // 1. createAgentFromProfile - for factory tools (e.g., developer_session)
    // 2. VoiceSession - for lifecycle tracking and logging
    // 3. Database - for session hierarchy tracking
    const sessionId = randomUUID();
    this.currentSessionId = sessionId;
    console.log(`[Agent] Activating profile: ${profile.name} (Session: ${sessionId})`);

    // Create voice session in database - voice is now persisted in the session tree
    const voiceProfileName = profile.name.toLowerCase() as VoiceProfile;
    this.sessionsRepo.createVoice({
      id: sessionId,
      profile: voiceProfileName,
      goal: `Voice conversation (${profile.name})`,
    });
    console.log(`[Agent] Created voice session in DB: ${sessionId}`);

    // Broadcast tree update so frontend can show the new voice session
    wsBroadcast.sessionTreeUpdate(sessionId);

    // Create JSONL session logger for debugging
    getSessionLogger(sessionId, null, 'voice', null, { profile: voiceProfileName });

    // Create session FIRST so it can buffer audio during connection
    // Pass `this` (VoiceAgent) so tools like background_task can notify on completion
    const agent = createAgentFromProfile(profile, sessionId, this);
    this.session = new VoiceSession(agent, profile, sessionId);

    // Create AI SDK adapter for unified stream_chunk events
    // This replaces the legacy wsBroadcast.transcript/toolStart/toolEnd calls
    this.adapter = createVoiceAdapter(sessionId);

    // Start transport AFTER session exists so audio can be buffered
    // This is critical for web mode where audio capture starts immediately
    if (this.transport && !this.transport.isActive()) {
      console.log('[Agent] Starting transport early for audio capture');
      this.transport.start();
    }

    // Wire up events
    this.session.on('stateChange', (state) => {
      this.state = state;
      // Emit state change for UI (listening/thinking/speaking indicator)
      this.emit('stateChange', state, this.currentProfile?.name ?? null);

      // Emit AI SDK lifecycle events via adapter (start-step on thinking, finish on idle)
      // This ensures the frontend knows when a response is complete (clears pending flag)
      this.adapter?.stateChange(state, this.currentProfile?.name ?? null);

      // Log state change to JSONL
      if (this.currentSessionId) {
        const logger = getSessionLogger(this.currentSessionId);
        logger.append({
          type: 'state-change',
          id: `sc-${Date.now()}`,
          state,
          profile: this.currentProfile?.name ?? null,
          timestamp: new Date().toISOString(),
        });
      }

      // Stop transport when going idle
      if (this.transport && state === 'idle') {
        this.transport.stop();
      }
    });

    this.session.on('audio', (audio) => {
      // Route to transport if available, otherwise emit for external handling
      if (this.transport && audio.data) {
        this.transport.play(audio.data);
      }
      this.emit('audio', audio);
    });

    // Wire up placeholder events for message ordering
    // These are emitted when conversation.item.added arrives, before transcripts
    this.session.on('userItemCreated', (itemId) => {
      this.adapter?.userPlaceholder(itemId);
    });

    this.session.on('assistantItemCreated', (itemId, previousItemId) => {
      this.adapter?.assistantPlaceholder(itemId, previousItemId);
    });

    this.session.on('transcript', (text, role, itemId) => {
      // Collect transcripts for logging
      this.transcriptBuffer.push(`${role}: ${text}`);
      // Accumulate voice context for HandoffPacket (anti-telephone)
      this.addVoiceContext(role, text);
      // Emit stream_chunk via AI SDK adapter (unified protocol)
      // Only emit for user messages - assistant messages are streamed via transcriptDelta
      if (role === 'user') {
        this.adapter?.transcript(text, role, itemId);
      }
    });

    this.session.on('transcriptDelta', (delta, role, itemId) => {
      // Stream assistant transcript deltas in real-time
      // User transcripts don't have deltas (they arrive complete)
      if (role === 'assistant') {
        this.adapter?.transcript(delta, role, itemId);
      }
    });

    this.session.on('error', (error) => {
      // Emit stream_chunk error via adapter
      this.adapter?.error(error.message);
      this.emit('error', error);
    });

    this.session.on('toolStart', (name, args) => {
      // Emit stream_chunk tool-call via adapter
      this.adapter?.toolStart(name, args);
    });

    this.session.on('toolEnd', (name, result) => {
      // Accumulate tool result in voice context for HandoffPacket
      this.addVoiceContext('system', `[Tool: ${name}] ${result}`, { name, result });
      // Emit stream_chunk tool-result via adapter
      this.adapter?.toolEnd(name, result);
    });

    // When audio is interrupted (user speaks over agent), stop local playback
    // This is critical for WebSocket transport where we manage audio playback ourselves
    this.session.on('audioInterrupted', () => {
      if (this.transport) {
        this.transport.interrupt();
      }
    });

    this.session.on('disconnected', () => {
      // Log the agent run to database before resetting state
      this.logAgentRun();

      // Clean up adapter state tracking
      this.adapter?.cleanup();

      // Mark voice session as finished in database
      if (this.currentSessionId) {
        this.sessionsRepo.finish(this.currentSessionId, 'finished');
        console.log(`[Agent] Marked voice session as finished: ${this.currentSessionId}`);
        // Broadcast tree update so frontend knows session ended
        wsBroadcast.sessionTreeUpdate(this.currentSessionId);
        // Remove JSONL logger
        removeSessionLogger(this.currentSessionId);
        this.currentSessionId = null;
      }

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

      // Mark voice session as finished in database (before disconnect triggers 'disconnected' event)
      // Note: disconnect() will trigger 'disconnected' event which also handles this,
      // but we do it here too in case deactivate() is called directly
      if (this.currentSessionId) {
        this.sessionsRepo.finish(this.currentSessionId, 'finished');
        console.log(`[Agent] Marked voice session as finished: ${this.currentSessionId}`);
        wsBroadcast.sessionTreeUpdate(this.currentSessionId);
        // Remove JSONL logger
        removeSessionLogger(this.currentSessionId);
        this.currentSessionId = null;
      }

      this.session.disconnect();
      this.session = null;
    }

    // Stop transport if managed internally
    if (this.transport) {
      this.transport.stop();
    }

    this.currentProfile = null;
    this.adapter = null;
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
   * Queue a process completion notification for the next voice session.
   * Used when a background process completes while the voice agent is idle.
   */
  addPendingNotification(process: ManagedProcess): void {
    this.pendingNotifications.push(process);
  }

  /**
   * Get and clear pending notification prompt text.
   * Called when activating a new voice session to prepend background task results.
   */
  getPendingNotificationsPrompt(): string {
    if (this.pendingNotifications.length === 0) return '';
    const notifications = this.pendingNotifications.map(p =>
      `- "${p.name}" ${p.status}: ${p.result || p.error || 'No details'}`
    ).join('\n');
    this.pendingNotifications = [];
    return `\n\nPending notifications from background tasks:\n${notifications}\nPlease inform the user about these completed tasks.`;
  }

  /**
   * Add an entry to the accumulated voice context.
   * Called on each transcript and tool result for HandoffPacket building.
   */
  private addVoiceContext(
    role: 'user' | 'assistant' | 'system',
    content: string,
    toolInfo?: { name: string; args?: unknown; result?: string }
  ): void {
    this.voiceContext.push({ role, content, timestamp: Date.now(), toolInfo });
    if (this.voiceContext.length > this.MAX_CONTEXT_ENTRIES) {
      this.voiceContext.shift();
    }
  }

  /**
   * Build a HandoffPacket for transferring context to a subagent.
   * Contains the full recent voice conversation + active process state.
   */
  createHandoffPacket(request: string): HandoffPacket {
    const pm = getProcessManager();
    return buildHandoffPacket({
      request,
      voiceContext: this.voiceContext,
      activeProcesses: [...pm.getRunning()],
      sessionId: this.currentSessionId ?? 'unknown',
      profile: this.currentProfile?.name ?? 'unknown',
    });
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

  /**
   * Hot-swap the audio transport.
   * Used for switching between local (device) and web (browser) audio sources.
   */
  setTransport(transport: IAudioTransport): void {
    // Stop and detach old transport
    if (this.transport) {
      this.transport.removeAllListeners();
      this.transport.stop();
    }

    // Set and wire new transport
    this.transport = transport;
    this.setupTransport();

    // If agent is active, start the new transport immediately
    if (this.isActive()) {
      console.log('[VoiceAgent] Hot-swapping transport while active, starting new transport');
      this.transport.start();
    }
  }

  /**
   * Get the current voice session ID.
   * Used by subagents to establish parent-child relationships.
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }
}
