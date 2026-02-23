import type {
  EventHandler,
  VoiceSession as PackageVoiceSession,
  VoiceSessionEvents as PackageVoiceSessionEvents,
} from '@voiceclaw/voice-runtime';
import type { IAudioTransport } from '../transport/types.js';
import { LegacyAudioTransportBridge } from './transport-bridge.js';
import type {
  AgentState,
  VoiceMode,
  VoiceProviderName,
  VoiceRuntime,
  VoiceRuntimeEvents,
  VoiceRuntimeHistoryItem,
} from './types.js';

function mapHistory(items: ReturnType<PackageVoiceSession['getHistory']>): VoiceRuntimeHistoryItem[] {
  return items.map((item) => ({
    id: item.id,
    type: 'message',
    role:
      item.role === 'assistant' || item.role === 'user' || item.role === 'system'
        ? item.role
        : 'system',
    content: [{ type: 'text', text: item.text }],
  }));
}

function mapLatencyStage(
  stage: string
): 'stt' | 'llm' | 'tts' | 'turn' | 'tool' | 'connection' {
  if (
    stage === 'stt' ||
    stage === 'llm' ||
    stage === 'tts' ||
    stage === 'turn' ||
    stage === 'tool' ||
    stage === 'connection'
  ) {
    return stage;
  }
  return 'turn';
}

export class PackageBackedVoiceRuntime implements VoiceRuntime {
  readonly mode: VoiceMode;
  readonly provider: VoiceProviderName;

  private readonly sessionFactory: () => Promise<PackageVoiceSession>;
  private session: PackageVoiceSession | null = null;
  private connected = false;
  private handlers: Partial<VoiceRuntimeEvents> = {};
  private readonly inputSampleRateHz: number;
  private attachedBridge: LegacyAudioTransportBridge | null = null;

  constructor(params: {
    mode: VoiceMode;
    provider: VoiceProviderName;
    sessionFactory: () => Promise<PackageVoiceSession>;
    inputSampleRateHz?: number;
  }) {
    this.mode = params.mode;
    this.provider = params.provider;
    this.sessionFactory = params.sessionFactory;
    this.inputSampleRateHz = params.inputSampleRateHz ?? 24000;
  }

  async connect(): Promise<void> {
    const session = await this.ensureSession();
    await session.connect();
  }

  disconnect(): void {
    void this.closeInternal();
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendAudio(audio: ArrayBuffer): void {
    if (!this.session) return;
    this.session.sendAudio({
      data: audio,
      sampleRate: this.inputSampleRateHz,
      format: 'pcm16',
    });
  }

  sendMessage(text: string): void {
    this.session?.sendText(text);
  }

  interrupt(): void {
    this.session?.interrupt();
  }

  getState(): AgentState {
    return this.session?.getState() ?? 'idle';
  }

  getHistory(): VoiceRuntimeHistoryItem[] {
    if (!this.session) return [];
    return mapHistory(this.session.getHistory());
  }

  async attachAudioTransport(transport: IAudioTransport): Promise<void> {
    const session = await this.ensureSession();
    if (this.attachedBridge) {
      await session.detachClientTransport();
    }
    const bridge = new LegacyAudioTransportBridge(transport);
    await session.attachClientTransport(bridge);
    this.attachedBridge = bridge;
  }

  async detachAudioTransport(): Promise<void> {
    if (!this.session || !this.attachedBridge) return;
    await this.session.detachClientTransport();
    this.attachedBridge = null;
  }

  usesInternalTransport(): boolean {
    return this.attachedBridge !== null;
  }

  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void {
    this.handlers[event] = handler;
  }

  private emit<K extends keyof VoiceRuntimeEvents>(
    event: K,
    ...args: Parameters<VoiceRuntimeEvents[K]>
  ): void {
    const handler = this.handlers[event];
    if (!handler) return;
    (handler as (...eventArgs: Parameters<VoiceRuntimeEvents[K]>) => void)(...args);
  }

  private bindSessionEvents(session: PackageVoiceSession): void {
    this.bind('connected', session, () => {
      this.connected = true;
      this.emit('connected');
    });

    this.bind('disconnected', session, () => {
      this.connected = false;
      this.emit('disconnected');
    });

    this.bind('stateChange', session, (state) => {
      this.emit('stateChange', state);
    });

    this.bind('audio', session, (frame) => {
      this.emit('audio', {
        data: frame.data,
        sampleRate: frame.sampleRate,
        format: frame.format,
      });
    });

    this.bind('audioInterrupted', session, () => {
      this.emit('audioInterrupted');
    });

    this.bind('transcript', session, (text, role, itemId, order) => {
      this.emit('transcript', text, role, itemId, order);
    });

    this.bind('transcriptDelta', session, (delta, role, itemId, order) => {
      this.emit('transcriptDelta', delta, role, itemId, order);
    });

    this.bind('spokenDelta', session, (delta, role, itemId, meta) => {
      if (this.handlers.spokenDelta) {
        this.emit('spokenDelta', delta, role, itemId, meta);
      }
    });

    this.bind('spokenProgress', session, (itemId, progress) => {
      if (this.handlers.spokenProgress) {
        this.emit('spokenProgress', itemId, progress);
      }
    });

    this.bind('spokenFinal', session, (text, role, itemId, meta) => {
      if (this.handlers.spokenFinal) {
        this.emit('spokenFinal', text, role, itemId, meta);
      }
    });

    this.bind('userItemCreated', session, (itemId, order) => {
      this.emit('userItemCreated', itemId, order);
    });

    this.bind('assistantItemCreated', session, (itemId, previousItemId, order) => {
      this.emit('assistantItemCreated', itemId, previousItemId, order);
    });

    this.bind('historyUpdated', session, (history) => {
      this.emit('historyUpdated', mapHistory(history));
    });

    this.bind('error', session, (error) => {
      this.emit('error', error);
    });

    this.bind('toolStart', session, (name, args, callId) => {
      this.emit('toolStart', name, args, callId);
    });

    this.bind('toolEnd', session, (name, result, callId) => {
      this.emit('toolEnd', name, result, callId);
    });

    this.bind('latency', session, (metric) => {
      this.emit('latency', {
        stage: mapLatencyStage(metric.stage),
        durationMs: metric.durationMs,
        provider: metric.provider,
        model: metric.model,
        details: metric.details,
      });
    });
  }

  private bind<K extends keyof PackageVoiceSessionEvents>(
    event: K,
    session: PackageVoiceSession,
    handler: EventHandler<PackageVoiceSessionEvents, K>
  ): void {
    session.on(event, handler);
  }

  private async closeInternal(): Promise<void> {
    if (!this.session) return;
    await this.session.close();
    this.attachedBridge = null;
    this.connected = false;
  }

  private async ensureSession(): Promise<PackageVoiceSession> {
    if (!this.session) {
      this.session = await this.sessionFactory();
      this.bindSessionEvents(this.session);
    }
    return this.session;
  }
}
