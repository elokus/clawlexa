// ═══════════════════════════════════════════════════════════════════════════
// Timeline Types - Unified conversation + tool execution stream
// ═══════════════════════════════════════════════════════════════════════════

import type { MessageRole } from './index';

export type TimelineItemType = 'transcript' | 'tool';

export interface BaseTimelineItem {
  id: string;
  type: TimelineItemType;
  timestamp: number;
}

export interface SpokenWordCue {
  word: string;
  startMs: number;
  endMs: number;
  source: 'provider' | 'synthetic';
  timeBase: 'utterance';
}

export interface SpokenWordCueUpdate {
  mode: 'append' | 'replace';
  cues: SpokenWordCue[];
}

export interface TranscriptItem extends BaseTimelineItem {
  type: 'transcript';
  role: MessageRole;
  content: string;
  ttfbMs?: number;
  generatedContent?: string;
  spokenContent?: string;
  spokenChars?: number;
  spokenWords?: number;
  playbackMs?: number;
  precision?: 'ratio' | 'segment' | 'aligned' | 'provider-word-timestamps';
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
