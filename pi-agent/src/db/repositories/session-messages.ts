/**
 * Session Messages Repository
 *
 * Stores AI SDK stream events for chat history persistence.
 * Enables UI reconstruction with tool calls, reasoning, and full message structure.
 */

import type Database from 'better-sqlite3';
import { getDatabase } from '../database.js';
import type { AISDKStreamEvent } from '../../api/stream-types.js';

/**
 * Events worth persisting (content-bearing).
 * Lifecycle events (start, finish, etc.) are skipped as they're reconstructable.
 */
export const PERSISTABLE_EVENT_TYPES = new Set([
  'text-delta',
  'user-transcript',
  'tool-call',
  'tool-result',
  'reasoning-delta',
  'reasoning-end',
  'error',
]);

export interface SessionMessage {
  id: number;
  session_id: string;
  event_type: string;
  payload: string; // JSON blob of AISDKStreamEvent
  created_at: string;
}

export class SessionMessagesRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Persist an AI SDK stream event for a session.
   * Only persists content-bearing events (text, tools, reasoning, errors).
   *
   * @returns The created message, or null if event type is not persistable
   */
  create(sessionId: string, event: AISDKStreamEvent): SessionMessage | null {
    if (!PERSISTABLE_EVENT_TYPES.has(event.type)) {
      return null;
    }

    const payload = JSON.stringify(event);

    const result = this.db
      .prepare(
        `INSERT INTO session_messages (session_id, event_type, payload)
         VALUES (?, ?, ?)`
      )
      .run(sessionId, event.type, payload);

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Find a message by ID.
   */
  findById(id: number): SessionMessage | null {
    return (
      (this.db
        .prepare('SELECT * FROM session_messages WHERE id = ?')
        .get(id) as SessionMessage) ?? null
    );
  }

  /**
   * Get all messages for a session, ordered by creation time.
   */
  getBySession(sessionId: string): SessionMessage[] {
    return this.db
      .prepare(
        `SELECT * FROM session_messages
         WHERE session_id = ?
         ORDER BY id ASC`
      )
      .all(sessionId) as SessionMessage[];
  }

  /**
   * Get messages for a session with parsed events.
   * Convenience method for replaying events.
   */
  getEventsForSession(sessionId: string): AISDKStreamEvent[] {
    const messages = this.getBySession(sessionId);
    return messages.map((msg) => JSON.parse(msg.payload) as AISDKStreamEvent);
  }

  /**
   * Delete all messages for a session.
   */
  deleteBySession(sessionId: string): number {
    const result = this.db
      .prepare('DELETE FROM session_messages WHERE session_id = ?')
      .run(sessionId);
    return result.changes;
  }

  /**
   * Get message count for a session.
   */
  countBySession(sessionId: string): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM session_messages WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return result.count;
  }
}
