/**
 * Database Module
 *
 * Central database for the voice agent control plane.
 */

// Database connection
export { getDatabase, closeDatabase, generateId } from './database.js';

// Repositories
export { CliSessionsRepository } from './repositories/cli-sessions.js';
export type { CliSession, SessionStatus, CreateSessionInput } from './repositories/cli-sessions.js';

export { CliEventsRepository } from './repositories/cli-events.js';
export type { CliEvent, EventType, CreateEventInput } from './repositories/cli-events.js';

export { TimersRepository } from './repositories/timers.js';
export type { Timer, TimerMode, TimerStatus, CreateTimerInput } from './repositories/timers.js';

export { AgentRunsRepository } from './repositories/agent-runs.js';
export type { AgentRun, CreateAgentRunInput } from './repositories/agent-runs.js';
