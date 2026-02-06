/**
 * Developer Session Tool - Delegates coding tasks to the CLI orchestration agent.
 *
 * This tool is called by the realtime voice agent when the user requests:
 * - Code reviews
 * - Feature implementation
 * - Bug fixes
 * - Any coding-related tasks
 *
 * It passes the conversation history and delegates to a GPT-5 text-based agent
 * that manages Mac CLI sessions.
 */

import { tool, RealtimeContextData } from '@openai/agents/realtime';
import { z } from 'zod';
import { handleDeveloperRequest, isMacDaemonAvailable } from '../subagents/cli/index.js';
import { getProcessManager } from '../processes/manager.js';
import { generateSessionName, resolveSessionName } from '../utils/session-names.js';
import { CliSessionsRepository, HandoffsRepository } from '../db/index.js';
import type { Session } from '../db/repositories/cli-sessions.js';
import type { VoiceAgent } from '../agent/voice-agent.js';

/**
 * Resolve a named coding session (subagent) by exact or fuzzy name.
 * Only named subagent sessions are considered.
 */
function resolveNamedSession(sessionName: string, includeFinished = false): Session | null {
  const repo = new CliSessionsRepository();
  const query = sessionName.trim();
  if (!query) return null;

  const subagents = repo.list({ type: 'subagent' });
  const candidates = subagents.filter((s) => {
    if (!s.name) return false;
    if (includeFinished) return true;
    return ['pending', 'running', 'waiting_for_input'].includes(s.status);
  });

  const exact = candidates.find((s) => s.name === query);
  if (exact) return exact;

  const resolved = resolveSessionName(
    query,
    candidates.map((s) => ({ name: s.name!, id: s.id }))
  );
  if (!resolved) return null;

  return candidates.find((s) => s.id === resolved.id) ?? null;
}

const developerSessionParameters = z.object({
  request: z
    .string()
    .describe(
      'The coding task or request from the user. Include project name if mentioned.'
    ),
});

/**
 * Factory function to create the developer_session tool with injected context.
 * Uses the VoiceAgent to build a HandoffPacket with full conversation context,
 * solving the "telephone effect" where subagents lose context.
 *
 * The tool is NON-BLOCKING: it spawns the work via ProcessManager and returns
 * immediately with the session name so the voice agent can continue the conversation.
 */
export function createDeveloperSessionTool(sessionId: string, voiceAgent?: VoiceAgent) {
  return tool<typeof developerSessionParameters, RealtimeContextData>({
    name: 'developer_session',
    description: `Start or manage a coding session on the Mac. Use this when the user wants to:
- Review code in a project
- Implement a new feature
- Fix a bug
- Refactor code
- Get information about a project
- Start Claude Code to work on something

Examples:
- "Review the code in kireon backend"
- "Implement dark mode in the frontend"
- "Fix the authentication bug in weka"
- "Start a session for the BEGA project"`,
    parameters: developerSessionParameters,
    async execute({ request }) {
      console.log('[DeveloperSession] Tool called with request:', request);

      // Check if Mac daemon is available
      const macAvailable = await isMacDaemonAvailable();
      if (!macAvailable) {
        console.log('[DeveloperSession] Mac daemon not available');
        return 'Der Mac ist gerade nicht erreichbar. Bitte stelle sicher, dass der Mac Daemon läuft.';
      }

      // Use the injected sessionId directly (no need to extract from history)
      console.log('[DeveloperSession] Using injected voice session ID:', sessionId);

      // Build HandoffPacket with full voice context (anti-telephone)
      // Falls back to minimal packet if voiceAgent not available
      const handoff = voiceAgent
        ? voiceAgent.createHandoffPacket(request)
        : {
            id: `hp-${Date.now()}`,
            timestamp: Date.now(),
            request,
            voiceContext: [],
            activeProcesses: [],
            source: { sessionId, profile: 'unknown' },
          };

      console.log(`[DeveloperSession] HandoffPacket: ${handoff.voiceContext.length} context entries, ${handoff.activeProcesses.length} active processes`);

      // Persist handoff for debugging/replay
      const handoffsRepo = new HandoffsRepository();
      handoffsRepo.save(handoff);

      const sessionsRepo = new CliSessionsRepository();
      const processManager = getProcessManager();

      // Check if there's already a running CLI subagent for this voice session
      const existingSubagent = sessionsRepo.findRunningSubagent('cli', sessionId);

      if (existingSubagent?.name) {
        // Reuse existing session — announce its name, not a new one
        processManager.spawn({
          name: existingSubagent.name,
          sessionId: `dev-${Date.now()}`,
          type: 'headless',
          execute: async () => {
            return await handleDeveloperRequest(handoff, sessionId);
          },
        });
        console.log(`[DeveloperSession] Reusing existing subagent "${existingSubagent.name}"`);
        return `Sende an "${existingSubagent.name}": ${request.substring(0, 80)}`;
      }

      // No existing session — generate new name
      const activeNames = sessionsRepo.getActiveSessionNames();
      const name = generateSessionName(activeNames);

      // Spawn as background process via ProcessManager - returns immediately
      processManager.spawn({
        name,
        sessionId: `dev-${Date.now()}`, // Unique process ID
        type: 'headless',
        execute: async () => {
          return await handleDeveloperRequest(handoff, sessionId, name);
        },
      });

      console.log(`[DeveloperSession] Spawned non-blocking process "${name}"`);
      return `Starte "${name}" für: ${request.substring(0, 100)}`;
    },
  });
}

// Additional tools for session management from voice

const checkSessionParameters = z.object({
  session_name: z
    .string()
    .optional()
    .describe('Name der Session (z.B. "terra-comet"). Ohne Angabe werden alle aktiven Sessions gezeigt.'),
});

export const checkSessionTool = tool<
  typeof checkSessionParameters,
  RealtimeContextData
>({
  name: 'check_coding_session',
  description:
    'Check the status of a coding session or list all active sessions. ' +
    'Use when the user asks "how is the session going" or "what sessions are running". ' +
    'Use session names, not IDs.',
  parameters: checkSessionParameters,
  async execute({ session_name }) {
    console.log('[CheckSession] Checking session:', session_name ?? 'all');

    const macAvailable = await isMacDaemonAvailable();
    if (!macAvailable) {
      return 'Der Mac ist gerade nicht erreichbar.';
    }

    const { CliEventsRepository } = await import('../db/index.js');
    const macClient = await import('./mac-client.js');

    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    if (session_name) {
      // Resolve by exact or fuzzy session name
      const session = resolveNamedSession(session_name);
      if (!session) {
        return `Session "${session_name}" nicht gefunden.`;
      }

      const output = await macClient.readCliOutput(session.id);
      const recentLines = output.output.slice(-5).join('\n');

      // Get last webhook event for this session
      const recentEvents = eventsRepo.getBySession(session.id, 1);
      const lastEvent = recentEvents[0];
      let lastWebhookInfo = '';
      if (lastEvent) {
        let eventMessage = '';
        if (lastEvent.payload) {
          try {
            const payload = JSON.parse(lastEvent.payload);
            if (payload.message) {
              eventMessage = payload.message;
            } else if (payload.status) {
              eventMessage = `Status: ${payload.status}`;
            }
          } catch {
            eventMessage = lastEvent.payload;
          }
        }
        lastWebhookInfo = `\n\nLetzter Webhook (${lastEvent.event_type}): ${eventMessage || '(keine Nachricht)'}`;
      }

      const displayName = session.name!;
      return `Session "${displayName}": ${session.status}\nZiel: ${session.goal}\n\nLetzte Ausgabe:\n${recentLines || '(keine)'}${lastWebhookInfo}`;
    } else {
      // List all active named coding sessions
      const sessions = sessionsRepo
        .getActive()
        .filter((s) => s.type === 'subagent' && Boolean(s.name));

      if (sessions.length === 0) {
        return 'Keine aktiven Coding-Sessions.';
      }

      const summaries = sessions.map((s) => {
        // Get last event for this session
        const recentEvents = eventsRepo.getBySession(s.id, 1);
        const lastEvent = recentEvents[0];
        let lastMessage = '';
        if (lastEvent?.payload) {
          try {
            const payload = JSON.parse(lastEvent.payload);
            if (payload.message) {
              lastMessage = ` - ${payload.message.substring(0, 40)}`;
            }
          } catch {
            // Ignore parse errors
          }
        }
        const displayName = s.name!;
        return `${displayName}: ${s.goal?.substring(0, 50) ?? 'kein Ziel'} (${s.status})${lastMessage}`;
      });

      return `${sessions.length} aktive Session${sessions.length > 1 ? 's' : ''}:\n${summaries.join('\n')}`;
    }
  },
});

const sendFeedbackParameters = z.object({
  session_name: z.string().describe('Name der Session (z.B. "terra-comet")'),
  feedback: z.string().describe('The feedback or input to send to the session'),
});

export const sendFeedbackTool = tool<
  typeof sendFeedbackParameters,
  RealtimeContextData
>({
  name: 'send_session_feedback',
  description:
    'Send feedback or input to an active coding session. ' +
    'Use when the user wants to guide or correct what Claude is doing in a session. ' +
    'Use session names, not IDs.',
  parameters: sendFeedbackParameters,
  async execute({ session_name, feedback }) {
    console.log(`[SendFeedback] Sending to ${session_name}: ${feedback}`);

    const macAvailable = await isMacDaemonAvailable();
    if (!macAvailable) {
      return 'Der Mac ist gerade nicht erreichbar.';
    }

    // Resolve by exact or fuzzy session name
    const session = resolveNamedSession(session_name);
    if (!session) {
      return `Session "${session_name}" nicht gefunden.`;
    }

    const macClient = await import('./mac-client.js');
    const { CliEventsRepository } = await import('../db/index.js');

    const eventsRepo = new CliEventsRepository();

    try {
      const result = await macClient.sendCliInput(session.id, feedback);

      eventsRepo.create({
        session_id: session.id,
        event_type: 'input',
        payload: { input: feedback },
      });

      const displayName = session.name!;
      return result.success ? `Feedback an "${displayName}" gesendet.` : `Fehler: ${result.message}`;
    } catch (error) {
      return `Fehler beim Senden: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

const stopSessionParameters = z.object({
  session_name: z.string().describe('Name der Session (z.B. "terra-comet")'),
});

export const stopSessionTool = tool<
  typeof stopSessionParameters,
  RealtimeContextData
>({
  name: 'stop_coding_session',
  description:
    'Stop/terminate a coding session. Use when the user wants to cancel or end a session. ' +
    'Use session names, not IDs.',
  parameters: stopSessionParameters,
  async execute({ session_name }) {
    console.log(`[StopSession] Stopping session ${session_name}`);

    const macAvailable = await isMacDaemonAvailable();
    if (!macAvailable) {
      return 'Der Mac ist gerade nicht erreichbar.';
    }

    // Resolve by exact or fuzzy session name
    const session = resolveNamedSession(session_name);
    if (!session) {
      return `Session "${session_name}" nicht gefunden.`;
    }

    const macClient = await import('./mac-client.js');
    const { CliEventsRepository } = await import('../db/index.js');

    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    try {
      await macClient.terminateSession(session.id);
      sessionsRepo.updateStatus(session.id, 'cancelled');

      eventsRepo.create({
        session_id: session.id,
        event_type: 'finished',
        payload: { reason: 'user_cancelled' },
      });

      const displayName = session.name!;
      return `Session "${displayName}" beendet.`;
    } catch (error) {
      return `Fehler: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

const viewPastSessionsParameters = z.object({
  limit: z
    .number()
    .optional()
    .describe('Number of sessions to show (default: 5)'),
  session_name: z
    .string()
    .optional()
    .describe('Name einer bestimmten Session für Detailansicht (z.B. "terra-comet")'),
});

export const viewPastSessionsTool = tool<
  typeof viewPastSessionsParameters,
  RealtimeContextData
>({
  name: 'view_past_sessions',
  description:
    'View completed/past coding sessions and their results. ' +
    'Use when the user asks about previous sessions, what was done, or session history. ' +
    'Can show a list of recent sessions or details for a specific session name.',
  parameters: viewPastSessionsParameters,
  async execute({ limit = 5, session_name }) {
    console.log('[ViewPastSessions] Viewing past sessions, limit:', limit, 'session_name:', session_name);

    const { CliEventsRepository } = await import('../db/index.js');
    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    if (session_name) {
      // Resolve by exact or fuzzy session name (include finished)
      const session = resolveNamedSession(session_name, true);
      if (!session) {
        return `Session "${session_name}" nicht gefunden.`;
      }

      // Get all events for this session
      const events = eventsRepo.getBySession(session.id);

      // Find the result message (from finished or status_change events)
      let resultMessage = '';
      for (const event of events.reverse()) {
        if (event.payload) {
          try {
            const payload = JSON.parse(event.payload);
            if (payload.message) {
              resultMessage = payload.message;
              break;
            }
          } catch {
            // Skip parse errors
          }
        }
      }

      const createdAt = new Date(session.created_at).toLocaleString('de-DE');
      const displayName = session.name!;

      return `Session "${displayName}"
Status: ${session.status}
Erstellt: ${createdAt}
Ziel: ${session.goal}

Ergebnis:
${resultMessage || '(kein Ergebnis gespeichert)'}`;
    } else {
      // List recent sessions
      const allSessions = sessionsRepo
        .list({ type: 'subagent' })
        .filter((s) => Boolean(s.name));
      const recentSessions = allSessions.slice(0, limit);

      if (recentSessions.length === 0) {
        return 'Keine vergangenen Sessions gefunden.';
      }

      const summaries = recentSessions.map((s) => {
        // Get last event with a message
        const events = eventsRepo.getBySession(s.id, 1);
        const lastEvent = events[0];
        let shortResult = '';
        if (lastEvent?.payload) {
          try {
            const payload = JSON.parse(lastEvent.payload);
            if (payload.message) {
              shortResult = payload.message.substring(0, 60).replace(/\n/g, ' ');
              if (payload.message.length > 60) shortResult += '...';
            }
          } catch {
            // Skip
          }
        }

        const createdAt = new Date(s.created_at).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit'
        });

        const displayName = s.name!;
        return `${displayName} [${createdAt}] (${s.status}): ${s.goal?.substring(0, 40) || 'kein Ziel'}${shortResult ? `\n  → ${shortResult}` : ''}`;
      });

      return `Letzte ${recentSessions.length} Sessions:\n\n${summaries.join('\n\n')}`;
    }
  },
});
