/**
 * Tests for the inspector TUI state reducer.
 */

import { describe, it, expect } from 'bun:test';
import { inspectorReducer, createInitialState } from '../../src/tui/inspector/state.js';
import type { InspectorState, InspectorAction } from '../../src/tui/inspector/types.js';

function dispatch(state: InspectorState, action: InspectorAction): InspectorState {
  return inspectorReducer(state, action);
}

describe('inspector reducer', () => {
  it('creates initial state with correct defaults', () => {
    const state = createInitialState('live', 'jarvis');
    expect(state.mode).toBe('live');
    expect(state.profileName).toBe('jarvis');
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.agentState).toBe('idle');
    expect(state.muted).toBe(false);
    expect(state.audioDevices.inputDevice).toBe('default');
    expect(state.audioDevices.outputDevice).toBe('default');
    expect(state.transcripts).toEqual([]);
    expect(state.latency.size).toBe(0);
  });

  it('CONNECT_START resets state and sets provider', () => {
    const state = createInitialState('live', 'jarvis');
    const next = dispatch(state, {
      type: 'CONNECT_START',
      provider: 'openai-realtime',
      voiceMode: 'voice-to-voice',
      config: { provider: 'openai-realtime', mode: 'voice-to-voice', model: 'gpt-4o-mini', voice: 'echo', language: 'de' },
    });
    expect(next.connectionStatus).toBe('connecting');
    expect(next.provider).toBe('openai-realtime');
    expect(next.voiceMode).toBe('voice-to-voice');
    expect(next.sessionStartedAt).toBeGreaterThan(0);
    expect(next.transcripts).toEqual([]);
  });

  it('CONNECTED sets status to connected', () => {
    let state = createInitialState('live', 'jarvis');
    state = dispatch(state, {
      type: 'CONNECT_START',
      provider: 'openai-realtime',
      voiceMode: 'voice-to-voice',
      config: { provider: 'openai-realtime', mode: 'voice-to-voice', model: 'm', voice: 'v', language: 'de' },
    });
    state = dispatch(state, { type: 'CONNECTED' });
    expect(state.connectionStatus).toBe('connected');
  });

  it('STATE_CHANGE updates agentState and tracks thinking timestamp', () => {
    let state = createInitialState('live', 'jarvis');

    state = dispatch(state, { type: 'STATE_CHANGE', state: 'listening' });
    expect(state.agentState).toBe('listening');
    expect(state.thinkingStartedAt).toBeNull();

    state = dispatch(state, { type: 'STATE_CHANGE', state: 'thinking' });
    expect(state.agentState).toBe('thinking');
    expect(state.thinkingStartedAt).toBeGreaterThan(0);

    // Speaking after thinking computes synthetic turn latency
    state = dispatch(state, { type: 'STATE_CHANGE', state: 'speaking' });
    expect(state.agentState).toBe('speaking');
    expect(state.thinkingStartedAt).toBeNull();
    expect(state.latency.get('turn')).toBeDefined();
    expect(state.latency.get('turn')!.samples.length).toBe(1);
  });

  it('LATENCY accumulates per-stage samples', () => {
    let state = createInitialState('live', 'jarvis');
    state = dispatch(state, { type: 'LATENCY', stage: 'stt', durationMs: 100 });
    state = dispatch(state, { type: 'LATENCY', stage: 'stt', durationMs: 150 });
    state = dispatch(state, { type: 'LATENCY', stage: 'llm', durationMs: 300 });

    const stt = state.latency.get('stt');
    expect(stt).toBeDefined();
    expect(stt!.current).toBe(150);
    expect(stt!.samples).toEqual([100, 150]);

    const llm = state.latency.get('llm');
    expect(llm).toBeDefined();
    expect(llm!.current).toBe(300);
    expect(llm!.samples).toEqual([300]);
  });

  it('TRANSCRIPT_DELTA creates and appends streaming entries', () => {
    let state = createInitialState('live', 'jarvis');

    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: 'Hello', itemId: 'a1' });
    expect(state.transcripts).toHaveLength(1);
    expect(state.transcripts[0]!.text).toBe('Hello');
    expect(state.transcripts[0]!.isStreaming).toBe(true);

    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: ' world', itemId: 'a1' });
    expect(state.transcripts).toHaveLength(1);
    expect(state.transcripts[0]!.text).toBe('Hello world');
    expect(state.transcripts[0]!.isStreaming).toBe(true);
  });

  it('USER_ITEM_CREATED + ASSISTANT_ITEM_CREATED reserve transcript order like web timeline', () => {
    let state = createInitialState('live', 'jarvis');

    // Out-of-order arrival: assistant placeholder first, then user placeholder
    state = dispatch(state, {
      type: 'ASSISTANT_ITEM_CREATED',
      itemId: 'assistant-2',
      previousItemId: 'user-1',
    });
    state = dispatch(state, { type: 'USER_ITEM_CREATED', itemId: 'user-1' });

    expect(state.transcripts).toHaveLength(2);
    expect(state.transcripts[0]!.id).toBe('user-1');
    expect(state.transcripts[0]!.role).toBe('user');
    expect(state.transcripts[1]!.id).toBe('assistant-2');
    expect(state.transcripts[1]!.role).toBe('assistant');

    state = dispatch(state, { type: 'TRANSCRIPT', role: 'user', text: 'Hi', itemId: 'user-1' });
    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: 'Hello', itemId: 'assistant-2' });

    expect(state.transcripts[0]!.text).toBe('Hi');
    expect(state.transcripts[0]!.isStreaming).toBe(false);
    expect(state.transcripts[1]!.text).toBe('Hello');
    expect(state.transcripts[1]!.isStreaming).toBe(true);
  });

  it('ignores scaffold-only assistant deltas when itemId has no placeholder', () => {
    let state = createInitialState('live', 'jarvis');

    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: '   ', itemId: 'assistant-9' });
    expect(state.transcripts).toHaveLength(0);

    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: 'Hallo', itemId: 'assistant-9' });
    expect(state.transcripts).toHaveLength(1);
    expect(state.transcripts[0]!.id).toBe('assistant-9');
    expect(state.transcripts[0]!.text).toBe('Hallo');
  });

  it('TRANSCRIPT finalizes a streaming entry', () => {
    let state = createInitialState('live', 'jarvis');

    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: 'Hello', itemId: 'a1' });
    state = dispatch(state, { type: 'TRANSCRIPT', role: 'assistant', text: 'Hello world!', itemId: 'a1' });

    expect(state.transcripts).toHaveLength(1);
    expect(state.transcripts[0]!.text).toBe('Hello world!');
    expect(state.transcripts[0]!.isStreaming).toBe(false);
  });

  it('TRANSCRIPT without itemId finalizes latest streaming entry for role', () => {
    let state = createInitialState('live', 'jarvis');

    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: 'Hello ', itemId: 'a1' });
    state = dispatch(state, { type: 'TRANSCRIPT', role: 'assistant', text: 'Hello world' });

    expect(state.transcripts).toHaveLength(1);
    expect(state.transcripts[0]!.text).toBe('Hello world');
    expect(state.transcripts[0]!.isStreaming).toBe(false);
  });

  it('STATE_CHANGE away from speaking finalizes pending assistant streaming entries', () => {
    let state = createInitialState('live', 'jarvis');

    state = dispatch(state, { type: 'TRANSCRIPT_DELTA', role: 'assistant', delta: 'Partial', itemId: 'a1' });
    expect(state.transcripts[0]!.isStreaming).toBe(true);

    state = dispatch(state, { type: 'STATE_CHANGE', state: 'listening' });
    expect(state.transcripts[0]!.isStreaming).toBe(false);
  });

  it('TOGGLE_MUTE flips muted state', () => {
    let state = createInitialState('live', 'jarvis');
    expect(state.muted).toBe(false);

    state = dispatch(state, { type: 'TOGGLE_MUTE' });
    expect(state.muted).toBe(true);

    state = dispatch(state, { type: 'TOGGLE_MUTE' });
    expect(state.muted).toBe(false);
  });

  it('AUDIO_CHUNK increments count and tracks gaps', () => {
    let state = createInitialState('live', 'jarvis');

    state = dispatch(state, { type: 'AUDIO_CHUNK', timestamp: 1000 });
    expect(state.audio.chunkCount).toBe(1);
    expect(state.audio.chunkGaps).toEqual([]);

    state = dispatch(state, { type: 'AUDIO_CHUNK', timestamp: 1030 });
    expect(state.audio.chunkCount).toBe(2);
    expect(state.audio.chunkGaps).toEqual([30]);

    state = dispatch(state, { type: 'AUDIO_CHUNK', timestamp: 1060 });
    expect(state.audio.chunkCount).toBe(3);
    expect(state.audio.chunkGaps).toEqual([30, 30]);
  });

  it('AUDIO_INTERRUPTED increments interruption count', () => {
    let state = createInitialState('live', 'jarvis');
    expect(state.audio.interruptionCount).toBe(0);

    state = dispatch(state, { type: 'AUDIO_INTERRUPTED' });
    state = dispatch(state, { type: 'AUDIO_INTERRUPTED' });

    expect(state.audio.interruptionCount).toBe(2);
  });

  it('AUDIO_DEVICES_LOADED stores device inventory and active devices', () => {
    let state = createInitialState('live', 'jarvis');
    state = dispatch(state, {
      type: 'AUDIO_DEVICES_LOADED',
      inputDevices: ['MacBook Pro Microphone', 'Brio 500'],
      outputDevices: ['MacBook Pro Speakers', 'DELL S2721QSA'],
      inputDevice: 'Brio 500',
      outputDevice: 'DELL S2721QSA',
    });
    expect(state.audioDevices.inputDevices).toEqual(['MacBook Pro Microphone', 'Brio 500']);
    expect(state.audioDevices.outputDevices).toEqual(['MacBook Pro Speakers', 'DELL S2721QSA']);
    expect(state.audioDevices.inputDevice).toBe('Brio 500');
    expect(state.audioDevices.outputDevice).toBe('DELL S2721QSA');
  });

  it('AUDIO_*_DEVICE_SET updates selected input/output device', () => {
    let state = createInitialState('live', 'jarvis');
    state = dispatch(state, { type: 'AUDIO_INPUT_DEVICE_SET', device: 'Brio 500' });
    state = dispatch(state, { type: 'AUDIO_OUTPUT_DEVICE_SET', device: 'DELL S2722QC' });
    expect(state.audioDevices.inputDevice).toBe('Brio 500');
    expect(state.audioDevices.outputDevice).toBe('DELL S2722QC');
  });

  it('ERROR accumulates error messages', () => {
    let state = createInitialState('live', 'jarvis');
    state = dispatch(state, { type: 'ERROR', message: 'Connection failed' });
    state = dispatch(state, { type: 'ERROR', message: 'Timeout' });
    expect(state.errors).toEqual(['Connection failed', 'Timeout']);
  });

  it('BENCHMARK_FINALIZED stores report and shows overlay', () => {
    let state = createInitialState('live', 'jarvis');
    const report = {
      pass: true,
      violations: [],
      firstAudioLatencyMs: 500,
      chunkCadence: { medianGapMs: 30, p95GapMs: 50, maxGapMs: 80, p95JitterMs: 10 },
      realtimeFactor: 1.0,
      transcriptOrdering: { duplicateAssistantFinals: 0, outOfOrderAssistantItems: 0 },
      interruption: { count: 0, medianMs: 0, p95Ms: 0, maxMs: 0 },
    };

    state = dispatch(state, { type: 'BENCHMARK_FINALIZED', report, outputPath: '/tmp/report.json' });
    expect(state.benchmarkReport).toBe(report);
    expect(state.benchmarkOutputPath).toBe('/tmp/report.json');
    expect(state.showBenchmarkResult).toBe(true);
  });

  it('REPORTS_LOADED populates report list', () => {
    let state = createInitialState('report', 'jarvis');
    const reports = [
      { filename: 'a.json', path: '/a.json', provider: 'openai-realtime', profile: 'jarvis', pass: true, date: '2025-01-01' },
      { filename: 'b.json', path: '/b.json', provider: 'decomposed', profile: 'marvin', pass: false, date: '2025-01-02' },
    ];

    state = dispatch(state, { type: 'REPORTS_LOADED', reports });
    expect(state.reportFiles).toHaveLength(2);
    expect(state.selectedReportIndex).toBe(0);
  });
});
