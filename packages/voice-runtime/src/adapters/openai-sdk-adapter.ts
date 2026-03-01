import { tool } from '@openai/agents-core';
import {
  RealtimeAgent,
  RealtimeSession,
  type RealtimeItem,
  type TransportEvent,
  type TransportLayerAudio,
} from '@openai/agents/realtime';
import {
  parseDecomposedProviderConfig,
  parseOpenAIProviderConfig,
} from '../provider-config.js';
import { countWords, splitSpeakableText } from './decomposed-utils.js';
import {
  resolveSharedTtsConfig,
  synthesizeWithSharedTts,
  type SharedTtsConfig,
} from './shared/tts-engine.js';
import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import type {
  AudioFrame,
  AudioNegotiation,
  DecomposedProviderConfig,
  EventHandler,
  OpenAIProviderConfig,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfigSchema,
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

interface InputAudioTranscriptionFailedEvent {
  type: 'conversation.item.input_audio_transcription.failed';
  item_id: string;
  error?: {
    code?: string;
    message?: string;
    type?: string;
    param?: string;
  };
}

interface OutputAudioTranscriptDeltaEvent {
  type: 'response.output_audio_transcript.delta';
  item_id: string;
  delta: string;
}

interface OutputTextDeltaEvent {
  type: 'response.output_text.delta';
  item_id: string;
  delta: string;
}

interface ConversationItemAddedEvent {
  type: 'conversation.item.added' | 'conversation.item.done' | 'conversation.item.retrieved';
  previous_item_id?: string | null;
  item: {
    id: string;
    type: string;
    role?: 'user' | 'assistant' | 'system';
    content?: Array<{
      type?: string;
      text?: string | null;
      transcript?: string | null;
    }>;
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

const OPENAI_CONFIG_SCHEMA: ProviderConfigSchema = {
  providerId: 'openai-sdk',
  displayName: 'OpenAI Realtime',
  fields: [
    {
      key: 'turnDetection',
      label: 'Turn Detection Mode',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'semantic_vad', label: 'Semantic VAD (recommended)' },
        { value: 'server_vad', label: 'Server VAD (threshold-based)' },
      ],
      defaultValue: 'semantic_vad',
      description: 'Semantic VAD uses a model to detect turn boundaries. Server VAD uses silence detection.',
    },
    {
      key: 'vad.eagerness',
      label: 'Eagerness',
      type: 'select',
      group: 'vad',
      options: [
        { value: 'low', label: 'Low (patient, 8s max)' },
        { value: 'medium', label: 'Medium (4s max)' },
        { value: 'high', label: 'High (responsive, 2s max)' },
        { value: 'auto', label: 'Auto' },
      ],
      defaultValue: 'auto',
      dependsOn: { field: 'turnDetection', value: 'semantic_vad' },
      description: 'How eager the model is to respond. Low = more patient with pauses.',
    },
    {
      key: 'vad.threshold',
      label: 'VAD Threshold',
      type: 'range',
      group: 'vad',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      defaultValue: 0.5,
      dependsOn: { field: 'turnDetection', value: 'server_vad' },
      description: 'Activation threshold. Higher = requires louder audio.',
    },
    {
      key: 'vad.silenceDurationMs',
      label: 'Silence Duration (ms)',
      type: 'number',
      group: 'vad',
      min: 100,
      max: 5000,
      step: 50,
      defaultValue: 500,
      dependsOn: { field: 'turnDetection', value: 'server_vad' },
      description: 'Silence required to detect end of speech.',
    },
    {
      key: 'vad.prefixPaddingMs',
      label: 'Prefix Padding (ms)',
      type: 'number',
      group: 'vad',
      min: 0,
      max: 2000,
      step: 50,
      defaultValue: 300,
      dependsOn: { field: 'turnDetection', value: 'server_vad' },
      description: 'Audio included before detected speech start.',
    },
    {
      key: 'transcriptionModel',
      label: 'Transcription Model',
      type: 'select',
      group: 'advanced',
      options: [
        { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
        { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
      ],
      defaultValue: 'gpt-4o-mini-transcribe',
    },
  ],
  voices: [
    { id: 'alloy', name: 'Alloy', language: 'multi', gender: 'neutral' },
    { id: 'ash', name: 'Ash', language: 'multi', gender: 'male' },
    { id: 'ballad', name: 'Ballad', language: 'multi', gender: 'male' },
    { id: 'coral', name: 'Coral', language: 'multi', gender: 'female' },
    { id: 'echo', name: 'Echo', language: 'multi', gender: 'male' },
    { id: 'sage', name: 'Sage', language: 'multi', gender: 'female' },
    { id: 'shimmer', name: 'Shimmer', language: 'multi', gender: 'female' },
    { id: 'verse', name: 'Verse', language: 'multi', gender: 'male' },
    { id: 'marin', name: 'Marin', language: 'multi', gender: 'female' },
    { id: 'cedar', name: 'Cedar', language: 'multi', gender: 'male' },
  ],
};

const OPENAI_DEFAULT_SESSION_VOICE = 'alloy';

export class OpenAISdkAdapter implements ProviderAdapter {
  readonly id = 'openai-sdk' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private session: RealtimeSession | null = null;
  private state: VoiceState = 'idle';
  private history: VoiceHistoryItem[] = [];
  private outputSampleRateHz = 24000;
  private outputMode: 'provider-audio' | 'text-tts' = 'provider-audio';
  private externalTtsConfig: SharedTtsConfig | null = null;
  private activeTtsAbortController: AbortController | null = null;
  private assistantGeneration = 0;
  private activeAssistantItemId: string | null = null;
  private assistantDeltaSeenThisTurn = false;
  private readonly outputTextRawByItemId = new Map<string, string>();
  private readonly outputTextEmittedLengthByItemId = new Map<string, number>();
  private readonly assistantDeltaSourceByItemId = new Map<
    string,
    'output_text' | 'output_audio_transcript'
  >();
  private readonly emittedUserTranscripts = new Map<string, string>();

  capabilities(): ProviderCapabilities {
    return OPENAI_SDK_CAPABILITIES;
  }

  configSchema(): ProviderConfigSchema {
    return OPENAI_CONFIG_SCHEMA;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.history = [];
    this.outputSampleRateHz = 24000;
    this.outputMode = 'provider-audio';
    this.externalTtsConfig = null;
    this.abortActiveTts();
    this.assistantGeneration = 0;
    this.activeAssistantItemId = null;
    this.assistantDeltaSeenThisTurn = false;
    this.outputTextRawByItemId.clear();
    this.outputTextEmittedLengthByItemId.clear();
    this.assistantDeltaSourceByItemId.clear();
    this.emittedUserTranscripts.clear();

    const providerConfig = this.getProviderConfig(input);
    const decomposedConfig = this.getDecomposedProviderConfig(input);
    const outputAudioMode = this.resolveOutputAudioMode(providerConfig);
    this.outputMode =
      outputAudioMode === 'text-tts' ? 'text-tts' : 'provider-audio';
    if (this.outputMode === 'text-tts') {
      this.externalTtsConfig = this.buildExternalTtsConfig({
        input,
        providerConfig,
        decomposedConfig,
      });
    }

    const apiKey = providerConfig.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI adapter requires providerConfig.apiKey');
    }
    const sessionVoice = this.resolveSessionVoice(input.voice);

    const realtimeAgent = new RealtimeAgent({
      name: 'voiceclaw-openai',
      instructions: input.instructions,
      voice: sessionVoice,
      tools: this.buildTools(input.tools ?? [], input),
    });

    const turnDetectionType =
      input.vad?.mode === 'semantic'
        ? 'semantic_vad'
        : input.vad?.mode === 'manual'
          ? null
          : providerConfig.turnDetection ?? 'semantic_vad';

    const buildTurnDetection = () => {
      if (!turnDetectionType) return null;
      const td: Record<string, unknown> = { type: turnDetectionType };
      if (input.vad?.silenceDurationMs != null) td.silence_duration_ms = input.vad.silenceDurationMs;
      if (input.vad?.threshold != null) td.threshold = input.vad.threshold;
      if (input.vad?.prefixPaddingMs != null) td.prefix_padding_ms = input.vad.prefixPaddingMs;
      if (input.vad?.eagerness != null) td.eagerness = input.vad.eagerness;
      return td;
    };

    const turnDetection = buildTurnDetection();

    const sessionConfig: Record<string, unknown> = {
      // Use GA-style config only. Mixing legacy + GA keys forces the SDK down
      // deprecated normalization paths that drop outputModalities.
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: {
            model: providerConfig.transcriptionModel ?? 'gpt-4o-mini-transcribe',
            language: input.language ?? providerConfig.language,
          },
          ...(turnDetection
            ? { turnDetection }
            : { turnDetection: null }),
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice: sessionVoice,
        },
      },
      voice: sessionVoice,
      ...(this.outputMode === 'text-tts'
        ? { outputModalities: ['text'] }
        : {}),
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
    this.abortActiveTts();
    this.externalTtsConfig = null;
    this.outputMode = 'provider-audio';
    this.assistantGeneration += 1;
    this.activeAssistantItemId = null;
    this.assistantDeltaSeenThisTurn = false;
    this.outputTextRawByItemId.clear();
    this.outputTextEmittedLengthByItemId.clear();
    this.assistantDeltaSourceByItemId.clear();
    this.emittedUserTranscripts.clear();
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
    this.assistantGeneration += 1;
    this.abortActiveTts();
    this.outputTextRawByItemId.clear();
    this.outputTextEmittedLengthByItemId.clear();
    if (this.outputMode === 'text-tts') {
      this.events.emit('audioInterrupted');
    }
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
      if (this.outputMode === 'text-tts') {
        return;
      }
      this.setState('speaking');
      this.events.emit('audio', {
        data: audio.data,
        sampleRate: this.outputSampleRateHz,
        format: 'pcm16',
      });
    });

    this.session.on('audio_interrupted', () => {
      this.abortActiveTts();
      this.setState('listening');
      this.events.emit('audioInterrupted');
    });

    this.session.on('agent_start', () => {
      this.assistantGeneration += 1;
      this.abortActiveTts();
      this.activeAssistantItemId = null;
      this.assistantDeltaSeenThisTurn = false;
      this.outputTextRawByItemId.clear();
      this.outputTextEmittedLengthByItemId.clear();
      this.assistantDeltaSourceByItemId.clear();
      this.setState('thinking');
      this.events.emit('turnStarted');
    });

    this.session.on('agent_end', (_ctx, _agent, textOutput) => {
      const generation = this.assistantGeneration;
      void this.handleAgentEnd(
        generation,
        textOutput ?? '',
        this.activeAssistantItemId ?? undefined
      );
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
      for (const item of history) {
        this.maybeEmitUserTranscriptFromRealtimeItem(item);
      }
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
          this.abortActiveTts();
          this.events.emit('audioInterrupted');
        }
        this.setState('listening');
      }

      if (event.type === 'conversation.item.added') {
        const itemEvent = event as ConversationItemAddedEvent;
        const { item, previous_item_id } = itemEvent;
        const contentArray = item.content;
        const hasAudioContent =
          Array.isArray(contentArray) && contentArray.some((content) => content.type === 'input_audio');

        if (item.role === 'user' && item.type === 'message' && hasAudioContent) {
          this.events.emit('userItemCreated', item.id);
        } else if (item.role === 'assistant' && item.type === 'message') {
          this.activeAssistantItemId = item.id;
          this.events.emit('assistantItemCreated', item.id, previous_item_id ?? undefined);
        }
      }

      if (
        event.type === 'conversation.item.done'
        || event.type === 'conversation.item.retrieved'
      ) {
        const itemEvent = event as ConversationItemAddedEvent;
        const { item } = itemEvent;
        if (item.role === 'user' && item.type === 'message') {
          const transcript = this.extractConversationItemTranscript(item.content);
          if (transcript) {
            this.emitUserTranscript(item.id, transcript);
          }
        }
      }

      if (event.type === 'response.output_audio_transcript.delta') {
        const deltaEvent = event as OutputAudioTranscriptDeltaEvent;
        if (!deltaEvent.delta) {
          return;
        }
        this.emitAssistantDelta(
          deltaEvent.delta,
          deltaEvent.item_id,
          'output_audio_transcript'
        );
      }

      if (event.type === 'response.output_text.delta') {
        if (this.outputMode !== 'text-tts') {
          return;
        }
        const deltaEvent = event as OutputTextDeltaEvent;
        if (!deltaEvent.delta) {
          return;
        }
        this.emitAssistantDelta(deltaEvent.delta, deltaEvent.item_id, 'output_text');
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        const transcriptEvent = event as InputAudioTranscriptionCompletedEvent;
        if (transcriptEvent.transcript) {
          this.emitUserTranscript(transcriptEvent.item_id, transcriptEvent.transcript);
        }
      }

      if (event.type === 'conversation.item.input_audio_transcription.failed') {
        const failedEvent = event as InputAudioTranscriptionFailedEvent;
        const details = failedEvent.error;
        const messageParts = [
          'Input audio transcription failed',
          failedEvent.item_id ? `(item ${failedEvent.item_id})` : null,
          details?.message ?? null,
          details?.code ? `[${details.code}]` : null,
        ].filter(Boolean);
        this.events.emit('error', new Error(messageParts.join(' ')));
      }
    });

    this.session.on('audio_stopped', () => {
      if (this.outputMode === 'text-tts') {
        return;
      }
      this.setState('listening');
    });

    this.session.on('error', (errorEvent) => {
      const error = this.normalizeError(errorEvent.error);
      this.events.emit('error', error);
    });
  }

  private async handleAgentEnd(
    generation: number,
    textOutput: string,
    assistantItemId?: string
  ): Promise<void> {
    if (!this.isCurrentGeneration(generation)) {
      return;
    }

    const normalizedText = this.normalizeAssistantTextOutput(
      textOutput,
      assistantItemId
    );
    if (this.outputMode === 'text-tts' && normalizedText) {
      if (!this.assistantDeltaSeenThisTurn) {
        this.emitAssistantDelta(normalizedText, assistantItemId, 'output_text');
      }
      try {
        await this.speakWithExternalTts(
          normalizedText,
          generation,
          assistantItemId
        );
      } catch (error) {
        if (!this.isCurrentGeneration(generation) || this.isAbortError(error)) {
          return;
        }
        this.events.emit(
          'error',
          error instanceof Error ? error : new Error(String(error))
        );
        this.setState('listening');
        return;
      }
    }

    if (!this.isCurrentGeneration(generation)) {
      return;
    }

    if (normalizedText) {
      this.events.emit('transcript', normalizedText, 'assistant', assistantItemId);
    }
    if (assistantItemId) {
      this.outputTextRawByItemId.delete(assistantItemId);
      this.outputTextEmittedLengthByItemId.delete(assistantItemId);
    }
    this.events.emit('turnComplete');
  }

  private async speakWithExternalTts(
    text: string,
    generation: number,
    assistantItemId?: string
  ): Promise<void> {
    if (this.outputMode !== 'text-tts') {
      return;
    }
    if (!this.externalTtsConfig) {
      throw new Error('OpenAI text->TTS mode is enabled but TTS config is missing');
    }

    const normalized = text.trim();
    if (!normalized) {
      return;
    }

    this.abortActiveTts();
    const controller = new AbortController();
    this.activeTtsAbortController = controller;
    this.setState('speaking');

    const startedAtMs = Date.now();
    let playbackMs = 0;
    let emittedChunks = 0;
    let firstAudioAtMs: number | null = null;
    let spokenText = '';
    let spokenPrecision:
      | 'ratio'
      | 'segment'
      | 'aligned'
      | 'provider-word-timestamps' = 'segment';
    const spokenItemId = assistantItemId ?? this.activeAssistantItemId ?? undefined;
    const emitChunk = async (chunk: ArrayBuffer): Promise<boolean> => {
      if (!this.isCurrentGeneration(generation) || controller.signal.aborted) {
        return false;
      }
      emittedChunks += 1;
      if (firstAudioAtMs === null) {
        firstAudioAtMs = Date.now();
      }
      playbackMs += (chunk.byteLength / 2 / this.outputSampleRateHz) * 1000;
      this.events.emit('audio', {
        data: chunk,
        sampleRate: this.outputSampleRateHz,
        format: 'pcm16',
      });
      return true;
    };

    const emitSpokenDelta = (
      delta: string,
      precision:
        | 'ratio'
        | 'segment'
        | 'aligned'
        | 'provider-word-timestamps',
      wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>,
      wordTimestampsTimeBase?: 'segment' | 'utterance'
    ): void => {
      if (!this.isCurrentGeneration(generation) || controller.signal.aborted) {
        return;
      }
      spokenText = this.joinSpokenChunks(spokenText, delta);
      const spokenChars = spokenText.length;
      const spokenWords = countWords(spokenText);
      spokenPrecision = precision;

      this.events.emit('spokenDelta', delta, 'assistant', spokenItemId, {
        spokenChars,
        spokenWords,
        playbackMs: Math.round(playbackMs),
        precision,
        wordTimestamps,
        wordTimestampsTimeBase,
      });

      if (spokenItemId) {
        this.events.emit('spokenProgress', spokenItemId, {
          spokenChars,
          spokenWords,
          playbackMs: Math.round(playbackMs),
          precision: 'segment',
        });
      }
    };

    if (spokenItemId) {
      // Mark adapter-provided spoken tracking before first audio chunk so
      // runtime-level fallback synthesis does not latch full text too early.
      this.events.emit('spokenProgress', spokenItemId, {
        spokenChars: 0,
        spokenWords: 0,
        playbackMs: 0,
        precision: 'segment',
      });
    }

    const split = splitSpeakableText(normalized);
    const segments = [...split.segments];
    const trailing = split.remainder.trim();
    if (trailing) {
      segments.push(trailing);
    }
    if (segments.length === 0) {
      segments.push(normalized);
    }

    try {
      for (const segment of segments) {
        if (!this.isCurrentGeneration(generation) || controller.signal.aborted) {
          break;
        }
        const synthesisResult = await synthesizeWithSharedTts({
          text: segment,
          config: this.externalTtsConfig,
          signal: controller.signal,
          emitChunk,
        });
        emitSpokenDelta(
          segment,
          synthesisResult.precision ?? 'segment',
          synthesisResult.wordTimestamps,
          synthesisResult.wordTimestampsTimeBase
        );
      }

      if (
        this.isCurrentGeneration(generation) &&
        !controller.signal.aborted &&
        spokenText
      ) {
        this.events.emit('spokenFinal', normalized, 'assistant', spokenItemId, {
          spokenChars: normalized.length,
          spokenWords: countWords(normalized),
          playbackMs: Math.round(playbackMs),
          precision: spokenPrecision,
        });
      }
    } finally {
      if (this.activeTtsAbortController === controller) {
        this.activeTtsAbortController = null;
      }
      if (this.isCurrentGeneration(generation)) {
        this.setState('listening');
        this.events.emit('latency', {
          stage: 'tts',
          durationMs: Date.now() - startedAtMs,
          provider: this.externalTtsConfig.provider,
          model: this.externalTtsConfig.model,
          details: {
            textChars: normalized.length,
            playbackMs: Math.round(playbackMs),
            chunks: emittedChunks,
            firstAudioLatencyMs:
              firstAudioAtMs === null
                ? null
                : Math.max(0, firstAudioAtMs - startedAtMs),
          },
        });
      }
    }
  }

  private abortActiveTts(): void {
    if (!this.activeTtsAbortController) {
      return;
    }
    this.activeTtsAbortController.abort();
    this.activeTtsAbortController = null;
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.assistantGeneration;
  }

  private isAbortError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return true;
      }
      return /aborted|abort/i.test(error.message);
    }
    return false;
  }

  private normalizeError(error: unknown): Error {
    if (error && typeof error === 'object') {
      const nested = (error as { error?: unknown }).error;
      if (nested && nested !== error) {
        return this.normalizeError(nested);
      }
    }

    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    if (error && typeof error === 'object') {
      const withMessage = error as { message?: unknown; type?: unknown; code?: unknown };
      if (typeof withMessage.message === 'string' && withMessage.message.trim()) {
        return new Error(withMessage.message);
      }

      const type = typeof withMessage.type === 'string' ? withMessage.type : null;
      const code = typeof withMessage.code === 'string' ? withMessage.code : null;
      const summary =
        [type, code].filter(Boolean).join(': ')
        || 'OpenAI realtime error';
      return new Error(summary);
    }

    return new Error('OpenAI realtime error');
  }

  private emitAssistantDelta(
    delta: string,
    itemId: string | undefined,
    source: 'output_text' | 'output_audio_transcript'
  ): void {
    const resolvedItemId = itemId ?? this.activeAssistantItemId ?? undefined;

    let normalizedDelta = delta;
    if (source === 'output_text') {
      normalizedDelta = this.normalizeOutputTextDelta(normalizedDelta, resolvedItemId);
      if (!normalizedDelta) {
        return;
      }
    } else if (resolvedItemId) {
      // Drop any temporary output_text cleanup state when audio transcript takes over.
      this.outputTextRawByItemId.delete(resolvedItemId);
      this.outputTextEmittedLengthByItemId.delete(resolvedItemId);
    }

    if (resolvedItemId) {
      const existingSource = this.assistantDeltaSourceByItemId.get(resolvedItemId);
      if (existingSource && existingSource !== source) {
        return;
      }
      this.assistantDeltaSourceByItemId.set(resolvedItemId, source);
      this.activeAssistantItemId = resolvedItemId;
    }

    this.assistantDeltaSeenThisTurn = true;
    this.events.emit('transcriptDelta', normalizedDelta, 'assistant', resolvedItemId);
  }

  private normalizeOutputTextDelta(delta: string, itemId?: string): string {
    if (!itemId) {
      return this.normalizeQuotedWrapperText(delta);
    }

    const prevRaw = this.outputTextRawByItemId.get(itemId) ?? '';
    const nextRaw = prevRaw + delta;
    this.outputTextRawByItemId.set(itemId, nextRaw);

    const normalized = this.normalizeQuotedWrapperText(nextRaw);
    const emittedLength = this.outputTextEmittedLengthByItemId.get(itemId) ?? 0;
    if (normalized.length <= emittedLength) {
      return '';
    }

    this.outputTextEmittedLengthByItemId.set(itemId, normalized.length);
    return normalized.slice(emittedLength);
  }

  private normalizeQuotedWrapperText(text: string): string {
    // Some realtime text channels occasionally stream utterances wrapped as {"..."}.
    // Convert that transport artifact back into plain conversational text.
    if (!text.startsWith('{"') || text.includes('":')) {
      return text;
    }

    let normalized = text.slice(2);
    if (normalized.endsWith('"}')) {
      normalized = normalized.slice(0, -2);
    } else if (normalized.endsWith('"')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n');
  }

  private normalizeAssistantTextOutput(text: string, itemId?: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      return '';
    }

    if (itemId) {
      const rawFromDeltas = this.outputTextRawByItemId.get(itemId);
      if (rawFromDeltas) {
        const normalizedFromDeltas =
          this.normalizeQuotedWrapperText(rawFromDeltas).trim();
        if (normalizedFromDeltas) {
          return normalizedFromDeltas;
        }
      }
    }

    return this.normalizeQuotedWrapperText(trimmed).trim();
  }

  private joinSpokenChunks(previous: string, delta: string): string {
    if (!previous) {
      return delta;
    }
    if (!delta) {
      return previous;
    }
    const previousEndsWithWhitespace = /\s$/u.test(previous);
    const deltaStartsWithWhitespace = /^\s/u.test(delta);
    if (previousEndsWithWhitespace || deltaStartsWithWhitespace) {
      return previous + delta;
    }

    const previousTail = previous[previous.length - 1] ?? '';
    const deltaHead = delta[0] ?? '';
    const needsSeparator =
      /[\p{L}\p{N}]/u.test(previousTail) && /[\p{L}\p{N}]/u.test(deltaHead);
    const punctuationBoundary =
      /[.,!?;:]/u.test(previousTail) && /[\p{L}\p{N}]/u.test(deltaHead);
    if (needsSeparator || punctuationBoundary) {
      return `${previous} ${delta}`;
    }

    return previous + delta;
  }

  private emitUserTranscript(itemId: string, transcript: string): void {
    const normalized = transcript.trim();
    if (!normalized) {
      return;
    }
    const previous = this.emittedUserTranscripts.get(itemId);
    if (previous === normalized) {
      return;
    }
    this.emittedUserTranscripts.set(itemId, normalized);
    this.events.emit('transcript', normalized, 'user', itemId);
  }

  private extractConversationItemTranscript(
    content: ConversationItemAddedEvent['item']['content']
  ): string {
    if (!Array.isArray(content)) {
      return '';
    }

    const chunks: string[] = [];
    for (const part of content) {
      const transcript = typeof part?.transcript === 'string' ? part.transcript.trim() : '';
      if (transcript) {
        chunks.push(transcript);
        continue;
      }
      const text = typeof part?.text === 'string' ? part.text.trim() : '';
      if (text) {
        chunks.push(text);
      }
    }

    return chunks.join(' ').trim();
  }

  private maybeEmitUserTranscriptFromRealtimeItem(item: RealtimeItem): void {
    if (!item || typeof item !== 'object') {
      return;
    }

    const message = item as {
      type?: string;
      role?: string;
      itemId?: string;
      content?: ConversationItemAddedEvent['item']['content'];
    };

    if (message.type !== 'message' || message.role !== 'user' || !message.itemId) {
      return;
    }

    const transcript = this.extractConversationItemTranscript(message.content);
    if (transcript) {
      this.emitUserTranscript(message.itemId, transcript);
    }
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

  private resolveOutputAudioMode(
    providerConfig: OpenAIProviderConfig
  ): 'provider-audio' | 'text-tts' {
    const raw = (providerConfig as Record<string, unknown>).outputAudioMode;
    return raw === 'text-tts' ? 'text-tts' : 'provider-audio';
  }

  private resolveSessionVoice(raw: string): string {
    const normalized = raw.trim();
    if (normalized.length > 0) {
      return normalized;
    }
    return OPENAI_DEFAULT_SESSION_VOICE;
  }

  private getProviderConfig(input: SessionInput): OpenAIProviderConfig {
    return parseOpenAIProviderConfig(input.providerConfig);
  }

  private getDecomposedProviderConfig(input: SessionInput): DecomposedProviderConfig {
    return parseDecomposedProviderConfig(input.providerConfig);
  }

  private buildExternalTtsConfig(input: {
    input: SessionInput;
    providerConfig: OpenAIProviderConfig;
    decomposedConfig: DecomposedProviderConfig;
  }): SharedTtsConfig {
    const language =
      input.input.language ??
      input.providerConfig.language ??
      'en';
    const config = resolveSharedTtsConfig({
      provider: input.decomposedConfig.ttsProvider,
      model: input.decomposedConfig.ttsModel,
      voice: input.decomposedConfig.ttsVoice ?? input.input.voice,
      language,
      openaiApiKey:
        input.decomposedConfig.openaiApiKey ?? input.providerConfig.apiKey,
      deepgramApiKey: input.decomposedConfig.deepgramApiKey,
      googleApiKey: input.decomposedConfig.googleApiKey,
      cartesiaApiKey: input.decomposedConfig.cartesiaApiKey,
      fishAudioApiKey: input.decomposedConfig.fishAudioApiKey,
      rimeApiKey: input.decomposedConfig.rimeApiKey,
      kokoroEndpoint: input.decomposedConfig.kokoroEndpoint,
      pocketTtsEndpoint: input.decomposedConfig.pocketTtsEndpoint,
      localEndpoint: input.decomposedConfig.localEndpoint,
      localTtsStreamingIntervalSec:
        input.decomposedConfig.localTtsStreamingIntervalSec,
      voiceRefAudio: input.decomposedConfig.voiceRefAudio,
      voiceRefText: input.decomposedConfig.voiceRefText,
      googleChirpEndpoint: input.decomposedConfig.googleChirpEndpoint,
      cartesiaTtsWsUrl: input.decomposedConfig.cartesiaTtsWsUrl,
      fishTtsWsUrl: input.decomposedConfig.fishTtsWsUrl,
      rimeTtsWsUrl: input.decomposedConfig.rimeTtsWsUrl,
    });
    if (config.provider === 'deepgram') {
      throw new Error(
        'realtime-text-tts mode does not support deepgram segment synthesis. '
          + 'Set decomposed TTS provider to local/openai/cartesia/fish/rime/google-chirp/kokoro/pocket-tts.'
      );
    }
    return config;
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
