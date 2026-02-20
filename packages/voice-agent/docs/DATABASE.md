# Database

SQLite database for the voice agent control plane, using `bun:sqlite` (not `better-sqlite3`).

## Connection

- **Location**: `~/voice-agent.db`
- **Driver**: `bun:sqlite` (`Database` is a named export)
- **WAL mode** enabled for concurrent access
- **Foreign keys** enabled via PRAGMA
- **Singleton** pattern in `src/db/database.ts`

```typescript
import { Database } from 'bun:sqlite';

// Singleton - created on first call, reused thereafter
const db = getDatabase();  // opens ~/voice-agent.db
```

## API Pattern

`bun:sqlite` uses `db.query()` (not `db.prepare()`):

```typescript
// Read one
db.query('SELECT * FROM cli_sessions WHERE id = ?').get(id) as Session;

// Read many
db.query('SELECT * FROM cli_sessions WHERE status = ?').all('running') as Session[];

// Write (returns { changes, lastInsertRowid })
db.query('INSERT INTO cli_sessions (id, goal) VALUES (?, ?)').run(id, goal);

// DDL / multi-statement
db.exec('PRAGMA journal_mode = WAL');

// Transactions
db.transaction(() => {
  db.exec(migration.up);
  db.query('INSERT INTO _migrations ...').run(...);
})();
```

## Migrations

Tracked in `_migrations` table. Applied once in order at startup via `runMigrations(db)`.

Source: `src/db/schema.ts`

| Version | Name | Description |
|---------|------|-------------|
| 1 | `initial_schema` | `cli_sessions`, `cli_events`, `timers`, `agent_runs` tables + indexes |
| 2 | `add_session_hierarchy` | `parent_id` and `thread_id` columns on `cli_sessions` |
| 3 | `unified_sessions` | `type`, `agent_name`, `model`, `conversation_history`, `finished_at` columns; renames orchestrator concept |
| 4 | `add_tool_call_id` | `tool_call_id` column linking terminal sessions to their creating tool call |
| 5 | `session_centric_architecture` | `profile` column; renames `orchestrator` type to `subagent`; voice sessions now persisted |
| 6 | `session_messages` | New `session_messages` table for AI SDK stream event persistence |
| 7 | `background_sessions` | `background` column for detached/fire-and-forget subagent sessions |
| 8 | `session_names` | `name` column with partial unique index for human-readable session names |
| 9 | `handoff_packets` | New `handoff_packets` table for structured context transfer |

## Tables

### cli_sessions

Main session table. All session types (voice, subagent, terminal) share this table.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Session ID (UUID for voice, 8-char hex for others) |
| `type` | TEXT | `'voice'`, `'subagent'`, or `'terminal'` |
| `name` | TEXT | Human-readable name (e.g. "swift-falcon"), unique among non-null |
| `goal` | TEXT | Session purpose / task description |
| `status` | TEXT | `pending`, `running`, `waiting_for_input`, `finished`, `error`, `cancelled` |
| `parent_id` | TEXT | Parent session ID (voice -> subagent -> terminal) |
| `thread_id` | TEXT | Legacy thread grouping (deprecated) |
| `profile` | TEXT | Voice profile name (`jarvis`, `marvin`) - voice sessions only |
| `agent_name` | TEXT | Agent type (`cli`, `web_search`, `deep_thinking`) - subagents only |
| `model` | TEXT | LLM model used - subagents only |
| `conversation_history` | TEXT | JSON array of messages - subagents only |
| `background` | INTEGER | `1` = detached/fire-and-forget - subagents only |
| `mac_session_id` | TEXT | Mac daemon session reference - terminals only |
| `tool_call_id` | TEXT | Tool call that created this session - terminals only |
| `created_at` | TEXT | ISO 8601 timestamp |
| `updated_at` | TEXT | ISO 8601 timestamp |
| `finished_at` | TEXT | ISO 8601 timestamp when session ended |

Indexes: `status`, `parent_id`, `thread_id`, `type`, `profile`, `tool_call_id`, `background`, `name` (unique partial).

### cli_events

Event log for session activities.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `session_id` | TEXT FK | References `cli_sessions(id)` ON DELETE CASCADE |
| `event_type` | TEXT | `created`, `started`, `input`, `output`, `status_change`, `error`, `finished` |
| `payload` | TEXT | JSON or string payload |
| `created_at` | TEXT | ISO 8601 timestamp |

### session_messages

AI SDK stream events for chat history persistence and UI reconstruction.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `session_id` | TEXT FK | References `cli_sessions(id)` ON DELETE CASCADE |
| `event_type` | TEXT | `text-delta`, `user-transcript`, `tool-call`, `tool-result`, `reasoning-delta`, `reasoning-end`, `error` |
| `payload` | TEXT | JSON blob of AISDKStreamEvent |
| `created_at` | TEXT | ISO 8601 timestamp |

Only content-bearing events are persisted (`PERSISTABLE_EVENT_TYPES`). Lifecycle events (start, finish) are skipped.

### handoff_packets

Structured context transfer from voice sessions to subagents.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Handoff packet ID |
| `source_session_id` | TEXT FK | Voice session that initiated the handoff |
| `target_session_id` | TEXT | Subagent session that received the handoff |
| `request` | TEXT | User's explicit request |
| `voice_context` | TEXT | JSON of recent voice conversation entries |
| `active_processes` | TEXT | JSON of running process summaries |
| `created_at` | TEXT | ISO 8601 timestamp |

### timers

Timers and reminders.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `fire_at` | TEXT | ISO 8601 timestamp when timer should fire |
| `mode` | TEXT | `tts` (spoken) or `agent` (starts conversation) |
| `message` | TEXT | Reminder message |
| `status` | TEXT | `pending`, `fired`, `cancelled` |
| `created_at` | TEXT | ISO 8601 timestamp |

### agent_runs

Optional history of agent interactions for debugging and analytics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `profile` | TEXT | Profile name (e.g. "Jarvis") |
| `transcript` | TEXT | Full conversation transcript |
| `tool_calls` | TEXT | JSON array of tool calls |
| `created_at` | TEXT | ISO 8601 timestamp |

## Repositories

Each table has a dedicated repository class in `src/db/repositories/`. All accept an optional `Database` parameter (defaults to singleton).

| Repository | File | Purpose |
|-----------|------|---------|
| `CliSessionsRepository` | `cli-sessions.ts` | Session CRUD, tree queries, cleanup |
| `CliEventsRepository` | `cli-events.ts` | Session event logging |
| `SessionMessagesRepository` | `session-messages.ts` | AI SDK stream event persistence |
| `HandoffsRepository` | `handoffs.ts` | HandoffPacket persistence |
| `TimersRepository` | `timers.ts` | Timer/reminder CRUD |
| `AgentRunsRepository` | `agent-runs.ts` | Agent interaction history |

### Key Repository Methods

**CliSessionsRepository** (also exported as `SessionsRepository`):

- `createVoice()`, `createSubagent()`, `createTerminal()` - Type-specific session creation
- `findById()`, `findByName()`, `findRunningVoice()`, `findRunningSubagent()` - Lookups
- `getActiveRoots()` - Roots with active descendants (recursive CTE)
- `getTree()`, `getActiveTrees()` - Session tree building for UI
- `getRecentTrees()` - Recent trees for chat history (configurable hours)
- `finish()` - Mark session as finished/cancelled/error with timestamp
- `cancelTree()` - Cascading cancel of session and all descendants
- `deleteTree()` - Delete session subtree (children first)
- `cleanup()` - Retention policy: leaf sessions after 24h, all finished after 10 days

## Cleanup / Retention

- **Leaf sessions** (subagent/voice without children): deleted after 24 hours
- **All finished sessions**: deleted after 10 days
- **Timers**: fired/cancelled timers cleaned up after 7 days
- **Agent runs**: cleaned up after 30 days
- Cascade deletes: `cli_events` and `session_messages` cascade from `cli_sessions`; `handoff_packets` are deleted explicitly
