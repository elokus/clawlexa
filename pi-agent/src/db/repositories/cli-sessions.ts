/**
 * CLI Sessions Repository
 *
 * CRUD operations for Mac CLI session metadata.
 */

import type Database from 'better-sqlite3';
import { getDatabase, generateId } from '../database.js';

export type SessionStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_input'
  | 'finished'
  | 'error'
  | 'cancelled';

export interface CliSession {
  id: string;
  goal: string;
  status: SessionStatus;
  mac_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  goal: string;
  id?: string;
}

export class CliSessionsRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Create a new CLI session.
   */
  create(input: CreateSessionInput): CliSession {
    const id = input.id ?? generateId();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO cli_sessions (id, goal, status, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?)`
      )
      .run(id, input.goal, now, now);

    return this.findById(id)!;
  }

  /**
   * Find a session by ID.
   */
  findById(id: string): CliSession | null {
    return (
      (this.db.prepare('SELECT * FROM cli_sessions WHERE id = ?').get(id) as CliSession) ?? null
    );
  }

  /**
   * List all sessions, optionally filtered by status.
   */
  list(status?: SessionStatus): CliSession[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM cli_sessions WHERE status = ? ORDER BY created_at DESC')
        .all(status) as CliSession[];
    }
    return this.db
      .prepare('SELECT * FROM cli_sessions ORDER BY created_at DESC')
      .all() as CliSession[];
  }

  /**
   * Update session status.
   */
  updateStatus(id: string, status: SessionStatus): boolean {
    const result = this.db
      .prepare(
        `UPDATE cli_sessions SET status = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(status, id);
    return result.changes > 0;
  }

  /**
   * Set the Mac daemon session ID.
   */
  setMacSessionId(id: string, macSessionId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE cli_sessions SET mac_session_id = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(macSessionId, id);
    return result.changes > 0;
  }

  /**
   * Delete a session and its events (cascade).
   */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM cli_sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get active sessions (pending, running, or waiting_for_input).
   */
  getActive(): CliSession[] {
    return this.db
      .prepare(
        `SELECT * FROM cli_sessions
         WHERE status IN ('pending', 'running', 'waiting_for_input')
         ORDER BY created_at DESC`
      )
      .all() as CliSession[];
  }
}
