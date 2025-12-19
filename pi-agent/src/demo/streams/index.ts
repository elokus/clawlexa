/**
 * Demo Streams - Pre-recorded agent interaction streams.
 *
 * Each stream represents a captured agent interaction that can be
 * replayed for component development and testing.
 *
 * Streams can be:
 * 1. Hardcoded in this file (simplified mocks)
 * 2. Loaded from captured JSON files (real data)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WSMessageType } from '../../api/types.js';

export interface DemoEvent {
  type: WSMessageType;
  payload: unknown;
  /** Delay in ms before this event (for realistic timing) */
  delay?: number;
}

export interface DemoStream {
  id: string;
  name: string;
  description: string;
  agent: string;
  events: DemoEvent[];
}

// Registry of available streams
export const streams = new Map<string, DemoStream>();

// ═══════════════════════════════════════════════════════════════════════════
// Load captured streams from JSON files
// ═══════════════════════════════════════════════════════════════════════════

function loadCapturedStreams() {
  const capturedDir = path.join(import.meta.dirname, '../../captured');

  if (!fs.existsSync(capturedDir)) {
    console.log('[Demo] No captured directory found');
    return;
  }

  const files = fs.readdirSync(capturedDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filepath = path.join(capturedDir, file);
      const content = fs.readFileSync(filepath, 'utf-8');
      const events = JSON.parse(content) as DemoEvent[];

      // Extract agent name from first event
      const firstEvent = events[0];
      const agent = (firstEvent?.payload as { agent?: string })?.agent || 'Unknown';

      // Generate ID from filename
      const id = file.replace('.json', '');
      const name = id
        .replace(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, '') // Remove timestamp
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      streams.set(id, {
        id,
        name: `${name} (Captured)`,
        description: `Real captured stream with ${events.length} events`,
        agent,
        events,
      });

      console.log(`[Demo] Loaded captured stream: ${id} (${events.length} events)`);
    } catch (err) {
      console.error(`[Demo] Failed to load ${file}:`, err);
    }
  }
}

// Load captured streams on module init
loadCapturedStreams();

// Helper to create subagent activity events
function activity(
  agent: string,
  type: string,
  payload: unknown,
  delay: number = 100
): DemoEvent {
  return {
    type: 'subagent_activity',
    payload: { agent, type, payload },
    delay,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI Agent - Code Review Stream
// ═══════════════════════════════════════════════════════════════════════════

const cliCodeReview: DemoStream = {
  id: 'cli-code-review',
  name: 'CLI Code Review',
  description: 'Marvin reviewing code in a backend project',
  agent: 'Marvin',
  events: [
    // Reasoning phase
    activity('Marvin', 'reasoning_start', {}, 200),
    activity('Marvin', 'reasoning_delta', { delta: 'The user wants me to review the code in the Kireon backend. ' }, 50),
    activity('Marvin', 'reasoning_delta', { delta: 'This is a complex project with authentication, database models, and API endpoints. ' }, 80),
    activity('Marvin', 'reasoning_delta', { delta: 'I should start a headless session to quickly analyze the codebase structure ' }, 60),
    activity('Marvin', 'reasoning_delta', { delta: 'and identify any potential issues with the current implementation. ' }, 70),
    activity('Marvin', 'reasoning_delta', { delta: 'Looking at the request, this seems like a quick review task rather than ' }, 50),
    activity('Marvin', 'reasoning_delta', { delta: 'a complex refactoring, so headless mode is appropriate.' }, 60),
    activity('Marvin', 'reasoning_end', { text: 'The user wants me to review...', durationMs: 2340 }, 100),

    // Tool call - start session
    activity('Marvin', 'tool_call', {
      toolName: 'start_headless_session',
      toolCallId: 'call_abc123',
      args: {
        project_path: '~/Code/Work/kireon/kireon-backend',
        prompt: 'Review the authentication implementation and identify any security concerns or code quality issues.',
      },
    }, 150),

    // Tool result
    activity('Marvin', 'tool_result', {
      toolName: 'start_headless_session',
      toolCallId: 'call_abc123',
      result: JSON.stringify({
        sessionId: 'session_xyz789',
        status: 'completed',
        summary: 'Code review completed. Found 3 minor issues: 1) Missing rate limiting on login endpoint, 2) JWT secret should use environment variable, 3) Password validation could be stricter.',
      }),
    }, 3000),

    // Final response
    activity('Marvin', 'response', {
      text: 'I\'ve reviewed the authentication implementation in Kireon backend. Found a few things to address:\n\n1. **Rate Limiting**: The login endpoint lacks rate limiting, which could allow brute force attacks.\n\n2. **JWT Secret**: The secret is hardcoded. Move it to an environment variable.\n\n3. **Password Validation**: Consider adding stricter rules (minimum length, special characters).\n\nWant me to create fixes for any of these?',
    }, 200),

    // Complete
    activity('Marvin', 'complete', { success: true }, 100),
  ],
};

streams.set(cliCodeReview.id, cliCodeReview);

// ═══════════════════════════════════════════════════════════════════════════
// CLI Agent - Interactive Session Stream
// ═══════════════════════════════════════════════════════════════════════════

const cliInteractive: DemoStream = {
  id: 'cli-interactive',
  name: 'CLI Interactive Session',
  description: 'Marvin starting an interactive coding session',
  agent: 'Marvin',
  events: [
    // Reasoning
    activity('Marvin', 'reasoning_start', {}, 150),
    activity('Marvin', 'reasoning_delta', { delta: 'The user wants to implement a new feature - user authentication. ' }, 60),
    activity('Marvin', 'reasoning_delta', { delta: 'This is a complex task that will require multiple file changes, ' }, 55),
    activity('Marvin', 'reasoning_delta', { delta: 'database migrations, and careful implementation. ' }, 50),
    activity('Marvin', 'reasoning_delta', { delta: 'I should use an interactive session so I can work through this step by step ' }, 65),
    activity('Marvin', 'reasoning_delta', { delta: 'and handle any issues that come up during implementation.' }, 60),
    activity('Marvin', 'reasoning_end', { text: 'The user wants...', durationMs: 1890 }, 100),

    // Tool call - start interactive session
    activity('Marvin', 'tool_call', {
      toolName: 'start_interactive_session',
      toolCallId: 'call_int456',
      args: {
        project_path: '~/Code/Private/kalm-monorepo/backend',
        prompt: 'Implement user authentication with JWT tokens. Include user registration, login, logout, and password reset endpoints. Use bcrypt for password hashing.',
      },
    }, 150),

    // Tool result
    activity('Marvin', 'tool_result', {
      toolName: 'start_interactive_session',
      toolCallId: 'call_int456',
      result: JSON.stringify({
        sessionId: 'session_auth001',
        status: 'running',
        message: 'Interactive session started. Claude is working on the authentication implementation.',
      }),
    }, 500),

    // Session created broadcast
    {
      type: 'cli_session_created',
      payload: {
        id: 'session_auth001',
        goal: 'Implement user authentication with JWT tokens',
        mode: 'interactive',
        projectPath: '~/Code/Private/kalm-monorepo/backend',
        command: 'claude --dangerously-skip-permissions',
      },
      delay: 100,
    } as DemoEvent,

    // Response
    activity('Marvin', 'response', {
      text: 'I\'ve started an interactive session to implement user authentication. You can monitor the progress in the terminal view. This will include:\n\n- User registration endpoint\n- Login with JWT tokens\n- Logout (token invalidation)\n- Password reset flow\n\nI\'ll let you know when it\'s complete or if I need any input.',
    }, 200),

    // Complete
    activity('Marvin', 'complete', { success: true }, 100),
  ],
};

streams.set(cliInteractive.id, cliInteractive);

// ═══════════════════════════════════════════════════════════════════════════
// Web Search Agent Stream
// ═══════════════════════════════════════════════════════════════════════════

const webSearch: DemoStream = {
  id: 'web-search',
  name: 'Web Search',
  description: 'Jarvis searching for weather information',
  agent: 'Jarvis',
  events: [
    // Reasoning
    activity('Jarvis', 'reasoning_start', {}, 150),
    activity('Jarvis', 'reasoning_delta', { delta: 'Der Nutzer fragt nach dem Wetter in Bonn. ' }, 40),
    activity('Jarvis', 'reasoning_delta', { delta: 'Ich werde die aktuelle Wettervorhersage suchen ' }, 50),
    activity('Jarvis', 'reasoning_delta', { delta: 'und die wichtigsten Informationen zusammenfassen: ' }, 45),
    activity('Jarvis', 'reasoning_delta', { delta: 'Temperatur, Niederschlag, und eine Empfehlung für morgen.' }, 55),
    activity('Jarvis', 'reasoning_end', { text: 'Der Nutzer fragt...', durationMs: 890 }, 100),

    // Response (web search is implicit via :online model)
    activity('Jarvis', 'response', {
      text: 'Das Wetter in Bonn morgen:\n\n**Temperatur**: 6-12°C\n**Himmel**: Bewölkt mit gelegentlichen Auflockerungen\n**Niederschlag**: 40% Regenwahrscheinlichkeit am Nachmittag\n**Wind**: Leicht aus Südwest, 10-15 km/h\n\nEmpfehlung: Nimm sicherheitshalber einen Regenschirm mit, falls du länger draußen bist.',
    }, 1500),

    // Complete
    activity('Jarvis', 'complete', { success: true }, 100),
  ],
};

streams.set(webSearch.id, webSearch);

// ═══════════════════════════════════════════════════════════════════════════
// Error Handling Stream
// ═══════════════════════════════════════════════════════════════════════════

const errorStream: DemoStream = {
  id: 'error-handling',
  name: 'Error Handling',
  description: 'Agent encountering and reporting an error',
  agent: 'Marvin',
  events: [
    // Reasoning
    activity('Marvin', 'reasoning_start', {}, 150),
    activity('Marvin', 'reasoning_delta', { delta: 'Attempting to connect to the Mac daemon ' }, 50),
    activity('Marvin', 'reasoning_delta', { delta: 'to start a coding session...' }, 40),
    activity('Marvin', 'reasoning_end', { text: 'Attempting...', durationMs: 450 }, 100),

    // Tool call
    activity('Marvin', 'tool_call', {
      toolName: 'start_interactive_session',
      toolCallId: 'call_err456',
      args: {
        project_path: '~/Code/Private/kalm-monorepo',
        prompt: 'Add user authentication to the backend',
      },
    }, 150),

    // Error
    activity('Marvin', 'error', {
      message: 'Connection refused: Mac daemon not running at http://MacBook-Pro-von-Lukasz.local:3100. Please ensure the daemon is started.',
    }, 2000),

    // Complete with failure
    activity('Marvin', 'complete', { success: false, error: 'Connection refused' }, 100),
  ],
};

streams.set(errorStream.id, errorStream);

// ═══════════════════════════════════════════════════════════════════════════
// Multi-Tool Stream
// ═══════════════════════════════════════════════════════════════════════════

const multiTool: DemoStream = {
  id: 'multi-tool',
  name: 'Multi-Tool Workflow',
  description: 'Agent using multiple tools in sequence',
  agent: 'Marvin',
  events: [
    // Reasoning
    activity('Marvin', 'reasoning_start', {}, 150),
    activity('Marvin', 'reasoning_delta', { delta: 'The user wants to set up a new feature branch and start working on it. ' }, 60),
    activity('Marvin', 'reasoning_delta', { delta: 'I need to first check the current git status, ' }, 50),
    activity('Marvin', 'reasoning_delta', { delta: 'then create the branch, and finally start an interactive session.' }, 55),
    activity('Marvin', 'reasoning_end', { text: 'The user wants...', durationMs: 1230 }, 100),

    // First tool - check status
    activity('Marvin', 'tool_call', {
      toolName: 'start_headless_session',
      toolCallId: 'call_git001',
      args: {
        project_path: '~/Code/Work/kireon/kireon-backend',
        prompt: 'Run git status and git branch to check current state',
      },
    }, 150),

    activity('Marvin', 'tool_result', {
      toolName: 'start_headless_session',
      toolCallId: 'call_git001',
      result: 'On branch main. Working tree clean. Available branches: main, develop, feature/auth',
    }, 1500),

    // Second tool - create branch
    activity('Marvin', 'tool_call', {
      toolName: 'start_headless_session',
      toolCallId: 'call_git002',
      args: {
        project_path: '~/Code/Work/kireon/kireon-backend',
        prompt: 'Create and checkout new branch feature/user-profiles',
      },
    }, 200),

    activity('Marvin', 'tool_result', {
      toolName: 'start_headless_session',
      toolCallId: 'call_git002',
      result: 'Switched to a new branch \'feature/user-profiles\'',
    }, 800),

    // Third tool - start session
    activity('Marvin', 'tool_call', {
      toolName: 'start_interactive_session',
      toolCallId: 'call_feat003',
      args: {
        project_path: '~/Code/Work/kireon/kireon-backend',
        prompt: 'Implement user profiles feature with avatar upload and bio fields',
      },
    }, 200),

    activity('Marvin', 'tool_result', {
      toolName: 'start_interactive_session',
      toolCallId: 'call_feat003',
      result: JSON.stringify({
        sessionId: 'session_profiles001',
        status: 'running',
      }),
    }, 500),

    // Response
    activity('Marvin', 'response', {
      text: 'All set! I\'ve:\n\n1. Verified the repo is clean on main\n2. Created branch `feature/user-profiles`\n3. Started an interactive session for the implementation\n\nThe session is now running. I\'ll work on adding user profiles with avatar upload and bio fields.',
    }, 200),

    activity('Marvin', 'complete', { success: true }, 100),
  ],
};

streams.set(multiTool.id, multiTool);
