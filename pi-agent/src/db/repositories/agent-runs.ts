/**
 * Agent Runs Repository
 *
 * Optional history of agent interactions for debugging and analytics.
 */

import type { Database } from 'bun:sqlite';
import { getDatabase } from '../database.js';

export interface AgentRun {
  id: number;
  profile: string | null;
  transcript: string | null;
  tool_calls: string | null;
  created_at: string;
}

export interface CreateAgentRunInput {
  profile?: string;
  transcript?: string;
  tool_calls?: string | object[];
}

export class AgentRunsRepository {
  private db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Log a new agent run.
   */
  create(input: CreateAgentRunInput): AgentRun {
    const toolCalls =
      input.tool_calls === undefined
        ? null
        : typeof input.tool_calls === 'string'
          ? input.tool_calls
          : JSON.stringify(input.tool_calls);

    const result = this.db
      .query(
        `INSERT INTO agent_runs (profile, transcript, tool_calls)
         VALUES (?, ?, ?)`
      )
      .run(input.profile ?? null, input.transcript ?? null, toolCalls);

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Find a run by ID.
   */
  findById(id: number): AgentRun | null {
    return (this.db.query('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRun) ?? null;
  }

  /**
   * Get recent runs.
   */
  getRecent(limit: number = 50): AgentRun[] {
    return this.db
      .query(
        `SELECT * FROM agent_runs
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as AgentRun[];
  }

  /**
   * Get runs by profile.
   */
  getByProfile(profile: string, limit?: number): AgentRun[] {
    if (limit) {
      return this.db
        .query(
          `SELECT * FROM agent_runs
           WHERE profile = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(profile, limit) as AgentRun[];
    }
    return this.db
      .query(
        `SELECT * FROM agent_runs
         WHERE profile = ?
         ORDER BY created_at DESC`
      )
      .all(profile) as AgentRun[];
  }

  /**
   * Delete old runs (older than days).
   */
  cleanup(days: number = 30): number {
    const result = this.db
      .query(
        `DELETE FROM agent_runs
         WHERE created_at < datetime('now', '-' || ? || ' days')`
      )
      .run(days);
    return result.changes;
  }

  /**
   * Get run count statistics.
   */
  getStats(): { total: number; by_profile: Record<string, number> } {
    const total = (
      this.db.query('SELECT COUNT(*) as count FROM agent_runs').get() as { count: number }
    ).count;

    const byProfile = this.db
      .query(
        `SELECT profile, COUNT(*) as count FROM agent_runs
         WHERE profile IS NOT NULL
         GROUP BY profile`
      )
      .all() as { profile: string; count: number }[];

    const profileMap: Record<string, number> = {};
    for (const row of byProfile) {
      profileMap[row.profile] = row.count;
    }

    return { total, by_profile: profileMap };
  }
}
