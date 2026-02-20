import { resamplePcm16Mono } from '../media/resample-pcm16.js';
import { parseUltravoxProviderConfig } from '../provider-config.js';
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
  ToolReaction,
  UltravoxProviderConfig,
  VoiceHistoryItem,
  VoiceSessionEvents,
  VoiceState,
} from '../types.js';

interface UltravoxCallResponse {
  joinUrl?: string;
  websocketUrl?: string;
  medium?: {
    serverWebSocket?: {
      inputSampleRate?: number;
      outputSampleRate?: number;
      clientBufferSizeMs?: number;
    };
  };
}

interface UltravoxMessage {
  type?: string;
  state?: string;
  text?: string | null;
  delta?: string | null;
  role?: 'user' | 'assistant' | 'agent';
  speaker?: 'user' | 'assistant' | 'agent';
  final?: boolean;
  ordinal?: number;
  toolName?: string;
  invocationId?: string;
  parameters?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

interface TranscriptAccumulator {
  text: string;
  role: 'user' | 'assistant';
  final: boolean;
  announced: boolean;
}

interface UltravoxSelectedTool {
  temporaryTool: {
    modelToolName: string;
    description: string;
    dynamicParameters: Array<{
      name: string;
      location: 'PARAMETER_LOCATION_BODY';
      schema: Record<string, unknown>;
      required: boolean;
    }>;
    client: Record<string, never>;
    precomputable?: boolean;
    timeout?: string;
    defaultReaction?: 'SPEAKS' | 'LISTENS' | 'SPEAKS_ONCE';
  };
}

const DEFAULT_API_BASE = 'https://api.ultravox.ai';
const DEFAULT_BUFFER_MS = 30000;
const DEFAULT_INPUT_RATE = 48000;
const DEFAULT_OUTPUT_RATE = 48000;

const ULTRAVOX_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  transcriptDeltas: true,
  interruption: true,

  providerTransportKinds: ['websocket'],
  audioNegotiation: true,
  vadModes: ['server'],
  interruptionModes: ['barge-in'],

  toolTimeout: true,
  asyncTools: false,
  toolCancellation: false,
  toolScheduling: false,
  toolReaction: true,
  precomputableTools: true,
  toolApproval: false,
  mcpTools: false,
  serverSideTools: true,

  sessionResumption: true,
  midSessionConfigUpdate: false,
  contextCompression: false,

  forceAgentMessage: true,
  outputMediumSwitch: true,
  callState: true,
  deferredText: true,
  callStages: true,
  proactivity: false,
  usageMetrics: false,
  orderedTranscripts: true,
  ephemeralTokens: false,
  nativeTruncation: false,
  wordLevelTimestamps: false,
};

export class UltravoxWsAdapter implements ProviderAdapter {
  readonly id = 'ultravox-ws' as const;

  private readonly events = new TypedEventEmitter<VoiceSessionEvents>();
  private socket: WebSocket | null = null;
  private connected = false;
  private state: VoiceState = 'idle';
  private input: SessionInput | null = null;
  private history: VoiceHistoryItem[] = [];
  private toolByName = new Map<string, ToolDefinition>();
  private transcriptsByOrdinal = new Map<number, TranscriptAccumulator>();

  private providerInputRateHz = DEFAULT_INPUT_RATE;
  private providerOutputRateHz = DEFAULT_OUTPUT_RATE;
  private preferredInputRateHz = 24000;
  private preferredOutputRateHz = 24000;

  capabilities(): ProviderCapabilities {
    return ULTRAVOX_CAPABILITIES;
  }

  async connect(input: SessionInput): Promise<AudioNegotiation> {
    if (this.connected) {
      return {
        providerInputRate: this.providerInputRateHz,
        providerOutputRate: this.providerOutputRateHz,
        preferredClientInputRate: this.preferredInputRateHz,
        preferredClientOutputRate: this.preferredOutputRateHz,
        format: 'pcm16',
      };
    }

    this.input = input;
    this.toolByName.clear();
    this.history = [];
    this.transcriptsByOrdinal.clear();
    for (const tool of input.tools ?? []) {
      this.toolByName.set(tool.name, tool);
    }

    const providerConfig = this.getProviderConfig(input);
    const apiKey = providerConfig.apiKey;
    if (!apiKey) {
      throw new Error('Ultravox adapter requires providerConfig.apiKey');
    }

    this.providerInputRateHz = providerConfig.inputSampleRate ?? DEFAULT_INPUT_RATE;
    this.providerOutputRateHz = providerConfig.outputSampleRate ?? DEFAULT_OUTPUT_RATE;
    const clientBufferSizeMs = providerConfig.clientBufferSizeMs ?? DEFAULT_BUFFER_MS;

    const payload: Record<string, unknown> = {
      model: providerConfig.model ?? input.model,
      systemPrompt: input.instructions,
      voice: providerConfig.voice ?? input.voice,
      medium: {
        serverWebSocket: {
          inputSampleRate: this.providerInputRateHz,
          outputSampleRate: this.providerOutputRateHz,
          clientBufferSizeMs,
        },
      },
    };

    const selectedTools = this.toSelectedTools(input.tools ?? []);
    if (selectedTools.length > 0) {
      payload.selectedTools = selectedTools;
    }

    const createUrl = `${providerConfig.apiBaseUrl ?? DEFAULT_API_BASE}/api/calls`;
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Ultravox call creation failed (${createResponse.status}): ${errorText}`);
    }

    const call = (await createResponse.json()) as UltravoxCallResponse;
    const negotiatedInputRate = call.medium?.serverWebSocket?.inputSampleRate;
    const negotiatedOutputRate = call.medium?.serverWebSocket?.outputSampleRate;
    if (typeof negotiatedInputRate === 'number' && negotiatedInputRate > 0) {
      this.providerInputRateHz = negotiatedInputRate;
    }
    if (typeof negotiatedOutputRate === 'number' && negotiatedOutputRate > 0) {
      this.providerOutputRateHz = negotiatedOutputRate;
    }

    const joinUrl = call.joinUrl ?? call.websocketUrl;
    if (!joinUrl) {
      throw new Error('Ultravox API response did not include joinUrl/websocketUrl');
    }

    const wsUrl = new URL(joinUrl);
    wsUrl.searchParams.set('apiVersion', '1');

    this.socket = new WebSocket(wsUrl.toString());
    this.socket.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Ultravox websocket not created'));
        return;
      }

      const onOpen = () => {
        this.socket?.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        this.socket?.removeEventListener('open', onOpen);
        reject(
          new Error(`Ultravox websocket connection error: ${String((event as ErrorEvent).message ?? '')}`)
        );
      };

      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('error', onError, { once: true });
    });

    this.bindSocketHandlers();
    this.connected = true;
    this.setState('listening');
    this.events.emit('connected');

    return {
      providerInputRate: this.providerInputRateHz,
      providerOutputRate: this.providerOutputRateHz,
      preferredClientInputRate: this.preferredInputRateHz,
      preferredClientOutputRate: this.preferredOutputRateHz,
      format: 'pcm16',
    };
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      this.connected = false;
      this.setState('idle');
      this.events.emit('disconnected');
      return;
    }

    try {
      this.socket.send(JSON.stringify({ type: 'hang_up' }));
    } catch {
      // ignore
    }

    this.socket.close();
    this.socket = null;
    this.connected = false;
    this.transcriptsByOrdinal.clear();
    this.setState('idle');
    this.events.emit('disconnected');
  }

  sendAudio(frame: AudioFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const pcm =
      frame.sampleRate === this.providerInputRateHz
        ? frame
        : resamplePcm16Mono(frame, this.providerInputRateHz);
    this.socket.send(pcm.data);
  }

  sendText(text: string, options?: { defer?: boolean }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (options?.defer) {
      this.socket.send(
        JSON.stringify({
          type: 'deferred_text_message',
          text,
        })
      );
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: 'input_text_message',
        text,
      })
    );
  }

  interrupt(): void {
    this.events.emit('audioInterrupted');
  }

  sendToolResult(result: ToolCallResult): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const payload: Record<string, unknown> = {
      type: 'client_tool_result',
      invocationId: result.invocationId,
      result: result.result,
      responseType: result.isError ? 'tool-error' : result.stageTransition ? 'new-stage' : 'tool-response',
    };
    if (result.stateUpdate) {
      payload.updateCallState = result.stateUpdate;
    }
    if (result.errorMessage) {
      payload.errorMessage = result.errorMessage;
    }
    if (result.agentReaction) {
      payload.agentReaction = toUltravoxReaction(result.agentReaction);
    }
    this.socket.send(JSON.stringify(payload));
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

  setOutputMedium(medium: 'voice' | 'text'): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: 'set_output_medium',
        medium,
      })
    );
  }

  forceAgentMessage(
    text: string,
    options?: { uninterruptible?: boolean; urgency?: 'immediate' | 'soon' }
  ): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: 'forced_agent_message',
        text,
        uninterruptible: options?.uninterruptible ?? false,
        urgency: options?.urgency === 'immediate' ? 'IMMEDIATE' : 'SOON',
      })
    );
  }

  resume(handle: string): Promise<void> {
    throw new Error(`Ultravox resume is not implemented in this adapter yet (${handle})`);
  }

  private bindSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.addEventListener('message', (event: MessageEvent) => {
      void this.handleSocketMessage(event.data);
    });

    this.socket.addEventListener('close', () => {
      this.connected = false;
      this.setState('idle');
      this.events.emit('disconnected');
    });

    this.socket.addEventListener('error', (event: Event) => {
      const message = (event as ErrorEvent).message ?? 'Ultravox websocket error';
      this.events.emit('error', new Error(message));
    });
  }

  private async handleSocketMessage(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      this.handleDataMessage(data);
      return;
    }

    if (data instanceof ArrayBuffer) {
      this.emitAudioFrame(data);
      return;
    }

    if (data instanceof Uint8Array) {
      this.emitAudioFrame(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      return;
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      const audio = await data.arrayBuffer();
      this.emitAudioFrame(audio);
      return;
    }
  }

  private emitAudioFrame(raw: ArrayBufferLike): void {
    const normalizedRaw = toArrayBuffer(raw);
    const frame: AudioFrame = {
      data: normalizedRaw,
      sampleRate: this.providerOutputRateHz,
      format: 'pcm16',
    };
    const frameForSession =
      frame.sampleRate === this.preferredOutputRateHz
        ? frame
        : resamplePcm16Mono(frame, this.preferredOutputRateHz);
    this.events.emit('audio', frameForSession);
  }

  private handleDataMessage(raw: string): void {
    let message: UltravoxMessage;
    try {
      message = JSON.parse(raw) as UltravoxMessage;
    } catch {
      return;
    }

    const type = message.type ?? '';

    if (type === 'state') {
      this.mapState(message.state);
      return;
    }

    if (type === 'transcript') {
      this.handleTranscript(message);
      return;
    }

    if (type === 'playback_clear_buffer') {
      this.events.emit('audioInterrupted');
      return;
    }

    if (type === 'client_tool_invocation') {
      void this.handleToolInvocation(message);
      return;
    }
  }

  private handleTranscript(message: UltravoxMessage): void {
    const role = this.mapRole(message);
    if (!role) return;

    const ordinal = typeof message.ordinal === 'number' ? message.ordinal : -1;
    const itemId = ordinal >= 0 ? `${role}-${ordinal}` : `${role}-${Date.now()}`;
    const delta = typeof message.delta === 'string' ? message.delta : '';
    const text = typeof message.text === 'string' ? message.text : '';

    let accumulator = ordinal >= 0 ? this.transcriptsByOrdinal.get(ordinal) : undefined;
    if (!accumulator && ordinal >= 0) {
      accumulator = {
        text: '',
        role,
        final: false,
        announced: false,
      };
      this.transcriptsByOrdinal.set(ordinal, accumulator);
    }

    const previousText = accumulator?.text ?? '';
    const wasAnnounced = accumulator?.announced ?? false;

    let nextText = previousText;
    if (delta) {
      nextText = previousText + delta;
    } else if (text) {
      nextText = text;
    }
    if (accumulator) {
      accumulator.text = nextText;
      accumulator.role = role;
    }

    // Ultravox can emit scaffold ordinals that carry only whitespace/newlines.
    // Keep assistant placeholder gating strict (only with meaningful text) to avoid
    // empty assistant bubbles, but announce user placeholder immediately so UI can
    // show "You: ..." while recognition is still in progress.
    const hasMeaningfulText = nextText.trim().length > 0;
    if (accumulator && !accumulator.announced) {
      if (role === 'user') {
        this.events.emit('userItemCreated', itemId);
        accumulator.announced = true;
      } else if (hasMeaningfulText) {
        this.events.emit('assistantItemCreated', itemId);
        accumulator.announced = true;
      }
    }

    if (role === 'assistant') {
      if (delta && accumulator?.announced) {
        let emittedDelta = delta;
        if (!wasAnnounced && previousText.trim().length === 0 && hasMeaningfulText) {
          emittedDelta = nextText.replace(/^\s+/, '');
        }
        if (emittedDelta) {
          this.events.emit('transcriptDelta', emittedDelta, role, itemId);
        }
      } else if (text && message.final !== true && accumulator?.announced) {
        let computedDelta =
          text.length > previousText.length ? text.slice(previousText.length) : text;
        if (!wasAnnounced && previousText.trim().length === 0 && text.trim().length > 0) {
          computedDelta = text.replace(/^\s+/, '');
        }
        if (computedDelta) {
          this.events.emit('transcriptDelta', computedDelta, role, itemId);
        }
      }
    }

    if (message.final === true) {
      if (accumulator) {
        accumulator.final = true;
      }

      const finalText = (accumulator?.text || text).trim();
      if (!finalText) return;

      if (accumulator && !accumulator.announced) {
        if (role === 'user') {
          this.events.emit('userItemCreated', itemId);
        } else {
          this.events.emit('assistantItemCreated', itemId);
        }
        accumulator.announced = true;
      }

      const historyItem: VoiceHistoryItem = {
        id: itemId,
        role,
        text: finalText,
        createdAt: Date.now(),
      };
      this.history.push(historyItem);
      this.events.emit('historyUpdated', [...this.history]);
      this.events.emit('transcript', finalText, role, itemId);
    }
  }

  private async handleToolInvocation(message: UltravoxMessage): Promise<void> {
    const invocationId =
      typeof message.invocationId === 'string' ? message.invocationId : `uvx-${Date.now()}`;
    const toolName = typeof message.toolName === 'string' ? message.toolName : 'ultravox_tool';
    const args = this.parseToolParameters(message.parameters);
    this.events.emit('toolStart', toolName, args, invocationId);

    if (!this.input?.toolHandler) {
      const errorResult: ToolCallResult = {
        invocationId,
        result: `No toolHandler registered for tool ${toolName}`,
        isError: true,
      };
      this.sendToolResult(errorResult);
      this.events.emit('toolEnd', toolName, errorResult.result, invocationId);
      return;
    }

    try {
      const context: ToolCallContext = {
        providerId: this.id,
        callId: invocationId,
        invocationId,
        history: [...this.history],
      };
      const rawResult = await this.input.toolHandler(toolName, args, context);
      const normalized = this.normalizeToolResult(invocationId, rawResult);
      this.sendToolResult(normalized);
      this.events.emit('toolEnd', toolName, normalized.result, invocationId);
    } catch (error) {
      const result = `Tool ${toolName} failed: ${(error as Error).message}`;
      this.sendToolResult({
        invocationId,
        result,
        isError: true,
      });
      this.events.emit('toolEnd', toolName, result, invocationId);
      this.events.emit('error', error as Error);
    }
  }

  private mapState(state?: string): void {
    switch (state) {
      case 'listening':
        this.setState('listening');
        break;
      case 'thinking':
        this.setState('thinking');
        break;
      case 'speaking':
        this.setState('speaking');
        break;
      default:
        this.setState('idle');
        break;
    }
  }

  private mapRole(message: UltravoxMessage): 'user' | 'assistant' | null {
    if (message.role === 'user' || message.speaker === 'user') return 'user';
    if (
      message.role === 'assistant' ||
      message.role === 'agent' ||
      message.speaker === 'assistant' ||
      message.speaker === 'agent'
    ) {
      return 'assistant';
    }
    return null;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);
  }

  private parseToolParameters(parameters: unknown): Record<string, unknown> {
    if (!parameters) return {};
    if (typeof parameters === 'object' && !Array.isArray(parameters)) {
      return parameters as Record<string, unknown>;
    }
    if (typeof parameters === 'string') {
      try {
        const parsed = JSON.parse(parameters) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through
      }
      return { raw: parameters };
    }
    return { raw: parameters };
  }

  private normalizeToolResult(
    invocationId: string,
    value: ToolCallResult | string
  ): ToolCallResult {
    if (typeof value === 'string') {
      return {
        invocationId,
        result: value,
      };
    }
    return {
      ...value,
      invocationId,
      result: this.stringifyToolOutput(value.result),
    };
  }

  private stringifyToolOutput(output: unknown): string {
    if (typeof output === 'string') return output;
    if (typeof output === 'number' || typeof output === 'boolean') return String(output);
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }

  private getProviderConfig(input: SessionInput): UltravoxProviderConfig {
    return parseUltravoxProviderConfig(input.providerConfig);
  }

  private toSelectedTools(tools: ToolDefinition[]): UltravoxSelectedTool[] {
    return tools.map((tool) => {
      const parameters = tool.parameters ?? {};
      const properties =
        parameters.properties &&
        typeof parameters.properties === 'object' &&
        !Array.isArray(parameters.properties)
          ? (parameters.properties as Record<string, unknown>)
          : {};
      const requiredNames = Array.isArray(parameters.required)
        ? new Set(parameters.required.filter((name): name is string => typeof name === 'string'))
        : new Set<string>();

      return {
        temporaryTool: {
          modelToolName: tool.name,
          description: tool.description,
          dynamicParameters: Object.entries(properties).map(([name, schema]) => ({
            name,
            location: 'PARAMETER_LOCATION_BODY' as const,
            schema:
              schema && typeof schema === 'object' && !Array.isArray(schema)
                ? (schema as Record<string, unknown>)
                : { type: 'string' },
            required: requiredNames.has(name),
          })),
          client: {},
          precomputable: tool.precomputable,
          timeout: typeof tool.timeout === 'number' ? `${tool.timeout}ms` : undefined,
          defaultReaction: tool.defaultReaction
            ? toUltravoxReaction(tool.defaultReaction)
            : undefined,
        },
      };
    });
  }
}

function toUltravoxReaction(reaction: ToolReaction): 'SPEAKS' | 'LISTENS' | 'SPEAKS_ONCE' {
  if (reaction === 'listens') return 'LISTENS';
  if (reaction === 'speaks-once') return 'SPEAKS_ONCE';
  return 'SPEAKS';
}

function toArrayBuffer(input: ArrayBufferLike): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const copied = new Uint8Array(input.byteLength);
  copied.set(new Uint8Array(input));
  return copied.buffer;
}
