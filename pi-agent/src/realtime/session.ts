/**
 * Voice Session - Wraps RealtimeSession with state management.
 *
 * Handles:
 * - WebSocket connection to OpenAI Realtime API
 * - State machine (idle → listening → thinking → speaking)
 * - Remote prompt configuration
 * - Greeting trigger after wake word
 * - Conversation timeout
 */

import {
  RealtimeAgent,
  RealtimeSession,
  type TransportLayerAudio,
  type RealtimeItem,
  type TransportEvent,
} from '@openai/agents/realtime';

// Type for input audio transcription completed event (not exported from SDK)
interface InputAudioTranscriptionCompletedEvent {
  type: 'conversation.item.input_audio_transcription.completed';
  item_id: string;
  transcript: string;
}
import { config } from '../config.js';
import type { AgentProfile } from '../agent/profiles.js';

// Stop words that end the conversation and return to wakeword mode
const STOP_PHRASES = [
  'das wäre alles',
  'das war alles',
  "das wär's",
  'das wärs',
  'danke das wars',
  'danke das wärs',
  'tschüss',
  'auf wiedersehen',
  'bis später',
  'gute nacht',
];

function containsStopPhrase(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return STOP_PHRASES.some((phrase) => normalized.includes(phrase));
}

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface SessionEvents {
  stateChange: (state: AgentState) => void;
  audio: (audio: TransportLayerAudio) => void;
  transcript: (text: string, role: 'user' | 'assistant') => void;
  historyUpdated: (history: RealtimeItem[]) => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
  toolStart: (name: string, args: Record<string, unknown>) => void;
  toolEnd: (name: string, result: string) => void;
}

export class VoiceSession {
  private session: RealtimeSession | null = null;
  private agent: RealtimeAgent;
  private profile: AgentProfile;
  private state: AgentState = 'idle';
  private eventHandlers: Partial<SessionEvents> = {};
  private conversationTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Audio buffer for chunks received before connection is ready
  private audioBuffer: ArrayBuffer[] = [];
  // Start in "buffering" mode - audio will be buffered until connect() completes
  private isConnecting = true;
  private static readonly MAX_BUFFER_SIZE = 50; // ~5 seconds at 100ms chunks

  constructor(agent: RealtimeAgent, profile: AgentProfile) {
    this.agent = agent;
    this.profile = profile;
  }

  on<K extends keyof SessionEvents>(event: K, handler: SessionEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  private emit<K extends keyof SessionEvents>(
    event: K,
    ...args: Parameters<SessionEvents[K]>
  ): void {
    const handler = this.eventHandlers[event];
    if (handler) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (handler as (...a: any[]) => void)(...args);
    }
  }

  private setState(newState: AgentState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('stateChange', newState);
    }
  }

  getState(): AgentState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.session) {
      console.warn('Session already connected');
      return;
    }

    // Note: isConnecting is already true from constructor to buffer early audio

    // Build session config
    const sessionConfig: Record<string, unknown> = {
      inputAudioFormat: config.audio.format,
      outputAudioFormat: config.audio.format,
      voice: this.profile.voice,
      inputAudioTranscription: {
        model: 'gpt-4o-mini-transcribe',
        language: 'de',
      },
      turnDetection: {
        type: 'semantic_vad',
      },
    };

    this.session = new RealtimeSession(this.agent, {
      apiKey: config.openai.apiKey,
      transport: 'websocket',
      model: config.agent.model,
      config: sessionConfig,
    });

    this.setupEventListeners();

    try {
      await this.session.connect({
        apiKey: config.openai.apiKey,
      });
      this.isConnecting = false;
      this.setState('listening');
      this.emit('connected');
      this.resetConversationTimeout();

      // Flush any buffered audio that was received during connection
      this.flushAudioBuffer();

      // Send greeting trigger to make the model speak first
      if (this.profile.greetingTrigger) {
        console.log(`[Session] Sending greeting trigger for ${this.profile.name}`);
        this.session.sendMessage(this.profile.greetingTrigger);
      }
    } catch (error) {
      this.isConnecting = false;
      this.audioBuffer = []; // Clear buffer on error
      this.emit('error', error as Error);
      throw error;
    }
  }

  private setupEventListeners(): void {
    if (!this.session) return;

    // Audio output from the agent
    this.session.on('audio', (audio: TransportLayerAudio) => {
      this.setState('speaking');
      this.emit('audio', audio);
    });

    // When audio playback is interrupted (user speaks over agent)
    this.session.on('audio_interrupted', () => {
      this.setState('listening');
    });

    // Agent starts working
    this.session.on('agent_start', () => {
      this.setState('thinking');
    });

    // Agent finished responding - includes the transcript
    this.session.on('agent_end', (_ctx, _agent, textOutput) => {
      if (textOutput) {
        this.emit('transcript', textOutput, 'assistant');
      }
    });

    // Agent tool execution
    this.session.on('agent_tool_start', (_ctx, _agent, tool, details) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (details as any)?.toolCall?.arguments;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = args ? JSON.parse(args) : {};
      } catch {
        parsedArgs = { raw: args };
      }
      // Format parameters nicely
      const paramStr = Object.entries(parsedArgs)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      console.log(`[Tool] ${tool.name}(${paramStr})`);
      this.setState('thinking');
      this.emit('toolStart', tool.name, parsedArgs);
    });

    this.session.on('agent_tool_end', (_ctx, _agent, tool, result) => {
      // Truncate long results for cleaner logs
      const displayResult = result.length > 200 ? result.substring(0, 200) + '...' : result;
      console.log(`[Tool] ${tool.name} returned: ${displayResult}`);
      this.emit('toolEnd', tool.name, result);
    });

    // Tool approval - auto-approve all tools
    this.session.on('tool_approval_requested', (_ctx, _agent, approval) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const approvalAny = approval as any;
      console.log(`[Tool] Auto-approving: ${approvalAny.tool?.name || 'unknown'}`);
      // Auto-approve by calling approve on the approval item
      if (approvalAny.approvalItem?.approve) {
        approvalAny.approvalItem.approve();
      }
    });

    // Conversation history updates
    this.session.on('history_updated', (history: RealtimeItem[]) => {
      this.emit('historyUpdated', history);
      this.resetConversationTimeout();
    });

    // Transport events for user transcription
    this.session.on('transport_event', (event: TransportEvent) => {
      // User input audio transcription completed
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        const transcriptEvent = event as InputAudioTranscriptionCompletedEvent;
        if (transcriptEvent.transcript) {
          this.emit('transcript', transcriptEvent.transcript, 'user');

          // Check for stop phrases to end conversation
          if (containsStopPhrase(transcriptEvent.transcript)) {
            console.log('[Session] Stop phrase detected - ending conversation');
            // Disconnect after a short delay to let the agent respond
            setTimeout(() => {
              this.disconnect();
            }, 3000);
          }
        }
      }
    });

    // Audio stopped - back to listening
    this.session.on('audio_stopped', () => {
      this.setState('listening');
    });

    // Error handling
    this.session.on('error', (errorEvent) => {
      const error =
        errorEvent.error instanceof Error ? errorEvent.error : new Error(String(errorEvent.error));
      console.error('[Session] Error:', error.message);
      this.emit('error', error);
    });
  }


  private resetConversationTimeout(): void {
    if (this.conversationTimeoutId) {
      clearTimeout(this.conversationTimeoutId);
    }
    this.conversationTimeoutId = setTimeout(() => {
      console.log('Conversation timeout - disconnecting');
      this.disconnect();
    }, config.agent.conversationTimeout);
  }

  sendAudio(audio: ArrayBuffer): void {
    // If connecting, buffer the audio for later
    if (this.isConnecting) {
      if (this.audioBuffer.length < VoiceSession.MAX_BUFFER_SIZE) {
        this.audioBuffer.push(audio);
      }
      // Silently drop if buffer is full (prevent memory issues)
      return;
    }

    if (!this.session) {
      console.warn('Cannot send audio: session not connected');
      return;
    }
    this.session.sendAudio(audio);
    this.resetConversationTimeout();
  }

  /**
   * Flush any buffered audio that was received during connection.
   */
  private flushAudioBuffer(): void {
    if (this.audioBuffer.length === 0) return;

    console.log(`[Session] Flushing ${this.audioBuffer.length} buffered audio chunks`);

    for (const chunk of this.audioBuffer) {
      if (this.session) {
        this.session.sendAudio(chunk);
      }
    }

    this.audioBuffer = [];
  }

  sendMessage(text: string): void {
    if (!this.session) {
      console.warn('Cannot send message: session not connected');
      return;
    }
    this.session.sendMessage(text);
    this.resetConversationTimeout();
  }

  interrupt(): void {
    if (!this.session) {
      return;
    }
    this.session.interrupt();
    this.setState('listening');
  }

  getHistory(): RealtimeItem[] {
    return this.session?.history ?? [];
  }

  disconnect(): void {
    if (this.conversationTimeoutId) {
      clearTimeout(this.conversationTimeoutId);
      this.conversationTimeoutId = null;
    }

    if (this.session) {
      this.session.close();
      this.session = null;
    }

    // Clear state
    this.isConnecting = false;
    this.audioBuffer = [];

    this.setState('idle');
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.session !== null;
  }
}
