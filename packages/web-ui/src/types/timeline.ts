// ═══════════════════════════════════════════════════════════════════════════
// Timeline Types - Unified conversation + tool execution stream
// ═══════════════════════════════════════════════════════════════════════════

import type { MessageRole } from './index';
import type {
  SpokenPrecision,
  SpokenWordCue,
  SpokenWordCueUpdate,
} from '@voiceclaw/voice-runtime';

export type { SpokenPrecision, SpokenWordCue, SpokenWordCueUpdate } from '@voiceclaw/voice-runtime';

export type TimelineItemType = 'transcript' | 'tool';

export interface BaseTimelineItem {
  id: string;
  type: TimelineItemType;
  timestamp: number;
}

export interface TranscriptItem extends BaseTimelineItem {
  type: 'transcript';
  role: MessageRole;
  content: string;
  ttfbMs?: number;
  audioRoundtripMs?: number;
  sttMs?: number;
  llmMs?: number;
  generatedContent?: string;
  spokenContent?: string;
  spokenChars?: number;
  spokenWords?: number;
  playbackMs?: number;
  precision?: SpokenPrecision;
  wordCues?: SpokenWordCue[];
  spokenFinalized?: boolean;
  pending?: boolean;
  itemId?: string; // OpenAI item correlation for message ordering
  order?: number; // Runtime-normalized conversation order
}

export interface ToolItem extends BaseTimelineItem {
  type: 'tool';
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  status: 'running' | 'completed' | 'error';
}

export type TimelineItem = TranscriptItem | ToolItem;
