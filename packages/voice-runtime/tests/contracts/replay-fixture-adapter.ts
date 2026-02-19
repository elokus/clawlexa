import { TypedEventEmitter } from '../../src/runtime/typed-emitter.js';
import type {
  AudioFrame,
  AudioNegotiation,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
  ToolCallResult,
  VoiceHistoryItem,
  VoiceProviderId,
  VoiceSessionEvents,
} from '../../src/types.js';
import type { ReplayFixtureEvent } from './contract-types.js';

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,
  providerTransportKinds: ['websocket'],
  audioNegotiation: true,
  vadModes: ['server', 'manual'],
  interruptionModes: ['barge-in'],
  toolTimeout: false,
  asyncTools: true,
  toolCancellation: false,
  toolScheduling: false,
  toolReaction: false,
  precomputableTools: false,
  toolApproval: false,
  mcpTools: false,
  serverSideTools: false,
  sessionResumption: false,
  midSessionConfigUpdate: false,
  contextCompression: false,
  forceAgentMessage: false,
  outputMediumSwitch: false,
  callState: false,
  deferredText: false,
  callStages: false,
  proactivity: false,
  usageMetrics: false,
  orderedTranscripts: true,
  ephemeralTokens: false,
  nativeTruncation: false,
  wordLevelTimestamps: false,
};

export function replayCapabilitiesForProvider(providerId: VoiceProviderId): ProviderCapabilities {
  if (providerId === 'decomposed') {
    return {
      ...DEFAULT_CAPABILITIES,
      toolCalling: false,
      providerTransportKinds: ['http'],
      vadModes: ['manual'],
      asyncTools: false,
    };
  }

  if (providerId === 'openai-sdk') {
    return {
      ...DEFAULT_CAPABILITIES,
      providerTransportKinds: ['sdk', 'websocket', 'webrtc'],
      usageMetrics: true,
      toolApproval: true,
      mcpTools: true,
      midSessionConfigUpdate: true,
      nativeTruncation: true,
      vadModes: ['server', 'semantic', 'manual', 'disabled'],
    };
  }

  if (providerId === 'ultravox-ws') {
    return {
      ...DEFAULT_CAPABILITIES,
      serverSideTools: true,
      precomputableTools: true,
      toolReaction: true,
      sessionResumption: true,
      forceAgentMessage: true,
      outputMediumSwitch: true,
      callState: true,
      deferredText: true,
      callStages: true,
      vadModes: ['server'],
    };
  }

  if (providerId === 'gemini-live') {
    return {
      ...DEFAULT_CAPABILITIES,
      toolCancellation: true,
      toolScheduling: true,
      sessionResumption: true,
      contextCompression: true,
      proactivity: true,
      usageMetrics: true,
      orderedTranscripts: false,
      ephemeralTokens: true,
      interruptionModes: ['barge-in', 'no-interruption'],
      vadModes: ['server', 'manual'],
    };
  }

  if (providerId === 'pipecat-rtvi') {
    return {
      ...DEFAULT_CAPABILITIES,
      toolCancellation: true,
      toolScheduling: true,
      forceAgentMessage: true,
      outputMediumSwitch: true,
      callState: true,
      deferredText: true,
      usageMetrics: true,
      providerTransportKinds: ['websocket', 'webrtc'],
      vadModes: ['server', 'manual', 'disabled'],
      midSessionConfigUpdate: true,
    };
  }

  return DEFAULT_CAPABILITIES;
}

function createAudioFrame(durationMs: number, sampleRate: number): AudioFrame {
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  return {
    data: new ArrayBuffer(samples * 2),
    sampleRate,
    format: 'pcm16',
  };
}

export class ReplayFixtureAdapter implements ProviderAdapter {
  readonly id: VoiceProviderId;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private readonly fixture: ReplayFixtureEvent[];
  private readonly providerCapabilities: ProviderCapabilities;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly history: VoiceHistoryItem[] = [];
  private disconnected = false;

  constructor(params: {
    providerId: VoiceProviderId;
    fixture: ReplayFixtureEvent[];
    capabilities?: ProviderCapabilities;
  }) {
    this.id = params.providerId;
    this.fixture = params.fixture;
    this.providerCapabilities =
      params.capabilities ?? replayCapabilitiesForProvider(params.providerId);
  }

  capabilities(): ProviderCapabilities {
    return this.providerCapabilities;
  }

  async connect(_input: SessionInput): Promise<AudioNegotiation> {
    this.disconnected = false;
    this.history.length = 0;
    this.scheduleReplay();
    this.events.emit('connected');
    return {
      providerInputRate: 24000,
      providerOutputRate: 24000,
      preferredClientInputRate: 24000,
      preferredClientOutputRate: 24000,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.events.emit('disconnected');
  }

  sendAudio(_frame: AudioFrame): void {
    // Replay adapter does not depend on live input.
  }

  sendText(_text: string): void {
    // Replay adapter does not depend on live input.
  }

  interrupt(): void {
    this.events.emit('audioInterrupted');
  }

  sendToolResult(_result: ToolCallResult): void {
    // Replay adapter fixtures encode tool completion explicitly.
  }

  on<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void {
    this.events.on(event, handler);
  }

  off<K extends keyof VoiceSessionEvents>(
    event: K,
    handler: EventHandler<VoiceSessionEvents, K>
  ): void {
    this.events.off(event, handler);
  }

  private scheduleReplay(): void {
    for (const event of this.fixture) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.disconnected) return;
        this.emitFixtureEvent(event);
      }, event.atMs);
      this.timers.add(timer);
    }
  }

  private emitFixtureEvent(event: ReplayFixtureEvent): void {
    switch (event.type) {
      case 'state':
        this.events.emit('stateChange', event.state);
        return;
      case 'turn_started':
        this.events.emit('turnStarted');
        return;
      case 'turn_complete':
        this.events.emit('turnComplete');
        return;
      case 'audio_interrupted':
        this.events.emit('audioInterrupted');
        return;
      case 'assistant_item':
        this.events.emit('assistantItemCreated', event.itemId, event.previousItemId);
        return;
      case 'user_item':
        this.events.emit('userItemCreated', event.itemId);
        return;
      case 'transcript_delta':
        this.events.emit('transcriptDelta', event.text, event.role, event.itemId);
        return;
      case 'transcript_final': {
        this.events.emit('transcript', event.text, event.role, event.itemId);
        if (event.itemId) {
          this.history.push({
            id: event.itemId,
            role: event.role,
            text: event.text,
            createdAt: Date.now(),
          });
          this.events.emit('historyUpdated', [...this.history]);
        }
        return;
      }
      case 'audio': {
        const sampleRate = event.sampleRate ?? 24000;
        this.events.emit('audio', createAudioFrame(event.durationMs, sampleRate));
        return;
      }
      case 'tool_start':
        this.events.emit('toolStart', event.name, event.args ?? {}, event.callId);
        return;
      case 'tool_end':
        this.events.emit('toolEnd', event.name, event.result, event.callId);
        return;
      default:
        return;
    }
  }
}
