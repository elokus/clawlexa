/**
 * Database Connection Manager
 *
 * Singleton pattern for SQLite database connection.
 * Uses bun:sqlite for synchronous, high-performance operations.
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { runMigrations } from './schema.js';

const DEFAULT_DB_PATH = join(homedir(), 'voice-agent.db');

let dbInstance: Database | null = null;

/**
 * Get the database instance (singleton).
 * Creates the database and runs migrations if needed.
 */
export function getDatabase(dbPath: string = DEFAULT_DB_PATH): Database {
  if (!dbInstance) {
    console.log(`[DB] Opening database at ${dbPath}`);
    dbInstance = new Database(dbPath);

    // Enable WAL mode for better concurrent access
    dbInstance.exec('PRAGMA journal_mode = WAL');

    // Enable foreign keys
    dbInstance.exec('PRAGMA foreign_keys = ON');

    // Run migrations
    runMigrations(dbInstance);

    console.log('[DB] Database initialized');
  }

  return dbInstance;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (dbInstance) {
    console.log('[DB] Closing database');
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Generate a unique ID for sessions.
 * Format: 8 character hex string
 */
export function generateId(): string {
  return Math.random().toString(16).substring(2, 10);
}
