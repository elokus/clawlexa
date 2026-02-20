/**
 * Voice Runtime Inspector TUI — State management (reducer + context).
 */

import { createContext, useContext } from 'react';
import type {
  InspectorState,
  InspectorAction,
  LatencyStage,
  LatencyEntry,
  TranscriptEntry,
} from './types.js';

// ── Initial State ────────────────────────────────────────────

export function createInitialState(mode: 'live' | 'report', profileName: string): InspectorState {
  return {
    mode,
    connectionStatus: 'disconnected',
    provider: null,
    voiceMode: null,
    agentState: 'idle',
    profileName,
    sessionStartedAt: null,

    muted: false,
    audio: {
      chunkCount: 0,
      lastChunkAt: null,
      chunkGaps: [],
      interruptionCount: 0,
    },
    audioDevices: {
      inputDevices: ['default'],
      outputDevices: ['default'],
      inputDevice: 'default',
      outputDevice: 'default',
    },

    latency: new Map(),
    thinkingStartedAt: null,

    transcripts: [],
    activeTools: [],

    benchmarkReport: null,
    benchmarkOutputPath: null,

    config: null,

    reportFiles: [],
    selectedReportIndex: 0,
    selectedReport: null,

    errors: [],

    textInputActive: false,
    showBenchmarkResult: false,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function updateLatency(
  map: Map<LatencyStage, LatencyEntry>,
  stage: LatencyStage,
  durationMs: number,
): Map<LatencyStage, LatencyEntry> {
  const next = new Map(map);
  const existing = next.get(stage);
  if (existing) {
    next.set(stage, {
      current: durationMs,
      samples: [...existing.samples, durationMs],
    });
  } else {
    next.set(stage, { current: durationMs, samples: [durationMs] });
  }
  return next;
}

function findTranscriptByItemId(
  transcripts: TranscriptEntry[],
  itemId: string,
  role?: 'user' | 'assistant',
): number {
  for (let i = transcripts.length - 1; i >= 0; i--) {
    const item = transcripts[i];
    if (!item || item.id !== itemId) continue;
    if (role && item.role !== role) continue;
    return i;
  }
  return -1;
}

function parseConversationItemOrder(itemId?: string): number | null {
  if (!itemId) return null;

  const uvxMatch = itemId.match(/^(?:assistant|user)-(\d+)$/);
  if (uvxMatch?.[1]) {
    const parsed = Number.parseInt(uvxMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const decomposedMatch = itemId.match(/^decomp-(?:assistant|user|context)-(\d+)-[a-z0-9]+$/i);
  if (decomposedMatch?.[1]) {
    const parsed = Number.parseInt(decomposedMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function findTranscriptInsertIndex(
  transcripts: TranscriptEntry[],
  itemId?: string,
  previousItemId?: string,
): number | undefined {
  const targetOrder = parseConversationItemOrder(itemId);

  if (previousItemId) {
    for (let idx = transcripts.length - 1; idx >= 0; idx--) {
      const item = transcripts[idx];
      if (!item || item.id !== previousItemId) continue;

      let insertIdx = idx + 1;
      if (targetOrder !== null) {
        while (insertIdx < transcripts.length) {
          const current = transcripts[insertIdx];
          if (!current) {
            insertIdx++;
            continue;
          }
          const currentOrder = parseConversationItemOrder(current.id);
          if (currentOrder === null) {
            insertIdx++;
            continue;
          }
          if (currentOrder >= targetOrder) break;
          insertIdx++;
        }
      }
      return insertIdx;
    }
  }

  if (targetOrder === null) return undefined;

  for (let idx = 0; idx < transcripts.length; idx++) {
    const item = transcripts[idx];
    if (!item) continue;
    const currentOrder = parseConversationItemOrder(item.id);
    if (currentOrder === null) continue;
    if (currentOrder > targetOrder) return idx;
  }

  return transcripts.length;
}

function insertTranscriptAt(
  transcripts: TranscriptEntry[],
  entry: TranscriptEntry,
  insertIndex?: number,
): TranscriptEntry[] {
  if (insertIndex === undefined || insertIndex < 0 || insertIndex >= transcripts.length) {
    return [...transcripts, entry];
  }
  return [
    ...transcripts.slice(0, insertIndex),
    entry,
    ...transcripts.slice(insertIndex),
  ];
}

function ensurePlaceholder(
  transcripts: TranscriptEntry[],
  role: 'user' | 'assistant',
  itemId: string,
  previousItemId?: string,
): TranscriptEntry[] {
  const existingIdx = findTranscriptByItemId(transcripts, itemId, role);
  if (existingIdx >= 0) return transcripts;

  const newEntry: TranscriptEntry = {
    id: itemId,
    role,
    text: '',
    isStreaming: true,
    timestamp: Date.now(),
  };
  const insertIndex = findTranscriptInsertIndex(transcripts, itemId, previousItemId);
  return insertTranscriptAt(transcripts, newEntry, insertIndex);
}

function updateTranscriptDelta(
  transcripts: TranscriptEntry[],
  role: 'user' | 'assistant',
  delta: string,
  itemId?: string,
): TranscriptEntry[] {
  if (itemId) {
    const existingIdx = findTranscriptByItemId(transcripts, itemId, role);
    if (existingIdx >= 0) {
      const existing = transcripts[existingIdx];
      if (!existing) return transcripts;
      return [
        ...transcripts.slice(0, existingIdx),
        { ...existing, text: existing.text + delta, isStreaming: true },
        ...transcripts.slice(existingIdx + 1),
      ];
    }

    // Ignore scaffold-only deltas before a concrete item exists.
    if (delta.trim().length === 0) {
      return transcripts;
    }

    const created: TranscriptEntry = {
      id: itemId,
      role,
      text: delta,
      isStreaming: true,
      timestamp: Date.now(),
    };
    const insertIndex = findTranscriptInsertIndex(transcripts, itemId);
    return insertTranscriptAt(transcripts, created, insertIndex);
  }

  for (let i = transcripts.length - 1; i >= 0; i--) {
    const current = transcripts[i];
    if (!current || !current.isStreaming || current.role !== role) continue;
    return [
      ...transcripts.slice(0, i),
      { ...current, text: current.text + delta, isStreaming: true },
      ...transcripts.slice(i + 1),
    ];
  }

  if (delta.trim().length === 0) {
    return transcripts;
  }

  return [
    ...transcripts,
    {
      id: `${role}-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: delta,
      isStreaming: true,
      timestamp: Date.now(),
    },
  ];
}

function finalizeTranscript(
  transcripts: TranscriptEntry[],
  role: 'user' | 'assistant',
  text: string,
  itemId?: string,
): TranscriptEntry[] {
  if (itemId) {
    const existingIdx = findTranscriptByItemId(transcripts, itemId, role);
    if (existingIdx >= 0) {
      const current = transcripts[existingIdx];
      if (!current) return transcripts;
      return [
        ...transcripts.slice(0, existingIdx),
        { ...current, role, text, isStreaming: false, timestamp: current.timestamp },
        ...transcripts.slice(existingIdx + 1),
      ];
    }

    const created: TranscriptEntry = {
      id: itemId,
      role,
      text,
      isStreaming: false,
      timestamp: Date.now(),
    };
    const insertIndex = findTranscriptInsertIndex(transcripts, itemId);
    return insertTranscriptAt(transcripts, created, insertIndex);
  }

  for (let i = transcripts.length - 1; i >= 0; i--) {
    const current = transcripts[i];
    if (!current || !current.isStreaming || current.role !== role) continue;
    return [
      ...transcripts.slice(0, i),
      { ...current, role, text, isStreaming: false, timestamp: current.timestamp },
      ...transcripts.slice(i + 1),
    ];
  }

  return [
    ...transcripts,
    {
      id: itemId ?? `${role}-final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      isStreaming: false,
      timestamp: Date.now(),
    },
  ];
}

function finalizeStreamingRole(
  transcripts: TranscriptEntry[],
  role: 'user' | 'assistant',
): TranscriptEntry[] {
  let changed = false;
  const next = transcripts.map((entry) => {
    if (entry.role !== role || !entry.isStreaming) return entry;
    changed = true;
    return { ...entry, isStreaming: false };
  });
  return changed ? next : transcripts;
}

// ── Reducer ──────────────────────────────────────────────────

export function inspectorReducer(state: InspectorState, action: InspectorAction): InspectorState {
  switch (action.type) {
    // ── Connection ─────────────────────────────────────────
    case 'CONNECT_START':
      return {
        ...state,
        connectionStatus: 'connecting',
        provider: action.provider,
        voiceMode: action.voiceMode,
        config: action.config,
        sessionStartedAt: Date.now(),
        // Reset live state
        agentState: 'idle',
        latency: new Map(),
        thinkingStartedAt: null,
        transcripts: [],
        activeTools: [],
        audio: { chunkCount: 0, lastChunkAt: null, chunkGaps: [], interruptionCount: 0 },
        benchmarkReport: null,
        benchmarkOutputPath: null,
        showBenchmarkResult: false,
        errors: [],
      };

    case 'CONNECTED':
      return { ...state, connectionStatus: 'connected' };

    case 'DISCONNECTED':
      return { ...state, connectionStatus: 'disconnected', agentState: 'idle' };

    // ── Runtime Events ─────────────────────────────────────
    case 'STATE_CHANGE': {
      const next: Partial<InspectorState> = { agentState: action.state };
      // Track thinking start for synthetic turn latency
      if (action.state === 'thinking') {
        next.thinkingStartedAt = Date.now();
      }
      // Synthetic turn latency: first audio after thinking
      if (action.state === 'speaking' && state.thinkingStartedAt) {
        const syntheticTurn = Date.now() - state.thinkingStartedAt;
        next.latency = updateLatency(state.latency, 'turn', syntheticTurn);
        next.thinkingStartedAt = null;
      }
      if (action.state !== 'speaking') {
        next.transcripts = finalizeStreamingRole(state.transcripts, 'assistant');
      }
      return { ...state, ...next };
    }

    case 'AUDIO_CHUNK': {
      const { lastChunkAt, chunkGaps } = state.audio;
      const gap = lastChunkAt ? action.timestamp - lastChunkAt : null;
      return {
        ...state,
        audio: {
          ...state.audio,
          chunkCount: state.audio.chunkCount + 1,
          lastChunkAt: action.timestamp,
          chunkGaps: gap !== null ? [...chunkGaps, gap] : chunkGaps,
        },
        // Clear synthetic turn latency — first audio received
        thinkingStartedAt: null,
      };
    }

    case 'AUDIO_INTERRUPTED':
      return {
        ...state,
        audio: {
          ...state.audio,
          interruptionCount: state.audio.interruptionCount + 1,
        },
      };

    case 'AUDIO_DEVICES_LOADED':
      return {
        ...state,
        audioDevices: {
          inputDevices: action.inputDevices.length > 0 ? action.inputDevices : ['default'],
          outputDevices: action.outputDevices.length > 0 ? action.outputDevices : ['default'],
          inputDevice: action.inputDevice || 'default',
          outputDevice: action.outputDevice || 'default',
        },
      };

    case 'AUDIO_INPUT_DEVICE_SET':
      return {
        ...state,
        audioDevices: {
          ...state.audioDevices,
          inputDevice: action.device,
        },
      };

    case 'AUDIO_OUTPUT_DEVICE_SET':
      return {
        ...state,
        audioDevices: {
          ...state.audioDevices,
          outputDevice: action.device,
        },
      };

    case 'LATENCY':
      return {
        ...state,
        latency: updateLatency(state.latency, action.stage, action.durationMs),
      };

    case 'USER_ITEM_CREATED':
      return {
        ...state,
        transcripts: ensurePlaceholder(state.transcripts, 'user', action.itemId),
      };

    case 'ASSISTANT_ITEM_CREATED':
      return {
        ...state,
        transcripts: ensurePlaceholder(state.transcripts, 'assistant', action.itemId, action.previousItemId),
      };

    case 'TRANSCRIPT':
      return {
        ...state,
        transcripts: finalizeTranscript(state.transcripts, action.role, action.text, action.itemId),
      };

    case 'TRANSCRIPT_DELTA':
      return {
        ...state,
        transcripts: updateTranscriptDelta(state.transcripts, action.role, action.delta, action.itemId),
      };

    case 'TOOL_START':
      return {
        ...state,
        activeTools: [
          ...state.activeTools,
          {
            name: action.name,
            args: action.args,
            callId: action.callId,
            startedAt: Date.now(),
          },
        ],
      };

    case 'TOOL_END': {
      const tools = state.activeTools.map((t) =>
        t.callId === action.callId || t.name === action.name
          ? { ...t, result: action.result, finishedAt: Date.now() }
          : t,
      );
      return { ...state, activeTools: tools };
    }

    case 'ERROR':
      return { ...state, errors: [...state.errors, action.message] };

    // ── Audio ──────────────────────────────────────────────
    case 'TOGGLE_MUTE':
      return { ...state, muted: !state.muted };

    // ── Benchmark ──────────────────────────────────────────
    case 'BENCHMARK_FINALIZED':
      return {
        ...state,
        benchmarkReport: action.report,
        benchmarkOutputPath: action.outputPath ?? null,
        showBenchmarkResult: true,
      };

    // ── UI ─────────────────────────────────────────────────
    case 'SET_TEXT_INPUT':
      return { ...state, textInputActive: action.active };

    case 'DISMISS_BENCHMARK':
      return { ...state, showBenchmarkResult: false };

    // ── Report Mode ────────────────────────────────────────
    case 'REPORTS_LOADED':
      return { ...state, reportFiles: action.reports, selectedReportIndex: 0, selectedReport: null };

    case 'SELECT_REPORT':
      return { ...state, selectedReportIndex: action.index, selectedReport: null };

    case 'REPORT_DETAIL_LOADED':
      return { ...state, selectedReport: action.detail };

    case 'FILTER_REPORTS':
      // Filtering is handled at the component level; this just resets selection
      return { ...state, selectedReportIndex: 0, selectedReport: null };

    default:
      return state;
  }
}

// ── Context ──────────────────────────────────────────────────

export interface InspectorContextValue {
  state: InspectorState;
  dispatch: React.Dispatch<InspectorAction>;
}

export const InspectorContext = createContext<InspectorContextValue | null>(null);

export function useInspector(): InspectorContextValue {
  const ctx = useContext(InspectorContext);
  if (!ctx) {
    throw new Error('useInspector must be used within InspectorContext.Provider');
  }
  return ctx;
}
