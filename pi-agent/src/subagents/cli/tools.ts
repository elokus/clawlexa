/**
 * CLI Agent Tools - Tools for managing Mac CLI sessions.
 *
 * These tools create TERMINAL sessions as children of the CLI orchestrator.
 * Session Hierarchy:
 *   Orchestrator (stateful, created in index.ts)
 *     → Terminal 1 (long-running Claude Code CLI)
 *     → Terminal 2
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
import { getCurrentOrchestratorId, consumePendingToolCall } from './index.js';

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

    const terminalId = generateId();
    const orchestratorId = getCurrentOrchestratorId();
    const command = `cd ${project_path} && claude -p "${prompt.replace(/"/g, '\\"')}"`;

    console.log(`[CliAgent] Starting headless terminal: ${terminalId}`);
    console.log(`[CliAgent] Parent orchestrator: ${orchestratorId ?? 'none'}`);
    console.log(`[CliAgent] Command: ${command}`);

    if (!orchestratorId) {
      return 'Fehler: Kein aktiver Orchestrator. Bitte starte eine neue Anfrage.';
    }

    // Get the tool call ID for linking this session to the tool call
    const toolCallId = consumePendingToolCall(orchestratorId);
    console.log(`[CliAgent] Tool call ID: ${toolCallId ?? 'none'}`);

    // Create terminal session as child of orchestrator
    sessionsRepo.createTerminal({
      id: terminalId,
      goal: `Headless: ${prompt.substring(0, 100)}...`,
      parent_id: orchestratorId,
      tool_call_id: toolCallId,
    });

    eventsRepo.create({
      session_id: terminalId,
      event_type: 'started',
      payload: { command, project_path, prompt },
    });

    // Broadcast tree update (terminal added)
    wsBroadcast.sessionTreeUpdate(orchestratorId);

    try {
      // Start session on Mac
      const result = await macClient.startCliSession(terminalId, prompt, command);

      if (!result.success) {
        sessionsRepo.finish(terminalId, 'error');
        eventsRepo.create({
          session_id: terminalId,
          event_type: 'error',
          payload: result.message,
        });
        wsBroadcast.sessionTreeUpdate(orchestratorId);
        return `Fehler beim Starten der Session: ${result.message}`;
      }

      // Wait for completion via webhook (no polling!)
      const completion = await waitForSessionCompletion(terminalId, 120_000);

      if (completion) {
        sessionsRepo.finish(
          terminalId,
          completion.status === 'finished' ? 'finished' : 'error'
        );
        eventsRepo.create({
          session_id: terminalId,
          event_type: 'finished',
          payload: { message: completion.message },
        });

        // Cleanup: terminate the tmux session since headless is done
        try {
          await macClient.terminateSession(terminalId);
          console.log(`[CliAgent] Terminated tmux session for ${terminalId}`);
        } catch (cleanupError) {
          console.warn(`[CliAgent] Failed to cleanup tmux session ${terminalId}:`, cleanupError);
        }

        wsBroadcast.sessionTreeUpdate(orchestratorId);
        return completion.message || 'Aufgabe abgeschlossen, keine Ausgabe.';
      } else {
        sessionsRepo.finish(terminalId, 'error');
        wsBroadcast.sessionTreeUpdate(orchestratorId);
        return 'Die Aufgabe hat zu lange gedauert. Bitte prüfe die Session manuell.';
      }
    } catch (error) {
      sessionsRepo.finish(terminalId, 'error');
      eventsRepo.create({
        session_id: terminalId,
        event_type: 'error',
        payload: String(error),
      });
      wsBroadcast.sessionTreeUpdate(orchestratorId);
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

    const terminalId = generateId();
    const orchestratorId = getCurrentOrchestratorId();

    // Escape the prompt for shell
    const escapedPrompt = initial_prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$');

    // Start Claude with the initial prompt - stays interactive after first response
    const command = `cd ${project_path} && claude --dangerously-skip-permissions "${escapedPrompt}"`;

    console.log(`[CliAgent] Starting interactive terminal: ${terminalId}`);
    console.log(`[CliAgent] Parent orchestrator: ${orchestratorId ?? 'none'}`);
    console.log(`[CliAgent] Command: ${command}`);
    console.log(`[CliAgent] Initial prompt: ${initial_prompt}`);

    if (!orchestratorId) {
      return 'Fehler: Kein aktiver Orchestrator. Bitte starte eine neue Anfrage.';
    }

    // Get the tool call ID for linking this session to the tool call
    const toolCallId = consumePendingToolCall(orchestratorId);
    console.log(`[CliAgent] Tool call ID: ${toolCallId ?? 'none'}`);

    // Create terminal session as child of orchestrator
    sessionsRepo.createTerminal({
      id: terminalId,
      goal: initial_prompt.substring(0, 200),
      parent_id: orchestratorId,
      tool_call_id: toolCallId,
    });

    eventsRepo.create({
      session_id: terminalId,
      event_type: 'started',
      payload: { command, project_path, initial_prompt },
    });

    // Broadcast tree update (terminal added)
    wsBroadcast.sessionTreeUpdate(orchestratorId);

    try {
      const result = await macClient.startCliSession(terminalId, initial_prompt, command);

      if (!result.success) {
        sessionsRepo.finish(terminalId, 'error');
        wsBroadcast.sessionTreeUpdate(orchestratorId);
        return `Fehler beim Starten: ${result.message}`;
      }

      sessionsRepo.update(terminalId, { mac_session_id: result.tmuxSession });

      eventsRepo.create({
        session_id: terminalId,
        event_type: 'input',
        payload: { input: initial_prompt },
      });

      wsBroadcast.sessionTreeUpdate(orchestratorId);
      return `Interaktive Session gestartet in ${project_path}. Claude arbeitet jetzt an der Aufgabe.`;
    } catch (error) {
      sessionsRepo.finish(terminalId, 'error');
      wsBroadcast.sessionTreeUpdate(orchestratorId);
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
  description: 'Terminate/cancel a running session and delete it from the database',
  inputSchema: z.object({
    session_id: z.string().describe('The session ID to terminate'),
  }),
  execute: async ({ session_id }: { session_id: string }) => {
    console.log(`[CliAgent] Terminating session ${session_id}`);

    const sessionsRepo = new CliSessionsRepository();

    try {
      // Get session to find parent for tree update
      const session = sessionsRepo.findById(session_id);
      const parentId = session?.parent_id;

      // Terminate on Mac daemon
      await macClient.terminateSession(session_id);

      // Delete from database (cascade deletes events too)
      sessionsRepo.delete(session_id);
      console.log(`[CliAgent] Deleted session ${session_id} from database`);

      // Broadcast deletion to connected clients
      wsBroadcast.cliSessionDeleted(session_id);

      // Broadcast tree update if we have a parent
      if (parentId) {
        wsBroadcast.sessionTreeUpdate(parentId);
      }

      return 'Session beendet und gelöscht.';
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const terminateAllSessionsTool = tool({
  description: 'Terminate all active sessions and delete them from the database',
  inputSchema: z.object({}),
  execute: async () => {
    console.log(`[CliAgent] Terminating all sessions`);

    const sessionsRepo = new CliSessionsRepository();

    try {
      // Get all active sessions
      const activeSessions = sessionsRepo.getActive();

      if (activeSessions.length === 0) {
        return 'Keine aktiven Sessions zum Beenden.';
      }

      let terminatedCount = 0;
      const errors: string[] = [];

      for (const session of activeSessions) {
        try {
          // Terminate on Mac daemon (skip if no mac_session_id - might be orchestrator)
          if (session.mac_session_id || session.type === 'terminal') {
            await macClient.terminateSession(session.id);
          }

          // Delete from database
          sessionsRepo.delete(session.id);
          terminatedCount++;
          console.log(`[CliAgent] Deleted session ${session.id}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(`${session.id.substring(0, 8)}: ${msg}`);
          console.error(`[CliAgent] Failed to terminate session ${session.id}:`, error);
        }
      }

      // Broadcast that all sessions have been deleted
      wsBroadcast.cliAllSessionsDeleted();

      if (errors.length > 0) {
        return `${terminatedCount} Sessions beendet. Fehler bei: ${errors.join(', ')}`;
      }

      return `${terminatedCount} Sessions beendet und gelöscht.`;
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
  terminate_all_sessions: terminateAllSessionsTool,
};
