/**
 * HandoffPacket - Structured context transfer from voice to subagents.
 *
 * Solves the "telephone effect" where context is lost at each handoff boundary:
 *   Voice (10 turns about Kireon auth bug)
 *     → developer_session("fix the auth endpoint bug")  ← only last turn
 *       → CLI Agent gets: tool args + poorly formatted history
 *
 * With HandoffPacket:
 *   Voice (10 turns about Kireon auth bug)
 *     → developer_session builds HandoffPacket with full context
 *       → CLI Agent gets: request + 20 recent voice entries + active processes
 */

import { generateId } from '../db/index.js';
import type { ManagedProcess } from '../processes/manager.js';

export interface HandoffPacket {
  /** Unique ID for this handoff */
  id: string;

  /** When the handoff was created */
  timestamp: number;

  /** The user's explicit request (from tool args) */
  request: string;

  /** Recent voice conversation (last N turns, properly formatted) */
  voiceContext: VoiceContextEntry[];

  /** Active/recent background tasks and their status */
  activeProcesses: ProcessSummary[];

  /** Metadata about the source */
  source: {
    sessionId: string;
    profile: string; // 'jarvis' | 'marvin'
  };
}

export interface VoiceContextEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Whether this was a tool call/result (provides extra context) */
  toolInfo?: { name: string; args?: unknown; result?: string };
}

export interface ProcessSummary {
  name: string;
  status: 'running' | 'finished' | 'error';
  goal: string;
  startedAt: number;
  result?: string;
}

/**
 * Build a HandoffPacket from voice agent state.
 */
export function buildHandoffPacket(params: {
  request: string;
  voiceContext: VoiceContextEntry[];
  activeProcesses: ManagedProcess[];
  sessionId: string;
  profile: string;
}): HandoffPacket {
  return {
    id: generateId(),
    timestamp: Date.now(),
    request: params.request,
    voiceContext: params.voiceContext.slice(-20), // last 20 entries
    activeProcesses: params.activeProcesses.map(p => ({
      name: p.name,
      status: p.status === 'finished' ? 'finished' : p.status === 'error' ? 'error' : 'running',
      goal: p.name, // process name serves as goal
      startedAt: p.startedAt,
      result: p.result,
    })),
    source: {
      sessionId: params.sessionId,
      profile: params.profile,
    },
  };
}

/**
 * Format a HandoffPacket's voice context into a readable text block.
 * Used by subagents to include in their system prompt.
 */
export function formatVoiceContext(packet: HandoffPacket): string {
  if (packet.voiceContext.length === 0) {
    return '(direct request, no voice context)';
  }

  return packet.voiceContext
    .map(entry => {
      if (entry.toolInfo) {
        return `[tool:${entry.toolInfo.name}] ${entry.toolInfo.result || entry.content}`;
      }
      return `[${entry.role}] ${entry.content}`;
    })
    .join('\n');
}

/**
 * Format active processes into a readable text block.
 */
export function formatActiveProcesses(packet: HandoffPacket): string {
  if (packet.activeProcesses.length === 0) {
    return 'None';
  }

  return packet.activeProcesses
    .map(p => `- ${p.name} (${p.status}): ${p.goal}${p.result ? ` → ${p.result.substring(0, 100)}` : ''}`)
    .join('\n');
}
