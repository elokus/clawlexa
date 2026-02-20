/**
 * Database Schema and Migrations
 *
 * Central database for the voice agent control plane.
 * Tables:
 *   - cli_sessions: Mac CLI session metadata
 *   - cli_events: Session event log
 *   - session_messages: AI SDK stream events for chat history persistence
 *   - timers: Timers and reminders
 *   - agent_runs: Agent interaction history (optional)
 */

import type { Database } from 'bun:sqlite';

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
  {
    version: 3,
    name: 'unified_sessions',
    up: `
      -- Unify session management: orchestrators and terminals in one table
      -- Voice sessions are NOT persisted (fire-and-forget)

      -- Add session type: 'orchestrator' (stateful LLM agents) or 'terminal' (Claude Code CLI)
      ALTER TABLE cli_sessions ADD COLUMN type TEXT DEFAULT 'terminal';

      -- Orchestrator-specific fields
      ALTER TABLE cli_sessions ADD COLUMN agent_name TEXT;           -- 'cli', 'web_search', 'deep_thinking'
      ALTER TABLE cli_sessions ADD COLUMN model TEXT;                -- LLM model used
      ALTER TABLE cli_sessions ADD COLUMN conversation_history TEXT; -- JSON array for stateful agents

      -- Add finished timestamp for cleanup queries
      ALTER TABLE cli_sessions ADD COLUMN finished_at TEXT;

      -- Index for type queries
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_type ON cli_sessions(type);

      -- Update existing sessions to be terminals (they already are)
      UPDATE cli_sessions SET type = 'terminal' WHERE type IS NULL;
    `,
  },
  {
    version: 4,
    name: 'add_tool_call_id',
    up: `
      -- Link terminal sessions to the tool call that created them
      -- Enables clicking on tool calls in ActivityFeed to navigate to the session
      ALTER TABLE cli_sessions ADD COLUMN tool_call_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_tool_call ON cli_sessions(tool_call_id);
    `,
  },
  {
    version: 5,
    name: 'session_centric_architecture',
    up: `
      -- Phase 2 of Session-Centric Refactor: Voice sessions are now persisted
      -- Session types: 'voice' | 'subagent' | 'terminal' (replaces 'orchestrator')

      -- Add profile column for voice sessions (stores 'jarvis', 'marvin', etc.)
      ALTER TABLE cli_sessions ADD COLUMN profile TEXT;

      -- Rename 'orchestrator' → 'subagent' for terminology alignment
      UPDATE cli_sessions SET type = 'subagent' WHERE type = 'orchestrator';

      -- Index for quick profile lookups (voice session by profile)
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_profile ON cli_sessions(profile);
    `,
  },
  {
    version: 6,
    name: 'session_messages',
    up: `
      -- Store AI SDK stream events for chat history persistence
      -- Enables UI reconstruction with tool calls, reasoning, and full message structure

      CREATE TABLE IF NOT EXISTS session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES cli_sessions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,      -- 'text-delta', 'tool-call', 'user-transcript', etc.
        payload TEXT NOT NULL,         -- JSON blob of AISDKStreamEvent
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Index for fetching messages by session (most common query)
      CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id);
    `,
  },
  {
    version: 7,
    name: 'background_sessions',
    up: `
      -- Support for background/detached subagent sessions
      -- Background sessions run independently without blocking the voice agent
      -- They don't take over audio input and continue processing while user can speak

      ALTER TABLE cli_sessions ADD COLUMN background INTEGER DEFAULT 0;

      -- Index for querying background sessions
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_background ON cli_sessions(background);
    `,
  },
  {
    version: 8,
    name: 'session_names',
    up: `
      -- Human-readable session names (e.g., "swift-falcon")
      -- Generated automatically for subagents, optional for voice/terminal sessions
      ALTER TABLE cli_sessions ADD COLUMN name TEXT;

      -- Unique index (partial: only non-null names) for collision detection
      CREATE UNIQUE INDEX idx_cli_sessions_name ON cli_sessions(name) WHERE name IS NOT NULL;
    `,
  },
  {
    version: 9,
    name: 'handoff_packets',
    up: `
      -- Store handoff packets for debugging and replay
      -- Each packet captures the full context transferred from voice to a subagent
      CREATE TABLE IF NOT EXISTS handoff_packets (
        id TEXT PRIMARY KEY,
        source_session_id TEXT NOT NULL,
        target_session_id TEXT,
        request TEXT NOT NULL,
        voice_context TEXT NOT NULL,
        active_processes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (source_session_id) REFERENCES cli_sessions(id)
      );

      -- Index for querying handoffs by source session
      CREATE INDEX IF NOT EXISTS idx_handoff_packets_source ON handoff_packets(source_session_id);
    `,
  },
];

/**
 * Run all pending migrations on the database.
 */
export function runMigrations(db: Database): void {
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
    .query('SELECT version FROM _migrations')
    .all() as { version: number }[];
  const appliedVersions = new Set(applied.map((m) => m.version));

  // Apply pending migrations
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      console.log(`[DB] Applying migration ${migration.version}: ${migration.name}`);

      db.transaction(() => {
        db.exec(migration.up);
        db.query('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name
        );
      })();
    }
  }
}
