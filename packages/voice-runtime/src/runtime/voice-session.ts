import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import { StreamResamplerPool } from '../media/stream-resampler.js';
import type {
  AudioFrame,
  AudioNegotiation,
  ClientTransport,
  EventHandler,
  InterruptionContext,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
  SpokenWordCue,
  SpokenWordTimestamp,
  ToolCallResult,
  VoiceHistoryItem,
  VoiceSession,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';
import { InterruptionTracker } from './interruption-tracker.js';
import { TypedEventEmitter } from './typed-emitter.js';
import {
  cuesToWordTimestamps,
  resolveWordCountAtPlaybackMs,
  WordCueTimelineBuilder,
} from './word-cue-timeline.js';

const OUTBOUND_SPEECH_RMS_THRESHOLD = 0.01;

export class VoiceSessionImpl implements VoiceSession {
  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private readonly adapter: ProviderAdapter;
  private readonly input: SessionInput;
  private readonly capabilities: ProviderCapabilities;
  private readonly resamplerPool = new StreamResamplerPool();

  private state: VoiceState = 'idle';
  private history: VoiceHistoryItem[] = [];
  private connected = false;
  private negotiation: AudioNegotiation | null = null;
  private clientTransport: ClientTransport | null = null;
  private transportAudioHandler: ((frame: AudioFrame) => void) | null = null;
  private readonly interruptionTracker = new InterruptionTracker();
  private readonly assistantDeltaItemIds = new Set<string>();
  private assistantDeltaSeenThisTurn = false;
  private nextConversationOrder = 1;
  private readonly conversationOrderByItemId = new Map<string, number>();
  private lastUserConversationOrder: number | undefined;
  private lastAssistantConversationOrder: number | undefined;
  private adapterProvidedSpokenEvents = false;
  private activeAssistantItemId: string | null = null;
  private spokenCursorItemId: string | null = null;
  private spokenCursorText = '';
  private spokenCursorPlaybackMs = 0;
  private spokenCursorPrecision: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps' =
    'segment';
  private readonly spokenFinalizedItemIds = new Set<string>();
  private readonly spokenCueTimeline: WordCueTimelineBuilder;
  private playbackPositionOffsetMs = 0;
  private lastOutboundAudioAtMs: number | null = null;
  private lastOutboundSpeechAtMs: number | null = null;
  private pendingInputAudioToFirstAssistantAudioAtMs: number | null = null;

  constructor(adapter: ProviderAdapter, input: SessionInput) {
    this.adapter = adapter;
    this.input = input;
    this.capabilities = adapter.capabilities();

    // Derive synthetic word cue config from turn settings.
    const turnConfig = input.turn;
    const configuredMsPerWord = turnConfig?.spokenHighlightMsPerWord;
    const minMsPerWord =
      typeof configuredMsPerWord === 'number' && configuredMsPerWord > 0
        ? Math.max(100, configuredMsPerWord)
        : undefined;
    const punctuationPauseMs =
      typeof turnConfig?.spokenHighlightPunctuationPauseMs === 'number' &&
      turnConfig.spokenHighlightPunctuationPauseMs > 0
        ? turnConfig.spokenHighlightPunctuationPauseMs
        : undefined;
    this.spokenCueTimeline = new WordCueTimelineBuilder({
      minMsPerWord,
      punctuationPauseMs,
      preferProviderTimestamps: turnConfig?.preferProviderTimestamps,
    });

    this.bindAdapterEvents();
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.resetConversationOrderState();
    this.resetSpokenSynthesisState();
    this.negotiation = await this.adapter.connect(this.input);
    this.connected = true;
    // Pre-warm stream resamplers for any rate mismatches
    await this.initResamplers();
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
    this.resetAssistantTranscriptDedup();
    this.resetConversationOrderState();
    this.resetSpokenSynthesisState();
    this.playbackPositionOffsetMs = 0;
    this.lastOutboundAudioAtMs = null;
    this.lastOutboundSpeechAtMs = null;
    this.pendingInputAudioToFirstAssistantAudioAtMs = null;
    this.resamplerPool.clear();
  }

  async attachClientTransport(transport: ClientTransport): Promise<void> {
    if (this.clientTransport) {
      await this.detachClientTransport();
    }
    this.clientTransport = transport;
    this.transportAudioHandler = (frame: AudioFrame) => {
      this.markOutboundAudioFrame(frame);
      const providerInputRate = this.negotiation?.providerInputRate;
      if (!providerInputRate || frame.sampleRate === providerInputRate) {
        this.adapter.sendAudio(frame);
        return;
      }
      const resampler = this.resamplerPool.getSync(frame.sampleRate, providerInputRate);
      if (resampler) {
        this.adapter.sendAudio(resampler.process(frame));
      } else {
        // Fallback to stateless resample while WASM initializes
        this.adapter.sendAudio(resamplePcm16Mono(frame, providerInputRate));
      }
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
    this.playbackPositionOffsetMs = 0;
  }

  sendAudio(frame: AudioFrame): void {
    this.markOutboundAudioFrame(frame);
    const providerInputRate = this.negotiation?.providerInputRate;
    if (!providerInputRate || frame.sampleRate === providerInputRate) {
      this.adapter.sendAudio(frame);
      return;
    }
    const resampler = this.resamplerPool.getSync(frame.sampleRate, providerInputRate);
    if (resampler) {
      this.adapter.sendAudio(resampler.process(frame));
    } else {
      this.adapter.sendAudio(resamplePcm16Mono(frame, providerInputRate));
    }
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

  /**
   * Pre-initialize stream resamplers for any rate mismatches between
   * client and provider. Called once after connect() so the WASM init
   * completes before audio starts flowing.
   */
  private async initResamplers(): Promise<void> {
    if (!this.negotiation) return;
    const clientIn =
      this.negotiation.preferredClientInputRate ?? this.negotiation.providerInputRate;
    const providerIn = this.negotiation.providerInputRate;
    const providerOut = this.negotiation.providerOutputRate;
    const clientOut =
      this.negotiation.preferredClientOutputRate ?? this.negotiation.providerOutputRate;

    const inits: Promise<unknown>[] = [];
    if (clientIn !== providerIn) {
      inits.push(this.resamplerPool.get(clientIn, providerIn));
    }
    if (providerOut !== clientOut) {
      inits.push(this.resamplerPool.get(providerOut, clientOut));
    }
    if (inits.length > 0) {
      await Promise.all(inits);
    }
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

  private markOutboundAudioFrame(frame: AudioFrame): void {
    if (frame.data.byteLength <= 0) {
      return;
    }
    const nowMs = Date.now();
    this.lastOutboundAudioAtMs = nowMs;
    if (computeRmsPcm16(frame.data) >= OUTBOUND_SPEECH_RMS_THRESHOLD) {
      this.lastOutboundSpeechAtMs = nowMs;
    }
  }

  private armInputAudioToFirstAssistantAudioMetric(): void {
    const anchorMs = this.lastOutboundSpeechAtMs ?? this.lastOutboundAudioAtMs;
    if (anchorMs === null) {
      return;
    }
    this.pendingInputAudioToFirstAssistantAudioAtMs = anchorMs;
  }

  private clearInputAudioToFirstAssistantAudioMetric(): void {
    this.pendingInputAudioToFirstAssistantAudioAtMs = null;
  }

  private maybeEmitInputAudioToFirstAssistantAudioMetric(): void {
    const inputAudioAtMs = this.pendingInputAudioToFirstAssistantAudioAtMs;
    if (inputAudioAtMs === null) {
      return;
    }
    const firstAudioAtMs = Date.now();
    this.pendingInputAudioToFirstAssistantAudioAtMs = null;
    this.events.emit('latency', {
      stage: 'turn',
      durationMs: Math.max(0, firstAudioAtMs - inputAudioAtMs),
      details: {
        metric: 'input-audio-to-first-audio',
        inputAudioAtMs,
        firstAudioAtMs,
      },
    });
  }

  private forwardAssistantAudio(frame: AudioFrame): void {
    if (!this.clientTransport) {
      this.interruptionTracker.trackAssistantAudio(frame);
      this.emitSynthesizedSpokenProgress();
      this.events.emit('audio', frame);
      return;
    }

    const targetRate =
      this.negotiation?.preferredClientOutputRate ??
      this.negotiation?.providerOutputRate ??
      frame.sampleRate;

    let frameForTransport: AudioFrame;
    if (frame.sampleRate === targetRate) {
      frameForTransport = frame;
    } else {
      const resampler = this.resamplerPool.getSync(frame.sampleRate, targetRate);
      frameForTransport = resampler
        ? resampler.process(frame)
        : resamplePcm16Mono(frame, targetRate);
    }
    this.interruptionTracker.trackAssistantAudio(frameForTransport);
    this.clientTransport.playAudioFrame(frameForTransport);
    this.emitSynthesizedSpokenProgress();
    this.events.emit('audio', frameForTransport);
  }

  private resolveInterruptionContext(): void {
    const playbackPositionMs = this.getPlaybackPositionMs();
    let context = this.interruptionTracker.resolve(playbackPositionMs);
    if (!context) return;
    context = this.resolveInterruptionFromCueTimeline(context, playbackPositionMs);

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

    if (this.adapterProvidedSpokenEvents) {
      this.emitInterruptedSpokenFinal(context);
    } else {
      this.emitSynthesizedSpokenProgress(context);
      this.emitSynthesizedSpokenFinal(context);
    }
    this.events.emit('interruptionResolved', context);
    this.interruptionTracker.reset();
    this.activeAssistantItemId = null;
    this.spokenCueTimeline.reset();
    this.spokenCursorItemId = null;
    this.spokenCursorText = '';
    this.spokenCursorPlaybackMs = 0;
    this.spokenCursorPrecision = 'segment';
  }

  private getPlaybackPositionMs(): number | undefined {
    if (!this.clientTransport?.getPlaybackPositionMs) return undefined;
    const position = this.clientTransport.getPlaybackPositionMs();
    if (!Number.isFinite(position) || position < 0) return undefined;
    return Math.max(0, position - this.playbackPositionOffsetMs);
  }

  private capturePlaybackPositionOffset(): void {
    if (!this.clientTransport?.getPlaybackPositionMs) {
      this.playbackPositionOffsetMs = 0;
      return;
    }
    const position = this.clientTransport.getPlaybackPositionMs();
    if (!Number.isFinite(position) || position < 0) {
      this.playbackPositionOffsetMs = 0;
      return;
    }
    this.playbackPositionOffsetMs = position;
  }

  private normalizeSpokenPlaybackMs(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value) || value === undefined || value < 0) {
      return Math.max(0, fallback);
    }
    return Math.max(0, value);
  }

  private resolveSpokenTextFromDelta(
    previousText: string,
    delta: string,
    spokenChars?: number
  ): string {
    const safePrevious = previousText ?? '';
    const safeDelta = delta ?? '';
    const expanded = joinSpokenChunks(safePrevious, safeDelta);
    if (!Number.isFinite(spokenChars) || spokenChars === undefined || spokenChars < 0) {
      return expanded;
    }
    const targetChars = Math.max(0, spokenChars);
    if (targetChars >= expanded.length) {
      return expanded;
    }
    if (targetChars <= safePrevious.length) {
      return safePrevious.slice(0, targetChars);
    }
    return expanded.slice(0, targetChars);
  }

  private resolveSpokenTextFromChars(text: string, spokenChars: number): string {
    if (!Number.isFinite(spokenChars) || spokenChars < 0) {
      return text;
    }
    return text.slice(0, Math.max(0, Math.min(text.length, spokenChars)));
  }

  private extractProviderWordTimestamps(cues: SpokenWordCue[]): SpokenWordTimestamp[] | undefined {
    const providerCues = cues.filter((cue) => cue.source === 'provider');
    if (providerCues.length === 0) {
      return undefined;
    }
    return cuesToWordTimestamps(providerCues);
  }

  private truncateLocalHistory(itemId: string, spokenText: string): void {
    const truncatedText = spokenText ?? '';
    if (!truncatedText.trim()) {
      return;
    }
    const historyIndex = this.history.findIndex((item) => item.id === itemId);
    if (historyIndex < 0) {
      this.history.push({
        id: itemId,
        role: 'assistant',
        text: truncatedText,
        createdAt: Date.now(),
        providerMeta: {
          interrupted: true,
        },
      });
      this.events.emit('historyUpdated', [...this.history]);
      return;
    }
    const existingItem = this.history[historyIndex];
    if (!existingItem || existingItem.role !== 'assistant') return;

    this.history[historyIndex] = {
      ...existingItem,
      text: truncatedText,
      providerMeta: {
        ...(existingItem.providerMeta ?? {}),
        interrupted: true,
      },
    };
    this.events.emit('historyUpdated', [...this.history]);
  }

  private resolveInterruptionFromCueTimeline(
    context: InterruptionContext,
    playbackPositionMs: number | undefined
  ): InterruptionContext {
    if (!this.adapterProvidedSpokenEvents) {
      return context;
    }

    const fullText = context.fullText ?? '';
    if (!fullText) {
      return context;
    }

    const cues = this.spokenCueTimeline.getTimeline();
    if (cues.length === 0) {
      return context;
    }

    const effectivePlaybackMs = Number.isFinite(playbackPositionMs)
      ? Math.max(0, playbackPositionMs ?? 0)
      : Math.max(0, context.playbackPositionMs);
    const resolvedWordCount = resolveWordCountAtPlaybackMs(cues, effectivePlaybackMs);
    const truncated = truncateTextToWordCount(fullText, resolvedWordCount);

    return {
      ...context,
      spokenText: truncated.text,
      truncated: truncated.text !== fullText,
      spokenWordCount: truncated.wordCount > 0 ? truncated.wordCount : undefined,
      spokenWordIndex:
        truncated.wordCount > 0 ? Math.max(0, truncated.wordCount - 1) : undefined,
    };
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
      this.resetAssistantTranscriptDedup();
      this.resetConversationOrderState();
      this.resetSpokenSynthesisState();
      this.lastOutboundAudioAtMs = null;
      this.lastOutboundSpeechAtMs = null;
      this.clearInputAudioToFirstAssistantAudioMetric();
      this.events.emit('disconnected', reason);
    });

    this.adapter.on('stateChange', (state: VoiceState) => {
      const previousState = this.state;
      this.state = state;
      if (state === 'thinking' && previousState !== 'thinking') {
        this.armInputAudioToFirstAssistantAudioMetric();
      } else if (
        (state === 'listening' || state === 'idle') &&
        previousState === 'thinking'
      ) {
        this.clearInputAudioToFirstAssistantAudioMetric();
      }
      this.events.emit('stateChange', state);
    });

    this.adapter.on('audio', (frame: AudioFrame) => {
      this.maybeEmitInputAudioToFirstAssistantAudioMetric();
      this.forwardAssistantAudio(frame);
    });

    this.adapter.on('audioInterrupted', () => {
      const interruptionRelevant =
        this.state === 'speaking' || this.interruptionTracker.hasActiveAssistantOutput();
      if (!interruptionRelevant) {
        return;
      }
      this.resolveInterruptionContext();
      if (this.clientTransport) {
        this.clientTransport.interruptPlayback();
      }
      this.events.emit('audioInterrupted');
    });

    this.adapter.on('transcript', (text, role, itemId, orderHint) => {
      if (role === 'assistant') {
        this.interruptionTracker.trackAssistantTranscript(text, itemId);
        if (!this.shouldEmitAssistantTranscript(itemId)) {
          return;
        }
        if (itemId) {
          this.assistantDeltaItemIds.delete(itemId);
        }
      }
      const order = this.resolveConversationOrder(role, itemId, orderHint);
      this.events.emit('transcript', text, role, itemId, order);
    });

    this.adapter.on('transcriptDelta', (delta, role, itemId, orderHint) => {
      if (role === 'assistant') {
        this.interruptionTracker.trackAssistantDelta(delta, itemId);
        this.assistantDeltaSeenThisTurn = true;
        if (itemId) {
          this.assistantDeltaItemIds.add(itemId);
        }
      }
      const order = this.resolveConversationOrder(role, itemId, orderHint);
      this.events.emit('transcriptDelta', delta, role, itemId, order);
    });

    this.adapter.on('spokenDelta', (delta, role, itemId, meta) => {
      this.adapterProvidedSpokenEvents = true;
      const playbackMs = this.normalizeSpokenPlaybackMs(
        meta?.playbackMs,
        this.spokenCursorPlaybackMs
      );
      const previousSpokenText =
        this.spokenCursorItemId === itemId ? this.spokenCursorText : '';
      const nextSpokenText = this.resolveSpokenTextFromDelta(
        previousSpokenText,
        delta,
        meta?.spokenChars
      );
      const cues = this.spokenCueTimeline.ingestDelta({
        spokenText: nextSpokenText,
        playbackMs,
        speechOnsetMs: meta?.speechOnsetMs,
        providerWordTimestamps: meta?.wordTimestamps,
        providerTimeBase: meta?.wordTimestampsTimeBase ?? 'segment',
      });

      const providerWordTimestamps = this.extractProviderWordTimestamps(cues.timeline);
      this.interruptionTracker.trackAssistantSpokenDelta(delta, itemId, {
        ...meta,
        playbackMs,
        wordTimestamps: providerWordTimestamps,
        wordTimestampsTimeBase: providerWordTimestamps ? 'utterance' : undefined,
      });

      this.events.emit('spokenDelta', delta, role, itemId, {
        ...meta,
        spokenChars: meta?.spokenChars ?? nextSpokenText.length,
        spokenWords: meta?.spokenWords ?? countWords(nextSpokenText),
        playbackMs,
        wordCueUpdate: cues.update ?? undefined,
      });

      this.spokenCursorItemId = itemId ?? this.spokenCursorItemId ?? this.activeAssistantItemId;
      this.spokenCursorText = nextSpokenText;
      this.spokenCursorPlaybackMs = playbackMs;
      this.spokenCursorPrecision = meta?.precision ?? this.spokenCursorPrecision;
    });

    this.adapter.on('spokenProgress', (itemId, progress) => {
      this.adapterProvidedSpokenEvents = true;
      const playbackMs = this.normalizeSpokenPlaybackMs(
        progress.playbackMs,
        this.spokenCursorPlaybackMs
      );
      const spokenText =
        this.spokenCursorItemId === itemId
          ? this.resolveSpokenTextFromChars(this.spokenCursorText, progress.spokenChars)
          : '';
      this.spokenCueTimeline.ingestDelta({
        spokenText,
        playbackMs,
      });
      this.interruptionTracker.trackAssistantSpokenProgress(itemId, {
        ...progress,
        playbackMs,
      });
      this.events.emit('spokenProgress', itemId, {
        ...progress,
        playbackMs,
      });
      this.spokenCursorItemId = itemId;
      this.spokenCursorText = spokenText;
      this.spokenCursorPlaybackMs = playbackMs;
      this.spokenCursorPrecision = progress.precision;
    });

    this.adapter.on('spokenFinal', (text, role, itemId, meta) => {
      this.adapterProvidedSpokenEvents = true;
      const spokenText = text ?? '';
      const playbackMs = this.normalizeSpokenPlaybackMs(
        meta?.playbackMs,
        this.spokenCursorPlaybackMs
      );
      const cues = this.spokenCueTimeline.ingestFinal({
        spokenText,
        playbackMs,
        providerWordTimestamps: meta?.wordTimestamps,
        providerTimeBase: meta?.wordTimestampsTimeBase ?? 'utterance',
      });

      const providerWordTimestamps = this.extractProviderWordTimestamps(cues.timeline);
      this.interruptionTracker.trackAssistantSpokenFinal(spokenText, itemId, {
        ...meta,
        spokenChars: meta?.spokenChars ?? spokenText.length,
        spokenWords: meta?.spokenWords ?? countWords(spokenText),
        playbackMs,
        wordTimestamps: providerWordTimestamps,
        wordTimestampsTimeBase: providerWordTimestamps ? 'utterance' : undefined,
      });

      this.events.emit('spokenFinal', spokenText, role, itemId, {
        ...meta,
        spokenChars: meta?.spokenChars ?? spokenText.length,
        spokenWords: meta?.spokenWords ?? countWords(spokenText),
        playbackMs,
        wordCues: cues.timeline,
        wordCueUpdate: cues.update ?? undefined,
      });

      this.spokenCursorItemId = itemId ?? this.spokenCursorItemId ?? this.activeAssistantItemId;
      this.spokenCursorText = spokenText;
      this.spokenCursorPlaybackMs = playbackMs;
      this.spokenCursorPrecision = meta?.precision ?? this.spokenCursorPrecision;
    });

    this.adapter.on('userItemCreated', (itemId, orderHint) => {
      const order = this.getOrCreateConversationOrder(itemId, orderHint);
      this.lastUserConversationOrder = order;
      this.events.emit('userItemCreated', itemId, order);
    });

    this.adapter.on('assistantItemCreated', (itemId, previousItemId, orderHint) => {
      this.interruptionTracker.beginAssistantItem(itemId);
      this.activeAssistantItemId = itemId;
      this.capturePlaybackPositionOffset();
      this.assistantDeltaSeenThisTurn = false;
      this.assistantDeltaItemIds.delete(itemId);
      this.spokenFinalizedItemIds.delete(itemId);
      if (this.spokenCursorItemId !== itemId) {
        this.spokenCursorItemId = itemId;
        this.spokenCursorText = '';
        this.spokenCursorPlaybackMs = 0;
        this.spokenCursorPrecision = 'segment';
        this.spokenCueTimeline.reset();
      }
      const order = this.getOrCreateConversationOrderAfter(itemId, previousItemId, orderHint);
      this.lastAssistantConversationOrder = order;
      this.events.emit('assistantItemCreated', itemId, previousItemId, order);
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
      this.resetAssistantTranscriptDedup();
      this.armInputAudioToFirstAssistantAudioMetric();
      this.events.emit('turnStarted');
    });

    this.adapter.on('turnComplete', () => {
      this.clearInputAudioToFirstAssistantAudioMetric();
      this.emitSynthesizedSpokenProgress();
      this.emitSynthesizedSpokenFinal();
      this.events.emit('turnComplete');
      this.resetAssistantTranscriptDedup();
      this.playbackPositionOffsetMs = 0;

      if (this.adapterProvidedSpokenEvents) {
        // When the adapter provides spoken events, TTS generation may finish
        // before audio playback completes.  Keep the interruption tracker and
        // spoken-cursor state alive so that a barge-in during the "playback
        // tail" can still resolve what the user actually heard.  All of this
        // state is naturally reset when the next assistant item starts
        // (beginAssistantItem), on disconnect, or on close.
      } else {
        this.interruptionTracker.reset();
        this.activeAssistantItemId = null;
        this.spokenCueTimeline.reset();
        this.spokenCursorItemId = null;
        this.spokenCursorText = '';
        this.spokenCursorPlaybackMs = 0;
        this.spokenCursorPrecision = 'segment';
      }
    });

    this.adapter.on('toolCancelled', (callIds) => {
      this.events.emit('toolCancelled', callIds);
    });

    this.adapter.on('usage', (metrics) => {
      this.events.emit('usage', metrics);
    });
  }

  private shouldEmitAssistantTranscript(itemId?: string): boolean {
    if (itemId) {
      return !this.assistantDeltaItemIds.has(itemId);
    }
    return !this.assistantDeltaSeenThisTurn;
  }

  private resetAssistantTranscriptDedup(): void {
    this.assistantDeltaItemIds.clear();
    this.assistantDeltaSeenThisTurn = false;
  }

  private resetSpokenSynthesisState(): void {
    this.adapterProvidedSpokenEvents = false;
    this.activeAssistantItemId = null;
    this.spokenCursorItemId = null;
    this.spokenCursorText = '';
    this.spokenCursorPlaybackMs = 0;
    this.spokenCursorPrecision = 'segment';
    this.spokenFinalizedItemIds.clear();
    this.spokenCueTimeline.reset();
  }

  private emitSynthesizedSpokenProgress(context?: InterruptionContext): void {
    if (this.adapterProvidedSpokenEvents) {
      return;
    }
    const resolved = context ?? this.interruptionTracker.resolve(this.getPlaybackPositionMs());
    if (!resolved) {
      return;
    }

    const itemId = resolved.itemId ?? this.activeAssistantItemId;
    if (!itemId) {
      return;
    }

    const precision = resolved.precision ?? 'ratio';
    const spokenText = resolved.spokenText ?? '';
    if (this.spokenCursorItemId !== itemId) {
      this.spokenCursorItemId = itemId;
      this.spokenCursorText = '';
      this.spokenCursorPlaybackMs = 0;
      this.spokenCursorPrecision = precision;
    }

    const previousSpokenText = this.spokenCursorText;
    const previousPlaybackMs = this.spokenCursorPlaybackMs;
    const previousPrecision = this.spokenCursorPrecision;
    let delta = '';
    if (spokenText.length > previousSpokenText.length && spokenText.startsWith(previousSpokenText)) {
      delta = spokenText.slice(previousSpokenText.length);
    }

    const spokenChars = spokenText.length;
    const spokenWords = countWords(spokenText);
    const playbackMs = resolved.playbackPositionMs;
    const progressChanged =
      spokenText !== previousSpokenText ||
      playbackMs !== previousPlaybackMs ||
      precision !== previousPrecision;
    const cues = this.spokenCueTimeline.ingestDelta({
      spokenText,
      playbackMs,
    });

    if (delta.length > 0 || cues.update) {
      this.events.emit('spokenDelta', delta, 'assistant', itemId, {
        spokenChars,
        spokenWords,
        playbackMs,
        precision,
        wordCueUpdate: cues.update ?? undefined,
      });
    }

    if (progressChanged) {
      this.events.emit('spokenProgress', itemId, {
        spokenChars,
        spokenWords,
        playbackMs,
        precision,
      });
    }

    this.spokenCursorItemId = itemId;
    this.spokenCursorText = spokenText;
    this.spokenCursorPlaybackMs = playbackMs;
    this.spokenCursorPrecision = precision;
  }

  private emitSynthesizedSpokenFinal(context?: InterruptionContext): void {
    if (this.adapterProvidedSpokenEvents) {
      return;
    }
    const resolved = context ?? this.interruptionTracker.resolve(this.getPlaybackPositionMs());
    if (!resolved) {
      return;
    }

    const itemId = resolved.itemId ?? this.activeAssistantItemId;
    if (!itemId || this.spokenFinalizedItemIds.has(itemId)) {
      return;
    }

    const precision = resolved.precision ?? 'ratio';
    const spokenText = resolved.spokenText ?? '';
    const spokenChars = spokenText.length;
    const spokenWords = countWords(spokenText);
    const playbackMs = resolved.playbackPositionMs;
    const cues = this.spokenCueTimeline.ingestFinal({
      spokenText,
      playbackMs,
    });
    this.events.emit('spokenFinal', spokenText, 'assistant', itemId, {
      spokenChars,
      spokenWords,
      playbackMs,
      precision,
      wordCues: cues.timeline,
      wordCueUpdate: cues.update ?? undefined,
    });
    this.spokenFinalizedItemIds.add(itemId);
    this.spokenCursorItemId = itemId;
    this.spokenCursorText = spokenText;
    this.spokenCursorPlaybackMs = playbackMs;
    this.spokenCursorPrecision = precision;
  }

  private emitInterruptedSpokenFinal(context: InterruptionContext): void {
    const itemId = context.itemId ?? this.activeAssistantItemId;
    if (!itemId) {
      return;
    }

    const spokenText = context.spokenText ?? '';
    const spokenChars = spokenText.length;
    const spokenWords = countWords(spokenText);
    const playbackMs = context.playbackPositionMs;
    const precision = context.precision ?? 'segment';
    const cues = this.spokenCueTimeline.ingestFinal({
      spokenText,
      playbackMs,
    });

    this.events.emit('spokenProgress', itemId, {
      spokenChars,
      spokenWords,
      playbackMs,
      precision,
    });
    this.events.emit('spokenFinal', spokenText, 'assistant', itemId, {
      spokenChars,
      spokenWords,
      playbackMs,
      precision,
      wordCues: cues.timeline,
      wordCueUpdate: cues.update ?? undefined,
    });
    this.spokenFinalizedItemIds.add(itemId);
    this.spokenCursorItemId = itemId;
    this.spokenCursorText = spokenText;
    this.spokenCursorPlaybackMs = playbackMs;
    this.spokenCursorPrecision = precision;
  }

  private getOrCreateConversationOrder(itemId: string, orderHint?: number): number {
    const existing = this.conversationOrderByItemId.get(itemId);
    if (existing !== undefined) {
      return existing;
    }
    const allocated = this.allocateConversationOrder(orderHint);
    this.nextConversationOrder = Math.max(this.nextConversationOrder, allocated + 1);
    this.conversationOrderByItemId.set(itemId, allocated);
    return allocated;
  }

  private getOrCreateConversationOrderAfter(
    itemId: string,
    previousItemId?: string,
    orderHint?: number
  ): number {
    const existing = this.conversationOrderByItemId.get(itemId);
    if (existing !== undefined) {
      return existing;
    }

    let minOrder = 1;
    if (previousItemId) {
      const previousOrder = this.conversationOrderByItemId.get(previousItemId);
      if (typeof previousOrder === 'number') {
        minOrder = Math.max(minOrder, previousOrder + 1);
      } else if (!this.isValidConversationOrder(orderHint)) {
        const createdPreviousOrder = this.getOrCreateConversationOrder(previousItemId);
        minOrder = Math.max(minOrder, createdPreviousOrder + 1);
      }
    }

    const allocated = this.allocateConversationOrder(orderHint, minOrder);
    this.nextConversationOrder = Math.max(this.nextConversationOrder, allocated + 1);
    this.conversationOrderByItemId.set(itemId, allocated);
    return allocated;
  }

  private resolveConversationOrder(
    role: 'user' | 'assistant',
    itemId?: string,
    orderHint?: number
  ): number | undefined {
    if (itemId) {
      const order = this.getOrCreateConversationOrder(itemId, orderHint);
      if (role === 'assistant') {
        this.lastAssistantConversationOrder = order;
      } else {
        this.lastUserConversationOrder = order;
      }
      return order;
    }
    return role === 'assistant'
      ? this.lastAssistantConversationOrder
      : this.lastUserConversationOrder;
  }

  private allocateConversationOrder(orderHint?: number, minOrder = 1): number {
    const normalizedHint = this.normalizeConversationOrder(orderHint);
    if (
      typeof normalizedHint === 'number' &&
      normalizedHint >= minOrder &&
      !this.isConversationOrderTaken(normalizedHint)
    ) {
      return normalizedHint;
    }

    let candidate = Math.max(this.nextConversationOrder, minOrder);
    while (this.isConversationOrderTaken(candidate)) {
      candidate += 1;
    }
    return candidate;
  }

  private isConversationOrderTaken(order: number): boolean {
    for (const existingOrder of this.conversationOrderByItemId.values()) {
      if (existingOrder === order) {
        return true;
      }
    }
    return false;
  }

  private isValidConversationOrder(order: number | undefined): boolean {
    return typeof order === 'number' && Number.isInteger(order) && order >= 1;
  }

  private normalizeConversationOrder(order: number | undefined): number | undefined {
    if (!this.isValidConversationOrder(order)) {
      return undefined;
    }
    return order;
  }

  private resetConversationOrderState(): void {
    this.nextConversationOrder = 1;
    this.conversationOrderByItemId.clear();
    this.lastUserConversationOrder = undefined;
    this.lastAssistantConversationOrder = undefined;
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function computeRmsPcm16(data: ArrayBuffer): number {
  const bytes = new DataView(data);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = bytes.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

function joinSpokenChunks(previous: string, delta: string): string {
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
  const punctuationBoundary = /[.,!?;:]/u.test(previousTail) && /[\p{L}\p{N}]/u.test(deltaHead);
  if (needsSeparator || punctuationBoundary) {
    return `${previous} ${delta}`;
  }

  return previous + delta;
}

function truncateTextToWordCount(
  text: string,
  wordCount: number
): { text: string; wordCount: number } {
  if (!text || wordCount <= 0) {
    return { text: '', wordCount: 0 };
  }

  const matcher = /\S+/gu;
  let matchedWords = 0;
  let endIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(text)) !== null) {
    matchedWords += 1;
    endIndex = match.index + match[0].length;
    if (matchedWords >= wordCount) {
      break;
    }
  }

  if (matchedWords === 0 || endIndex <= 0) {
    return { text: '', wordCount: 0 };
  }

  return {
    text: text.slice(0, endIndex),
    wordCount: matchedWords,
  };
}
