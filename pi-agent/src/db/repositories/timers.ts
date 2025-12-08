/**
 * Timers Repository
 *
 * CRUD operations for timers and reminders.
 */

import type Database from 'better-sqlite3';
import { getDatabase } from '../database.js';

export type TimerMode = 'tts' | 'agent';
export type TimerStatus = 'pending' | 'fired' | 'cancelled';

export interface Timer {
  id: number;
  fire_at: string;
  mode: TimerMode;
  message: string;
  status: TimerStatus;
  created_at: string;
}

export interface CreateTimerInput {
  fire_at: Date | string;
  message: string;
  mode?: TimerMode;
}

export class TimersRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Create a new timer.
   */
  create(input: CreateTimerInput): Timer {
    const fireAt =
      input.fire_at instanceof Date ? input.fire_at.toISOString() : input.fire_at;
    const mode = input.mode ?? 'tts';

    const result = this.db
      .prepare(
        `INSERT INTO timers (fire_at, mode, message, status)
         VALUES (?, ?, ?, 'pending')`
      )
      .run(fireAt, mode, input.message);

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Find a timer by ID.
   */
  findById(id: number): Timer | null {
    return (this.db.prepare('SELECT * FROM timers WHERE id = ?').get(id) as Timer) ?? null;
  }

  /**
   * List all timers, optionally filtered by status.
   */
  list(status?: TimerStatus): Timer[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM timers WHERE status = ? ORDER BY fire_at ASC')
        .all(status) as Timer[];
    }
    return this.db.prepare('SELECT * FROM timers ORDER BY fire_at ASC').all() as Timer[];
  }

  /**
   * Get pending timers that are due (fire_at <= now).
   */
  getDue(): Timer[] {
    // Compare against current ISO timestamp to handle both ISO and SQLite datetime formats
    const now = new Date().toISOString();
    return this.db
      .prepare(
        `SELECT * FROM timers
         WHERE status = 'pending' AND fire_at <= ?
         ORDER BY fire_at ASC`
      )
      .all(now) as Timer[];
  }

  /**
   * Get the next pending timer.
   */
  getNext(): Timer | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM timers
           WHERE status = 'pending'
           ORDER BY fire_at ASC
           LIMIT 1`
        )
        .get() as Timer) ?? null
    );
  }

  /**
   * Mark a timer as fired.
   */
  markFired(id: number): boolean {
    const result = this.db
      .prepare(`UPDATE timers SET status = 'fired' WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  /**
   * Cancel a timer.
   */
  cancel(id: number): boolean {
    const result = this.db
      .prepare(`UPDATE timers SET status = 'cancelled' WHERE id = ? AND status = 'pending'`)
      .run(id);
    return result.changes > 0;
  }

  /**
   * Delete a timer.
   */
  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM timers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get all pending timers.
   */
  getPending(): Timer[] {
    return this.db
      .prepare(
        `SELECT * FROM timers
         WHERE status = 'pending'
         ORDER BY fire_at ASC`
      )
      .all() as Timer[];
  }

  /**
   * Clean up old fired/cancelled timers (older than days).
   */
  cleanup(days: number = 7): number {
    const result = this.db
      .prepare(
        `DELETE FROM timers
         WHERE status IN ('fired', 'cancelled')
         AND created_at < datetime('now', '-' || ? || ' days')`
      )
      .run(days);
    return result.changes;
  }
}
