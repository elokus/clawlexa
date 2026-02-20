/**
 * JSONL Session Logger - Append-only file-based session logging for debugging.
 *
 * Each session gets a `.jsonl` file in `.voiceclaw/.sessions/` with one JSON object per line.
 * Inspired by pi-mono's session persistence pattern.
 */

import { appendFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { CliSessionsRepository } from '../db/repositories/cli-sessions.js';

// Session log directory at project root
const SESSIONS_DIR = join(import.meta.dirname, '..', '..', '..', '..', '.voiceclaw', '.sessions');
type LoggerSessionType = 'voice' | 'subagent' | 'terminal';

export interface SessionLogEntry {
  type: string;
  id: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Logger instance for a single session. Appends JSONL entries to a file.
 * Uses lazy flush: buffers until first content event, then flushes all at once.
 */
export class SessionLogger {
  private filePath: string;
  private buffer: SessionLogEntry[] = [];
  private flushed = false;

  constructor(
    sessionId: string,
    sessionName: string | null,
    sessionType: LoggerSessionType,
    parentId: string | null = null,
    meta: Record<string, unknown> = {}
  ) {
    // Ensure .voiceclaw/.sessions/ directory exists
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    // Filename: use session name if available, else UUID prefix
    const rawName = sessionName ?? sessionId.slice(0, 12);
    const filename = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    this.filePath = join(SESSIONS_DIR, `${filename}.jsonl`);

    // Write session header
    this.append({
      type: 'session',
      version: 1,
      id: sessionId,
      sessionType,
      name: sessionName,
      parentId,
      ...meta,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Append an entry to the session log.
   * Buffers until first content event (text-delta, tool-call, user-transcript),
   * then flushes all buffered entries and switches to immediate append.
   */
  append(entry: SessionLogEntry): void {
    if (!this.flushed) {
      this.buffer.push(entry);
      // Flush on first content-bearing event
      const contentTypes = [
        'text-delta',
        'user-transcript',
        'tool-call',
        'tool-result',
        'reasoning-delta',
        'state-change',
        'cli-event',
        'webhook-status',
        'error',
      ];
      if (contentTypes.includes(entry.type)) {
        this.flush();
      }
      return;
    }
    this.writeLine(entry);
  }

  private flush(): void {
    for (const entry of this.buffer) {
      this.writeLine(entry);
    }
    this.buffer = [];
    this.flushed = true;
  }

  private writeLine(entry: SessionLogEntry): void {
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error(`[SessionLogger] Failed to write to ${this.filePath}:`, err);
    }
  }

  /** Get the file path for this session log */
  getFilePath(): string {
    return this.filePath;
  }
}

// ============================================================================
// Global logger registry - one logger per session
// ============================================================================

const loggers = new Map<string, SessionLogger>();
let logCounter = 0;

function createLogEntryId(prefix = 'evt'): string {
  logCounter += 1;
  return `${prefix}-${Date.now()}-${logCounter.toString(36)}`;
}

function mapSessionType(type: string | null): LoggerSessionType {
  if (type === 'voice' || type === 'terminal') return type;
  return 'subagent';
}

function ensureSessionLogger(sessionId: string): SessionLogger | null {
  const existing = loggers.get(sessionId);
  if (existing) return existing;

  const sessionsRepo = new CliSessionsRepository();
  const session = sessionsRepo.findById(sessionId);
  if (!session) return null;

  const logger = new SessionLogger(
    session.id,
    session.name,
    mapSessionType(session.type),
    session.parent_id,
    {
      profile: session.profile,
      agent_name: session.agent_name,
      goal: session.goal,
      status: session.status,
      created_at: session.created_at,
    }
  );
  loggers.set(sessionId, logger);
  return logger;
}

/**
 * Get or create a logger for a session.
 * Call this from wsBroadcast.streamChunk or voice-agent event handlers.
 */
export function getSessionLogger(
  sessionId: string,
  sessionName?: string | null,
  sessionType: LoggerSessionType = 'subagent',
  parentId?: string | null,
  meta?: Record<string, unknown>
): SessionLogger {
  let logger = loggers.get(sessionId);
  if (!logger) {
    logger = new SessionLogger(sessionId, sessionName ?? null, sessionType, parentId ?? null, meta ?? {});
    loggers.set(sessionId, logger);
  }
  return logger;
}

/**
 * Remove a logger from the registry (on session end).
 */
export function removeSessionLogger(sessionId: string): void {
  loggers.delete(sessionId);
}

/**
 * Clear all persisted session JSONL logs.
 * Returns number of deleted files.
 */
export function clearAllSessionLogs(): number {
  loggers.clear();

  if (!existsSync(SESSIONS_DIR)) {
    return 0;
  }

  let deleted = 0;
  const entries = readdirSync(SESSIONS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue;
    }

    const filePath = join(SESSIONS_DIR, entry.name);
    try {
      unlinkSync(filePath);
      deleted += 1;
    } catch (err) {
      console.error(`[SessionLogger] Failed to delete ${filePath}:`, err);
    }
  }

  return deleted;
}

/**
 * Clear session JSONL logs for specific sessions.
 * Returns number of deleted files.
 */
export function clearSessionLogsForSessions(
  sessions: Array<{ id: string; name: string | null }>
): number {
  if (!existsSync(SESSIONS_DIR) || sessions.length === 0) {
    return 0;
  }

  let deleted = 0;
  const filenames = new Set<string>();

  for (const session of sessions) {
    const rawName = session.name ?? session.id.slice(0, 12);
    const sanitized = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    filenames.add(`${sanitized}.jsonl`);
  }

  for (const filename of filenames) {
    const filePath = join(SESSIONS_DIR, filename);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      unlinkSync(filePath);
      deleted += 1;
    } catch (err) {
      console.error(`[SessionLogger] Failed to delete ${filePath}:`, err);
    }
  }

  return deleted;
}

/**
 * Log an AI SDK stream event for a session.
 * Converts the event to a JSONL entry and appends it.
 */
export function logStreamEvent(sessionId: string, event: { type: string; [key: string]: unknown }): void {
  const logger = ensureSessionLogger(sessionId);
  if (!logger) return;

  const entry: SessionLogEntry = {
    ...event,
    id: createLogEntryId('stream'),
    timestamp: new Date().toISOString(),
  };
  logger.append(entry);
}

/**
 * Log CLI event repository writes to session JSONL logs.
 */
export function logCliEvent(
  sessionId: string,
  eventType: string,
  payload: unknown
): void {
  const logger = ensureSessionLogger(sessionId);
  if (!logger) return;

  logger.append({
    type: 'cli-event',
    id: createLogEntryId('cli'),
    timestamp: new Date().toISOString(),
    eventType,
    payload,
  });
}

/**
 * Log webhook status updates to session JSONL logs.
 */
export function logWebhookStatus(
  sessionId: string,
  status: string,
  message?: string,
  output?: unknown
): void {
  const logger = ensureSessionLogger(sessionId);
  if (!logger) return;

  logger.append({
    type: 'webhook-status',
    id: createLogEntryId('wh'),
    timestamp: new Date().toISOString(),
    status,
    message: message ?? null,
    output: output ?? null,
  });
}
