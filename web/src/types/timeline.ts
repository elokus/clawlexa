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

export interface TranscriptItem extends BaseTimelineItem {
  type: 'transcript';
  role: MessageRole;
  content: string;
  pending?: boolean;
}

export interface ToolItem extends BaseTimelineItem {
  type: 'tool';
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  status: 'running' | 'completed' | 'error';
}

export type TimelineItem = TranscriptItem | ToolItem;
