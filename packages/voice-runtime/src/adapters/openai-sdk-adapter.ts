import { tool } from '@openai/agents-core';
import {
  RealtimeAgent,
  RealtimeSession,
  type RealtimeItem,
  type TransportEvent,
  type TransportLayerAudio,
} from '@openai/agents/realtime';
import { parseOpenAIProviderConfig } from '../provider-config.js';
import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import type {
  AudioFrame,
  AudioNegotiation,
  EventHandler,
  OpenAIProviderConfig,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
  ToolCallContext,
  ToolCallResult,
  ToolDefinition,
  VoiceHistoryItem,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';

interface InputAudioTranscriptionCompletedEvent {
  type: 'conversation.item.input_audio_transcription.completed';
  item_id: string;
  transcript: string;
}

interface OutputAudioTranscriptDeltaEvent {
  type: 'response.output_audio_transcript.delta';
  item_id: string;
  delta: string;
}

interface ConversationItemAddedEvent {
  type: 'conversation.item.added';
  previous_item_id: string | null;
  item: {
    id: string;
    type: string;
    role?: 'user' | 'assistant' | 'system';
    content?: unknown[];
  };
}

const OPENAI_SDK_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['sdk', 'websocket', 'webrtc'],
  audioNegotiation: true,
  vadModes: ['server', 'semantic', 'manual', 'disabled'],
  interruptionModes: ['barge-in'],

  toolTimeout: false,
  asyncTools: true,
  toolCancellation: false,
  toolScheduling: false,
  toolReaction: false,
  precomputableTools: false,
  toolApproval: true,
  mcpTools: true,
  serverSideTools: false,

  sessionResumption: false,
  midSessionConfigUpdate: true,
  contextCompression: false,

  forceAgentMessage: false,
  outputMediumSwitch: false,
  callState: false,
  deferredText: false,
  callStages: false,
  proactivity: false,
  usageMetrics: true,
  orderedTranscripts: true,
  ephemeralTokens: true,
  nativeTruncation: true,
  wordLevelTimestamps: false,
};

export class OpenAISdkAdapter implements ProviderAdapter {
  readonly id = 'openai-sdk' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private session: RealtimeSession | null = null;
  private state: VoiceState = 'idle';
  private history: VoiceHistoryItem[] = [];
  private outputSampleRateHz = 24000;

  capabilities(): ProviderCapabilities {
    return OPENAI_SDK_CAPABILITIES;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.history = [];
    this.outputSampleRateHz = 24000;

    const providerConfig = this.getProviderConfig(input);
    const apiKey = providerConfig.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI adapter requires providerConfig.apiKey');
    }

    const realtimeAgent = new RealtimeAgent({
      name: 'voiceclaw-openai',
      instructions: input.instructions,
      voice: input.voice,
      tools: this.buildTools(input.tools ?? [], input),
    });

    const turnDetectionType =
      input.vad?.mode === 'semantic'
        ? 'semantic_vad'
        : input.vad?.mode === 'manual'
          ? null
          : providerConfig.turnDetection ?? 'semantic_vad';

    const sessionConfig: Record<string, unknown> = {
      // Legacy config keys supported by the SDK.
      inputAudioFormat: 'pcm16',
      outputAudioFormat: 'pcm16',
      // GA-style config with explicit PCM rate. This helps avoid ambiguous defaults
      // that can produce playback-speed mismatches on some clients.
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          ...(turnDetectionType
            ? {
                turn_detection: {
                  type: turnDetectionType,
                  silence_duration_ms: input.vad?.silenceDurationMs,
                  threshold: input.vad?.threshold,
                },
              }
            : { turn_detection: null }),
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice: input.voice,
        },
      },
      voice: input.voice,
      inputAudioTranscription: {
        model: providerConfig.transcriptionModel ?? 'gpt-4o-mini-transcribe',
        language: input.language ?? providerConfig.language,
      },
      ...(turnDetectionType
        ? {
            turnDetection: {
              type: turnDetectionType,
              silence_duration_ms: input.vad?.silenceDurationMs,
              threshold: input.vad?.threshold,
            },
          }
        : { turnDetection: null }),
    };

    this.session = new RealtimeSession(realtimeAgent, {
      apiKey,
      transport: 'websocket',
      model: input.model,
      config: sessionConfig,
    });

    this.bindSessionEvents();

    await this.session.connect({
      apiKey,
    });

    this.setState('listening');
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
    if (!this.session) {
      this.setState('idle');
      this.events.emit('disconnected');
      return;
    }
    this.session.close();
    this.session = null;
    this.setState('idle');
    this.events.emit('disconnected');
  }

  sendAudio(frame: AudioFrame): void {
    this.session?.sendAudio(frame.data);
  }

  sendText(text: string, options?: { defer?: boolean }): void {
    if (!this.session) return;
    this.session.sendMessage({
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text,
        },
      ],
    });
    if (options?.defer) {
      this.events.emit('latency', {
        stage: 'connection',
        durationMs: 0,
        provider: 'openai-sdk',
        details: { deferRequested: true },
      });
    }
  }

  interrupt(): void {
    this.session?.interrupt();
    this.setState('listening');
  }

  truncateOutput(input: { itemId: string; audioEndMs: number }): void {
    if (!this.session) return;
    // SDK handles built-in truncation when interrupt() is called. This explicit
    // request is currently informational for this adapter path.
    this.events.emit('latency', {
      stage: 'connection',
      durationMs: 0,
      provider: 'openai-sdk',
      details: {
        truncateRequested: true,
        itemId: input.itemId,
        audioEndMs: input.audioEndMs,
      },
    });
  }

  sendToolResult(_result: ToolCallResult): void {
    // OpenAI SDK tool bridge is handled by tool execute callbacks.
  }

  updateConfig(config: Partial<SessionInput>): void {
    if (!this.session) return;
    this.events.emit('latency', {
      stage: 'connection',
      durationMs: 0,
      provider: 'openai-sdk',
      details: {
        updateConfigRequested: true,
        keys: Object.keys(config),
      },
    });
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

  private bindSessionEvents(): void {
    if (!this.session) return;

    this.session.on('audio', (audio: TransportLayerAudio) => {
      this.setState('speaking');
      this.events.emit('audio', {
        data: audio.data,
        sampleRate: this.outputSampleRateHz,
        format: 'pcm16',
      });
    });

    this.session.on('audio_interrupted', () => {
      this.setState('listening');
      this.events.emit('audioInterrupted');
    });

    this.session.on('agent_start', () => {
      this.setState('thinking');
      this.events.emit('turnStarted');
    });

    this.session.on('agent_end', (_ctx, _agent, textOutput) => {
      if (textOutput) {
        this.events.emit('transcript', textOutput, 'assistant');
      }
      this.events.emit('turnComplete');
    });

    this.session.on('agent_tool_start', (_ctx, _agent, toolDef, details) => {
      const toolCall = (details as any)?.toolCall;
      const args = toolCall?.arguments;
      const callId = toolCall?.callId ?? toolCall?.call_id ?? `tool-${Date.now()}`;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = args ? JSON.parse(args) : {};
      } catch {
        parsedArgs = { raw: args };
      }
      this.events.emit('toolStart', toolDef.name, parsedArgs, callId);
    });

    this.session.on('agent_tool_end', (_ctx, _agent, toolDef, result, details) => {
      const toolCall = (details as any)?.toolCall;
      const callId = toolCall?.callId ?? toolCall?.call_id ?? `tool-${Date.now()}`;
      this.events.emit('toolEnd', toolDef.name, result, callId);
    });

    this.session.on('tool_approval_requested', (_ctx, _agent, approval) => {
      const approvalAny = approval as any;
      if (approvalAny.approvalItem?.approve) {
        approvalAny.approvalItem.approve();
      }
    });

    this.session.on('history_updated', (history: RealtimeItem[]) => {
      this.history = history.map((item) => this.toHistoryItem(item));
      this.events.emit('historyUpdated', [...this.history]);
    });

    this.session.on('transport_event', (event: TransportEvent) => {
      if (event.type === 'session.created' || event.type === 'session.updated') {
        this.updateOutputSampleRateFromSession((event as { session?: unknown }).session);
      }

      if (event.type === 'input_audio_buffer.speech_started') {
        // Treat speech_started as barge-in only while assistant output is active.
        // Otherwise this event is just normal user turn onset and should not
        // clear local playback buffers.
        if (this.state === 'speaking') {
          this.events.emit('audioInterrupted');
        }
        this.setState('listening');
      }

      if (event.type === 'conversation.item.added') {
        const itemEvent = event as ConversationItemAddedEvent;
        const { item, previous_item_id } = itemEvent;
        const contentArray = item.content as Array<{ type?: string }> | undefined;
        const hasAudioContent =
          Array.isArray(contentArray) && contentArray.some((content) => content.type === 'input_audio');

        if (item.role === 'user' && item.type === 'message' && hasAudioContent) {
          this.events.emit('userItemCreated', item.id);
        } else if (item.role === 'assistant' && item.type === 'message') {
          this.events.emit('assistantItemCreated', item.id, previous_item_id ?? undefined);
        }
      }

      if (event.type === 'response.output_audio_transcript.delta') {
        const deltaEvent = event as OutputAudioTranscriptDeltaEvent;
        if (deltaEvent.delta) {
          this.events.emit('transcriptDelta', deltaEvent.delta, 'assistant', deltaEvent.item_id);
        }
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        const transcriptEvent = event as InputAudioTranscriptionCompletedEvent;
        if (transcriptEvent.transcript) {
          this.events.emit('transcript', transcriptEvent.transcript, 'user', transcriptEvent.item_id);
        }
      }
    });

    this.session.on('audio_stopped', () => {
      this.setState('listening');
    });

    this.session.on('error', (errorEvent) => {
      const error =
        errorEvent.error instanceof Error ? errorEvent.error : new Error(String(errorEvent.error));
      this.events.emit('error', error);
    });
  }

  private buildTools(definitions: ToolDefinition[], input: SessionInput) {
    if (definitions.length === 0 || !input.toolHandler) return [];

    return definitions.map((definition) =>
      tool({
        name: definition.name,
        description: definition.description,
        strict: false,
        parameters: definition.parameters as any,
        execute: async (rawInput, _context, details): Promise<string> => {
          const args =
            rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
              ? (rawInput as Record<string, unknown>)
              : {};

          const callId =
            details?.toolCall?.callId ?? `openai-tool-${Date.now()}`;
          const toolContext: ToolCallContext = {
            providerId: this.id,
            callId,
            invocationId: callId,
            history: [...this.history],
          };

          const rawResult = await input.toolHandler?.(definition.name, args, toolContext);
          return this.normalizeToolResult(callId, rawResult).result;
        },
      })
    );
  }

  private normalizeToolResult(callId: string, result: ToolCallResult | string | undefined): ToolCallResult {
    if (!result) {
      return {
        invocationId: callId,
        result: '',
      };
    }

    if (typeof result === 'string') {
      return {
        invocationId: callId,
        result,
      };
    }

    return {
      ...result,
      invocationId: callId,
      result: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
    };
  }

  private toHistoryItem(item: RealtimeItem): VoiceHistoryItem {
    const asMessage = item as any;
    const role =
      asMessage.role === 'assistant' || asMessage.role === 'user' || asMessage.role === 'system'
        ? (asMessage.role as VoiceHistoryItem['role'])
        : 'system';

    const text = Array.isArray(asMessage.content)
      ? asMessage.content
          .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
          .map((part: any) => part.text as string)
          .join(' ')
      : '';

    return {
      id: asMessage.id ?? `history-${Date.now()}`,
      role,
      text,
      createdAt: Date.now(),
    };
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);
  }

  private getProviderConfig(input: SessionInput): OpenAIProviderConfig {
    return parseOpenAIProviderConfig(input.providerConfig);
  }

  private updateOutputSampleRateFromSession(session: unknown): void {
    if (!session || typeof session !== 'object') return;
    const obj = session as Record<string, unknown>;

    const gaFormat = (
      obj.audio &&
      typeof obj.audio === 'object' &&
      (obj.audio as Record<string, unknown>).output &&
      typeof (obj.audio as Record<string, unknown>).output === 'object'
    )
      ? ((obj.audio as Record<string, unknown>).output as Record<string, unknown>).format
      : undefined;

    const legacyFormat = obj.output_audio_format;
    const resolvedRate = this.resolveAudioSampleRate(gaFormat) ?? this.resolveAudioSampleRate(legacyFormat);
    if (resolvedRate) {
      if (resolvedRate !== this.outputSampleRateHz) {
        console.log(`[OpenAISdkAdapter] output sample rate: ${resolvedRate}Hz`);
      }
      this.outputSampleRateHz = resolvedRate;
    }
  }

  private resolveAudioSampleRate(format: unknown): number | null {
    if (!format) return null;

    if (typeof format === 'string') {
      if (format === 'pcm16' || format === 'audio/pcm') return 24000;
      if (
        format === 'g711_ulaw' ||
        format === 'g711_alaw' ||
        format === 'audio/pcmu' ||
        format === 'audio/pcma'
      ) {
        return 8000;
      }
      return null;
    }

    if (typeof format !== 'object') return null;

    const obj = format as Record<string, unknown>;
    const rate = obj.rate;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      return rate;
    }

    const type = typeof obj.type === 'string' ? obj.type : null;
    if (type === 'audio/pcmu' || type === 'audio/pcma') return 8000;
    if (type === 'audio/pcm') return 24000;

    return null;
  }
}
