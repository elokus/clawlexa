import { parseDecomposedProviderConfig } from '../provider-config.js';
import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import { createClient, LiveTTSEvents, type SpeakLiveClient } from '@deepgram/sdk';
import type {
  AudioFrame,
  AudioNegotiation,
  DecomposedProviderConfig,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfigSchema,
  SessionInput,
  ToolCallContext,
  ToolDefinition,
  ToolCallResult,
  VoiceHistoryItem,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';

const AUDIO_SAMPLE_RATE = 24000;
const PCM_BYTES_PER_100MS = (AUDIO_SAMPLE_RATE * 2) / 10;
const TURN_MARKERS = ['✓', '○', '◐'] as const;

type TurnMarker = (typeof TURN_MARKERS)[number];
type ConversationRole = 'user' | 'assistant' | 'system';

interface DecomposedOptions {
  sttProvider: 'openai' | 'deepgram';
  sttModel: string;
  llmProvider: 'openai' | 'openrouter';
  llmModel: string;
  ttsProvider: 'openai' | 'deepgram';
  ttsModel: string;
  ttsVoice: string;
  deepgramTtsTransport: 'websocket';
  deepgramTtsWsUrl: string;
  silenceMs: number;
  minSpeechMs: number;
  minRms: number;
  llmCompletionEnabled: boolean;
  llmShortTimeoutMs: number;
  llmLongTimeoutMs: number;
  llmShortReprompt: string;
  llmLongReprompt: string;
  language: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  deepgramApiKey?: string;
}

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatCompletionMessage;
    finish_reason?: string | null;
  }>;
}

interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface ChatCompletionMessage {
  role?: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type?: string; text?: string }> | null;
  tool_calls?: ChatCompletionToolCall[];
  tool_call_id?: string;
}

interface ChatCompletionToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface LlmRequestTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

type LlmMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: ChatCompletionToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

const TURN_COMPLETION_PROMPT = [
  'You must start every response with exactly one marker character:',
  '✓ when the user turn is complete and you should answer now.',
  '○ when the user seems to have paused mid-thought and likely continues soon.',
  '◐ when the user seems to be thinking and may continue after a longer pause.',
  'If you use ○ or ◐, do not include any extra text after the marker.',
  'Never explain the marker. Never output more than one marker.',
].join('\n');

const DECOMPOSED_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['http', 'websocket'],
  audioNegotiation: false,
  vadModes: ['manual'],
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

interface ConversationEntry {
  id: string;
  role: ConversationRole;
  content: string;
}

const DECOMPOSED_CONFIG_SCHEMA: ProviderConfigSchema = {
  providerId: 'decomposed',
  displayName: 'Decomposed (STT + LLM + TTS)',
  fields: [
    {
      key: 'turn.silenceMs',
      label: 'Silence Threshold (ms)',
      type: 'number',
      group: 'vad',
      min: 100,
      max: 3000,
      step: 50,
      defaultValue: 700,
      description: 'Duration of silence before finalizing a turn.',
    },
    {
      key: 'turn.minSpeechMs',
      label: 'Minimum Speech (ms)',
      type: 'number',
      group: 'vad',
      min: 50,
      max: 2000,
      step: 50,
      defaultValue: 350,
      description: 'Minimum speech duration to process a turn.',
    },
    {
      key: 'turn.minRms',
      label: 'Minimum RMS Level',
      type: 'number',
      group: 'vad',
      min: 0.001,
      max: 0.1,
      step: 0.001,
      defaultValue: 0.015,
      description: 'Audio level threshold for speech detection.',
    },
    // LLM completion fields (enabled, shortTimeoutMs, longTimeoutMs) are managed
    // by the dedicated turn.llmCompletion section in voice.config.json, not providerSettings.
  ],
};

export class DecomposedAdapter implements ProviderAdapter {
  readonly id = 'decomposed' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private input: SessionInput | null = null;
  private options: DecomposedOptions | null = null;
  private state: VoiceState = 'idle';
  private connected = false;
  private history: ConversationEntry[] = [];

  private speechChunks: Uint8Array[] = [];
  private speechStartedAtMs: number | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private processingTurn = false;
  private interrupted = false;
  private assistantTurnQueue: Promise<void> = Promise.resolve();
  private deepgramTtsConnection: SpeakLiveClient | null = null;
  private deepgramTtsConnectionReady: Promise<SpeakLiveClient> | null = null;
  private deepgramTtsRequestQueue: Promise<void> = Promise.resolve();

  capabilities(): ProviderCapabilities {
    return DECOMPOSED_CAPABILITIES;
  }

  configSchema(): ProviderConfigSchema {
    return DECOMPOSED_CONFIG_SCHEMA;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.input = input;
    this.options = this.resolveOptions(input);
    console.log(`[DecomposedAdapter] Turn completion markers: ${this.options.llmCompletionEnabled ? 'enabled' : 'disabled'}`);
    this.history = [];
    this.speechChunks = [];
    this.speechStartedAtMs = null;
    this.processingTurn = false;
    this.interrupted = false;
    this.assistantTurnQueue = Promise.resolve();
    this.deepgramTtsRequestQueue = Promise.resolve();
    this.closeDeepgramTtsConnection();
    this.connected = true;

    this.setState('listening');
    this.events.emit('connected');

    return {
      providerInputRate: AUDIO_SAMPLE_RATE,
      providerOutputRate: AUDIO_SAMPLE_RATE,
      preferredClientInputRate: AUDIO_SAMPLE_RATE,
      preferredClientOutputRate: AUDIO_SAMPLE_RATE,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    this.clearSilenceTimer();
    this.clearCompletionTimer();
    this.connected = false;
    this.speechChunks = [];
    this.speechStartedAtMs = null;
    this.processingTurn = false;
    this.interrupted = false;
    this.assistantTurnQueue = Promise.resolve();
    this.deepgramTtsRequestQueue = Promise.resolve();
    this.closeDeepgramTtsConnection();
    this.setState('idle');
    this.events.emit('disconnected');
  }

  sendAudio(frame: AudioFrame): void {
    if (!this.connected || this.processingTurn || !this.options) return;

    const rms = computeRmsPcm16(frame.data);
    const hasSpeech = rms >= this.options.minRms;

    if (hasSpeech) {
      this.clearCompletionTimer();
      if (this.state === 'speaking') {
        this.interrupt();
      }
      if (this.speechStartedAtMs === null) {
        this.speechStartedAtMs = Date.now();
      }
      this.speechChunks.push(new Uint8Array(frame.data.slice(0)));
      this.clearSilenceTimer();
      return;
    }

    if (this.speechStartedAtMs !== null) {
      this.speechChunks.push(new Uint8Array(frame.data.slice(0)));
      if (!this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          void this.finalizeSpeechTurn();
        }, this.options.silenceMs);
      }
    }
  }

  sendText(text: string): void {
    if (!this.connected) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    void this.enqueueAssistantTurn(trimmed, {
      emitUserTranscript: false,
    });
  }

  interrupt(): void {
    this.interrupted = true;
    this.clearCompletionTimer();
    this.events.emit('audioInterrupted');
    this.setState('listening');
  }

  sendToolResult(_result: ToolCallResult): void {
    // Decomposed adapter currently does not expose provider-native tool callbacks.
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

  private clearSilenceTimer(): void {
    if (!this.silenceTimer) return;
    clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private clearCompletionTimer(): void {
    if (!this.completionTimer) return;
    console.log('[DecomposedAdapter] Re-engagement cancelled (user speech or interruption)');
    clearTimeout(this.completionTimer);
    this.completionTimer = null;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);
  }

  private emitLatency(metric: {
    stage: 'stt' | 'llm' | 'tts' | 'turn' | 'tool';
    durationMs: number;
    provider?: string;
    model?: string;
    details?: Record<string, unknown>;
  }): void {
    this.events.emit('latency', metric);
  }

  private async finalizeSpeechTurn(): Promise<void> {
    if (!this.options) return;
    const turnStartMs = Date.now();
    this.clearSilenceTimer();
    if (this.processingTurn) return;

    const joined = concatUint8Arrays(this.speechChunks);
    this.speechChunks = [];
    const speechStartedAtMs = this.speechStartedAtMs;
    this.speechStartedAtMs = null;
    if (!speechStartedAtMs || joined.byteLength === 0) return;

    const speechDurationMs = Math.floor((joined.byteLength / 2 / AUDIO_SAMPLE_RATE) * 1000);
    if (speechDurationMs < this.options.minSpeechMs) {
      return;
    }

    this.processingTurn = true;
    try {
      const sttStartMs = Date.now();
      const transcript = await this.transcribeAudio(joined);
      this.emitLatency({
        stage: 'stt',
        durationMs: Date.now() - sttStartMs,
        provider: this.options.sttProvider,
        model: this.options.sttModel,
        details: { transcriptChars: transcript.length },
      });

      if (!transcript) {
        this.setState('listening');
        return;
      }

      const userItemId = makeItemId('decomp-user');
      this.events.emit('userItemCreated', userItemId);
      this.events.emit('transcript', transcript, 'user', userItemId);

      await this.enqueueAssistantTurn(transcript, {
        emitUserTranscript: true,
        previousItemId: userItemId,
      });

      this.emitLatency({
        stage: 'turn',
        durationMs: Date.now() - turnStartMs,
        details: {
          speechDurationMs,
          transcriptChars: transcript.length,
        },
      });
    } catch (error) {
      this.events.emit('error', error as Error);
      this.setState('listening');
    } finally {
      this.processingTurn = false;
    }
  }

  private getHistoryItems(): VoiceHistoryItem[] {
    return this.history.map((entry) => ({
      id: entry.id,
      role: entry.role,
      text: entry.content,
      createdAt: Date.now(),
    }));
  }

  private async transcribeAudio(pcm: Uint8Array): Promise<string> {
    if (!this.options || !this.input) return '';
    this.setState('thinking');
    if (this.options.sttProvider === 'deepgram') {
      return this.transcribeWithDeepgram(pcm);
    }
    return this.transcribeWithOpenAI(pcm);
  }

  private async transcribeWithOpenAI(pcm: Uint8Array): Promise<string> {
    if (!this.options?.openaiApiKey) {
      throw new Error('OpenAI API key is missing for decomposed STT');
    }

    const wav = encodeWavPcm16Mono(pcm, AUDIO_SAMPLE_RATE);
    const form = new FormData();
    form.append('file', new File([wav], 'speech.wav', { type: 'audio/wav' }));
    form.append('model', this.options.sttModel);
    if (this.options.language) {
      form.append('language', this.options.language);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.openaiApiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI STT failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as { text?: string };
    return payload.text?.trim() ?? '';
  }

  private async transcribeWithDeepgram(pcm: Uint8Array): Promise<string> {
    if (!this.options?.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed STT');
    }

    const wav = encodeWavPcm16Mono(pcm, AUDIO_SAMPLE_RATE);
    const url = new URL('https://api.deepgram.com/v1/listen');
    url.searchParams.set('model', this.options.sttModel || 'nova-3');
    url.searchParams.set('language', this.options.language);
    url.searchParams.set('smart_format', 'true');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.options.deepgramApiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: wav,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepgram STT failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as DeepgramListenResponse;
    return payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
  }

  private async runAssistantTurn(
    text: string,
    options: { emitUserTranscript: boolean; previousItemId?: string }
  ): Promise<void> {
    if (!this.options || !this.input) return;

    const userId =
      options.emitUserTranscript && options.previousItemId
        ? options.previousItemId
        : makeItemId('decomp-context');
    const assistantId = makeItemId('decomp-assistant');

    if (options.emitUserTranscript) {
      this.history.push({ id: userId, role: 'user', content: text });
    } else {
      this.history.push({ id: userId, role: 'system', content: text });
    }
    this.events.emit('historyUpdated', this.getHistoryItems());

    this.setState('thinking');
    this.events.emit('assistantItemCreated', assistantId, options.previousItemId);
    this.events.emit('turnStarted');

    const systemPrompt = this.options.llmCompletionEnabled
      ? `${this.input.instructions}\n\n${TURN_COMPLETION_PROMPT}`
      : this.input.instructions;

    let marker: TurnMarker = '✓';
    let assistantText = '';
    let spokeWhileStreaming = false;
    let llmDurationMs = 0;

    try {
      const streamed = await this.generateAssistantResponseStreaming(systemPrompt, assistantId);
      assistantText = streamed.text;
      marker = streamed.marker;
      spokeWhileStreaming = streamed.spokeAudio;
      llmDurationMs = streamed.llmDurationMs;
    } catch (error) {
      this.events.emit('error', error as Error);
      this.setState('listening');
      return;
    }

    this.emitLatency({
      stage: 'llm',
      durationMs: llmDurationMs,
      provider: this.options.llmProvider,
      model: this.options.llmModel,
      details: { responseChars: assistantText.length },
    });

    if (this.options.llmCompletionEnabled && marker !== '✓') {
      this.scheduleIncompleteTurnReprompt(marker);
      this.setState('listening');
      return;
    }

    const finalText = assistantText.trim();
    if (!finalText) {
      this.setState('listening');
      return;
    }

    this.history.push({ id: assistantId, role: 'assistant', content: finalText });
    this.events.emit('historyUpdated', this.getHistoryItems());
    this.events.emit('transcript', finalText, 'assistant', assistantId);

    if (!spokeWhileStreaming && !this.interrupted) {
      await this.speak(finalText);
    }
    this.events.emit('turnComplete');
  }

  private enqueueAssistantTurn(
    text: string,
    options: { emitUserTranscript: boolean; previousItemId?: string }
  ): Promise<void> {
    const next = this.assistantTurnQueue.then(async () => {
      if (!this.connected) return;
      await this.runAssistantTurn(text, options);
    });
    this.assistantTurnQueue = next.catch(() => {});
    return next;
  }

  private async generateAssistantResponseStreaming(
    systemPrompt: string,
    assistantId: string
  ): Promise<{ marker: TurnMarker; text: string; spokeAudio: boolean; llmDurationMs: number }> {
    if (!this.options) {
      return { marker: '✓', text: '', spokeAudio: false, llmDurationMs: 0 };
    }

    if (this.toolsEnabled()) {
      return this.generateAssistantResponseWithTools(systemPrompt, assistantId);
    }

    // Create text stream; detect turn-completion marker when enabled
    const llmStartedAtMs = Date.now();
    let textStream: AsyncGenerator<string> = this.generateAssistantTextStream(systemPrompt);
    let marker: TurnMarker = '✓';

    if (this.options.llmCompletionEnabled) {
      const peek = await this.peekStreamForMarker(textStream);
      marker = peek.marker;
      if (marker !== '✓') {
        const label = marker === '○' ? 'incomplete-short' : 'incomplete-long';
        console.log(`[DecomposedAdapter] Turn marker: ${marker} (${label}) — suppressing response`);
        return { marker, text: '', spokeAudio: false, llmDurationMs: Date.now() - llmStartedAtMs };
      }
      console.log(`[DecomposedAdapter] Turn marker: ✓ (complete) — streaming response`);
      textStream = peek.stream;
    }

    if (this.options.ttsProvider === 'deepgram') {
      const request = this.deepgramTtsRequestQueue.then(() =>
        this.streamTextWithDeepgramTts(textStream, assistantId, llmStartedAtMs)
      );
      this.deepgramTtsRequestQueue = request.then(() => undefined).catch(() => undefined);
      const result = await request;
      return { ...result, marker };
    }

    const result = await this.streamTextWithInlineTts(textStream, assistantId, llmStartedAtMs);
    return { ...result, marker };
  }

  /**
   * Reads initial tokens from a text stream to detect a turn-completion marker.
   * Buffers until the first non-whitespace character, then:
   * - ✓ → strips marker, returns stream of remaining text
   * - ○/◐ → drains stream, returns empty stream
   * - No marker → treats as ✓, returns full stream
   */
  private async peekStreamForMarker(
    source: AsyncGenerator<string>
  ): Promise<{ marker: TurnMarker; stream: AsyncGenerator<string> }> {
    let buffer = '';

    while (true) {
      const { done, value } = await source.next();
      if (done) {
        const text = buffer.trimStart();
        return { marker: '✓', stream: singleValueGenerator(text) };
      }

      buffer += value;
      const trimmed = buffer.trimStart();
      if (trimmed.length === 0) continue;

      const first = trimmed[0] as string;
      if (TURN_MARKERS.includes(first as TurnMarker)) {
        const marker = first as TurnMarker;
        if (marker !== '✓') {
          // Incomplete turn — drain the stream so the HTTP response closes cleanly
          for await (const _ of source) { /* discard */ }
          return { marker, stream: emptyAsyncGenerator() };
        }
        const afterMarker = trimmed.slice(1).trimStart();
        return { marker: '✓', stream: prependToAsyncGenerator(afterMarker, source) };
      }

      // First character is not a marker — treat as complete
      return { marker: '✓', stream: prependToAsyncGenerator(buffer, source) };
    }
  }

  /**
   * Streams LLM text to TTS via the OpenAI-style segment queue (non-Deepgram path).
   */
  private async streamTextWithInlineTts(
    textStream: AsyncIterable<string>,
    assistantId: string,
    llmStartedAtMs: number
  ): Promise<{ text: string; spokeAudio: boolean; llmDurationMs: number }> {
    let assistantText = '';
    let speechBuffer = '';
    let segmentIndex = 0;
    let speaking = false;
    let spokeAudio = false;
    this.interrupted = false;

    let speakQueue: Promise<void> = Promise.resolve();
    const queueSegment = (segmentText: string): void => {
      const normalized = segmentText.trim();
      if (!normalized) return;
      const currentIndex = ++segmentIndex;
      speakQueue = speakQueue.then(async () => {
        if (this.interrupted || !this.connected) return;
        spokeAudio = true;
        await this.speakSegment(normalized, {
          segmentIndex: currentIndex,
          onFirstAudio: () => {
            if (!speaking) {
              this.setState('speaking');
              speaking = true;
            }
          },
        });
      });
    };

    for await (const delta of textStream) {
      if (!delta) continue;
      assistantText += delta;
      this.events.emit('transcriptDelta', delta, 'assistant', assistantId);
      speechBuffer += delta;
      const split = splitSpeakableText(speechBuffer);
      speechBuffer = split.remainder;
      for (const segment of split.segments) {
        queueSegment(segment);
      }
    }

    const trailing = speechBuffer.trim();
    if (trailing) {
      queueSegment(trailing);
    }

    const llmDurationMs = Date.now() - llmStartedAtMs;
    await speakQueue;

    if (speaking && !this.interrupted) {
      this.setState('listening');
    }

    return { text: assistantText, spokeAudio, llmDurationMs };
  }

  private async generateAssistantResponseWithTools(
    systemPrompt: string,
    assistantId: string
  ): Promise<{ marker: TurnMarker; text: string; spokeAudio: boolean; llmDurationMs: number }> {
    const llmStartedAtMs = Date.now();
    const rawText = await this.generateAssistantTextWithTools(systemPrompt);
    const { marker, text } = this.options?.llmCompletionEnabled
      ? parseMarker(rawText, true)
      : { marker: '✓' as TurnMarker, text: rawText };
    if (text) {
      this.events.emit('transcriptDelta', text, 'assistant', assistantId);
    }
    return {
      marker,
      text,
      spokeAudio: false,
      llmDurationMs: Date.now() - llmStartedAtMs,
    };
  }

  private async streamTextWithDeepgramTts(
    textStream: AsyncIterable<string>,
    assistantId: string,
    llmStartedAtMs: number
  ): Promise<{ text: string; spokeAudio: boolean; llmDurationMs: number }> {
    if (!this.options) {
      return { text: '', spokeAudio: false, llmDurationMs: 0 };
    }

    const connection = await this.ensureDeepgramTtsConnection();
    if (this.interrupted || !this.connected) {
      return { text: '', spokeAudio: false, llmDurationMs: 0 };
    }

    const ttsStartedAtMs = Date.now();
    let llmDurationMs = 0;
    let assistantText = '';
    let speaking = false;
    let spokeAudio = false;
    let pendingChars = 0;
    let expectedFlushes = 0;
    let receivedFlushes = 0;
    let sendingComplete = false;
    let settled = false;
    let aborted = false;
    let emittedAudioBytes = 0;
    let emittedChunks = 0;
    let firstAudioAtMs: number | null = null;
    let audioPipeline: Promise<void> = Promise.resolve();
    this.interrupted = false;

    await new Promise<void>((resolve, reject) => {
      const streamingTimeout = setTimeout(() => {
        this.closeDeepgramTtsConnection();
        rejectOnce(new Error('Deepgram websocket TTS streaming turn timed out'));
      }, 30000);

      const cleanup = (): void => {
        clearTimeout(streamingTimeout);
        connection.off(LiveTTSEvents.Audio, onAudio);
        connection.off(LiveTTSEvents.Flushed, onFlushed);
        connection.off(LiveTTSEvents.Warning, onWarning);
        connection.off(LiveTTSEvents.Close, onClose);
        connection.off(LiveTTSEvents.Error, onError);
      };

      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const maybeResolve = (): void => {
        if (settled) return;
        if (aborted) {
          resolveOnce();
          return;
        }
        if (!sendingComplete) {
          return;
        }
        if (receivedFlushes < expectedFlushes) {
          return;
        }
        void audioPipeline.then(() => resolveOnce()).catch((error) => {
          rejectOnce(error as Error);
        });
      };

      const emitChunk = async (chunk: ArrayBuffer): Promise<boolean> => {
        if (this.interrupted || !this.connected) {
          return false;
        }

        emittedAudioBytes += chunk.byteLength;
        emittedChunks += 1;
        if (firstAudioAtMs === null) {
          firstAudioAtMs = Date.now();
          if (!speaking) {
            this.setState('speaking');
            speaking = true;
          }
        }

        this.events.emit('audio', {
          data: chunk,
          sampleRate: AUDIO_SAMPLE_RATE,
          format: 'pcm16',
        });
        await sleep(20);
        return true;
      };

      const enqueueAudio = (payload: Uint8Array | ArrayBuffer): void => {
        audioPipeline = audioPipeline.then(async () => {
          const bytes =
            payload instanceof ArrayBuffer
              ? new Uint8Array(payload)
              : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
          const copied = new Uint8Array(bytes.byteLength);
          copied.set(bytes);
          const chunks = chunkArrayBuffer(copied.buffer, PCM_BYTES_PER_100MS);
          for (const chunk of chunks) {
            if (aborted) return;
            const keepGoing = await emitChunk(chunk);
            if (!keepGoing) {
              aborted = true;
              this.closeDeepgramTtsConnection();
              return;
            }
          }
        });
      };

      const requestFlush = (): void => {
        if (pendingChars <= 0) return;
        pendingChars = 0;
        expectedFlushes += 1;
        connection.flush();
      };

      const onAudio = (payload: unknown): void => {
        const binary = toRawDataUint8Array(payload);
        if (!binary || binary.byteLength === 0) return;
        enqueueAudio(binary);
      };

      const onFlushed = (): void => {
        receivedFlushes += 1;
        maybeResolve();
      };

      const onWarning = (event: unknown): void => {
        const warning = this.toDeepgramLiveError(event, 'Deepgram websocket TTS warning');
        this.events.emit('error', warning);
      };

      const onClose = (): void => {
        if (settled) return;
        if (this.interrupted || !this.connected) {
          resolveOnce();
          return;
        }
        rejectOnce(new Error('Deepgram websocket TTS closed before flush completed'));
      };

      const onError = (event: unknown): void => {
        if (settled) return;
        const error = this.toDeepgramLiveError(event, 'Deepgram websocket TTS error');
        this.closeDeepgramTtsConnection();
        rejectOnce(error);
      };

      connection.on(LiveTTSEvents.Audio, onAudio);
      connection.on(LiveTTSEvents.Flushed, onFlushed);
      connection.on(LiveTTSEvents.Warning, onWarning);
      connection.on(LiveTTSEvents.Close, onClose);
      connection.on(LiveTTSEvents.Error, onError);

      void (async () => {
        try {
          for await (const delta of textStream) {
            if (!delta) continue;
            assistantText += delta;
            this.events.emit('transcriptDelta', delta, 'assistant', assistantId);

            if (this.interrupted || !this.connected) {
              aborted = true;
              this.closeDeepgramTtsConnection();
              break;
            }

            connection.sendText(delta);
            spokeAudio = true;
            pendingChars += delta.length;

            if (shouldFlushDeepgramStream(delta, pendingChars, expectedFlushes)) {
              requestFlush();
            }
          }

          llmDurationMs = Date.now() - llmStartedAtMs;
          sendingComplete = true;

          if (!aborted && (pendingChars > 0 || expectedFlushes === 0)) {
            requestFlush();
          }

          maybeResolve();
        } catch (error) {
          this.closeDeepgramTtsConnection();
          rejectOnce(this.toDeepgramLiveError(error, 'Deepgram websocket TTS stream failed'));
        }
      })();
    });

    this.emitLatency({
      stage: 'tts',
      durationMs: Date.now() - ttsStartedAtMs,
      provider: this.options.ttsProvider,
      model: this.options.ttsModel || this.options.ttsVoice,
      details: {
        textChars: assistantText.length,
        audioBytes: emittedAudioBytes,
        chunks: emittedChunks,
        firstAudioLatencyMs:
          firstAudioAtMs === null ? null : Math.max(0, firstAudioAtMs - ttsStartedAtMs),
        streaming: true,
        flushes: expectedFlushes,
      },
    });

    if (!this.interrupted) {
      this.setState('listening');
    }

    return { text: assistantText, spokeAudio, llmDurationMs };
  }

  private async *generateAssistantTextStream(systemPrompt: string): AsyncGenerator<string> {
    if (!this.options) return;

    const response = await this.requestChatCompletionStream({
      messages: this.buildLlmMessages(systemPrompt),
      stream: true,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.options.llmProvider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} LLM failed (${response.status}): ${errorText}`
      );
    }

    if (!response.body) {
      const payload = (await response.json()) as ChatCompletionResponse;
      const fallback = extractChatCompletionText(payload);
      if (fallback) {
        yield fallback;
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;
          const payloadText = line.slice(5).trim();
          if (!payloadText || payloadText === '[DONE]') return;

          let chunk: ChatCompletionStreamChunk;
          try {
            chunk = JSON.parse(payloadText) as ChatCompletionStreamChunk;
          } catch {
            continue;
          }

          const deltaText = extractChatCompletionDeltaText(chunk);
          if (deltaText) {
            yield deltaText;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private toolsEnabled(): boolean {
    return Boolean(this.input?.toolHandler && this.input.tools && this.input.tools.length > 0);
  }

  private buildLlmMessages(systemPrompt: string): LlmMessage[] {
    return [
      { role: 'system', content: systemPrompt },
      ...this.history.map((entry) => ({
        role: entry.role === 'system' ? 'user' : entry.role,
        content: entry.content,
      })),
    ];
  }

  private getLlmTools(): LlmRequestTool[] {
    if (!this.toolsEnabled()) {
      return [];
    }
    const tools: ToolDefinition[] = this.input?.tools ?? [];
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? {},
      },
    }));
  }

  private async requestChatCompletion(
    body: Record<string, unknown>
  ): Promise<ChatCompletionResponse> {
    const response = await this.sendChatCompletionRequest(body);
    return (await response.json()) as ChatCompletionResponse;
  }

  private async requestChatCompletionStream(body: Record<string, unknown>): Promise<Response> {
    return this.sendChatCompletionRequest(body);
  }

  private async sendChatCompletionRequest(body: Record<string, unknown>): Promise<Response> {
    if (!this.options) {
      throw new Error('Decomposed LLM options are unavailable');
    }
    const { endpoint, apiKey } = this.resolveLlmEndpointAndKey();
    const payload: Record<string, unknown> = {
      model: this.options.llmModel,
      ...body,
    };

    if (typeof this.input?.temperature === 'number') {
      payload.temperature = this.input.temperature;
    }
    if (typeof this.input?.maxOutputTokens === 'number') {
      payload.max_tokens = this.input.maxOutputTokens;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.options.llmProvider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} LLM failed (${response.status}): ${errorText}`
      );
    }

    return response;
  }

  private async generateAssistantTextWithTools(systemPrompt: string): Promise<string> {
    if (!this.options) return '';

    const messages: LlmMessage[] = this.buildLlmMessages(systemPrompt);
    const tools = this.getLlmTools();
    if (tools.length === 0 || !this.input?.toolHandler) {
      const payload = await this.requestChatCompletion({ messages });
      return extractChatCompletionText(payload);
    }

    const maxToolRounds = 6;

    for (let round = 0; round < maxToolRounds; round += 1) {
      const payload = await this.requestChatCompletion({
        messages,
        tools,
        tool_choice: 'auto',
      });
      const message = payload.choices?.[0]?.message;
      if (!message) {
        return '';
      }

      const assistantText = extractChatCompletionMessageText(message);
      const toolCalls = sanitizeToolCalls(message.tool_calls);
      if (toolCalls.length === 0) {
        return assistantText.trim();
      }

      messages.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const callId = typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : makeItemId('tool');
        const functionName = toolCall.function?.name?.trim() ?? '';
        const rawArguments = toolCall.function?.arguments ?? '{}';
        const parsedArguments = parseToolArgs(rawArguments);
        this.events.emit('toolStart', functionName || 'unknown_tool', parsedArguments, callId);

        const result = await this.invokeToolHandler(functionName, parsedArguments, callId);
        this.events.emit('toolEnd', functionName || 'unknown_tool', result.result, callId);

        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: result.result,
        });
      }
    }

    throw new Error('Decomposed LLM exceeded maximum tool-call rounds');
  }

  private async invokeToolHandler(
    toolName: string,
    args: Record<string, unknown>,
    callId: string
  ): Promise<ToolCallResult> {
    if (!this.input?.toolHandler) {
      return {
        invocationId: callId,
        result: `Tool handler is not configured (tool: ${toolName || 'unknown'})`,
        isError: true,
      };
    }
    if (!toolName) {
      return {
        invocationId: callId,
        result: 'Tool name is missing in model function call',
        isError: true,
      };
    }

    const startedAtMs = Date.now();
    try {
      const context: ToolCallContext = {
        providerId: this.id,
        callId,
        invocationId: callId,
        history: this.getHistoryItems(),
      };
      const rawResult = await this.input.toolHandler(toolName, args, context);
      const normalized = this.normalizeToolResult(callId, rawResult);
      this.emitLatency({
        stage: 'tool',
        durationMs: Date.now() - startedAtMs,
        provider: this.options?.llmProvider,
        model: this.options?.llmModel,
        details: { toolName, callId, isError: normalized.isError === true },
      });
      return normalized;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Tool execution failed';
      this.emitLatency({
        stage: 'tool',
        durationMs: Date.now() - startedAtMs,
        provider: this.options?.llmProvider,
        model: this.options?.llmModel,
        details: { toolName, callId, isError: true, message },
      });
      return {
        invocationId: callId,
        result: `Tool ${toolName} failed: ${message}`,
        isError: true,
        errorMessage: message,
      };
    }
  }

  private normalizeToolResult(callId: string, result: ToolCallResult | string): ToolCallResult {
    if (typeof result === 'string') {
      return {
        invocationId: callId,
        result,
      };
    }

    const resultText =
      typeof result.result === 'string' ? result.result : safeStringify(result.result);

    return {
      ...result,
      invocationId: callId,
      result: resultText,
    };
  }

  private resolveLlmEndpointAndKey(): { endpoint: string; apiKey: string } {
    if (!this.options) {
      throw new Error('Decomposed LLM options are unavailable');
    }
    const endpoint =
      this.options.llmProvider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
    const apiKey =
      this.options.llmProvider === 'openrouter'
        ? this.options.openrouterApiKey
        : this.options.openaiApiKey;

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.options.llmProvider} decomposed LLM provider`);
    }

    return { endpoint, apiKey };
  }

  private scheduleIncompleteTurnReprompt(marker: TurnMarker): void {
    if (!this.options || !this.connected || this.processingTurn) return;
    this.clearCompletionTimer();

    const timeoutMs = marker === '○' ? this.options.llmShortTimeoutMs : this.options.llmLongTimeoutMs;
    const reprompt = marker === '○' ? this.options.llmShortReprompt : this.options.llmLongReprompt;

    console.log(`[DecomposedAdapter] Scheduling re-engagement in ${timeoutMs}ms (marker: ${marker}, reprompt: "${reprompt}")`);

    this.completionTimer = setTimeout(() => {
      if (!this.connected || this.processingTurn) return;
      console.log(`[DecomposedAdapter] Re-engagement fired — reprompting with: "${reprompt}"`);
      void this.runAssistantTurn(reprompt, {
        emitUserTranscript: false,
      });
    }, timeoutMs);
  }

  private async speak(text: string): Promise<void> {
    if (!this.options) return;
    this.interrupted = false;
    this.setState('speaking');
    await this.speakSegment(text);

    if (!this.interrupted) {
      this.setState('listening');
    }
  }

  private async speakSegment(
    text: string,
    details?: {
      segmentIndex?: number;
      onFirstAudio?: () => void;
    }
  ): Promise<void> {
    if (!this.options) return;
    const ttsStartMs = Date.now();
    const { onFirstAudio, ...latencyDetails } = details ?? {};
    let emittedAudioBytes = 0;
    let emittedChunks = 0;
    let firstAudioAtMs: number | null = null;

    const emitChunk = async (chunk: ArrayBuffer): Promise<boolean> => {
      if (this.interrupted || !this.connected) {
        return false;
      }
      emittedAudioBytes += chunk.byteLength;
      emittedChunks += 1;
      if (firstAudioAtMs === null) {
        firstAudioAtMs = Date.now();
        onFirstAudio?.();
      }
      this.events.emit('audio', {
        data: chunk,
        sampleRate: AUDIO_SAMPLE_RATE,
        format: 'pcm16',
      });
      await sleep(20);
      return true;
    };

    if (this.options.ttsProvider === 'deepgram') {
      await this.speakWithDeepgram(text, emitChunk);
    } else {
      await this.speakWithOpenAI(text, emitChunk);
    }

    this.emitLatency({
      stage: 'tts',
      durationMs: Date.now() - ttsStartMs,
      provider: this.options.ttsProvider,
      model: this.options.ttsModel || this.options.ttsVoice,
      details: {
        textChars: text.length,
        audioBytes: emittedAudioBytes,
        chunks: emittedChunks,
        firstAudioLatencyMs:
          firstAudioAtMs === null ? null : Math.max(0, firstAudioAtMs - ttsStartMs),
        ...latencyDetails,
      },
    });
  }

  private async speakWithOpenAI(
    text: string,
    emitChunk: (chunk: ArrayBuffer) => Promise<boolean>
  ): Promise<void> {
    if (!this.options?.openaiApiKey) {
      throw new Error('OpenAI API key is missing for decomposed TTS');
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.ttsModel,
        voice: this.options.ttsVoice,
        input: text,
        response_format: 'pcm',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS failed (${response.status}): ${errorText}`);
    }

    await this.streamTtsPcmResponse(response, emitChunk);
  }

  private async speakWithDeepgram(
    text: string,
    emitChunk: (chunk: ArrayBuffer) => Promise<boolean>
  ): Promise<void> {
    if (!this.options) {
      return;
    }
    if (!this.options.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed TTS');
    }
    if (this.options.deepgramTtsTransport !== 'websocket') {
      throw new Error('Decomposed Deepgram TTS requires websocket transport (no HTTP fallback).');
    }

    const request = this.deepgramTtsRequestQueue.then(async () => {
      await this.speakWithDeepgramLiveSegment(text, emitChunk);
    });
    this.deepgramTtsRequestQueue = request.catch(() => {});
    await request;
  }

  private async streamTtsPcmResponse(
    response: Response,
    emitChunk: (chunk: ArrayBuffer) => Promise<boolean>
  ): Promise<void> {
    if (!response.body) {
      const audio = await response.arrayBuffer();
      const chunks = chunkArrayBuffer(audio, PCM_BYTES_PER_100MS);
      for (const chunk of chunks) {
        const keepGoing = await emitChunk(chunk);
        if (!keepGoing) {
          break;
        }
      }
      return;
    }

    const reader = response.body.getReader();
    let pending = new Uint8Array(0);

    const appendPending = (value: Uint8Array): void => {
      if (value.byteLength === 0) return;
      if (pending.byteLength === 0) {
        pending = value.slice();
        return;
      }
      const merged = new Uint8Array(pending.byteLength + value.byteLength);
      merged.set(pending, 0);
      merged.set(value, pending.byteLength);
      pending = merged;
    };

    const flushPending = async (force: boolean): Promise<boolean> => {
      while (pending.byteLength >= PCM_BYTES_PER_100MS || (force && pending.byteLength > 0)) {
        const chunkSize =
          pending.byteLength >= PCM_BYTES_PER_100MS
            ? PCM_BYTES_PER_100MS
            : pending.byteLength;
        const chunk = pending.slice(0, chunkSize);
        pending = pending.slice(chunkSize);
        const keepGoing = await emitChunk(chunk.buffer);
        if (!keepGoing) {
          return false;
        }
      }
      return true;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }
        appendPending(value);
        const keepGoing = await flushPending(false);
        if (!keepGoing) {
          await reader.cancel();
          break;
        }
      }
      await flushPending(true);
    } finally {
      reader.releaseLock();
    }
  }

  private async speakWithDeepgramLiveSegment(
    text: string,
    emitChunk: (chunk: ArrayBuffer) => Promise<boolean>
  ): Promise<void> {
    const connection = await this.ensureDeepgramTtsConnection();
    if (this.interrupted || !this.connected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let flushReceived = false;
      let aborted = false;
      let audioPipeline: Promise<void> = Promise.resolve();
      const segmentTimeout = setTimeout(() => {
        this.closeDeepgramTtsConnection();
        rejectOnce(new Error('Deepgram websocket TTS segment timed out waiting for flush'));
      }, 10000);

      const cleanup = (): void => {
        clearTimeout(segmentTimeout);
        connection.off(LiveTTSEvents.Audio, onAudio);
        connection.off(LiveTTSEvents.Flushed, onFlushed);
        connection.off(LiveTTSEvents.Warning, onWarning);
        connection.off(LiveTTSEvents.Close, onClose);
        connection.off(LiveTTSEvents.Error, onError);
      };

      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const maybeResolve = (): void => {
        if (settled) return;
        if (aborted) {
          resolveOnce();
          return;
        }
        if (!flushReceived) {
          return;
        }
        void audioPipeline.then(() => resolveOnce()).catch((error) => {
          rejectOnce(error as Error);
        });
      };

      const enqueueAudio = (payload: ArrayBuffer | Uint8Array): void => {
        audioPipeline = audioPipeline.then(async () => {
          const bytes =
            payload instanceof ArrayBuffer
              ? new Uint8Array(payload)
              : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
          const copied = new Uint8Array(bytes.byteLength);
          copied.set(bytes);
          const audioBuffer = copied.buffer;

          const chunks = chunkArrayBuffer(audioBuffer, PCM_BYTES_PER_100MS);
          for (const chunk of chunks) {
            if (aborted) return;
            const keepGoing = await emitChunk(chunk);
            if (!keepGoing) {
              aborted = true;
              this.closeDeepgramTtsConnection();
              return;
            }
          }
        });
      };

      const onAudio = (payload: unknown): void => {
        const binary = toRawDataUint8Array(payload);
        if (binary) {
          enqueueAudio(binary);
        }
      };

      const onFlushed = (): void => {
        flushReceived = true;
        maybeResolve();
      };

      const onWarning = (event: unknown): void => {
        if (settled) return;
        const error = this.toDeepgramLiveError(event, 'Deepgram websocket TTS warning');
        this.closeDeepgramTtsConnection();
        rejectOnce(error);
      };

      const onClose = (): void => {
        if (settled) return;
        if (this.interrupted || !this.connected) {
          resolveOnce();
          return;
        }
        rejectOnce(new Error('Deepgram websocket TTS closed before flush completed'));
      };

      const onError = (event: unknown): void => {
        if (settled) return;
        const error = this.toDeepgramLiveError(event, 'Deepgram websocket TTS error');
        this.closeDeepgramTtsConnection();
        rejectOnce(error);
      };

      connection.on(LiveTTSEvents.Audio, onAudio);
      connection.on(LiveTTSEvents.Flushed, onFlushed);
      connection.on(LiveTTSEvents.Warning, onWarning);
      connection.on(LiveTTSEvents.Close, onClose);
      connection.on(LiveTTSEvents.Error, onError);

      try {
        connection.sendText(text);
        connection.flush();
      } catch (error) {
        this.closeDeepgramTtsConnection();
        rejectOnce(this.toDeepgramLiveError(error, 'Deepgram websocket TTS send failed'));
        return;
      }
    });
  }

  private async ensureDeepgramTtsConnection(): Promise<SpeakLiveClient> {
    if (!this.options?.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed TTS');
    }

    if (this.deepgramTtsConnection && this.deepgramTtsConnection.isConnected()) {
      return this.deepgramTtsConnection;
    }

    if (this.deepgramTtsConnectionReady) {
      return this.deepgramTtsConnectionReady;
    }

    const connectPromise = new Promise<SpeakLiveClient>((resolve, reject) => {
      if (!this.options?.deepgramApiKey) {
        reject(new Error('Deepgram API key is missing for decomposed TTS'));
        return;
      }

      const connectionTimeout = setTimeout(() => {
        this.closeDeepgramTtsConnection();
        rejectOnce(new Error('Deepgram websocket TTS connect timed out'));
      }, 10000);

      const model = this.options.ttsModel || this.options.ttsVoice;
      const connection = this.createDeepgramTtsConnection(
        this.options.deepgramApiKey,
        model,
        this.options.deepgramTtsWsUrl
      );

      let settled = false;
      const cleanup = (): void => {
        clearTimeout(connectionTimeout);
        connection.off(LiveTTSEvents.Open, onOpen);
        connection.off(LiveTTSEvents.Error, onError);
        connection.off(LiveTTSEvents.Close, onCloseBeforeOpen);
      };

      const resolveOnce = (client: SpeakLiveClient): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(client);
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onOpen = (): void => {
        this.deepgramTtsConnection = connection;

        connection.on(LiveTTSEvents.Close, () => {
          if (this.deepgramTtsConnection === connection) {
            this.deepgramTtsConnection = null;
          }
        });

        resolveOnce(connection);
      };

      const onError = (event: unknown): void => {
        rejectOnce(this.toDeepgramLiveError(event, 'Deepgram websocket TTS connect failed'));
      };

      const onCloseBeforeOpen = (): void => {
        rejectOnce(new Error('Deepgram websocket TTS closed before open'));
      };

      connection.once(LiveTTSEvents.Open, onOpen);
      connection.once(LiveTTSEvents.Error, onError);
      connection.once(LiveTTSEvents.Close, onCloseBeforeOpen);
    });

    this.deepgramTtsConnectionReady = connectPromise;
    try {
      return await connectPromise;
    } finally {
      if (this.deepgramTtsConnectionReady === connectPromise) {
        this.deepgramTtsConnectionReady = null;
      }
    }
  }

  private closeDeepgramTtsConnection(): void {
    const connection = this.deepgramTtsConnection;
    this.deepgramTtsConnection = null;
    this.deepgramTtsConnectionReady = null;
    if (!connection) return;
    try {
      connection.requestClose();
    } catch {
      // ignore close-send failures
    }
    try {
      connection.disconnect();
    } catch {
      // ignore close failures
    }
  }

  private createDeepgramTtsConnection(
    apiKey: string,
    model: string,
    endpoint: string
  ): SpeakLiveClient {
    const deepgram = createClient({
      key: apiKey,
    });
    return deepgram.speak.live(
      {
        model,
        encoding: 'linear16',
        sample_rate: AUDIO_SAMPLE_RATE,
        container: 'none',
      },
      endpoint
    );
  }

  private toDeepgramLiveError(event: unknown, fallback: string): Error {
    if (event instanceof Error) {
      return event;
    }

    const object = event as { message?: unknown; description?: unknown; code?: unknown } | null;
    if (object && typeof object === 'object') {
      const message =
        typeof object.message === 'string'
          ? object.message
          : typeof object.description === 'string'
            ? object.description
            : null;
      const code = typeof object.code === 'string' ? object.code : null;
      if (message && code) {
        return new Error(`${message} (code: ${code})`);
      }
      if (message) {
        return new Error(message);
      }
    }

    return new Error(fallback);
  }

  private resolveOptions(input: SessionInput): DecomposedOptions {
    const providerConfig: DecomposedProviderConfig = parseDecomposedProviderConfig(
      input.providerConfig
    );
    const ttsProvider = providerConfig.ttsProvider ?? 'openai';
    const ttsModel =
      providerConfig.ttsModel ?? (ttsProvider === 'deepgram' ? 'aura-2-thalia-en' : 'gpt-4o-mini-tts');

    return {
      sttProvider: providerConfig.sttProvider ?? 'openai',
      sttModel: providerConfig.sttModel ?? 'gpt-4o-mini-transcribe',
      llmProvider: providerConfig.llmProvider ?? 'openai',
      llmModel: providerConfig.llmModel ?? input.model,
      ttsProvider,
      ttsModel,
      ttsVoice: providerConfig.ttsVoice ?? input.voice,
      deepgramTtsTransport: providerConfig.deepgramTtsTransport ?? 'websocket',
      deepgramTtsWsUrl: providerConfig.deepgramTtsWsUrl ?? 'wss://api.deepgram.com/v1/speak',
      silenceMs: providerConfig.turn?.silenceMs ?? 700,
      minSpeechMs: providerConfig.turn?.minSpeechMs ?? 350,
      minRms: providerConfig.turn?.minRms ?? 0.015,
      llmCompletionEnabled: providerConfig.turn?.llmCompletionEnabled ?? false,
      llmShortTimeoutMs: providerConfig.turn?.llmShortTimeoutMs ?? 5000,
      llmLongTimeoutMs: providerConfig.turn?.llmLongTimeoutMs ?? 10000,
      llmShortReprompt:
        providerConfig.turn?.llmShortReprompt ??
        'Can you finish that thought for me?',
      llmLongReprompt:
        providerConfig.turn?.llmLongReprompt ??
        "I'm still here. Continue when you're ready.",
      language: input.language ?? 'en',
      openaiApiKey: providerConfig.openaiApiKey,
      openrouterApiKey: providerConfig.openrouterApiKey,
      deepgramApiKey: providerConfig.deepgramApiKey,
    };
  }
}

function toRawDataUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    const views: Uint8Array[] = [];
    let total = 0;
    for (const part of value) {
      if (part instanceof Uint8Array) {
        views.push(part);
        total += part.byteLength;
      } else if (ArrayBuffer.isView(part)) {
        const view = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
        views.push(view);
        total += view.byteLength;
      } else if (part instanceof ArrayBuffer) {
        const view = new Uint8Array(part);
        views.push(view);
        total += view.byteLength;
      }
    }
    if (views.length === 0) return null;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const view of views) {
      merged.set(view, offset);
      offset += view.byteLength;
    }
    return merged;
  }
  return null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = parseJsonObject(raw);
  if (parsed) return parsed;
  return { raw };
}

function sanitizeToolCalls(value: ChatCompletionToolCall[] | undefined): ChatCompletionToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ChatCompletionToolCall[] = [];
  for (const call of value) {
    if (!call || typeof call !== 'object') continue;
    const name = call.function?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    calls.push(call);
  }
  return calls;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized;
    }
    return String(value);
  } catch {
    return String(value);
  }
}

async function* emptyAsyncGenerator(): AsyncGenerator<string> {
  // yields nothing
}

async function* singleValueGenerator(value: string): AsyncGenerator<string> {
  if (value) yield value;
}

async function* prependToAsyncGenerator(
  prefix: string,
  source: AsyncIterable<string>
): AsyncGenerator<string> {
  if (prefix) yield prefix;
  yield* source;
}

function parseMarker(
  text: string,
  markerMode: boolean
): { marker: TurnMarker; text: string } {
  const trimmed = text.trim();
  if (!markerMode || trimmed.length === 0) {
    return {
      marker: '✓',
      text: trimmed,
    };
  }

  const marker = trimmed[0] as TurnMarker;
  if (!TURN_MARKERS.includes(marker)) {
    return {
      marker: '✓',
      text: trimmed,
    };
  }

  return {
    marker,
    text: trimmed.slice(1).trimStart(),
  };
}

function makeItemId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function computeRmsPcm16(input: ArrayBuffer): number {
  const bytes = new DataView(input);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = bytes.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function encodeWavPcm16Mono(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const headerSize = 44;
  const wav = new ArrayBuffer(headerSize + pcm.byteLength);
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);

  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, headerSize);

  return wav;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    target[offset + i] = value.charCodeAt(i);
  }
}

function chunkArrayBuffer(input: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
  const bytes = new Uint8Array(input);
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.byteLength);
    chunks.push(bytes.slice(offset, end).buffer);
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractChatCompletionText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function extractChatCompletionMessageText(message: ChatCompletionMessage): string {
  const content = message.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function extractChatCompletionDeltaText(chunk: ChatCompletionStreamChunk): string {
  const content = chunk.choices?.[0]?.delta?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

function splitSpeakableText(buffer: string): { segments: string[]; remainder: string } {
  if (!buffer) {
    return { segments: [], remainder: '' };
  }

  const segments: string[] = [];
  let start = 0;
  let candidate = -1;
  const minSegmentChars = 16;
  const earlySegmentChars = 8;
  const whitespaceSegmentChars = 18;
  const forceFlushChars = 72;
  const firstSegmentForceFlushChars = 28;

  const pushSegment = (endExclusive: number): void => {
    const raw = buffer.slice(start, endExclusive).trim();
    if (raw.length > 0) {
      segments.push(raw);
    }
    start = endExclusive;
    candidate = -1;
  };

  for (let i = 0; i < buffer.length; i += 1) {
    const char = buffer[i];
    if (char === '.' || char === '!' || char === '?' || char === ';' || char === '\n') {
      candidate = i + 1;
    } else if ((char === ',' || char === ':') && i + 1 - start >= 28) {
      candidate = i + 1;
    } else if (char === ' ' && i + 1 - start >= whitespaceSegmentChars) {
      candidate = i + 1;
    }

    const minCharsForSplit = segments.length === 0 ? earlySegmentChars : minSegmentChars;
    if (candidate > start && candidate - start >= minCharsForSplit) {
      pushSegment(candidate);
      continue;
    }

    const forceLimit = segments.length === 0 ? firstSegmentForceFlushChars : forceFlushChars;
    if (i + 1 - start >= forceLimit) {
      let splitAt = buffer.lastIndexOf(' ', i);
      if (splitAt <= start) {
        splitAt = i;
      }
      pushSegment(splitAt + 1);
    }
  }

  const remainder = buffer.slice(start);
  return { segments, remainder };
}

function shouldFlushDeepgramStream(
  delta: string,
  pendingChars: number,
  completedFlushes: number
): boolean {
  if (pendingChars <= 0) return false;

  const hasSentenceBoundary = /[.!?;\n]/.test(delta);
  const hasMinorBoundary = /[,]/.test(delta);
  const boundaryThreshold = completedFlushes === 0 ? 24 : 64;

  if (hasSentenceBoundary && pendingChars >= boundaryThreshold) {
    return true;
  }
  if (hasMinorBoundary && pendingChars >= 96) {
    return true;
  }
  if (pendingChars >= 180) {
    return true;
  }

  return false;
}
