/**
 * CLI Events Repository
 *
 * Event log for CLI session activities.
 */

import type Database from 'better-sqlite3';
import { getDatabase } from '../database.js';

export type EventType =
  | 'created'
  | 'started'
  | 'input'
  | 'output'
  | 'status_change'
  | 'error'
  | 'finished';

export interface CliEvent {
  id: number;
  session_id: string;
  event_type: EventType;
  payload: string | null;
  created_at: string;
}

export interface CreateEventInput {
  session_id: string;
  event_type: EventType;
  payload?: string | object;
}

export class CliEventsRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Log a new event for a session.
   */
  create(input: CreateEventInput): CliEvent {
    const payload =
      input.payload === undefined
        ? null
        : typeof input.payload === 'string'
          ? input.payload
          : JSON.stringify(input.payload);

    const result = this.db
      .prepare(
        `INSERT INTO cli_events (session_id, event_type, payload)
         VALUES (?, ?, ?)`
      )
      .run(input.session_id, input.event_type, payload);

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Find an event by ID.
   */
  findById(id: number): CliEvent | null {
    return (this.db.prepare('SELECT * FROM cli_events WHERE id = ?').get(id) as CliEvent) ?? null;
  }

  /**
   * Get all events for a session.
   */
  getBySession(sessionId: string, limit?: number): CliEvent[] {
    if (limit) {
      return this.db
        .prepare(
          `SELECT * FROM cli_events
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(sessionId, limit) as CliEvent[];
    }
    return this.db
      .prepare(
        `SELECT * FROM cli_events
         WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId) as CliEvent[];
  }

  /**
   * Get recent events across all sessions.
   */
  getRecent(limit: number = 100): CliEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM cli_events
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as CliEvent[];
  }

  /**
   * Get events by type for a session.
   */
  getByType(sessionId: string, eventType: EventType): CliEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM cli_events
         WHERE session_id = ? AND event_type = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId, eventType) as CliEvent[];
  }

  /**
   * Delete all events for a session.
   */
  deleteBySession(sessionId: string): number {
    const result = this.db
      .prepare('DELETE FROM cli_events WHERE session_id = ?')
      .run(sessionId);
    return result.changes;
  }
}
