import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import { TypedEventEmitter } from '../runtime/typed-emitter.js';
import type {
  AudioFrame,
  AudioNegotiation,
  EventHandler,
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

interface GeminiProviderConfig {
  apiKey?: string;
  endpoint?: string;
  apiVersion?: 'v1alpha' | 'v1beta';
  enableInputTranscription?: boolean;
  enableOutputTranscription?: boolean;
  noInterruption?: boolean;
  contextWindowCompressionTokens?: number;
  proactivity?: boolean;
  sessionResumptionHandle?: string;
  useEphemeralToken?: boolean;
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
}

interface GeminiModelTurn {
  parts?: GeminiPart[];
}

interface GeminiServerContent {
  modelTurn?: GeminiModelTurn;
  turnComplete?: boolean;
  generationComplete?: boolean;
  interrupted?: boolean;
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
}

interface GeminiFunctionCall {
  id?: string;
  name?: string;
  args?: unknown;
}

interface GeminiToolCall {
  functionCalls?: GeminiFunctionCall[];
}

interface GeminiToolCallCancellation {
  ids?: string[];
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  responseTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GeminiEnvelope {
  setupComplete?: Record<string, unknown>;
  serverContent?: GeminiServerContent;
  toolCall?: GeminiToolCall;
  toolCallCancellation?: GeminiToolCallCancellation;
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiFunctionResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
  scheduling?: 'INTERRUPT' | 'WHEN_IDLE' | 'SILENT';
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  behavior?: 'NON_BLOCKING';
}

const GEMINI_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_INPUT_RATE = 16000;
const GEMINI_OUTPUT_RATE = 24000;

const GEMINI_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['websocket'],
  audioNegotiation: true,
  vadModes: ['server', 'manual'],
  interruptionModes: ['barge-in', 'no-interruption'],

  toolTimeout: false,
  asyncTools: true,
  toolCancellation: true,
  toolScheduling: true,
  toolReaction: false,
  precomputableTools: false,
  toolApproval: false,
  mcpTools: false,
  serverSideTools: false,

  sessionResumption: true,
  midSessionConfigUpdate: false,
  contextCompression: true,

  forceAgentMessage: false,
  outputMediumSwitch: false,
  callState: false,
  deferredText: false,
  callStages: false,
  proactivity: true,
  usageMetrics: true,
  orderedTranscripts: false,
  ephemeralTokens: true,
  nativeTruncation: false,
  wordLevelTimestamps: false,
};

export class GeminiLiveAdapter implements ProviderAdapter {
  readonly id = 'gemini-live' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private socket: WebSocket | null = null;
  private input: SessionInput | null = null;
  private state: VoiceState = 'idle';
  private history: VoiceHistoryItem[] = [];
  private nextUserIndex = 0;
  private nextAssistantIndex = 0;
  private activeUserItemId: string | null = null;
  private activeUserText = '';
  private activeAssistantItemId: string | null = null;
  private activeAssistantText = '';
  private setupPromise: Promise<void> | null = null;
  private resolveSetup: (() => void) | null = null;
  private rejectSetup: ((error: Error) => void) | null = null;
  private pendingResumeHandle: string | null = null;

  capabilities(): ProviderCapabilities {
    return GEMINI_CAPABILITIES;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    this.input = input;
    this.history = [];
    this.nextUserIndex = 0;
    this.nextAssistantIndex = 0;
    this.activeUserItemId = null;
    this.activeUserText = '';
    this.activeAssistantItemId = null;
    this.activeAssistantText = '';

    const providerConfig = this.getProviderConfig(input);
    const apiKey = providerConfig.apiKey;
    if (!apiKey) {
      throw new Error('Gemini adapter requires providerConfig.apiKey');
    }

    const endpoint = providerConfig.endpoint ?? GEMINI_ENDPOINT;
    const url = new URL(endpoint);
    if (!providerConfig.useEphemeralToken) {
      url.searchParams.set('key', apiKey);
    } else {
      // Ephemeral tokens are passed as key-compatible values.
      url.searchParams.set('key', apiKey);
    }

    this.socket = new WebSocket(url.toString());
    this.socket.binaryType = 'arraybuffer';

    await this.waitForOpen();
    this.bindSocketHandlers();

    this.setupPromise = new Promise<void>((resolve, reject) => {
      this.resolveSetup = resolve;
      this.rejectSetup = reject;
    });

    this.sendJson(this.buildSetupMessage(input, providerConfig));

    await Promise.race([
      this.setupPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini setup timeout')), 12_000)
      ),
    ]);

    this.setState('listening');
    this.events.emit('connected');

    return {
      providerInputRate: GEMINI_INPUT_RATE,
      providerOutputRate: GEMINI_OUTPUT_RATE,
      preferredClientInputRate: 24000,
      preferredClientOutputRate: 24000,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    this.finalizeActiveUserTranscript();
    this.finalizeAssistantTranscript();

    if (!this.socket) {
      this.setState('idle');
      this.events.emit('disconnected');
      return;
    }

    try {
      this.socket.close();
    } catch {
      // ignore
    }
    this.socket = null;
    this.setState('idle');
    this.events.emit('disconnected');
  }

  sendAudio(frame: AudioFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const providerFrame =
      frame.sampleRate === GEMINI_INPUT_RATE ? frame : resamplePcm16Mono(frame, GEMINI_INPUT_RATE);
    this.sendJson({
      realtimeInput: {
        audio: {
          data: encodeBase64(providerFrame.data),
          mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
        },
      },
    });
  }

  sendText(text: string, options?: { defer?: boolean }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const itemId = this.nextUserItemId();
    this.events.emit('userItemCreated', itemId);
    this.events.emit('transcript', trimmed, 'user', itemId);
    this.history.push({
      id: itemId,
      role: 'user',
      text: trimmed,
      createdAt: Date.now(),
    });
    this.events.emit('historyUpdated', [...this.history]);

    this.sendJson({
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: options?.defer ? false : true,
      },
    });
  }

  interrupt(): void {
    this.events.emit('audioInterrupted');
    this.setState('listening');
  }

  sendToolResult(result: ToolCallResult): void {
    const callId = result.invocationId;
    this.sendFunctionResponses([
      {
        id: callId,
        name: 'tool_result',
        response: normalizeToolResponse(result),
        scheduling: toGeminiScheduling(result.scheduling),
      },
    ]);
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

  async resume(handle: string): Promise<void> {
    this.pendingResumeHandle = handle;
  }

  private waitForOpen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Gemini websocket missing'));
        return;
      }

      const onOpen = () => {
        this.socket?.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        this.socket?.removeEventListener('open', onOpen);
        const message = (event as ErrorEvent).message || 'Gemini websocket connection failed';
        reject(new Error(message));
      };

      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('error', onError, { once: true });
    });
  }

  private bindSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.addEventListener('message', (event: MessageEvent) => {
      void this.handleRawMessage(event.data);
    });

    this.socket.addEventListener('close', () => {
      this.setState('idle');
      this.events.emit('disconnected', 'socket_closed');
    });

    this.socket.addEventListener('error', (event: Event) => {
      const message = (event as ErrorEvent).message || 'Gemini websocket error';
      const error = new Error(message);
      if (this.rejectSetup) {
        this.rejectSetup(error);
        this.resolveSetup = null;
        this.rejectSetup = null;
      }
      this.events.emit('error', error);
    });
  }

  private async handleRawMessage(data: unknown): Promise<void> {
    let rawText = '';

    if (typeof data === 'string') {
      rawText = data;
    } else if (data instanceof ArrayBuffer) {
      rawText = new TextDecoder().decode(data);
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      rawText = await data.text();
    } else if (data instanceof Uint8Array) {
      rawText = new TextDecoder().decode(data);
    } else {
      return;
    }

    if (!rawText) return;

    let message: GeminiEnvelope;
    try {
      message = JSON.parse(rawText) as GeminiEnvelope;
    } catch {
      return;
    }

    this.handleEnvelope(message);
  }

  private handleEnvelope(message: GeminiEnvelope): void {
    if (message.setupComplete && this.resolveSetup) {
      this.resolveSetup();
      this.resolveSetup = null;
      this.rejectSetup = null;
    }

    if (message.usageMetadata) {
      this.events.emit('usage', {
        inputTokens: message.usageMetadata.promptTokenCount,
        outputTokens: message.usageMetadata.responseTokenCount,
        totalTokens: message.usageMetadata.totalTokenCount,
        inputTokenDetails: {
          cachedTokens: message.usageMetadata.cachedContentTokenCount,
        },
      });
    }

    if (message.sessionResumptionUpdate?.newHandle) {
      this.pendingResumeHandle = message.sessionResumptionUpdate.newHandle;
      this.events.emit('latency', {
        stage: 'connection',
        durationMs: 0,
        provider: 'gemini-live',
        details: {
          resumable: message.sessionResumptionUpdate.resumable ?? false,
          handle: this.pendingResumeHandle,
        },
      });
    }

    if (message.goAway) {
      this.events.emit('latency', {
        stage: 'connection',
        durationMs: 0,
        provider: 'gemini-live',
        details: {
          goAway: true,
          timeLeft: message.goAway.timeLeft ?? null,
        },
      });
    }

    if (message.toolCall?.functionCalls?.length) {
      void this.handleToolCall(message.toolCall.functionCalls);
    }

    if (message.toolCallCancellation?.ids?.length) {
      this.events.emit('toolCancelled', message.toolCallCancellation.ids);
    }

    if (message.serverContent) {
      this.handleServerContent(message.serverContent);
    }
  }

  private handleServerContent(content: GeminiServerContent): void {
    if (content.interrupted) {
      this.events.emit('audioInterrupted');
      this.setState('listening');
    }

    const inputText = content.inputTranscription?.text?.trim();
    if (inputText) {
      this.ensureActiveUserItem();
      const delta = computeDelta(this.activeUserText, inputText);
      this.activeUserText = inputText;
      if (delta) {
        this.events.emit('transcriptDelta', delta, 'user', this.activeUserItemId ?? undefined);
      }
    }

    const outputText = content.outputTranscription?.text?.trim();
    if (outputText) {
      this.ensureActiveAssistantItem();
      const delta = computeDelta(this.activeAssistantText, outputText);
      this.activeAssistantText = outputText;
      if (delta) {
        this.events.emit(
          'transcriptDelta',
          delta,
          'assistant',
          this.activeAssistantItemId ?? undefined
        );
      }
    }

    const parts = content.modelTurn?.parts ?? [];
    if (parts.length > 0) {
      this.ensureActiveAssistantItem();
    }

    for (const part of parts) {
      if (part.inlineData?.data) {
        const sampleRate = parseSampleRate(part.inlineData.mimeType) ?? GEMINI_OUTPUT_RATE;
        this.setState('speaking');
        this.events.emit('audio', {
          data: decodeBase64(part.inlineData.data),
          sampleRate,
          format: 'pcm16',
        });
      }

      if (part.text) {
        this.ensureActiveAssistantItem();
        this.activeAssistantText += part.text;
        this.events.emit(
          'transcriptDelta',
          part.text,
          'assistant',
          this.activeAssistantItemId ?? undefined
        );
      }
    }

    if (content.turnComplete || content.generationComplete) {
      this.finalizeActiveUserTranscript();
      this.finalizeAssistantTranscript();
      this.setState('listening');
      this.events.emit('turnComplete');
    }
  }

  private async handleToolCall(functionCalls: GeminiFunctionCall[]): Promise<void> {
    if (!this.input?.toolHandler) {
      const fallbackResponses = functionCalls
        .filter((call): call is GeminiFunctionCall & { id: string; name: string } =>
          typeof call.id === 'string' && typeof call.name === 'string'
        )
        .map((call) => ({
          id: call.id,
          name: call.name,
          response: {
            error: true,
            message: `No toolHandler registered for ${call.name}`,
          },
        }));
      if (fallbackResponses.length > 0) {
        this.sendFunctionResponses(fallbackResponses);
      }
      return;
    }

    for (const call of functionCalls) {
      const callId = typeof call.id === 'string' ? call.id : `gemini-tool-${Date.now()}`;
      const name = typeof call.name === 'string' ? call.name : 'unknown_tool';
      const args = toObject(call.args);

      this.events.emit('toolStart', name, args, callId);

      try {
        const context: ToolCallContext = {
          providerId: this.id,
          callId,
          invocationId: callId,
          history: [...this.history],
        };
        const rawResult = await this.input.toolHandler(name, args, context);
        const normalized = normalizeToolResult(callId, rawResult);
        this.sendFunctionResponses([
          {
            id: callId,
            name,
            response: normalizeToolResponse(normalized),
            scheduling: toGeminiScheduling(normalized.scheduling),
          },
        ]);
        this.events.emit('toolEnd', name, normalized.result, callId);
      } catch (error) {
        const message = (error as Error).message;
        this.sendFunctionResponses([
          {
            id: callId,
            name,
            response: {
              error: true,
              message,
            },
          },
        ]);
        this.events.emit('toolEnd', name, message, callId);
        this.events.emit('error', error as Error);
      }
    }
  }

  private sendFunctionResponses(responses: GeminiFunctionResponse[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.sendJson({
      toolResponse: {
        functionResponses: responses,
      },
    });
  }

  private ensureActiveUserItem(): void {
    if (this.activeUserItemId) return;
    this.activeUserItemId = this.nextUserItemId();
    this.activeUserText = '';
    this.events.emit('userItemCreated', this.activeUserItemId);
  }

  private finalizeActiveUserTranscript(): void {
    if (!this.activeUserItemId) return;
    const finalText = this.activeUserText.trim();
    if (finalText) {
      this.events.emit('transcript', finalText, 'user', this.activeUserItemId);
      this.history.push({
        id: this.activeUserItemId,
        role: 'user',
        text: finalText,
        createdAt: Date.now(),
      });
      this.events.emit('historyUpdated', [...this.history]);
    }
    this.activeUserItemId = null;
    this.activeUserText = '';
  }

  private ensureActiveAssistantItem(): void {
    if (this.activeAssistantItemId) return;
    this.finalizeActiveUserTranscript();
    this.activeAssistantItemId = this.nextAssistantItemId();
    this.activeAssistantText = '';
    this.events.emit('assistantItemCreated', this.activeAssistantItemId);
    this.events.emit('turnStarted');
    this.setState('thinking');
  }

  private finalizeAssistantTranscript(): void {
    if (!this.activeAssistantItemId) return;
    const finalText = this.activeAssistantText.trim();
    if (finalText) {
      this.events.emit('transcript', finalText, 'assistant', this.activeAssistantItemId);
      this.history.push({
        id: this.activeAssistantItemId,
        role: 'assistant',
        text: finalText,
        createdAt: Date.now(),
      });
      this.events.emit('historyUpdated', [...this.history]);
    }
    this.activeAssistantItemId = null;
    this.activeAssistantText = '';
  }

  private nextUserItemId(): string {
    this.nextUserIndex += 1;
    return `gemini-user-${this.nextUserIndex}`;
  }

  private nextAssistantItemId(): string {
    this.nextAssistantIndex += 1;
    return `gemini-assistant-${this.nextAssistantIndex}`;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private buildSetupMessage(
    input: SessionInput,
    config: GeminiProviderConfig
  ): Record<string, unknown> {
    const declarations = (input.tools ?? []).map((tool) =>
      this.toFunctionDeclaration(tool)
    );

    const setup: Record<string, unknown> = {
      model: input.model.startsWith('models/') ? input.model : `models/${input.model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        temperature: input.temperature ?? 0.8,
        maxOutputTokens: input.maxOutputTokens,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: input.voice,
            },
          },
          languageCode: input.language,
        },
      },
      systemInstruction: {
        parts: [{ text: input.instructions }],
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: input.vad?.mode === 'manual',
          silenceDurationMs: input.vad?.silenceDurationMs,
        },
        activityHandling: config.noInterruption
          ? 'NO_INTERRUPTION'
          : 'START_OF_ACTIVITY_INTERRUPTS',
      },
    };

    if (declarations.length > 0) {
      setup.tools = [{ functionDeclarations: declarations }];
    }

    if (config.enableInputTranscription !== false) {
      setup.inputAudioTranscription = {};
    }

    if (config.enableOutputTranscription !== false) {
      setup.outputAudioTranscription = {};
    }

    const resumeHandle = config.sessionResumptionHandle ?? this.pendingResumeHandle;
    if (resumeHandle) {
      setup.sessionResumption = { handle: resumeHandle };
    }

    if (typeof config.contextWindowCompressionTokens === 'number') {
      setup.contextWindowCompression = {
        slidingWindow: { targetTokens: config.contextWindowCompressionTokens },
      };
    }

    if (config.proactivity) {
      setup.proactivity = { proactiveAudio: true };
    }

    return { setup };
  }

  private toFunctionDeclaration(tool: ToolDefinition): GeminiFunctionDeclaration {
    const declaration: GeminiFunctionDeclaration = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
    if (tool.nonBlocking) {
      declaration.behavior = 'NON_BLOCKING';
    }
    return declaration;
  }

  private getProviderConfig(input: SessionInput): GeminiProviderConfig {
    return (input.providerConfig as GeminiProviderConfig | undefined) ?? {};
  }
}

function parseSampleRate(mimeType?: string): number | null {
  if (!mimeType) return null;
  const match = mimeType.match(/rate=(\d+)/);
  if (!match) return null;
  const rateText = match[1];
  if (!rateText) return null;
  const parsed = Number.parseInt(rateText, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function computeDelta(previous: string, next: string): string {
  if (!previous) return next;
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  return next;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeToolResult(
  invocationId: string,
  result: ToolCallResult | string | undefined
): ToolCallResult {
  if (!result) {
    return {
      invocationId,
      result: '',
    };
  }

  if (typeof result === 'string') {
    return {
      invocationId,
      result,
    };
  }

  return {
    ...result,
    invocationId,
    result: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
  };
}

function normalizeToolResponse(result: ToolCallResult): Record<string, unknown> {
  const response: Record<string, unknown> = {
    output: result.result,
    isError: result.isError ?? false,
  };
  if (result.errorMessage) {
    response.errorMessage = result.errorMessage;
  }
  return response;
}

function toGeminiScheduling(
  scheduling: ToolCallResult['scheduling']
): 'INTERRUPT' | 'WHEN_IDLE' | 'SILENT' | undefined {
  if (scheduling === 'interrupt') return 'INTERRUPT';
  if (scheduling === 'when_idle') return 'WHEN_IDLE';
  if (scheduling === 'silent') return 'SILENT';
  return undefined;
}
