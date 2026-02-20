/**
 * Voice Runtime Inspector TUI — Type definitions.
 */

import type { VoiceProviderName, VoiceMode, AgentState } from '../../voice/types.js';

// ── Latency ──────────────────────────────────────────────────

export type LatencyStage = 'stt' | 'llm' | 'tts' | 'turn' | 'tool' | 'connection';

export interface LatencyEntry {
  current: number;
  samples: number[];
}

// ── Transcripts ──────────────────────────────────────────────

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming: boolean;
  timestamp: number;
  order?: number;
}

// ── Tool Calls ───────────────────────────────────────────────

export interface ToolEntry {
  name: string;
  args: Record<string, unknown>;
  callId?: string;
  result?: string;
  startedAt: number;
  finishedAt?: number;
}

// ── Audio Metrics ────────────────────────────────────────────

export interface AudioMetrics {
  chunkCount: number;
  lastChunkAt: number | null;
  chunkGaps: number[];
  interruptionCount: number;
}

export interface AudioDeviceState {
  inputDevices: string[];
  outputDevices: string[];
  inputDevice: string;
  outputDevice: string;
}

// ── Benchmark Report (from voice-runtime package) ────────────

export interface BenchmarkReportFile {
  meta: {
    sessionId: string;
    profile: string;
    provider: VoiceProviderName;
    startedAt: string;
    finishedAt: string;
    reason: string;
  };
  thresholds: Record<string, number>;
  report: {
    pass: boolean;
    violations: string[];
    firstAudioLatencyMs?: number;
    chunkCadence: {
      medianGapMs: number;
      p95GapMs: number;
      maxGapMs: number;
      p95JitterMs: number;
    };
    realtimeFactor?: number;
    transcriptOrdering: {
      duplicateAssistantFinals: number;
      outOfOrderAssistantItems: number;
    };
    interruption: {
      count: number;
      medianMs: number;
      p95Ms: number;
      maxMs: number;
    };
  };
}

// ── Resolved Config (subset for display) ─────────────────────

export interface ResolvedConfigDisplay {
  provider: VoiceProviderName;
  mode: VoiceMode;
  model: string;
  voice: string;
  language: string;
  // Decomposed sub-providers (only if mode === 'decomposed')
  sttProvider?: string;
  sttModel?: string;
  llmProvider?: string;
  llmModel?: string;
  ttsProvider?: string;
  ttsModel?: string;
}

// ── Inspector State ──────────────────────────────────────────

export interface InspectorState {
  // Mode
  mode: 'live' | 'report';

  // Connection (live mode)
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  provider: VoiceProviderName | null;
  voiceMode: VoiceMode | null;
  agentState: AgentState;
  profileName: string;
  sessionStartedAt: number | null;

  // Audio
  muted: boolean;
  audio: AudioMetrics;
  audioDevices: AudioDeviceState;

  // Latency
  latency: Map<LatencyStage, LatencyEntry>;
  /** Timestamp when state changed to 'thinking' — for synthetic turn latency */
  thinkingStartedAt: number | null;

  // Transcripts
  transcripts: TranscriptEntry[];

  // Tools
  activeTools: ToolEntry[];

  // Benchmark
  benchmarkReport: BenchmarkReportFile['report'] | null;
  benchmarkOutputPath: string | null;

  // Config
  config: ResolvedConfigDisplay | null;

  // Report mode
  reportFiles: ReportListEntry[];
  selectedReportIndex: number;
  selectedReport: BenchmarkReportFile | null;

  // Errors
  errors: string[];

  // UI
  textInputActive: boolean;
  showBenchmarkResult: boolean;
}

// ── Report List ──────────────────────────────────────────────

export interface ReportListEntry {
  filename: string;
  path: string;
  provider: string;
  profile: string;
  pass: boolean;
  date: string;
}

// ── Actions ──────────────────────────────────────────────────

export type InspectorAction =
  // Connection lifecycle
  | { type: 'CONNECT_START'; provider: VoiceProviderName; voiceMode: VoiceMode; config: ResolvedConfigDisplay }
  | { type: 'CONNECTED' }
  | { type: 'DISCONNECTED' }

  // Runtime events
  | { type: 'STATE_CHANGE'; state: AgentState }
  | { type: 'AUDIO_CHUNK'; timestamp: number }
  | { type: 'AUDIO_INTERRUPTED' }
  | {
      type: 'AUDIO_DEVICES_LOADED';
      inputDevices: string[];
      outputDevices: string[];
      inputDevice: string;
      outputDevice: string;
    }
  | { type: 'AUDIO_INPUT_DEVICE_SET'; device: string }
  | { type: 'AUDIO_OUTPUT_DEVICE_SET'; device: string }
  | { type: 'LATENCY'; stage: LatencyStage; durationMs: number }
  | { type: 'USER_ITEM_CREATED'; itemId: string; order?: number }
  | { type: 'ASSISTANT_ITEM_CREATED'; itemId: string; previousItemId?: string; order?: number }
  | {
      type: 'TRANSCRIPT';
      role: 'user' | 'assistant';
      text: string;
      itemId?: string;
      order?: number;
    }
  | {
      type: 'TRANSCRIPT_DELTA';
      role: 'user' | 'assistant';
      delta: string;
      itemId?: string;
      order?: number;
    }
  | { type: 'TOOL_START'; name: string; args: Record<string, unknown>; callId?: string }
  | { type: 'TOOL_END'; name: string; result: string; callId?: string }
  | { type: 'ERROR'; message: string }

  // Audio
  | { type: 'TOGGLE_MUTE' }

  // Benchmark
  | { type: 'BENCHMARK_FINALIZED'; report: BenchmarkReportFile['report']; outputPath?: string }

  // UI
  | { type: 'SET_TEXT_INPUT'; active: boolean }
  | { type: 'DISMISS_BENCHMARK' }

  // Report mode
  | { type: 'REPORTS_LOADED'; reports: ReportListEntry[] }
  | { type: 'SELECT_REPORT'; index: number }
  | { type: 'REPORT_DETAIL_LOADED'; detail: BenchmarkReportFile }
  | { type: 'FILTER_REPORTS'; provider?: string };

// ── CLI Args ─────────────────────────────────────────────────

export interface InspectorArgs {
  mode: 'live' | 'report';
  profile: string;
  provider?: string;
}
