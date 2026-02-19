import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import type {
  AudioFrame,
  AudioNegotiation,
  EventHandler,
  ProviderAdapter,
  ProviderCapabilities,
  SessionInput,
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

interface DecomposedProviderConfig {
  openaiApiKey?: string;
  openrouterApiKey?: string;
  deepgramApiKey?: string;

  sttProvider?: 'openai' | 'deepgram';
  sttModel?: string;

  llmProvider?: 'openai' | 'openrouter';
  llmModel?: string;

  ttsProvider?: 'openai' | 'deepgram';
  ttsModel?: string;
  ttsVoice?: string;

  turn?: {
    silenceMs?: number;
    minSpeechMs?: number;
    minRms?: number;
    llmCompletionEnabled?: boolean;
    llmShortTimeoutMs?: number;
    llmLongTimeoutMs?: number;
    llmShortReprompt?: string;
    llmLongReprompt?: string;
  };
}

interface DecomposedOptions {
  sttProvider: 'openai' | 'deepgram';
  sttModel: string;
  llmProvider: 'openai' | 'openrouter';
  llmModel: string;
  ttsProvider: 'openai' | 'deepgram';
  ttsModel: string;
  ttsVoice: string;
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
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

const TURN_COMPLETION_PROMPT = [
  'You must start every response with exactly one marker character:',
  '✓ when the user turn is complete and you should answer now.',
  '○ when the user seems to have paused mid-thought and likely continues soon.',
  '◐ when the user seems to be thinking and may continue after a longer pause.',
  'If you use ○ or ◐, do not include any extra text after the marker.',
  'Never explain the marker. Never output more than one marker.',
].join('\n');

const DECOMPOSED_CAPABILITIES: ProviderCapabilities = {
  toolCalling: false,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['http'],
  audioNegotiation: false,
  vadModes: ['manual'],
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

interface ConversationEntry {
  id: string;
  role: ConversationRole;
  content: string;
}

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

  capabilities(): ProviderCapabilities {
    return DECOMPOSED_CAPABILITIES;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.input = input;
    this.options = this.resolveOptions(input);
    this.history = [];
    this.speechChunks = [];
    this.speechStartedAtMs = null;
    this.processingTurn = false;
    this.interrupted = false;
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
    void this.runAssistantTurn(trimmed, {
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
    clearTimeout(this.completionTimer);
    this.completionTimer = null;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);
  }

  private emitLatency(metric: {
    stage: 'stt' | 'llm' | 'tts' | 'turn';
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

      await this.runAssistantTurn(transcript, {
        emitUserTranscript: true,
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
    options: { emitUserTranscript: boolean }
  ): Promise<void> {
    if (!this.options || !this.input) return;

    const userId = makeItemId('decomp-context');
    const assistantId = makeItemId('decomp-assistant');

    if (options.emitUserTranscript) {
      this.history.push({ id: userId, role: 'user', content: text });
    } else {
      this.history.push({ id: userId, role: 'system', content: text });
    }
    this.events.emit('historyUpdated', this.getHistoryItems());

    this.setState('thinking');
    this.events.emit('assistantItemCreated', assistantId);
    this.events.emit('turnStarted');

    const llmStartMs = Date.now();
    const systemPrompt = this.options.llmCompletionEnabled
      ? `${this.input.instructions}\n\n${TURN_COMPLETION_PROMPT}`
      : this.input.instructions;

    let marker: TurnMarker = '✓';
    let assistantText = '';

    try {
      const responseText = await this.generateAssistantText(systemPrompt);
      const parsed = parseMarker(responseText, this.options.llmCompletionEnabled);
      marker = parsed.marker;
      assistantText = parsed.text;

      if (assistantText) {
        this.events.emit('transcriptDelta', assistantText, 'assistant', assistantId);
      }

      this.emitLatency({
        stage: 'llm',
        durationMs: Date.now() - llmStartMs,
        provider: this.options.llmProvider,
        model: this.options.llmModel,
        details: { responseChars: assistantText.length },
      });
    } catch (error) {
      this.events.emit('error', error as Error);
      this.setState('listening');
      return;
    }

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

    await this.speak(finalText);
    this.events.emit('turnComplete');
  }

  private async generateAssistantText(systemPrompt: string): Promise<string> {
    if (!this.options) return '';

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.history.map((entry) => ({
        role: entry.role === 'system' ? 'user' : entry.role,
        content: entry.content,
      })),
    ];

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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.llmModel,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.options.llmProvider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} LLM failed (${response.status}): ${errorText}`
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }

  private scheduleIncompleteTurnReprompt(marker: TurnMarker): void {
    if (!this.options || !this.connected || this.processingTurn) return;
    this.clearCompletionTimer();

    const timeoutMs = marker === '○' ? this.options.llmShortTimeoutMs : this.options.llmLongTimeoutMs;
    const reprompt = marker === '○' ? this.options.llmShortReprompt : this.options.llmLongReprompt;

    this.completionTimer = setTimeout(() => {
      if (!this.connected || this.processingTurn) return;
      void this.runAssistantTurn(reprompt, {
        emitUserTranscript: false,
      });
    }, timeoutMs);
  }

  private async speak(text: string): Promise<void> {
    if (!this.options) return;
    this.interrupted = false;
    this.setState('speaking');
    const ttsStartMs = Date.now();

    let audio: ArrayBuffer;
    if (this.options.ttsProvider === 'deepgram') {
      audio = await this.speakWithDeepgram(text);
    } else {
      audio = await this.speakWithOpenAI(text);
    }

    const chunks = chunkArrayBuffer(audio, PCM_BYTES_PER_100MS);
    this.emitLatency({
      stage: 'tts',
      durationMs: Date.now() - ttsStartMs,
      provider: this.options.ttsProvider,
      model: this.options.ttsModel || this.options.ttsVoice,
      details: {
        textChars: text.length,
        audioBytes: audio.byteLength,
        chunks: chunks.length,
      },
    });

    for (const chunk of chunks) {
      if (this.interrupted || !this.connected) break;
      this.events.emit('audio', {
        data: chunk,
        sampleRate: AUDIO_SAMPLE_RATE,
        format: 'pcm16',
      });
      await sleep(20);
    }

    if (!this.interrupted) {
      this.setState('listening');
    }
  }

  private async speakWithOpenAI(text: string): Promise<ArrayBuffer> {
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

    return response.arrayBuffer();
  }

  private async speakWithDeepgram(text: string): Promise<ArrayBuffer> {
    if (!this.options?.deepgramApiKey) {
      throw new Error('Deepgram API key is missing for decomposed TTS');
    }

    const model = this.options.ttsModel || this.options.ttsVoice;
    const url = new URL('https://api.deepgram.com/v1/speak');
    url.searchParams.set('model', model);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(AUDIO_SAMPLE_RATE));
    url.searchParams.set('container', 'none');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.options.deepgramApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepgram TTS failed (${response.status}): ${errorText}`);
    }

    return response.arrayBuffer();
  }

  private resolveOptions(input: SessionInput): DecomposedOptions {
    const providerConfig = (input.providerConfig as DecomposedProviderConfig | undefined) ?? {};

    return {
      sttProvider: providerConfig.sttProvider ?? 'openai',
      sttModel: providerConfig.sttModel ?? 'gpt-4o-mini-transcribe',
      llmProvider: providerConfig.llmProvider ?? 'openai',
      llmModel: providerConfig.llmModel ?? input.model,
      ttsProvider: providerConfig.ttsProvider ?? 'openai',
      ttsModel: providerConfig.ttsModel ?? 'gpt-4o-mini-tts',
      ttsVoice: providerConfig.ttsVoice ?? input.voice,
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
