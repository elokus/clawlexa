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

function createRuntime() {
  const runtime = new UltravoxRealtimeRuntime(TEST_PROFILE, createRuntimeConfig(), 'session-test');
  const events = {
    deltas: [] as Array<{ delta: string; role: string; itemId?: string }>,
    finals: [] as Array<{ text: string; role: string; itemId?: string }>,
    placeholders: [] as Array<{ type: 'user' | 'assistant'; itemId: string }>,
    stateChanges: [] as string[],
    interrupts: 0,
    toolStarts: [] as Array<{ name: string; callId?: string; args: Record<string, unknown> }>,
    toolEnds: [] as Array<{ name: string; callId?: string; result: string }>,
  };

  runtime.on('transcriptDelta', (delta, role, itemId) => {
    events.deltas.push({ delta, role, itemId });
  });
  runtime.on('transcript', (text, role, itemId) => {
    events.finals.push({ text, role, itemId });
  });
  runtime.on('userItemCreated', (itemId) => {
    events.placeholders.push({ type: 'user', itemId });
  });
  runtime.on('assistantItemCreated', (itemId) => {
    events.placeholders.push({ type: 'assistant', itemId });
  });
  runtime.on('stateChange', (state) => {
    events.stateChanges.push(state);
  });
  runtime.on('audioInterrupted', () => {
    events.interrupts++;
  });
  runtime.on('toolStart', (name, args, callId) => {
    events.toolStarts.push({ name, callId, args });
  });
  runtime.on('toolEnd', (name, result, callId) => {
    events.toolEnds.push({ name, result, callId });
  });

  return { runtime, events };
}

describe('UltravoxRealtimeRuntime', () => {
  test('maps role=agent delta then final correctly', () => {
    const { runtime, events } = createRuntime();

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

    // Should emit placeholder for new ordinal
    expect(events.placeholders).toHaveLength(1);
    expect(events.placeholders[0]).toEqual({ type: 'assistant', itemId: 'assistant-7' });

    // Should emit exactly one delta (from the delta message, not the text message)
    expect(events.deltas).toHaveLength(1);
    expect(events.deltas[0]).toEqual({
      delta: 'Hallo',
      role: 'assistant',
      itemId: 'assistant-7',
    });

    // Should emit exactly one final transcript
    expect(events.finals).toHaveLength(1);
    expect(events.finals[0]).toEqual({
      text: 'Hallo Welt',
      role: 'assistant',
      itemId: 'assistant-7',
    });
  });

  test('handles text-based partial transcripts without doubling', () => {
    const { runtime, events } = createRuntime();

    // Ultravox sends accumulated text (not delta) for partials
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: 'Hello',
      final: false,
      ordinal: 1,
    });
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: 'Hello World',
      final: false,
      ordinal: 1,
    });
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: 'Hello World!',
      final: true,
      ordinal: 1,
    });

    // Should emit computed deltas (incremental parts only)
    expect(events.deltas).toHaveLength(2);
    expect(events.deltas[0]!.delta).toBe('Hello');
    expect(events.deltas[1]!.delta).toBe(' World');

    // Final transcript should be the complete text
    expect(events.finals).toHaveLength(1);
    expect(events.finals[0]!.text).toBe('Hello World!');
  });

  test('emits user placeholder and transcript for user role', () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'user',
      text: 'Wie geht es dir?',
      final: true,
      ordinal: 3,
    });

    expect(events.placeholders).toHaveLength(1);
    expect(events.placeholders[0]).toEqual({ type: 'user', itemId: 'user-3' });

    // User transcripts should not emit deltas
    expect(events.deltas).toHaveLength(0);

    expect(events.finals).toHaveLength(1);
    expect(events.finals[0]).toEqual({
      text: 'Wie geht es dir?',
      role: 'user',
      itemId: 'user-3',
    });
  });

  test('does not emit transcript for empty or whitespace-only final', () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: '',
      final: true,
      ordinal: 10,
    });
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: '   ',
      final: true,
      ordinal: 11,
    });

    expect(events.finals).toHaveLength(0);
  });

  test('maps state transitions correctly', () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({ type: 'state', state: 'listening' });
    (runtime as any).handleDataMessage({ type: 'state', state: 'thinking' });
    (runtime as any).handleDataMessage({ type: 'state', state: 'speaking' });
    (runtime as any).handleDataMessage({ type: 'state', state: 'listening' });

    expect(events.stateChanges).toEqual(['listening', 'thinking', 'speaking', 'listening']);
  });

  test('does not emit duplicate state for same state', () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({ type: 'state', state: 'listening' });
    (runtime as any).handleDataMessage({ type: 'state', state: 'listening' });
    (runtime as any).handleDataMessage({ type: 'state', state: 'thinking' });

    expect(events.stateChanges).toEqual(['listening', 'thinking']);
  });

  test('emits audioInterrupted on playback_clear_buffer', () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({ type: 'playback_clear_buffer' });

    expect(events.interrupts).toBe(1);
  });

  test('emits placeholder only once per ordinal', () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      delta: 'A',
      final: false,
      ordinal: 5,
    });
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      delta: 'B',
      final: false,
      ordinal: 5,
    });
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: 'AB',
      final: true,
      ordinal: 5,
    });

    // Only one placeholder for ordinal 5
    expect(events.placeholders).toHaveLength(1);
    expect(events.placeholders[0]!.itemId).toBe('assistant-5');

    // Two deltas from the two delta messages
    expect(events.deltas).toHaveLength(2);
    expect(events.deltas[0]!.delta).toBe('A');
    expect(events.deltas[1]!.delta).toBe('B');
  });

  test('multiple ordinals get separate placeholders', () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'user',
      text: 'Hi',
      final: true,
      ordinal: 1,
    });
    (runtime as any).handleDataMessage({
      type: 'transcript',
      role: 'agent',
      text: 'Hello!',
      final: true,
      ordinal: 2,
    });

    expect(events.placeholders).toHaveLength(2);
    expect(events.placeholders[0]).toEqual({ type: 'user', itemId: 'user-1' });
    expect(events.placeholders[1]).toEqual({ type: 'assistant', itemId: 'assistant-2' });
  });

  test('executes client tool invocation and emits start/end with invocation id', async () => {
    const { runtime, events } = createRuntime();

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

    expect(events.toolStarts).toHaveLength(1);
    expect(events.toolStarts[0]).toEqual({
      name: 'mock_tool',
      callId: 'inv-1',
      args: { value: '42' },
    });
    expect(events.toolEnds).toHaveLength(1);
    expect(events.toolEnds[0]).toEqual({
      name: 'mock_tool',
      callId: 'inv-1',
      result: 'ok:42',
    });
  });

  test('missing tool emits toolEnd with error message', async () => {
    const { runtime, events } = createRuntime();

    (runtime as any).handleDataMessage({
      type: 'client_tool_invocation',
      toolName: 'nonexistent',
      invocationId: 'inv-2',
      parameters: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.toolStarts).toHaveLength(1);
    expect(events.toolStarts[0]!.name).toBe('nonexistent');
    expect(events.toolStarts[0]!.callId).toBe('inv-2');

    expect(events.toolEnds).toHaveLength(1);
    expect(events.toolEnds[0]!.name).toBe('nonexistent');
    expect(events.toolEnds[0]!.callId).toBe('inv-2');
    expect(events.toolEnds[0]!.result).toContain('not available');
  });
});
