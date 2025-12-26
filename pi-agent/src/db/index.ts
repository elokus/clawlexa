/**
 * Database Module
 *
 * Central database for the voice agent control plane.
 */

// Database connection
export { getDatabase, closeDatabase, generateId } from './database.js';

// Repositories
export { CliSessionsRepository, SessionsRepository } from './repositories/cli-sessions.js';
export type {
  Session,
  CliSession,
  SessionStatus,
  SessionType,
  AgentName,
  VoiceProfile,
  SessionTreeNode,
  CreateSessionInput,
  CreateVoiceInput,
  CreateSubagentInput,
  CreateOrchestratorInput,
  CreateTerminalInput,
} from './repositories/cli-sessions.js';

export { CliEventsRepository } from './repositories/cli-events.js';
export type { CliEvent, EventType, CreateEventInput } from './repositories/cli-events.js';

export { TimersRepository } from './repositories/timers.js';
export type { Timer, TimerMode, TimerStatus, CreateTimerInput } from './repositories/timers.js';

export { AgentRunsRepository } from './repositories/agent-runs.js';
export type { AgentRun, CreateAgentRunInput } from './repositories/agent-runs.js';

export { SessionMessagesRepository, PERSISTABLE_EVENT_TYPES } from './repositories/session-messages.js';
export type { SessionMessage } from './repositories/session-messages.js';
