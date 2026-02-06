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

const ACTIVE_SESSION_STATUSES = new Set(['pending', 'running', 'waiting_for_input']);

function isActiveSessionStatus(status: string): boolean {
  return ACTIVE_SESSION_STATUSES.has(status);
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeOutputLine(line: string): string {
  const trimmed = line.trimEnd();

  if (/^[\-\u2500\s]+$/.test(trimmed) && trimmed.length > 30) {
    return '----------------------------------------';
  }

  return clipText(trimmed, 160);
}

function formatOutputBlock(lines: string[]): string {
  if (lines.length === 0) {
    return '| (keine Ausgabe - interaktive Session wartet eventuell auf Eingabe)';
  }

  return lines.map((line) => `| ${normalizeOutputLine(line)}`).join('\n');
}

interface ResolvedTerminalTarget {
  terminalId: string | null;
  resolutionNote: string | null;
  error: string | null;
}

function resolveTerminalTarget(
  sessionsRepo: CliSessionsRepository,
  targetId: string,
  orchestratorId?: string
): ResolvedTerminalTarget {
  const target = sessionsRepo.findById(targetId);

  if (!target) {
    return {
      terminalId: null,
      resolutionNote: null,
      error: `Terminal/Session "${targetId}" nicht gefunden.`,
    };
  }

  if (target.type === 'terminal') {
    return {
      terminalId: target.id,
      resolutionNote: null,
      error: null,
    };
  }

  if (target.type === 'subagent') {
    const activeChildren = sessionsRepo
      .getChildren(target.id)
      .filter((child) => child.type === 'terminal' && isActiveSessionStatus(child.status));

    if (activeChildren.length === 1) {
      const resolved = activeChildren[0]!;
      return {
        terminalId: resolved.id,
        resolutionNote: `Orchestrator-ID ${target.id} wurde auf Terminal ${resolved.id} aufgelöst.`,
        error: null,
      };
    }

    if (activeChildren.length > 1) {
      const choices = activeChildren.map((child) => `- ${child.id} (${child.status})`).join('\n');
      return {
        terminalId: null,
        resolutionNote: null,
        error: `Orchestrator ${target.id} hat mehrere aktive Terminals. Nutze terminal_id explizit:\n${choices}`,
      };
    }

    return {
      terminalId: null,
      resolutionNote: null,
      error: `Orchestrator ${target.id} hat kein aktives Terminal.`,
    };
  }

  if (target.type === 'voice' && orchestratorId) {
    const orchestrator = sessionsRepo.findById(orchestratorId);
    if (orchestrator?.type === 'subagent') {
      return resolveTerminalTarget(sessionsRepo, orchestrator.id, orchestratorId);
    }
  }

  return {
    terminalId: null,
    resolutionNote: null,
    error: `ID ${target.id} ist vom Typ "${target.type}". Erwarte terminal_id oder orchestrator_id.`,
  };
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
        return `Headless-Session ${terminalId} abgeschlossen.\n${completion.message || 'Aufgabe abgeschlossen, keine Ausgabe.'}`;
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
      return `Interaktive Session gestartet in ${project_path}. Terminal-ID: ${terminalId}. Claude arbeitet jetzt an der Aufgabe.`;
    } catch (error) {
      sessionsRepo.finish(terminalId, 'error');
      wsBroadcast.sessionTreeUpdate(orchestratorId);
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const sendSessionInputTool = tool({
  description:
    'Send input/feedback to a running interactive terminal. Use terminal_id. ' +
    'If an orchestrator session_id is provided and has exactly one active terminal, it is auto-resolved.',
  inputSchema: z.object({
    terminal_id: z
      .string()
      .optional()
      .describe('Terminal session ID (preferred)'),
    session_id: z
      .string()
      .optional()
      .describe('Deprecated alias. Can be terminal ID or orchestrator ID'),
    input: z.string().describe('The input to send'),
  }),
  execute: async (
    { terminal_id, session_id, input }: { terminal_id?: string; session_id?: string; input: string }
  ) => {
    const eventsRepo = new CliEventsRepository();
    const sessionsRepo = new CliSessionsRepository();
    const requestedId = terminal_id ?? session_id;
    const orchestratorId = getCurrentOrchestratorId();

    if (!requestedId) {
      return 'Fehler: terminal_id fehlt. Nutze list_active_sessions für gültige Terminal-IDs.';
    }

    const resolved = resolveTerminalTarget(sessionsRepo, requestedId, orchestratorId);
    if (!resolved.terminalId) {
      return `Fehler: ${resolved.error}`;
    }

    console.log(`[CliAgent] Sending input to terminal ${resolved.terminalId}: ${input}`);

    try {
      const result = await macClient.sendCliInput(resolved.terminalId, input);

      eventsRepo.create({
        session_id: resolved.terminalId,
        event_type: 'input',
        payload: {
          input,
          requested_id: requestedId,
          resolved_terminal_id: resolved.terminalId,
        },
      });

      const resolutionPrefix = resolved.resolutionNote ? `${resolved.resolutionNote}\n` : '';
      return result.success
        ? [
            resolutionPrefix.trim(),
            '=== INPUT GESENDET ===',
            `Terminal : ${resolved.terminalId}`,
            `Text     : ${clipText(input, 140)}`,
          ]
            .filter(Boolean)
            .join('\n')
        : `Fehler: ${result.message}`;
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const checkSessionStatusTool = tool({
  description:
    'Check the status and recent output of a terminal session. Use terminal_id (or session_id alias).',
  inputSchema: z.object({
    terminal_id: z.string().optional().describe('Terminal session ID (preferred)'),
    session_id: z.string().optional().describe('Deprecated alias for terminal_id/orchestrator_id'),
  }),
  execute: async ({ terminal_id, session_id }: { terminal_id?: string; session_id?: string }) => {
    const sessionsRepo = new CliSessionsRepository();
    const requestedId = terminal_id ?? session_id;
    const orchestratorId = getCurrentOrchestratorId();

    if (!requestedId) {
      return 'Fehler: terminal_id fehlt. Nutze list_active_sessions für gültige Terminal-IDs.';
    }

    const resolved = resolveTerminalTarget(sessionsRepo, requestedId, orchestratorId);
    if (!resolved.terminalId) {
      return `Fehler: ${resolved.error}`;
    }

    console.log(`[CliAgent] Checking status for terminal ${resolved.terminalId}`);

    try {
      const result = await macClient.readCliOutput(resolved.terminalId);
      const details = await macClient.getSessionDetails(resolved.terminalId);
      const runtimeStatus = details?.status || result.status;

      const recentOutput = formatOutputBlock(result.output.slice(-10));
      const waitingHint =
        runtimeStatus === 'waiting_for_input'
          ? '\n[Hint]\nSession wartet auf Input. Nutze send_session_input.'
          : '';

      const resolutionPrefix = resolved.resolutionNote ? `${resolved.resolutionNote}\n` : '';
      return [
        resolutionPrefix.trim(),
        '=== TERMINAL STATUS ===',
        '',
        '[Terminal]',
        `ID     : ${resolved.terminalId}`,
        `Status : ${runtimeStatus}`,
        '',
        '[Snapshot]',
        '--- BEGIN SNAPSHOT ---',
        recentOutput,
        '--- END SNAPSHOT ---',
        waitingHint.trim(),
      ]
        .filter(Boolean)
        .join('\n');
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const listActiveSessionsTool = tool({
  description:
    'List active terminal sessions. By default this returns only terminals for the current orchestrator.',
  inputSchema: z.object({}),
  execute: async () => {
    console.log(`[CliAgent] Listing active sessions`);

    try {
      const sessionsRepo = new CliSessionsRepository();
      const dbSessions = sessionsRepo.getActive();
      const orchestratorId = getCurrentOrchestratorId();
      const activeTerminals = dbSessions.filter(
        (s) =>
          s.type === 'terminal' &&
          isActiveSessionStatus(s.status) &&
          (orchestratorId ? s.parent_id === orchestratorId : true)
      );

      if (activeTerminals.length === 0) {
        return orchestratorId
          ? `Keine aktiven Terminals für Orchestrator ${orchestratorId}.`
          : 'Keine aktiven Terminals.';
      }

      const summaries = activeTerminals.map(
        (terminal) => {
          const parent = terminal.parent_id ?? '-';
          return [
            `- ${terminal.id}`,
            `  status : ${terminal.status}`,
            `  parent : ${parent}`,
            `  goal   : ${clipText(terminal.goal, 100)}`,
          ].join('\n');
        }
      );

      return [
        '=== AKTIVE TERMINALS ===',
        `Scope: ${orchestratorId ? `orchestrator ${orchestratorId}` : 'global'}`,
        `Count: ${activeTerminals.length}`,
        '',
        ...summaries,
        '',
        'Nutze diese IDs als terminal_id in send_session_input/check_session_status/terminate_session.',
      ].join('\n');
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const terminateSessionTool = tool({
  description:
    'Terminate/cancel a running terminal and delete it from the database. Use terminal_id (or session_id alias).',
  inputSchema: z.object({
    terminal_id: z.string().optional().describe('Terminal session ID (preferred)'),
    session_id: z.string().optional().describe('Deprecated alias for terminal_id/orchestrator_id'),
  }),
  execute: async ({ terminal_id, session_id }: { terminal_id?: string; session_id?: string }) => {
    const requestedId = terminal_id ?? session_id;
    const orchestratorId = getCurrentOrchestratorId();
    const sessionsRepo = new CliSessionsRepository();

    if (!requestedId) {
      return 'Fehler: terminal_id fehlt. Nutze list_active_sessions für gültige Terminal-IDs.';
    }

    const resolved = resolveTerminalTarget(sessionsRepo, requestedId, orchestratorId);
    if (!resolved.terminalId) {
      return `Fehler: ${resolved.error}`;
    }

    console.log(`[CliAgent] Terminating terminal ${resolved.terminalId}`);

    try {
      // Get session to find parent for tree update
      const session = sessionsRepo.findById(resolved.terminalId);
      const parentId = session?.parent_id;

      // Terminate on Mac daemon
      await macClient.terminateSession(resolved.terminalId);

      // Delete from database (cascade deletes events too)
      sessionsRepo.delete(resolved.terminalId);
      console.log(`[CliAgent] Deleted terminal ${resolved.terminalId} from database`);

      // Broadcast deletion to connected clients
      wsBroadcast.cliSessionDeleted(resolved.terminalId);

      // Broadcast tree update if we have a parent
      if (parentId) {
        wsBroadcast.sessionTreeUpdate(parentId);
      }

      const resolutionPrefix = resolved.resolutionNote ? `${resolved.resolutionNote}\n` : '';
      return `${resolutionPrefix}Terminal ${resolved.terminalId} beendet und gelöscht.`;
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
