/**
 * Database Schema and Migrations
 *
 * Central database for the voice agent control plane.
 * Tables:
 *   - cli_sessions: Mac CLI session metadata
 *   - cli_events: Session event log
 *   - timers: Timers and reminders
 *   - agent_runs: Agent interaction history (optional)
 */

import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/**
 * All database migrations in order.
 * Each migration is applied once and tracked in the _migrations table.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- CLI Sessions metadata
      CREATE TABLE IF NOT EXISTS cli_sessions (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'waiting_for_input', 'finished', 'error', 'cancelled')),
        mac_session_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Session events log
      CREATE TABLE IF NOT EXISTS cli_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES cli_sessions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK(event_type IN ('created', 'started', 'input', 'output', 'status_change', 'error', 'finished')),
        payload TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Timers and reminders
      CREATE TABLE IF NOT EXISTS timers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fire_at TEXT NOT NULL,
        mode TEXT DEFAULT 'tts' CHECK(mode IN ('tts', 'agent')),
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'fired', 'cancelled')),
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Agent interaction history
      CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile TEXT,
        transcript TEXT,
        tool_calls TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_cli_events_session ON cli_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_status ON cli_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_timers_status_fire ON timers(status, fire_at);
    `,
  },
  {
    version: 2,
    name: 'add_session_hierarchy',
    up: `
      -- Add parent-child session tracking for Thread Rail visualization
      ALTER TABLE cli_sessions ADD COLUMN parent_id TEXT;
      ALTER TABLE cli_sessions ADD COLUMN thread_id TEXT;

      -- Indexes for hierarchy queries
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_parent ON cli_sessions(parent_id);
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_thread ON cli_sessions(thread_id);
    `,
  },
];

/**
 * Run all pending migrations on the database.
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get applied migrations
  const applied = db
    .prepare('SELECT version FROM _migrations')
    .all() as { version: number }[];
  const appliedVersions = new Set(applied.map((m) => m.version));

  // Apply pending migrations
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      console.log(`[DB] Applying migration ${migration.version}: ${migration.name}`);

      db.transaction(() => {
        db.exec(migration.up);
        db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name
        );
      })();
    }
  }
}
