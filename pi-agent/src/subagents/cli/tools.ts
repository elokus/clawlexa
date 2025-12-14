/**
 * CLI Agent Tools - Tools for managing Mac CLI sessions.
 *
 * These tools are used by the CLI orchestration agent to:
 * - Start headless sessions (claude -p) for quick tasks
 * - Start interactive sessions for complex implementations
 * - Monitor and control running sessions
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  generateId,
  CliSessionsRepository,
  CliEventsRepository,
} from '../../db/index.js';
import * as macClient from '../../tools/mac-client.js';
import { waitForSessionCompletion } from '../../api/webhooks.js';
import { wsBroadcast } from '../../api/websocket.js';

/**
 * Check if the Mac daemon is available.
 */
export async function isMacDaemonAvailable(): Promise<boolean> {
  const health = await macClient.checkHealth();
  return health !== null;
}

export const startHeadlessSessionTool = tool({
  description:
    'Start a headless Claude session with -p flag for quick tasks. Returns the result directly. IMPORTANT: After calling this tool, you MUST stop and provide your final response.',
  inputSchema: z.object({
    project_path: z
      .string()
      .describe('Full path to the project directory, e.g., ~/Code/Work/kireon/kireon-backend'),
    prompt: z.string().describe('The prompt to send to Claude with -p flag'),
  }),
  execute: async ({ project_path, prompt }: { project_path: string; prompt: string }) => {
    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    const sessionId = generateId();
    const command = `cd ${project_path} && claude -p "${prompt.replace(/"/g, '\\"')}"`;

    console.log(`[CliAgent] Starting headless session: ${sessionId}`);
    console.log(`[CliAgent] Command: ${command}`);

    // Create DB entry
    sessionsRepo.create({
      id: sessionId,
      goal: `Headless: ${prompt.substring(0, 100)}...`,
    });
    sessionsRepo.updateStatus(sessionId, 'running');

    eventsRepo.create({
      session_id: sessionId,
      event_type: 'started',
      payload: { command, project_path, prompt },
    });

    // Broadcast session start
    wsBroadcast.cliSessionCreated({
      id: sessionId,
      goal: prompt.substring(0, 100),
      mode: 'headless',
      projectPath: project_path,
      command,
    });

    try {
      // Start session on Mac
      const result = await macClient.startCliSession(sessionId, prompt, command);

      if (!result.success) {
        sessionsRepo.updateStatus(sessionId, 'error');
        eventsRepo.create({
          session_id: sessionId,
          event_type: 'error',
          payload: result.message,
        });
        return `Fehler beim Starten der Session: ${result.message}`;
      }

      // Wait for completion via webhook (no polling!)
      const completion = await waitForSessionCompletion(sessionId, 120_000);

      if (completion) {
        sessionsRepo.updateStatus(
          sessionId,
          completion.status === 'finished' ? 'finished' : 'error'
        );
        eventsRepo.create({
          session_id: sessionId,
          event_type: 'finished',
          payload: { message: completion.message },
        });

        // Cleanup: terminate the tmux session since headless is done
        try {
          await macClient.terminateSession(sessionId);
          console.log(`[CliAgent] Terminated tmux session for ${sessionId}`);
        } catch (cleanupError) {
          console.warn(`[CliAgent] Failed to cleanup tmux session ${sessionId}:`, cleanupError);
        }

        return completion.message || 'Aufgabe abgeschlossen, keine Ausgabe.';
      } else {
        sessionsRepo.updateStatus(sessionId, 'error');
        return 'Die Aufgabe hat zu lange gedauert. Bitte prüfe die Session manuell.';
      }
    } catch (error) {
      sessionsRepo.updateStatus(sessionId, 'error');
      eventsRepo.create({
        session_id: sessionId,
        event_type: 'error',
        payload: String(error),
      });
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const startInteractiveSessionTool = tool({
  description:
    'Start an interactive Claude session for complex tasks that need iteration. Returns immediately with "Session gestartet". IMPORTANT: After calling this tool, you MUST stop and provide your final response.',
  inputSchema: z.object({
    project_path: z.string().describe('Full path to the project directory'),
    initial_prompt: z.string().describe('Initial prompt/goal to send after session starts'),
  }),
  execute: async ({ project_path, initial_prompt }: { project_path: string; initial_prompt: string }) => {
    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    const sessionId = generateId();

    // Escape the prompt for shell
    const escapedPrompt = initial_prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$');

    // Start Claude with the initial prompt - stays interactive after first response
    const command = `cd ${project_path} && claude --dangerously-skip-permissions "${escapedPrompt}"`;

    console.log(`[CliAgent] Starting interactive session: ${sessionId}`);
    console.log(`[CliAgent] Command: ${command}`);
    console.log(`[CliAgent] Initial prompt: ${initial_prompt}`);

    // Create DB entry
    sessionsRepo.create({
      id: sessionId,
      goal: initial_prompt.substring(0, 200),
    });
    sessionsRepo.updateStatus(sessionId, 'running');

    eventsRepo.create({
      session_id: sessionId,
      event_type: 'started',
      payload: { command, project_path, initial_prompt },
    });

    // Broadcast session start
    wsBroadcast.cliSessionCreated({
      id: sessionId,
      goal: initial_prompt.substring(0, 100),
      mode: 'interactive',
      projectPath: project_path,
      command,
    });

    try {
      const result = await macClient.startCliSession(sessionId, initial_prompt, command);

      if (!result.success) {
        sessionsRepo.updateStatus(sessionId, 'error');
        return `Fehler beim Starten: ${result.message}`;
      }

      sessionsRepo.setMacSessionId(sessionId, result.tmuxSession);

      eventsRepo.create({
        session_id: sessionId,
        event_type: 'input',
        payload: { input: initial_prompt },
      });

      return `Interaktive Session gestartet in ${project_path}. Claude arbeitet jetzt an der Aufgabe.`;
    } catch (error) {
      sessionsRepo.updateStatus(sessionId, 'error');
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const sendSessionInputTool = tool({
  description: 'Send input/feedback to a running interactive session',
  inputSchema: z.object({
    session_id: z.string().describe('The session ID'),
    input: z.string().describe('The input to send'),
  }),
  execute: async ({ session_id, input }: { session_id: string; input: string }) => {
    const eventsRepo = new CliEventsRepository();

    console.log(`[CliAgent] Sending input to session ${session_id}: ${input}`);

    try {
      const result = await macClient.sendCliInput(session_id, input);

      eventsRepo.create({
        session_id,
        event_type: 'input',
        payload: { input },
      });

      return result.success ? 'Eingabe gesendet.' : `Fehler: ${result.message}`;
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const checkSessionStatusTool = tool({
  description: 'Check the status and recent output of a session',
  inputSchema: z.object({
    session_id: z.string().describe('The session ID'),
  }),
  execute: async ({ session_id }: { session_id: string }) => {
    console.log(`[CliAgent] Checking status for session ${session_id}`);

    try {
      const result = await macClient.readCliOutput(session_id);

      const recentOutput = result.output.slice(-10).join('\n');

      return `Status: ${result.status}\n\nLetzte Ausgabe:\n${recentOutput || '(keine Ausgabe)'}`;
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const listActiveSessionsTool = tool({
  description: 'List all active CLI sessions',
  inputSchema: z.object({}),
  execute: async () => {
    console.log(`[CliAgent] Listing active sessions`);

    try {
      const sessionsRepo = new CliSessionsRepository();
      const dbSessions = sessionsRepo.getActive();

      if (dbSessions.length === 0) {
        return 'Keine aktiven Sessions.';
      }

      const summaries = dbSessions.map(
        (s) => `- ${s.id.substring(0, 8)}: ${s.goal} (${s.status})`
      );

      return `Aktive Sessions:\n${summaries.join('\n')}`;
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const terminateSessionTool = tool({
  description: 'Terminate/cancel a running session',
  inputSchema: z.object({
    session_id: z.string().describe('The session ID to terminate'),
  }),
  execute: async ({ session_id }: { session_id: string }) => {
    console.log(`[CliAgent] Terminating session ${session_id}`);

    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    try {
      await macClient.terminateSession(session_id);
      sessionsRepo.updateStatus(session_id, 'cancelled');

      eventsRepo.create({
        session_id,
        event_type: 'finished',
        payload: { reason: 'terminated' },
      });

      return 'Session beendet.';
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Tool registry for the CLI orchestration agent.
 */
export const cliAgentTools = {
  start_headless_session: startHeadlessSessionTool,
  start_interactive_session: startInteractiveSessionTool,
  send_session_input: sendSessionInputTool,
  check_session_status: checkSessionStatusTool,
  list_active_sessions: listActiveSessionsTool,
  terminate_session: terminateSessionTool,
};
