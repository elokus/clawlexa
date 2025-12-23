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

import { tool, RealtimeContextData, RealtimeItem } from '@openai/agents/realtime';
import { z } from 'zod';
import { handleDeveloperRequest, isMacDaemonAvailable } from '../subagents/cli/index.js';

const developerSessionParameters = z.object({
  request: z
    .string()
    .describe(
      'The coding task or request from the user. Include project name if mentioned.'
    ),
});

/**
 * Factory function to create the developer_session tool with an injected session ID.
 * This avoids polluting the conversation context with the session ID.
 */
export function createDeveloperSessionTool(sessionId: string) {
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
    async execute({ request }, details) {
      console.log('[DeveloperSession] Tool called with request:', request);

      // Check if Mac daemon is available
      const macAvailable = await isMacDaemonAvailable();
      if (!macAvailable) {
        console.log('[DeveloperSession] Mac daemon not available');
        return 'Der Mac ist gerade nicht erreichbar. Bitte stelle sicher, dass der Mac Daemon läuft.';
      }

      // Get conversation history from context
      const history: RealtimeItem[] = details?.context?.history ?? [];
      console.log('[DeveloperSession] Got history with', history.length, 'items');

      // Use the injected sessionId directly (no need to extract from history)
      console.log('[DeveloperSession] Using injected voice session ID:', sessionId);

      // Delegate to the CLI orchestration agent
      const result = await handleDeveloperRequest(request, history, sessionId);

      return result;
    },
  });
}

// Additional tools for session management from voice

const checkSessionParameters = z.object({
  session_id: z
    .string()
    .optional()
    .describe('Session ID to check. If not provided, shows all active sessions.'),
});

export const checkSessionTool = tool<
  typeof checkSessionParameters,
  RealtimeContextData
>({
  name: 'check_coding_session',
  description:
    'Check the status of a coding session or list all active sessions. ' +
    'Use when the user asks "how is the session going" or "what sessions are running".',
  parameters: checkSessionParameters,
  async execute({ session_id }) {
    console.log('[CheckSession] Checking session:', session_id ?? 'all');

    const macAvailable = await isMacDaemonAvailable();
    if (!macAvailable) {
      return 'Der Mac ist gerade nicht erreichbar.';
    }

    // Import dynamically to avoid circular dependencies
    const { CliSessionsRepository, CliEventsRepository } = await import('../db/index.js');
    const macClient = await import('./mac-client.js');

    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    if (session_id) {
      // Check specific session
      const session = sessionsRepo.findById(session_id);
      if (!session) {
        return `Session ${session_id} nicht gefunden.`;
      }

      const output = await macClient.readCliOutput(session_id);
      const recentLines = output.output.slice(-5).join('\n');

      // Get last webhook event for this session
      const recentEvents = eventsRepo.getBySession(session_id, 1);
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

      return `Session ${session_id.substring(0, 8)}...: ${session.status}\nZiel: ${session.goal}\n\nLetzte Ausgabe:\n${recentLines || '(keine)'}${lastWebhookInfo}`;
    } else {
      // List all active sessions
      const sessions = sessionsRepo.getActive();

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
        return `${s.id.substring(0, 8)}: ${s.goal?.substring(0, 50) ?? 'kein Ziel'} (${s.status})${lastMessage}`;
      });

      return `${sessions.length} aktive Session${sessions.length > 1 ? 's' : ''}:\n${summaries.join('\n')}`;
    }
  },
});

const sendFeedbackParameters = z.object({
  session_id: z.string().describe('The session ID to send feedback to'),
  feedback: z.string().describe('The feedback or input to send to the session'),
});

export const sendFeedbackTool = tool<
  typeof sendFeedbackParameters,
  RealtimeContextData
>({
  name: 'send_session_feedback',
  description:
    'Send feedback or input to an active coding session. ' +
    'Use when the user wants to guide or correct what Claude is doing in a session.',
  parameters: sendFeedbackParameters,
  async execute({ session_id, feedback }) {
    console.log(`[SendFeedback] Sending to ${session_id}: ${feedback}`);

    const macAvailable = await isMacDaemonAvailable();
    if (!macAvailable) {
      return 'Der Mac ist gerade nicht erreichbar.';
    }

    const macClient = await import('./mac-client.js');
    const { CliEventsRepository } = await import('../db/index.js');

    const eventsRepo = new CliEventsRepository();

    try {
      const result = await macClient.sendCliInput(session_id, feedback);

      eventsRepo.create({
        session_id,
        event_type: 'input',
        payload: { input: feedback },
      });

      return result.success ? 'Feedback gesendet.' : `Fehler: ${result.message}`;
    } catch (error) {
      return `Fehler beim Senden: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

const stopSessionParameters = z.object({
  session_id: z.string().describe('The session ID to stop'),
});

export const stopSessionTool = tool<
  typeof stopSessionParameters,
  RealtimeContextData
>({
  name: 'stop_coding_session',
  description:
    'Stop/terminate a coding session. Use when the user wants to cancel or end a session.',
  parameters: stopSessionParameters,
  async execute({ session_id }) {
    console.log(`[StopSession] Stopping session ${session_id}`);

    const macAvailable = await isMacDaemonAvailable();
    if (!macAvailable) {
      return 'Der Mac ist gerade nicht erreichbar.';
    }

    const macClient = await import('./mac-client.js');
    const { CliSessionsRepository, CliEventsRepository } = await import('../db/index.js');

    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    try {
      await macClient.terminateSession(session_id);
      sessionsRepo.updateStatus(session_id, 'cancelled');

      eventsRepo.create({
        session_id,
        event_type: 'finished',
        payload: { reason: 'user_cancelled' },
      });

      return 'Session beendet.';
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
  session_id: z
    .string()
    .optional()
    .describe('Specific session ID to get full details for'),
});

export const viewPastSessionsTool = tool<
  typeof viewPastSessionsParameters,
  RealtimeContextData
>({
  name: 'view_past_sessions',
  description:
    'View completed/past coding sessions and their results. ' +
    'Use when the user asks about previous sessions, what was done, or session history. ' +
    'Can show a list of recent sessions or details for a specific session.',
  parameters: viewPastSessionsParameters,
  async execute({ limit = 5, session_id }) {
    console.log('[ViewPastSessions] Viewing past sessions, limit:', limit, 'session_id:', session_id);

    const { CliSessionsRepository, CliEventsRepository } = await import('../db/index.js');
    const sessionsRepo = new CliSessionsRepository();
    const eventsRepo = new CliEventsRepository();

    if (session_id) {
      // Get details for a specific session
      const session = sessionsRepo.findById(session_id);
      if (!session) {
        return `Session ${session_id} nicht gefunden.`;
      }

      // Get all events for this session
      const events = eventsRepo.getBySession(session_id);

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

      return `Session ${session_id.substring(0, 8)}
Status: ${session.status}
Erstellt: ${createdAt}
Ziel: ${session.goal}

Ergebnis:
${resultMessage || '(kein Ergebnis gespeichert)'}`;
    } else {
      // List recent sessions
      const allSessions = sessionsRepo.list();
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

        return `${s.id.substring(0, 8)} [${createdAt}] (${s.status}): ${s.goal?.substring(0, 40) || 'kein Ziel'}${shortResult ? `\n  → ${shortResult}` : ''}`;
      });

      return `Letzte ${recentSessions.length} Sessions:\n\n${summaries.join('\n\n')}`;
    }
  },
});
