import { describe, expect, test } from 'bun:test';
import type { AgentProfile } from '../src/agent/profiles.js';
import type { VoiceRuntimeConfig } from '../src/voice/types.js';
import { UltravoxRealtimeRuntime } from '../src/voice/ultravox-realtime-runtime.js';

const TEST_PROFILE: AgentProfile = {
  name: 'Test',
  wakeWord: 'test',
  instructions: 'You are a test profile.',
  voice: 'echo',
  tools: [],
  greetingTrigger: '',
};

function createRuntimeConfig(): VoiceRuntimeConfig {
  return {
    mode: 'voice-to-voice',
    provider: 'ultravox-realtime',
    language: 'de',
    voice: '',
    model: 'gpt-realtime-mini-2025-10-06',
    geminiModel: 'gemini-2.5-flash-native-audio-preview',
    geminiVoice: 'Puck',
    ultravoxModel: 'fixie-ai/ultravox-70B',
    decomposedSttProvider: 'deepgram',
    decomposedSttModel: 'nova-3',
    decomposedLlmProvider: 'openai',
    decomposedLlmModel: 'gpt-4.1',
    decomposedTtsProvider: 'deepgram',
    decomposedTtsModel: 'aura-2-thalia-en',
    decomposedTtsVoice: 'aura-2-thalia-en',
    auth: {
      openaiApiKey: '',
      openrouterApiKey: '',
      googleApiKey: '',
      deepgramApiKey: '',
      ultravoxApiKey: '',
    },
    turn: {
      strategy: 'layered',
      silenceMs: 700,
      minSpeechMs: 350,
      minRms: 0.015,
      llmCompletionEnabled: false,
      llmShortTimeoutMs: 5000,
      llmLongTimeoutMs: 10000,
      llmShortReprompt: '',
      llmLongReprompt: '',
    },
  };
}

describe('UltravoxRealtimeRuntime', () => {
  test('maps role=agent transcript deltas to assistant stream events', () => {
    const runtime = new UltravoxRealtimeRuntime(TEST_PROFILE, createRuntimeConfig(), 'session-test');
    const deltas: Array<{ delta: string; role: string; itemId?: string }> = [];
    const finals: Array<{ text: string; role: string; itemId?: string }> = [];

    runtime.on('transcriptDelta', (delta, role, itemId) => {
      deltas.push({ delta, role, itemId });
    });
    runtime.on('transcript', (text, role, itemId) => {
      finals.push({ text, role, itemId });
    });

    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      delta: 'Hallo',
      final: false,
      ordinal: 7,
    });
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: 'Hallo Welt',
      final: true,
      ordinal: 7,
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({
      delta: 'Hallo',
      role: 'assistant',
      itemId: 'assistant-7',
    });
    expect(finals).toHaveLength(1);
    expect(finals[0]).toEqual({
      text: 'Hallo Welt',
      role: 'assistant',
      itemId: 'assistant-7',
    });
  });

  test('executes client tool invocation and emits start/end with invocation id', async () => {
    const runtime = new UltravoxRealtimeRuntime(TEST_PROFILE, createRuntimeConfig(), 'session-test');
    const toolStarts: Array<{ name: string; callId?: string; args: Record<string, unknown> }> = [];
    const toolEnds: Array<{ name: string; callId?: string; result: string }> = [];

    runtime.on('toolStart', (name, args, callId) => {
      toolStarts.push({ name, callId, args });
    });
    runtime.on('toolEnd', (name, result, callId) => {
      toolEnds.push({ name, result, callId });
    });

    (runtime as any).localTools.set('mock_tool', {
      type: 'function',
      name: 'mock_tool',
      description: 'Mock',
      parameters: { type: 'object' },
      strict: true,
      invoke: async (_ctx: unknown, input: string) => {
        const parsed = JSON.parse(input) as Record<string, unknown>;
        return `ok:${parsed.value as string}`;
      },
      needsApproval: async () => false,
      isEnabled: async () => true,
    });

    (runtime as any).handleDataMessage({
      type: 'client_tool_invocation',
      toolName: 'mock_tool',
      invocationId: 'inv-1',
      parameters: { value: '42' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]).toEqual({
      name: 'mock_tool',
      callId: 'inv-1',
      args: { value: '42' },
    });
    expect(toolEnds).toHaveLength(1);
    expect(toolEnds[0]).toEqual({
      name: 'mock_tool',
      callId: 'inv-1',
      result: 'ok:42',
    });
  });
});
