import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import type {
  AudioFrame,
  AudioNegotiation,
  ClientTransport,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
  ToolCallResult,
  VoiceHistoryItem,
  VoiceSession,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';
import { InterruptionTracker } from './interruption-tracker.js';
import { TypedEventEmitter } from './typed-emitter.js';

export class VoiceSessionImpl implements VoiceSession {
  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private readonly adapter: ProviderAdapter;
  private readonly input: SessionInput;
  private readonly capabilities: ProviderCapabilities;

  private state: VoiceState = 'idle';
  private history: VoiceHistoryItem[] = [];
  private connected = false;
  private negotiation: AudioNegotiation | null = null;
  private clientTransport: ClientTransport | null = null;
  private transportAudioHandler: ((frame: AudioFrame) => void) | null = null;
  private readonly interruptionTracker = new InterruptionTracker();

  constructor(adapter: ProviderAdapter, input: SessionInput) {
    this.adapter = adapter;
    this.input = input;
    this.capabilities = adapter.capabilities();
    this.bindAdapterEvents();
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.negotiation = await this.adapter.connect(this.input);
    this.connected = true;
    if (this.clientTransport) {
      await this.startClientTransport(this.clientTransport);
    }
  }

  async close(): Promise<void> {
    if (this.clientTransport) {
      await this.detachClientTransport();
    }
    await this.adapter.disconnect();
    this.connected = false;
    this.negotiation = null;
    this.state = 'idle';
    this.interruptionTracker.reset();
  }

  async attachClientTransport(transport: ClientTransport): Promise<void> {
    if (this.clientTransport) {
      await this.detachClientTransport();
    }
    this.clientTransport = transport;
    this.transportAudioHandler = (frame: AudioFrame) => {
      const providerInputRate = this.negotiation?.providerInputRate;
      const normalizedFrame =
        providerInputRate && frame.sampleRate !== providerInputRate
          ? resamplePcm16Mono(frame, providerInputRate)
          : frame;
      this.adapter.sendAudio(normalizedFrame);
    };
    transport.onAudioFrame(this.transportAudioHandler);
    if (this.connected) {
      await this.startClientTransport(transport);
    }
  }

  async detachClientTransport(): Promise<void> {
    if (!this.clientTransport) return;
    if (this.transportAudioHandler) {
      this.clientTransport.offAudioFrame(this.transportAudioHandler);
      this.transportAudioHandler = null;
    }
    await this.clientTransport.stop();
    this.clientTransport = null;
  }

  sendAudio(frame: AudioFrame): void {
    const providerInputRate = this.negotiation?.providerInputRate;
    const normalizedFrame =
      providerInputRate && frame.sampleRate !== providerInputRate
        ? resamplePcm16Mono(frame, providerInputRate)
        : frame;
    this.adapter.sendAudio(normalizedFrame);
  }

  sendText(text: string): void {
    this.adapter.sendText(text);
  }

  interrupt(): void {
    this.resolveInterruptionContext();
    this.adapter.interrupt();
    if (this.clientTransport) {
      this.clientTransport.interruptPlayback();
    }
  }

  getState(): VoiceState {
    return this.state;
  }

  getHistory(): VoiceHistoryItem[] {
    return [...this.history];
  }

  getCapabilities() {
    return this.capabilities;
  }

  on<K extends keyof VoiceSessionEvents>(event: K, handler: EventHandler<VoiceSessionEvents, K>): void {
    this.events.on(event, handler);
  }

  off<K extends keyof VoiceSessionEvents>(event: K, handler: EventHandler<VoiceSessionEvents, K>): void {
    this.events.off(event, handler);
  }

  updateConfig(config: Partial<SessionInput>): void {
    if (!this.adapter.updateConfig) {
      throw new Error(`Provider ${this.adapter.id} does not support updateConfig`);
    }
    this.adapter.updateConfig(config);
  }

  forceAgentMessage(
    text: string,
    options?: { uninterruptible?: boolean; urgency?: 'immediate' | 'soon' }
  ): void {
    if (!this.adapter.forceAgentMessage) {
      throw new Error(`Provider ${this.adapter.id} does not support forceAgentMessage`);
    }
    this.adapter.forceAgentMessage(text, options);
  }

  setOutputMedium(medium: 'voice' | 'text'): void {
    if (!this.adapter.setOutputMedium) {
      throw new Error(`Provider ${this.adapter.id} does not support setOutputMedium`);
    }
    this.adapter.setOutputMedium(medium);
  }

  async resume(handle: string): Promise<void> {
    if (!this.adapter.resume) {
      throw new Error(`Provider ${this.adapter.id} does not support resume`);
    }
    await this.adapter.resume(handle);
  }

  mute(muted: boolean): void {
    if (!this.adapter.mute) {
      throw new Error(`Provider ${this.adapter.id} does not support mute`);
    }
    this.adapter.mute(muted);
  }

  submitToolResult(result: ToolCallResult): void {
    this.adapter.sendToolResult(result);
  }

  private async startClientTransport(transport: ClientTransport): Promise<void> {
    const inputRate =
      this.negotiation?.preferredClientInputRate ??
      this.negotiation?.providerInputRate ??
      24000;
    const outputRate =
      this.negotiation?.preferredClientOutputRate ??
      this.negotiation?.providerOutputRate ??
      24000;

    await transport.start({
      inputRate,
      outputRate,
      format: 'pcm16',
    });
  }

  private forwardAssistantAudio(frame: AudioFrame): void {
    if (!this.clientTransport) {
      this.interruptionTracker.trackAssistantAudio(frame);
      this.events.emit('audio', frame);
      return;
    }

    const targetRate =
      this.negotiation?.preferredClientOutputRate ??
      this.negotiation?.providerOutputRate ??
      frame.sampleRate;

    const frameForTransport =
      frame.sampleRate === targetRate ? frame : resamplePcm16Mono(frame, targetRate);
    this.interruptionTracker.trackAssistantAudio(frameForTransport);
    this.clientTransport.playAudioFrame(frameForTransport);
    this.events.emit('audio', frameForTransport);
  }

  private resolveInterruptionContext(): void {
    const playbackPositionMs = this.getPlaybackPositionMs();
    const context = this.interruptionTracker.resolve(playbackPositionMs);
    if (!context) return;

    if (context.truncated && context.itemId) {
      if (this.capabilities.nativeTruncation && this.adapter.truncateOutput) {
        this.adapter.truncateOutput({
          itemId: context.itemId,
          audioEndMs: context.playbackPositionMs,
        });
      } else {
        this.truncateLocalHistory(context.itemId, context.spokenText);
      }
    }

    this.events.emit('interruptionResolved', context);
    this.interruptionTracker.reset();
  }

  private getPlaybackPositionMs(): number | undefined {
    if (!this.clientTransport?.getPlaybackPositionMs) return undefined;
    const position = this.clientTransport.getPlaybackPositionMs();
    if (!Number.isFinite(position) || position < 0) return undefined;
    return position;
  }

  private truncateLocalHistory(itemId: string, spokenText: string): void {
    const historyIndex = this.history.findIndex((item) => item.id === itemId);
    if (historyIndex < 0) return;
    const existingItem = this.history[historyIndex];
    if (!existingItem || existingItem.role !== 'assistant') return;

    this.history[historyIndex] = {
      ...existingItem,
      text: spokenText,
      providerMeta: {
        ...(existingItem.providerMeta ?? {}),
        interrupted: true,
      },
    };
    this.events.emit('historyUpdated', [...this.history]);
  }

  private bindAdapterEvents(): void {
    this.adapter.on('connected', () => {
      this.connected = true;
      this.events.emit('connected');
    });

    this.adapter.on('disconnected', (reason?: string) => {
      this.connected = false;
      this.state = 'idle';
      this.interruptionTracker.reset();
      this.events.emit('disconnected', reason);
    });

    this.adapter.on('stateChange', (state: VoiceState) => {
      this.state = state;
      this.events.emit('stateChange', state);
    });

    this.adapter.on('audio', (frame: AudioFrame) => {
      this.forwardAssistantAudio(frame);
    });

    this.adapter.on('audioInterrupted', () => {
      if (this.clientTransport) {
        this.clientTransport.interruptPlayback();
      }
      this.events.emit('audioInterrupted');
    });

    this.adapter.on('transcript', (text, role, itemId) => {
      if (role === 'assistant') {
        this.interruptionTracker.trackAssistantTranscript(text, itemId);
      }
      this.events.emit('transcript', text, role, itemId);
    });

    this.adapter.on('transcriptDelta', (delta, role, itemId) => {
      if (role === 'assistant') {
        this.interruptionTracker.trackAssistantDelta(delta, itemId);
      }
      this.events.emit('transcriptDelta', delta, role, itemId);
    });

    this.adapter.on('userItemCreated', (itemId) => {
      this.events.emit('userItemCreated', itemId);
    });

    this.adapter.on('assistantItemCreated', (itemId, previousItemId) => {
      this.interruptionTracker.beginAssistantItem(itemId);
      this.events.emit('assistantItemCreated', itemId, previousItemId);
    });

    this.adapter.on('historyUpdated', (history) => {
      this.history = [...history];
      this.events.emit('historyUpdated', [...history]);
    });

    this.adapter.on('toolStart', (name, args, callId) => {
      this.events.emit('toolStart', name, args, callId);
    });

    this.adapter.on('toolEnd', (name, result, callId) => {
      this.events.emit('toolEnd', name, result, callId);
    });

    this.adapter.on('latency', (metric) => {
      this.events.emit('latency', metric);
    });

    this.adapter.on('error', (error) => {
      this.events.emit('error', error);
    });

    this.adapter.on('turnStarted', () => {
      this.events.emit('turnStarted');
    });

    this.adapter.on('turnComplete', () => {
      this.events.emit('turnComplete');
      this.interruptionTracker.reset();
    });

    this.adapter.on('toolCancelled', (callIds) => {
      this.events.emit('toolCancelled', callIds);
    });

    this.adapter.on('usage', (metrics) => {
      this.events.emit('usage', metrics);
    });
  }
}
