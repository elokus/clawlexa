import type {
  AudioNegotiation,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
  ToolCallResult,
  VoiceProviderId,
  VoiceSessionEvents,
} from '@voiceclaw/voice-runtime';
import { TypedEventEmitter } from '@voiceclaw/voice-runtime';
import type {
  VoiceProviderName,
  VoiceRuntime,
  VoiceRuntimeHistoryItem,
} from './types.js';

function normalizeHistoryItem(item: VoiceRuntimeHistoryItem) {
  const firstText = item.content.find((part) => part.type === 'text')?.text ?? '';
  return {
    id: item.id,
    role: item.role,
    text: firstText,
    createdAt: Date.now(),
  } as const;
}

function generateSyntheticCallId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

export function packageProviderIdFromLegacy(provider: VoiceProviderName): VoiceProviderId {
  switch (provider) {
    case 'openai-realtime':
      return 'openai-sdk';
    case 'ultravox-realtime':
      return 'ultravox-ws';
    case 'gemini-live':
      return 'gemini-live';
    case 'pipecat-rtvi':
      return 'pipecat-rtvi';
    case 'decomposed':
      return 'decomposed';
  }
}

export function capabilitiesForLegacyProvider(
  provider: VoiceProviderName
): ProviderCapabilities {
  const common: ProviderCapabilities = {
    toolCalling: true,
    transcriptDeltas: true,
    interruption: true,
    providerTransportKinds: ['websocket'],
    audioNegotiation: false,
    vadModes: ['server'],
    interruptionModes: ['barge-in'],
    toolTimeout: false,
    asyncTools: false,
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

  if (provider === 'openai-realtime') {
    return {
      ...common,
      providerTransportKinds: ['sdk', 'websocket'],
      vadModes: ['server', 'semantic'],
      toolApproval: true,
      mcpTools: true,
      midSessionConfigUpdate: true,
      usageMetrics: true,
      nativeTruncation: true,
    };
  }

  if (provider === 'ultravox-realtime') {
    return {
      ...common,
      audioNegotiation: true,
      toolTimeout: true,
      toolReaction: true,
      precomputableTools: true,
      serverSideTools: true,
      sessionResumption: true,
      forceAgentMessage: true,
      outputMediumSwitch: true,
      callState: true,
      deferredText: true,
      callStages: true,
    };
  }

  if (provider === 'gemini-live') {
    return {
      ...common,
      asyncTools: true,
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

  if (provider === 'pipecat-rtvi') {
    return {
      ...common,
      asyncTools: true,
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

  return {
    ...common,
    providerTransportKinds: ['http'],
    vadModes: ['manual'],
  };
}

export class LegacyProviderAdapter implements ProviderAdapter {
  readonly id: VoiceProviderId;

  private readonly legacyRuntime: VoiceRuntime;
  private readonly declaredCapabilities: ProviderCapabilities;
  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();

  constructor(params: {
    id: VoiceProviderId;
    legacyRuntime: VoiceRuntime;
    capabilities: ProviderCapabilities;
  }) {
    this.id = params.id;
    this.legacyRuntime = params.legacyRuntime;
    this.declaredCapabilities = params.capabilities;
    this.bindLegacyEvents();
  }

  capabilities(): ProviderCapabilities {
    return this.declaredCapabilities;
  }

  async connect(_input: SessionInput): Promise<AudioNegotiation> {
    await this.legacyRuntime.connect();
    return {
      providerInputRate: 24000,
      providerOutputRate: 24000,
      preferredClientInputRate: 24000,
      preferredClientOutputRate: 24000,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    this.legacyRuntime.disconnect();
  }

  sendAudio(frame: { data: ArrayBuffer }): void {
    this.legacyRuntime.sendAudio(frame.data);
  }

  sendText(text: string): void {
    this.legacyRuntime.sendMessage(text);
  }

  interrupt(): void {
    this.legacyRuntime.interrupt();
  }

  sendToolResult(_result: ToolCallResult): void {
    // Legacy runtimes execute tools internally.
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

  private bindLegacyEvents(): void {
    this.legacyRuntime.on('connected', () => {
      this.events.emit('connected');
    });

    this.legacyRuntime.on('disconnected', () => {
      this.events.emit('disconnected');
    });

    this.legacyRuntime.on('stateChange', (state) => {
      this.events.emit('stateChange', state);
    });

    this.legacyRuntime.on('audio', (audio) => {
      this.events.emit('audio', {
        data: audio.data,
        sampleRate: audio.sampleRate ?? 24000,
        format: audio.format ?? 'pcm16',
      });
    });

    this.legacyRuntime.on('audioInterrupted', () => {
      this.events.emit('audioInterrupted');
    });

    this.legacyRuntime.on('transcript', (text, role, itemId) => {
      this.events.emit('transcript', text, role, itemId);
    });

    this.legacyRuntime.on('transcriptDelta', (delta, role, itemId) => {
      this.events.emit('transcriptDelta', delta, role, itemId);
    });

    this.legacyRuntime.on('userItemCreated', (itemId) => {
      this.events.emit('userItemCreated', itemId);
    });

    this.legacyRuntime.on('assistantItemCreated', (itemId, previousItemId) => {
      this.events.emit('assistantItemCreated', itemId, previousItemId);
    });

    this.legacyRuntime.on('historyUpdated', (history) => {
      const normalized = history.map(normalizeHistoryItem);
      this.events.emit('historyUpdated', normalized);
    });

    this.legacyRuntime.on('toolStart', (name, args, callId) => {
      this.events.emit('toolStart', name, args, callId ?? generateSyntheticCallId('tool-start'));
    });

    this.legacyRuntime.on('toolEnd', (name, result, callId) => {
      this.events.emit('toolEnd', name, result, callId ?? generateSyntheticCallId('tool-end'));
    });

    this.legacyRuntime.on('latency', (metric) => {
      this.events.emit('latency', metric);
    });

    this.legacyRuntime.on('error', (error) => {
      this.events.emit('error', error);
    });
  }
}
