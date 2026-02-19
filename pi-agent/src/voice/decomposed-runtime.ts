import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, type CoreMessage } from 'ai';
import type { AgentProfile } from '../agent/profiles.js';
import { config } from '../config.js';
import {
  arrayBufferToBuffer,
  chunkBuffer,
  computeRmsPcm16,
  encodeWavPcm16Mono,
} from './audio-utils.js';
import type {
  AgentState,
  VoiceRuntime,
  VoiceRuntimeAudio,
  VoiceRuntimeConfig,
  VoiceRuntimeEvents,
  VoiceRuntimeHistoryItem,
} from './types.js';

const AUDIO_SAMPLE_RATE = 24000;
const PCM_BYTES_PER_100MS = (AUDIO_SAMPLE_RATE * 2) / 10;
const TURN_MARKERS = ['✓', '○', '◐'] as const;

type TurnMarker = (typeof TURN_MARKERS)[number];
type ConversationRole = 'user' | 'assistant' | 'system';

interface ConversationEntry {
  id: string;
  role: ConversationRole;
  content: string;
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

const TURN_COMPLETION_PROMPT = [
  'You must start every response with exactly one marker character:',
  '✓ when the user turn is complete and you should answer now.',
  '○ when the user seems to have paused mid-thought and likely continues soon.',
  '◐ when the user seems to be thinking and may continue after a longer pause.',
  'If you use ○ or ◐, do not include any extra text after the marker.',
  'Never explain the marker. Never output more than one marker.',
].join('\n');

/**
 * Decomposed runtime with configurable STT/LLM/TTS providers.
 * Supports pipecat-style turn completion markers on the LLM layer.
 */
export class DecomposedRuntime implements VoiceRuntime {
  readonly mode = 'decomposed' as const;
  readonly provider = 'decomposed' as const;

  private readonly profile: AgentProfile;
  private readonly runtimeConfig: VoiceRuntimeConfig;
  private readonly openai: OpenAI;
  private state: AgentState = 'idle';
  private connected = false;
  private eventHandlers: Partial<VoiceRuntimeEvents> = {};
  private history: ConversationEntry[] = [];

  private currentSpeech: Buffer[] = [];
  private speechStartedAtMs: number | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private processingTurn = false;
  private isInterrupted = false;

  constructor(profile: AgentProfile, runtimeConfig: VoiceRuntimeConfig) {
    this.profile = profile;
    this.runtimeConfig = runtimeConfig;
    this.openai = new OpenAI({
      apiKey: runtimeConfig.auth.openaiApiKey || config.openai.apiKey,
    });
  }

  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  connect(): Promise<void> {
    this.connected = true;
    this.setState('listening');
    this.emit('connected');

    if (this.profile.greetingTrigger) {
      void this.runAssistantTurn(this.profile.greetingTrigger, {
        emitUserTranscript: false,
      });
    }

    return Promise.resolve();
  }

  disconnect(): void {
    this.clearSilenceTimer();
    this.clearCompletionTimer();
    this.connected = false;
    this.currentSpeech = [];
    this.speechStartedAtMs = null;
    this.processingTurn = false;
    this.isInterrupted = false;
    this.setState('idle');
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendAudio(audio: ArrayBuffer): void {
    if (!this.connected || this.processingTurn) return;

    const rms = computeRmsPcm16(audio);
    const threshold = this.runtimeConfig.turn.minRms;
    const hasSpeech = rms >= threshold;

    if (hasSpeech) {
      this.clearCompletionTimer();
      if (this.state === 'speaking') {
        this.interrupt();
      }
      if (this.speechStartedAtMs === null) {
        this.speechStartedAtMs = Date.now();
      }
      this.currentSpeech.push(arrayBufferToBuffer(audio));
      this.clearSilenceTimer();
      return;
    }

    if (this.speechStartedAtMs !== null) {
      this.currentSpeech.push(arrayBufferToBuffer(audio));
      if (!this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          void this.finalizeSpeechTurn();
        }, this.runtimeConfig.turn.silenceMs);
      }
    }
  }

  sendMessage(text: string): void {
    if (!this.connected) return;
    void this.runAssistantTurn(text, { emitUserTranscript: false });
  }

  interrupt(): void {
    this.isInterrupted = true;
    this.clearCompletionTimer();
    this.emit('audioInterrupted');
    this.setState('listening');
  }

  getState(): AgentState {
    return this.state;
  }

  getHistory(): VoiceRuntimeHistoryItem[] {
    return this.history.map((entry) => ({
      id: entry.id,
      type: 'message',
      role: entry.role,
      content: [{ type: 'text', text: entry.content }],
    }));
  }

  private emit<K extends keyof VoiceRuntimeEvents>(
    event: K,
    ...args: Parameters<VoiceRuntimeEvents[K]>
  ): void {
    const handler = this.eventHandlers[event];
    if (!handler) return;
    (handler as (...eventArgs: Parameters<VoiceRuntimeEvents[K]>) => void)(...args);
  }

  private setState(newState: AgentState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.emit('stateChange', newState);
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

  private emitLatency(metric: {
    stage: 'stt' | 'llm' | 'tts' | 'turn';
    durationMs: number;
    provider?: string;
    model?: string;
    details?: Record<string, unknown>;
  }): void {
    this.emit('latency', metric);
  }

  private async finalizeSpeechTurn(): Promise<void> {
    const turnStartMs = Date.now();
    this.clearSilenceTimer();
    if (this.processingTurn) return;

    const joined = Buffer.concat(this.currentSpeech);
    this.currentSpeech = [];
    const speechStartedAtMs = this.speechStartedAtMs;
    this.speechStartedAtMs = null;
    if (!speechStartedAtMs || joined.length === 0) return;

    const speechDurationMs = Math.floor((joined.length / 2 / AUDIO_SAMPLE_RATE) * 1000);
    if (speechDurationMs < this.runtimeConfig.turn.minSpeechMs) {
      return;
    }

    this.processingTurn = true;
    try {
      const sttStartMs = Date.now();
      const transcript = await this.transcribeAudio(joined);
      this.emitLatency({
        stage: 'stt',
        durationMs: Date.now() - sttStartMs,
        provider: this.runtimeConfig.decomposedSttProvider,
        model: this.runtimeConfig.decomposedSttModel,
        details: { transcriptChars: transcript.length },
      });
      if (!transcript) {
        this.setState('listening');
        return;
      }

      const userItemId = randomUUID();
      this.emit('userItemCreated', userItemId);
      this.emit('transcript', transcript, 'user', userItemId);

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
      this.emit('error', error as Error);
      this.setState('listening');
    } finally {
      this.processingTurn = false;
    }
  }

  private async transcribeAudio(pcm: Buffer): Promise<string> {
    this.setState('thinking');

    if (this.runtimeConfig.decomposedSttProvider === 'deepgram') {
      return this.transcribeWithDeepgram(pcm);
    }

    return this.transcribeWithOpenAI(pcm);
  }

  private async transcribeWithOpenAI(pcm: Buffer): Promise<string> {
    const wav = encodeWavPcm16Mono(pcm, AUDIO_SAMPLE_RATE);
    const file = new File([wav], 'speech.wav', { type: 'audio/wav' });

    const response = await this.openai.audio.transcriptions.create({
      file,
      model: this.runtimeConfig.decomposedSttModel,
      language: this.runtimeConfig.language,
    });

    return response.text?.trim() ?? '';
  }

  private async transcribeWithDeepgram(pcm: Buffer): Promise<string> {
    const apiKey = this.runtimeConfig.auth.deepgramApiKey;
    if (!apiKey) {
      throw new Error(
        'Deepgram API key is missing. Set DEEPGRAM_API_KEY or configure auth-profiles.json'
      );
    }

    const wav = encodeWavPcm16Mono(pcm, AUDIO_SAMPLE_RATE);
    const url = new URL('https://api.deepgram.com/v1/listen');
    url.searchParams.set('model', this.runtimeConfig.decomposedSttModel || 'nova-3');
    url.searchParams.set('language', this.runtimeConfig.language);
    url.searchParams.set('smart_format', 'true');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: wav,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepgram STT failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as DeepgramListenResponse;
    const transcript =
      payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';

    return transcript;
  }

  private buildCoreMessages(): CoreMessage[] {
    return this.history.map((entry) => ({
      role: entry.role === 'system' ? 'user' : (entry.role as 'user' | 'assistant'),
      content: entry.content,
    }));
  }

  private async runAssistantTurn(
    text: string,
    options: { emitUserTranscript: boolean }
  ): Promise<void> {
    const userId = randomUUID();
    const assistantId = randomUUID();

    if (options.emitUserTranscript) {
      this.history.push({ id: userId, role: 'user', content: text });
    } else {
      this.history.push({ id: userId, role: 'system', content: text });
    }
    this.emit('historyUpdated', this.getHistory());

    this.setState('thinking');
    this.emit('assistantItemCreated', assistantId);
    const llmStartMs = Date.now();

    let assistantText = '';
    let pendingPrefix = '';
    let markerResolved = !this.runtimeConfig.turn.llmCompletionEnabled;
    let marker: TurnMarker = '✓';

    const systemPrompt = this.runtimeConfig.turn.llmCompletionEnabled
      ? `${this.profile.instructions}\n\n${TURN_COMPLETION_PROMPT}`
      : this.profile.instructions;

    const consumeDelta = (delta: string): void => {
      if (!delta) return;

      if (markerResolved) {
        assistantText += delta;
        this.emit('transcriptDelta', delta, 'assistant', assistantId);
        return;
      }

      pendingPrefix += delta;
      const trimmed = pendingPrefix.trimStart();
      if (!trimmed) return;

      const candidate = trimmed[0] as TurnMarker | undefined;
      if (candidate && TURN_MARKERS.includes(candidate)) {
        marker = candidate;
        markerResolved = true;
        const rest = trimmed.slice(1).trimStart();
        if (rest) {
          assistantText += rest;
          this.emit('transcriptDelta', rest, 'assistant', assistantId);
        }
        pendingPrefix = '';
        return;
      }

      // Provider/model ignored marker protocol. Treat stream as normal text.
      marker = '✓';
      markerResolved = true;
      assistantText += pendingPrefix;
      this.emit('transcriptDelta', pendingPrefix, 'assistant', assistantId);
      pendingPrefix = '';
    };

    try {
      if (this.runtimeConfig.decomposedLlmProvider === 'openai') {
        await this.streamWithOpenAI(systemPrompt, consumeDelta);
      } else {
        await this.streamWithOpenRouter(systemPrompt, consumeDelta);
      }
      this.emitLatency({
        stage: 'llm',
        durationMs: Date.now() - llmStartMs,
        provider: this.runtimeConfig.decomposedLlmProvider,
        model: this.runtimeConfig.decomposedLlmModel,
        details: { responseChars: assistantText.length },
      });
    } catch (error) {
      this.emit('error', error as Error);
      this.setState('listening');
      return;
    }

    if (!markerResolved && pendingPrefix) {
      assistantText += pendingPrefix;
      this.emit('transcriptDelta', pendingPrefix, 'assistant', assistantId);
      pendingPrefix = '';
    }

    if (this.runtimeConfig.turn.llmCompletionEnabled && marker !== '✓') {
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
    this.emit('historyUpdated', this.getHistory());
    this.emit('transcript', finalText, 'assistant', assistantId);

    await this.speak(finalText);
  }

  private async streamWithOpenAI(
    systemPrompt: string,
    onDelta: (delta: string) => void
  ): Promise<void> {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.buildCoreMessages().map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
    ] as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

    const stream = await this.openai.chat.completions.create({
      model: this.runtimeConfig.decomposedLlmModel,
      stream: true,
      messages,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        onDelta(delta);
      }
    }
  }

  private async streamWithOpenRouter(
    systemPrompt: string,
    onDelta: (delta: string) => void
  ): Promise<void> {
    const apiKey = this.runtimeConfig.auth.openrouterApiKey;
    if (!apiKey) {
      throw new Error(
        'OpenRouter API key is missing. Set OPEN_ROUTER_API_KEY or configure auth-profiles.json'
      );
    }

    const openrouter = createOpenRouter({ apiKey });
    const result = streamText({
      model: openrouter.chat(this.runtimeConfig.decomposedLlmModel),
      system: systemPrompt,
      messages: this.buildCoreMessages(),
    });

    for await (const delta of result.textStream) {
      onDelta(delta);
    }
  }

  private scheduleIncompleteTurnReprompt(marker: TurnMarker): void {
    this.clearCompletionTimer();

    const timeoutMs =
      marker === '○'
        ? this.runtimeConfig.turn.llmShortTimeoutMs
        : this.runtimeConfig.turn.llmLongTimeoutMs;

    const reprompt =
      marker === '○'
        ? this.runtimeConfig.turn.llmShortReprompt
        : this.runtimeConfig.turn.llmLongReprompt;

    this.completionTimer = setTimeout(() => {
      if (!this.connected || this.processingTurn) return;
      void this.runAssistantTurn(reprompt, { emitUserTranscript: false });
    }, timeoutMs);
  }

  private async speak(text: string): Promise<void> {
    this.isInterrupted = false;
    this.setState('speaking');
    const ttsStartMs = Date.now();

    let fullAudio: Buffer;
    if (this.runtimeConfig.decomposedTtsProvider === 'deepgram') {
      fullAudio = await this.speakWithDeepgram(text);
    } else {
      fullAudio = await this.speakWithOpenAI(text);
    }

    const chunks = chunkBuffer(fullAudio, PCM_BYTES_PER_100MS);
    this.emitLatency({
      stage: 'tts',
      durationMs: Date.now() - ttsStartMs,
      provider: this.runtimeConfig.decomposedTtsProvider,
      model: this.runtimeConfig.decomposedTtsModel || this.runtimeConfig.decomposedTtsVoice,
      details: {
        textChars: text.length,
        audioBytes: fullAudio.length,
        chunks: chunks.length,
      },
    });

    for (const chunk of chunks) {
      if (this.isInterrupted || !this.connected) break;
      const arrayBuffer = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      );
      this.emit('audio', { data: arrayBuffer } as VoiceRuntimeAudio);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    if (!this.isInterrupted) {
      this.setState('listening');
    }
  }

  private async speakWithOpenAI(text: string): Promise<Buffer> {
    const response = await this.openai.audio.speech.create({
      model: this.runtimeConfig.decomposedTtsModel,
      voice: this.runtimeConfig.decomposedTtsVoice as
        | 'alloy'
        | 'ash'
        | 'coral'
        | 'echo'
        | 'fable'
        | 'onyx'
        | 'nova'
        | 'shimmer',
      input: text,
      response_format: 'pcm',
    });

    return Buffer.from(await response.arrayBuffer());
  }

  private async speakWithDeepgram(text: string): Promise<Buffer> {
    const apiKey = this.runtimeConfig.auth.deepgramApiKey;
    if (!apiKey) {
      throw new Error(
        'Deepgram API key is missing. Set DEEPGRAM_API_KEY or configure auth-profiles.json'
      );
    }

    const model = this.runtimeConfig.decomposedTtsModel || this.runtimeConfig.decomposedTtsVoice;
    const url = new URL('https://api.deepgram.com/v1/speak');
    url.searchParams.set('model', model);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(AUDIO_SAMPLE_RATE));
    url.searchParams.set('container', 'none');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepgram TTS failed (${response.status}): ${errorText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
