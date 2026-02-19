import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import type { FunctionTool } from '@openai/agents-core';
import { RunContext } from '@openai/agents-core';
import type { AgentProfile } from '../agent/profiles.js';
import type { VoiceAgent } from '../agent/voice-agent.js';
import { getToolsForSession } from '../tools/index.js';
import { resamplePcm16Mono } from './audio-utils.js';
import type {
  AgentState,
  VoiceRuntime,
  VoiceRuntimeAudio,
  VoiceRuntimeConfig,
  VoiceRuntimeEvents,
  VoiceRuntimeHistoryItem,
} from './types.js';

interface UltravoxCallResponse {
  callId?: string;
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

interface HistoryEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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
  };
}

export class UltravoxRealtimeRuntime implements VoiceRuntime {
  readonly mode = 'voice-to-voice' as const;
  readonly provider = 'ultravox-realtime' as const;
  private static readonly TRANSPORT_SAMPLE_RATE_HZ = 24000;
  private static readonly DEFAULT_ULTRAVOX_INPUT_SAMPLE_RATE_HZ = 48000;
  private static readonly DEFAULT_ULTRAVOX_OUTPUT_SAMPLE_RATE_HZ = 48000;
  private static readonly CLIENT_BUFFER_SIZE_MS = 30000;

  private readonly profile: AgentProfile;
  private readonly runtimeConfig: VoiceRuntimeConfig;
  private readonly localTools = new Map<string, FunctionTool<any, any, any>>();
  private readonly selectedTools: UltravoxSelectedTool[];
  private ws: WebSocket | null = null;
  private state: AgentState = 'idle';
  private connected = false;
  private eventHandlers: Partial<VoiceRuntimeEvents> = {};
  private history: HistoryEntry[] = [];
  private ultravoxInputSampleRateHz = UltravoxRealtimeRuntime.DEFAULT_ULTRAVOX_INPUT_SAMPLE_RATE_HZ;
  private ultravoxOutputSampleRateHz = UltravoxRealtimeRuntime.DEFAULT_ULTRAVOX_OUTPUT_SAMPLE_RATE_HZ;
  /** Ordinal-indexed transcript accumulation (matches Ultravox SDK pattern) */
  private transcriptsByOrdinal = new Map<number, { text: string; role: 'user' | 'assistant'; announced: boolean; final: boolean }>();

  constructor(
    profile: AgentProfile,
    runtimeConfig: VoiceRuntimeConfig,
    sessionId: string,
    voiceAgent?: VoiceAgent
  ) {
    this.profile = profile;
    this.runtimeConfig = runtimeConfig;

    const tools = getToolsForSession(profile.tools, { sessionId, voiceAgent });
    for (const tool of tools) {
      if (tool.type !== 'function') continue;
      this.localTools.set(tool.name, tool);
    }

    this.selectedTools = [...this.localTools.values()].map((tool) =>
      this.toUltravoxSelectedTool(tool)
    );
  }

  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const apiKey = this.runtimeConfig.auth.ultravoxApiKey;
    if (!apiKey) {
      throw new Error(
        'ULTRAVOX API key is missing. Set ULTRAVOX_API_KEY or configure auth-profiles.json'
      );
    }

    const basePayload: Record<string, unknown> = {
      model: this.runtimeConfig.ultravoxModel,
      systemPrompt: this.profile.instructions,
      ...(this.runtimeConfig.voice ? { voice: this.runtimeConfig.voice } : {}),
      medium: {
        serverWebSocket: {
          inputSampleRate: this.ultravoxInputSampleRateHz,
          outputSampleRate: this.ultravoxOutputSampleRateHz,
          clientBufferSizeMs: UltravoxRealtimeRuntime.CLIENT_BUFFER_SIZE_MS,
        },
      },
    };
    if (this.selectedTools.length > 0) {
      basePayload.selectedTools = this.selectedTools;
    }

    let createResponse = await this.createCall(apiKey, basePayload);

    // Graceful fallback when configured voice belongs to a different provider catalog.
    if (!createResponse.ok && this.runtimeConfig.voice) {
      const firstErrorText = await createResponse.text();
      const isInvalidVoice =
        createResponse.status === 400 &&
        firstErrorText.toLowerCase().includes('voice') &&
        firstErrorText.toLowerCase().includes('does not exist');
      if (isInvalidVoice) {
        console.warn(
          `[Ultravox] Voice "${this.runtimeConfig.voice}" rejected by provider. Retrying without explicit voice.`
        );
        const { voice: _ignored, ...fallbackPayload } = basePayload;
        createResponse = await this.createCall(apiKey, fallbackPayload);
      } else {
        throw new Error(
          `Ultravox call creation failed (${createResponse.status}): ${firstErrorText}`
        );
      }
    }

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Ultravox call creation failed (${createResponse.status}): ${errorText}`);
    }

    const call = (await createResponse.json()) as UltravoxCallResponse;
    const negotiatedInputRate = call.medium?.serverWebSocket?.inputSampleRate;
    const negotiatedOutputRate = call.medium?.serverWebSocket?.outputSampleRate;
    if (typeof negotiatedInputRate === 'number' && negotiatedInputRate > 0) {
      this.ultravoxInputSampleRateHz = negotiatedInputRate;
    }
    if (typeof negotiatedOutputRate === 'number' && negotiatedOutputRate > 0) {
      this.ultravoxOutputSampleRateHz = negotiatedOutputRate;
    }
    console.log(
      `[Ultravox] negotiated sample rates: input=${this.ultravoxInputSampleRateHz}Hz output=${this.ultravoxOutputSampleRateHz}Hz`
    );

    const joinUrl = call.joinUrl ?? call.websocketUrl;
    if (!joinUrl) {
      throw new Error('Ultravox API response did not include joinUrl/websocketUrl');
    }

    // Append apiVersion parameter (matches official SDKs)
    const wsUrl = new URL(joinUrl);
    wsUrl.searchParams.set('apiVersion', '1');
    this.ws = new WebSocket(wsUrl.toString());

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('Ultravox WebSocket was not created'));
        return;
      }

      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      this.ws.once('open', () => {
        if (settled) return;
        settled = true;
        this.connected = true;
        this.setState('listening');
        this.emit('connected');

        if (this.profile.greetingTrigger) {
          this.sendMessage(this.profile.greetingTrigger);
        }

        resolve();
      });

      this.ws.once('error', (error) => {
        fail(error as Error);
      });

      this.ws.once('close', (code, reasonBuffer) => {
        if (!settled) {
          const reason = reasonBuffer.toString();
          fail(new Error(`Ultravox socket closed during connect (${code}): ${reason}`));
        }
      });
    });

    this.setupMessageHandlers();
  }

  disconnect(): void {
    if (!this.ws) {
      this.connected = false;
      this.setState('idle');
      this.emit('disconnected');
      return;
    }

    try {
      this.ws.send(JSON.stringify({ type: 'hang_up' }));
    } catch {
      // Ignore if socket is already closing.
    }

    this.ws.removeAllListeners();
    this.ws.close();
    this.ws = null;
    this.connected = false;
    this.transcriptsByOrdinal.clear();
    this.setState('idle');
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendAudio(audio: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pcmForUltravox = resamplePcm16Mono(
      audio,
      UltravoxRealtimeRuntime.TRANSPORT_SAMPLE_RATE_HZ,
      this.ultravoxInputSampleRateHz
    );
    this.ws.send(pcmForUltravox);
  }

  sendMessage(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Ultravox data message for text user input (SDK convention).
    this.ws.send(
      JSON.stringify({
        type: 'input_text_message',
        text,
      })
    );
  }

  interrupt(): void {
    this.emit('audioInterrupted');
  }

  getState(): AgentState {
    return this.state;
  }

  getHistory(): VoiceRuntimeHistoryItem[] {
    return this.history.map((entry) => ({
      id: entry.id,
      type: 'message',
      role: entry.role,
      content: [{ type: 'text', text: entry.text }],
    }));
  }

  private setupMessageHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        const transportPcm = resamplePcm16Mono(
          buffer,
          this.ultravoxOutputSampleRateHz,
          UltravoxRealtimeRuntime.TRANSPORT_SAMPLE_RATE_HZ
        );
        const arrayBuffer = transportPcm.buffer.slice(
          transportPcm.byteOffset,
          transportPcm.byteOffset + transportPcm.byteLength
        );
        this.emit('audio', { data: arrayBuffer } as VoiceRuntimeAudio);
        return;
      }

      try {
        const parsed = JSON.parse(data.toString()) as UltravoxMessage;
        this.handleDataMessage(parsed);
      } catch (error) {
        this.emit('error', error as Error);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.setState('idle');
      this.emit('disconnected');
    });

    this.ws.on('error', (error) => {
      this.emit('error', error as Error);
    });
  }

  private handleDataMessage(message: UltravoxMessage): void {
    const type = message.type ?? '';

    if (type === 'state') {
      const state = typeof message.state === 'string' ? message.state : '';
      this.mapState(state);
      return;
    }

    if (type === 'transcript') {
      const role = this.mapRole(message);
      if (!role) return;

      const ordinal = typeof message.ordinal === 'number' ? message.ordinal : -1;
      const itemId = ordinal >= 0 ? `${role}-${ordinal}` : `${role}-${randomUUID()}`;
      const delta = typeof message.delta === 'string' ? message.delta : '';
      const text = typeof message.text === 'string' ? message.text : '';

      // Emit placeholder on first encounter of a new ordinal (ordering anchor for frontend)
      if (ordinal >= 0) {
        const existing = this.transcriptsByOrdinal.get(ordinal);
        if (!existing) {
          this.transcriptsByOrdinal.set(ordinal, { text: '', role, announced: true, final: false });
          if (role === 'user') {
            this.emit('userItemCreated', itemId);
          } else {
            this.emit('assistantItemCreated', itemId);
          }
        }
      }

      // Accumulate text using ordinal-indexed model:
      // - `text` field = full accumulated text at this ordinal (replace)
      // - `delta` field = incremental text to append at this ordinal
      // These are mutually exclusive per message.
      const entry = this.transcriptsByOrdinal.get(ordinal);
      const previousText = entry?.text ?? '';

      if (delta) {
        // Delta: append to existing accumulated text
        const newText = previousText + delta;
        if (ordinal >= 0 && entry) {
          entry.text = newText;
        }
        if (role === 'assistant') {
          this.emit('transcriptDelta', delta, role, itemId);
        }
      } else if (text) {
        // Text: full accumulated text — compute real delta from previous
        if (ordinal >= 0 && entry) {
          entry.text = text;
        }
        if (role === 'assistant' && message.final !== true) {
          // Compute the incremental part that is new
          const computedDelta = text.length > previousText.length
            ? text.slice(previousText.length)
            : text;
          if (computedDelta) {
            this.emit('transcriptDelta', computedDelta, role, itemId);
          }
        }
      }

      // On final: emit the complete transcript and add to history
      if (message.final === true) {
        const finalText = entry?.text || text;
        if (ordinal >= 0 && entry) {
          entry.final = true;
        }
        if (finalText.trim()) {
          this.history.push({ id: itemId, role, text: finalText });
          this.emit('historyUpdated', this.getHistory());
          this.emit('transcript', finalText, role, itemId);
        }
      }
      return;
    }

    if (type === 'playback_clear_buffer') {
      this.emit('audioInterrupted');
      return;
    }

    if (type === 'client_tool_invocation') {
      const toolName = (message.toolName as string) ?? 'ultravox_tool';
      const invocationId = typeof message.invocationId === 'string'
        ? message.invocationId
        : `uvx-${randomUUID()}`;
      const args = this.parseToolParameters(message.parameters);
      this.emit('toolStart', toolName, args, invocationId);
      void this.executeClientTool(toolName, args, invocationId);
      return;
    }

    if (type === 'client_tool_result') {
      const toolName = (message.toolName as string) ?? 'ultravox_tool';
      const invocationId = typeof message.invocationId === 'string' ? message.invocationId : undefined;
      const result = this.stringifyToolOutput(message.result ?? 'ok');
      this.emit('toolEnd', toolName, result, invocationId);
      return;
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

  private mapState(ultravoxState: string): void {
    switch (ultravoxState) {
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

  private emit<K extends keyof VoiceRuntimeEvents>(
    event: K,
    ...args: Parameters<VoiceRuntimeEvents[K]>
  ): void {
    const handler = this.eventHandlers[event];
    if (!handler) return;
    (handler as (...eventArgs: Parameters<VoiceRuntimeEvents[K]>) => void)(...args);
  }

  private setState(next: AgentState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('stateChange', next);
  }

  private async createCall(
    apiKey: string,
    payload: Record<string, unknown>
  ): Promise<Response> {
    return fetch('https://api.ultravox.ai/api/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });
  }

  private toUltravoxSelectedTool(tool: FunctionTool<any, any, any>): UltravoxSelectedTool {
    const schema = (tool.parameters ?? {}) as Record<string, unknown>;
    const properties =
      schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};
    const required =
      Array.isArray(schema.required)
        ? new Set(schema.required.filter((name): name is string => typeof name === 'string'))
        : new Set<string>();

    const dynamicParameters = Object.entries(properties).map(([name, propertySchema]) => ({
      name,
      location: 'PARAMETER_LOCATION_BODY' as const,
      schema:
        propertySchema && typeof propertySchema === 'object'
          ? (propertySchema as Record<string, unknown>)
          : { type: 'string' },
      required: required.has(name),
    }));

    return {
      temporaryTool: {
        modelToolName: tool.name,
        description: tool.description,
        dynamicParameters,
        client: {},
      },
    };
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
        // fall through to raw wrapper
      }
      return { raw: parameters };
    }
    return { raw: parameters };
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

  private async executeClientTool(
    toolName: string,
    args: Record<string, unknown>,
    invocationId: string
  ): Promise<void> {
    const tool = this.localTools.get(toolName);
    if (!tool) {
      const missing = `Tool ${toolName} is not available in this profile.`;
      this.sendClientToolResult(invocationId, missing, true);
      this.emit('toolEnd', toolName, missing, invocationId);
      return;
    }

    try {
      this.setState('thinking');
      const output = await tool.invoke(
        new RunContext({
          history: this.getHistory(),
        }),
        JSON.stringify(args)
      );
      const resultText = this.stringifyToolOutput(output);
      this.sendClientToolResult(invocationId, resultText, false);
      this.emit('toolEnd', toolName, resultText, invocationId);
    } catch (error) {
      const message = (error as Error).message;
      const resultText = `Tool ${toolName} failed: ${message}`;
      this.sendClientToolResult(invocationId, resultText, true);
      this.emit('toolEnd', toolName, resultText, invocationId);
      this.emit('error', error as Error);
    }
  }

  private sendClientToolResult(invocationId: string, result: string, isError: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload: Record<string, unknown> = {
      type: 'client_tool_result',
      invocationId,
      result,
      responseType: 'tool-response',
    };
    if (isError) {
      payload.responseType = 'tool-error';
    }
    this.ws.send(JSON.stringify(payload));
  }
}
