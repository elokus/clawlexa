import { tool, RealtimeContextData } from '@openai/agents/realtime';
import { z } from 'zod';
import { wsBroadcast } from '../api/websocket.js';
import { CliEventsRepository, CliSessionsRepository, type Session } from '../db/index.js';
import { generateSessionName, resolveSessionName } from '../utils/session-names.js';
import * as macClient from './mac-client.js';

export type DirectTerminalToolName =
  | 'open_claude'
  | 'open_codex'
  | 'dictate_to_session'
  | 'read_session'
  | 'close_session'
  | 'arrange_window';

type CliKind = 'claude' | 'codex';

const ACTIVE_STATUSES = new Set<Session['status']>([
  'pending',
  'running',
  'waiting_for_input',
]);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isActiveSession(session: Session): boolean {
  return ACTIVE_STATUSES.has(session.status);
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeSessionQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function gatherVoiceScopedTerminalSessions(
  sessionsRepo: CliSessionsRepository,
  voiceSessionId: string,
  includeFinished: boolean
): Session[] {
  const allSessions = sessionsRepo.list();
  const byId = new Map(allSessions.map((session) => [session.id, session]));

  const belongsToVoiceTree = (session: Session): boolean => {
    let current: Session | undefined = session;
    const seen = new Set<string>();

    while (current?.parent_id) {
      if (current.parent_id === voiceSessionId) {
        return true;
      }

      if (seen.has(current.parent_id)) {
        return false;
      }
      seen.add(current.parent_id);
      current = byId.get(current.parent_id);
    }

    return false;
  };

  return allSessions.filter((session) => {
    if (session.type !== 'terminal') return false;
    if (!belongsToVoiceTree(session)) return false;
    if (includeFinished) return true;
    return isActiveSession(session);
  });
}

function resolveTerminalByNameOrRecency(
  sessionsRepo: CliSessionsRepository,
  voiceSessionId: string,
  sessionName?: string,
  includeFinished = false
): { session: Session | null; error?: string } {
  const candidates = gatherVoiceScopedTerminalSessions(
    sessionsRepo,
    voiceSessionId,
    includeFinished
  );

  if (candidates.length === 0) {
    return {
      session: null,
      error:
        "No active session found. Say 'open Claude in <project>' first.",
    };
  }

  if (sessionName && sessionName.trim().length > 0) {
    const query = normalizeSessionQuery(sessionName);
    const namedCandidates = candidates.filter((candidate) => candidate.name);

    const exact = namedCandidates.find((candidate) => candidate.name === query);
    if (exact) {
      return { session: exact };
    }

    const fuzzy = resolveSessionName(
      query,
      namedCandidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name!,
      }))
    );

    if (!fuzzy) {
      return {
        session: null,
        error: `Session "${sessionName}" was not found in this voice conversation.`,
      };
    }

    const resolved = namedCandidates.find((candidate) => candidate.id === fuzzy.id);
    if (!resolved) {
      return {
        session: null,
        error: `Session "${sessionName}" was not found in this voice conversation.`,
      };
    }
    return { session: resolved };
  }

  // list() is sorted DESC by created_at, so first active terminal is the most recent.
  const mostRecent = candidates.find((candidate) => isActiveSession(candidate));
  if (!mostRecent) {
    return {
      session: null,
      error:
        "No active session found. Say 'open Claude in <project>' first.",
    };
  }

  return { session: mostRecent };
}

function getDisplayName(session: Session): string {
  if (session.name) return session.name;
  return session.id.slice(0, 8);
}

function buildCliCommand(
  cli: CliKind,
  projectPath: string,
  prompt?: string | null
): string {
  const cdPrefix = `cd ${shellQuote(projectPath)}`;
  const normalizedPrompt = prompt?.trim();

  if (cli === 'claude') {
    if (normalizedPrompt) {
      return `${cdPrefix} && claude -p ${shellQuote(normalizedPrompt)}`;
    }
    return `${cdPrefix} && claude --dangerously-skip-permissions`;
  }

  if (normalizedPrompt) {
    return `${cdPrefix} && codex ${shellQuote(normalizedPrompt)}`;
  }
  return `${cdPrefix} && codex`;
}

function generateTerminalName(sessionsRepo: CliSessionsRepository): string {
  const allKnownNames = new Set(
    sessionsRepo
      .list()
      .map((session) => session.name)
      .filter((name): name is string => Boolean(name))
  );

  return generateSessionName(allKnownNames);
}

function normalizeRuntimeStatus(status: string): Session['status'] | null {
  if (status === 'running') return 'running';
  if (status === 'waiting_for_input') return 'waiting_for_input';
  if (status === 'finished') return 'finished';
  if (status === 'error') return 'error';
  return null;
}

interface OpenSessionInput {
  project_path: string;
  prompt?: string | null;
  open_gui?: boolean | null;
}

function createOpenCliTool(
  voiceSessionId: string,
  cli: CliKind
) {
  const toolName = cli === 'claude' ? 'open_claude' : 'open_codex';
  const cliLabel = cli === 'claude' ? 'Claude' : 'Codex';
  const openToolSchema = z.object({
    project_path: z.string().describe('Project directory path on the Mac'),
    prompt: z
      .string()
      .nullable()
      .optional()
      .describe('Optional first prompt to pass directly to the CLI'),
    open_gui: z
      .boolean()
      .nullable()
      .optional()
      .describe('Whether to open a GUI terminal window (default: true)'),
  });

  return tool<typeof openToolSchema, RealtimeContextData>({
    name: toolName,
    description:
      `Open a direct ${cliLabel} terminal session in a project directory. ` +
      `Creates a named tmux session and can open a GUI terminal window.`,
    parameters: openToolSchema,
    async execute({ project_path, prompt, open_gui }: OpenSessionInput) {
      const projectPath = project_path.trim();
      if (!projectPath) {
        return 'Project path is required.';
      }

      const health = await macClient.checkHealth();
      if (!health) {
        return 'Der Mac-Daemon ist nicht erreichbar.';
      }

      const sessionsRepo = new CliSessionsRepository();
      const eventsRepo = new CliEventsRepository();
      const sessionName = generateTerminalName(sessionsRepo);
      const command = buildCliCommand(cli, projectPath, prompt);
      const shouldOpenGui = open_gui !== false;

      const terminal = sessionsRepo.createTerminal({
        goal: `${cliLabel} in ${projectPath}`,
        parent_id: voiceSessionId,
        name: sessionName,
      });
      wsBroadcast.sessionTreeUpdate(voiceSessionId);

      eventsRepo.create({
        session_id: terminal.id,
        event_type: 'created',
        payload: {
          source: toolName,
          cli,
          name: sessionName,
          project_path: projectPath,
        },
      });

      try {
        const startResult = await macClient.startCliSession(
          terminal.id,
          `${cliLabel} in ${projectPath}`,
          command
        );

        if (!startResult.success) {
          sessionsRepo.finish(terminal.id, 'error');
          eventsRepo.create({
            session_id: terminal.id,
            event_type: 'error',
            payload: {
              message: startResult.message,
            },
          });
          wsBroadcast.sessionTreeUpdate(voiceSessionId);
          return `Failed to start ${cliLabel} session "${sessionName}": ${startResult.message}`;
        }

        sessionsRepo.update(terminal.id, {
          status: 'running',
          mac_session_id: startResult.tmuxSession,
        });

        eventsRepo.create({
          session_id: terminal.id,
          event_type: 'started',
          payload: {
            command,
            prompt: prompt?.trim() || null,
            open_gui: shouldOpenGui,
          },
        });

        if (shouldOpenGui) {
          const guiResult = await macClient.openGuiTerminal(terminal.id);
          if (!guiResult.success) {
            eventsRepo.create({
              session_id: terminal.id,
              event_type: 'error',
              payload: { message: `GUI open failed: ${guiResult.message}` },
            });

            wsBroadcast.sessionTreeUpdate(voiceSessionId);
            return `Opened ${cliLabel} session "${sessionName}" in ${projectPath}, but GUI failed: ${guiResult.message}`;
          }
        }

        wsBroadcast.sessionTreeUpdate(voiceSessionId);
        return `Opened ${cliLabel} session "${sessionName}" in ${projectPath}.`;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        sessionsRepo.finish(terminal.id, 'error');
        eventsRepo.create({
          session_id: terminal.id,
          event_type: 'error',
          payload: { message: errorMessage },
        });
        wsBroadcast.sessionTreeUpdate(voiceSessionId);
        return `Failed to open ${cliLabel}: ${errorMessage}`;
      }
    },
  });
}

export function createDirectTerminalTools(
  voiceSessionId: string
) {
  const dictateSchema = z.object({
    text: z.string().describe('Text to type into the terminal and submit'),
    session_name: z
      .string()
      .nullable()
      .optional()
      .describe('Optional named terminal session (e.g. "swift-fox")'),
  });

  const readSchema = z.object({
    session_name: z
      .string()
      .nullable()
      .optional()
      .describe('Optional named terminal session (e.g. "swift-fox")'),
    lines: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .nullable()
      .optional()
      .describe('How many recent lines to return (default: 20)'),
  });

  const closeSchema = z.object({
    session_name: z
      .string()
      .nullable()
      .optional()
      .describe('Optional named terminal session (e.g. "swift-fox")'),
  });

  const arrangeSchema = z.object({
    arrangement: z.enum([
      'left_half',
      'right_half',
      'fullscreen',
      'top_half',
      'bottom_half',
      'center',
    ]),
    session_name: z
      .string()
      .nullable()
      .optional()
      .describe('Optional named terminal session (e.g. "swift-fox")'),
  });

  return {
    open_claude: createOpenCliTool(voiceSessionId, 'claude'),
    open_codex: createOpenCliTool(voiceSessionId, 'codex'),
    dictate_to_session: tool<typeof dictateSchema, RealtimeContextData>({
      name: 'dictate_to_session',
      description:
        'Send dictated text to a named terminal session (or the most recent active one).',
      parameters: dictateSchema,
      async execute({ text, session_name }) {
        const inputText = text.trim();
        if (!inputText) {
          return 'Text cannot be empty.';
        }

        const sessionsRepo = new CliSessionsRepository();
        const eventsRepo = new CliEventsRepository();
        const resolved = resolveTerminalByNameOrRecency(
          sessionsRepo,
          voiceSessionId,
          session_name ?? undefined,
          false
        );

        if (!resolved.session) {
          return resolved.error ?? 'No matching session found.';
        }

        const target = resolved.session;
        const response = await macClient.sendCliInput(target.id, inputText);
        if (!response.success) {
          return `Failed to send to "${getDisplayName(target)}": ${response.message}`;
        }

        eventsRepo.create({
          session_id: target.id,
          event_type: 'input',
          payload: {
            input: inputText,
            source: 'dictate_to_session',
          },
        });

        return `Sent to "${getDisplayName(target)}".`;
      },
    }),
    read_session: tool<typeof readSchema, RealtimeContextData>({
      name: 'read_session',
      description:
        'Read recent terminal output from a named session (or the most recent active one).',
      parameters: readSchema,
      async execute({ session_name, lines }) {
        const maxLines = lines ?? 20;
        const sessionsRepo = new CliSessionsRepository();

        const resolved = resolveTerminalByNameOrRecency(
          sessionsRepo,
          voiceSessionId,
          session_name ?? undefined,
          false
        );

        if (!resolved.session) {
          return resolved.error ?? 'No matching session found.';
        }

        const target = resolved.session;
        const response = await macClient.readCliOutput(target.id);
        if (!response.success) {
          return `Failed to read "${getDisplayName(target)}".`;
        }

        const runtimeStatus = normalizeRuntimeStatus(response.status);
        if (runtimeStatus && runtimeStatus !== target.status) {
          sessionsRepo.update(target.id, { status: runtimeStatus });
          wsBroadcast.sessionTreeUpdate(voiceSessionId);
        }

        const recent = response.output.slice(-maxLines);
        if (recent.length === 0) {
          return `Session "${getDisplayName(target)}" has no recent output.`;
        }

        return [
          `Session "${getDisplayName(target)}" (${response.status || target.status})`,
          ...recent.map((line) => clip(line, 240)),
        ].join('\n');
      },
    }),
    close_session: tool<typeof closeSchema, RealtimeContextData>({
      name: 'close_session',
      description:
        'Close a running terminal session by name (or the most recent active one).',
      parameters: closeSchema,
      async execute({ session_name }) {
        const sessionsRepo = new CliSessionsRepository();
        const eventsRepo = new CliEventsRepository();

        const resolved = resolveTerminalByNameOrRecency(
          sessionsRepo,
          voiceSessionId,
          session_name ?? undefined,
          false
        );

        if (!resolved.session) {
          if (session_name) {
            const maybeFinished = resolveTerminalByNameOrRecency(
              sessionsRepo,
              voiceSessionId,
              session_name,
              true
            );
            if (maybeFinished.session && !isActiveSession(maybeFinished.session)) {
              return `Session "${getDisplayName(maybeFinished.session)}" is already closed.`;
            }
          }
          return resolved.error ?? 'No matching session found.';
        }

        const target = resolved.session;
        const terminateResult = await macClient.terminateSession(target.id);
        const closeGuiResult = await macClient.closeGuiTerminal(target.id);

        if (!terminateResult.success) {
          return `Failed to close "${getDisplayName(target)}": ${terminateResult.message}`;
        }

        sessionsRepo.finish(target.id, 'finished');
        eventsRepo.create({
          session_id: target.id,
          event_type: 'finished',
          payload: {
            reason: 'user_closed',
            gui: closeGuiResult.success ? 'closed' : closeGuiResult.message,
          },
        });
        wsBroadcast.sessionTreeUpdate(voiceSessionId);

        if (!closeGuiResult.success) {
          return `Closed session "${getDisplayName(target)}", but GUI close failed: ${closeGuiResult.message}`;
        }

        return `Closed session "${getDisplayName(target)}".`;
      },
    }),
    arrange_window: tool<typeof arrangeSchema, RealtimeContextData>({
      name: 'arrange_window',
      description:
        'Arrange a terminal GUI window (left/right/fullscreen/top/bottom/center).',
      parameters: arrangeSchema,
      async execute({ arrangement, session_name }) {
        const sessionsRepo = new CliSessionsRepository();
        const resolved = resolveTerminalByNameOrRecency(
          sessionsRepo,
          voiceSessionId,
          session_name ?? undefined,
          false
        );

        if (!resolved.session) {
          return resolved.error ?? 'No matching session found.';
        }

        const target = resolved.session;
        const result = await macClient.arrangeWindow(target.id, arrangement);
        if (!result.success) {
          return `Failed to arrange "${getDisplayName(target)}": ${result.message}`;
        }

        return `Arranged "${getDisplayName(target)}" on ${arrangement}.`;
      },
    }),
  };
}
