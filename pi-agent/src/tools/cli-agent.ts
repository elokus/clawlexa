/**
 * CLI Orchestration Agent - Uses Vercel AI SDK with grok-code-fast-1 via OpenRouter.
 *
 * This agent is delegated to by the realtime voice agent when coding tasks are needed.
 * It has:
 * - Knowledge of the user's project structure on the Mac
 * - Ability to decide between headless (-p) and interactive sessions
 * - Tools to start, interact with, and monitor CLI sessions
 *
 * Flow:
 * 1. Realtime agent receives coding request
 * 2. Realtime calls developer_session tool
 * 3. This agent processes the request with conversation history
 * 4. Agent decides: headless for small tasks, interactive for larger ones
 * 5. Returns result to be spoken back to user
 */

import { tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { RealtimeItem } from '@openai/agents/realtime';
import { z } from 'zod';
import {
  generateId,
  CliSessionsRepository,
  CliEventsRepository,
} from '../db/index.js';
import * as macClient from './mac-client.js';
import { waitForSessionCompletion } from '../api/webhooks.js';
import { wsBroadcast } from '../api/websocket.js';
import { runObservableAgent } from '../lib/agent-runner.js';

// OpenRouter provider for grok-code-fast-1
const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

const openrouter = createOpenRouter({
  apiKey: OPENROUTER_API_KEY ?? '',
});

const MODEL = openrouter.chat('x-ai/grok-code-fast-1');

// Project locations on the Mac
const PROJECT_LOCATIONS = `
## Project Locations on Mac

### Agents & MCP
- ~/Code/Agents/ - Main agents directory
- ~/Code/mcp/ - MCP (Model Context Protocol) projects

### Apps
- ~/Code/Apps/three_tasks/ - Three Tasks application

### Private Projects

#### Data Science & Research
- ~/Code/Private/DataProject/ - GSR data analysis with neural networks
- ~/Code/Private/gsr-project/ - GSR medical data analysis
- ~/Code/Private/llm-toast-project/ - Medical records anonymization

#### AI/ML & Agents
- ~/Code/Private/Article3/ - Article demo with agents
- ~/Code/Private/ArticleDemo2/ - Article demo with database
- ~/Code/Private/LanggraphAgent/ - LangGraph-based agent
- ~/Code/Private/WhatsappAgent/ - WhatsApp integration agent

#### Web Applications
- ~/Code/Private/canvas-demo-backend/ - Canvas demo backend
- ~/Code/Private/cursor-orchestrator/ - VS Code extension orchestrator
- ~/Code/Private/kalm-monorepo/ - KALM monorepo (backend/, frontend-admin/, frontend-landing/)

#### Tools & Utilities
- ~/Code/Private/custom-mcp-servers/cursor-chain/ - Custom MCP servers
- ~/Code/Private/smart-repomix/ - Smart repository mixing tool
- ~/Code/Private/solar2btc/ - Solar to Bitcoin project

### Work Projects

#### BEGA
- ~/Code/Work/bega-bid-backend/
- ~/Code/Work/bega-connect-worktree/
- ~/Code/Work/bega-disposition/
- ~/Code/Work/bega-eos-mcp/
- ~/Code/Work/bega-gpt-backend/
- ~/Code/Work/bega-gpt-infrastructure/
- ~/Code/Work/bega-product-search/
- ~/Code/Work/bega-workshop-prototype/

#### AI Assistants
- ~/Code/Work/ai-assistant-backend/
- ~/Code/Work/ai-assistant-frontend/
- ~/Code/Work/benji-ki-backend/
- ~/Code/Work/benji-ki-fine-tuning/
- ~/Code/Work/expert_ai/

#### Frontends
- ~/Code/Work/faun-chat-frontend/
- ~/Code/Work/forum-verlag-frontend/
- ~/Code/Work/forum-verlarg-admin-frontend/
- ~/Code/Work/grundl-frontend/
- ~/Code/Work/hhp-chat-frontend/
- ~/Code/Work/hhp-frontend/
- ~/Code/Work/weka-frontend/
- ~/Code/Work/wts-frontend/

#### Backends
- ~/Code/Work/arbeitsschutz_gpt/
- ~/Code/Work/d7-agent-backend/
- ~/Code/Work/d7-hiring-backend/
- ~/Code/Work/deubner/
- ~/Code/Work/faun-gpt-backend/
- ~/Code/Work/forum-verlag-backend/
- ~/Code/Work/grundl-backend/
- ~/Code/Work/hhp-gpt-backend/
- ~/Code/Work/karlchen-backend/
- ~/Code/Work/weka-backend/
- ~/Code/Work/weka-gpt/
- ~/Code/Work/wekai/
- ~/Code/Work/wts-backend/

#### Infrastructure
- ~/Code/Work/grundl-infrastructure/
- ~/Code/Work/wts-infrastructure/

#### Kireon (Monorepo)
- ~/Code/Work/kireon/kireon-backend/
- ~/Code/Work/kireon/kireon-frontend/
- ~/Code/Work/kireon/kireon-infrastructure/

#### Other
- ~/Code/Work/PlayGroundAI/
- ~/Code/Work/d7-hiring-frontend/
- ~/Code/Work/docsync/
- ~/Code/Work/rplan-webclient/
`;

const AGENT_INSTRUCTIONS = `
You are a CLI orchestration agent that manages coding sessions on Lukasz's MacBook.

${PROJECT_LOCATIONS}

## Your Job

1. **Identify the project** from the user's request
2. **Choose execution mode**:
   - **Headless** (claude -p): Quick tasks like reviews, simple questions, analysis
   - **Interactive** (claude --dangerously-skip-permissions): Feature implementation, complex tasks
3. **Pass the user's request EXACTLY as they said it** - do NOT elaborate or add details

## CRITICAL RULES

### ONE SESSION ONLY - MOST IMPORTANT RULE
- **CALL EXACTLY ONE session tool** (start_headless_session OR start_interactive_session) per request
- **NEVER call both** headless and interactive for the same request
- **NEVER call the same tool twice** - one call, then STOP and respond
- After calling a session tool, immediately provide your final response - DO NOT call more tools

### Project Selection
- **ALWAYS pick ONE project** - when the user says a project name (e.g., "WTS", "kireon", "BEGA"), pick the MOST LIKELY single repo:
  - For general questions: prefer the **backend** repo
  - For UI questions: prefer the **frontend** repo
  - For deployment/docker questions: prefer **infrastructure** if exists, otherwise **backend**

### Prompt Handling
- **DO NOT modify or expand the user's request** - Claude Code has its own skills and will figure out the details
- **Keep prompts SHORT** - max 500 characters. Just pass the user's request with minimal formatting
- For features, just prefix with: "use the 'feature planner fast' skill to: <user's original request>"
- Do NOT add implementation details, parsing requirements, deliverables, etc.
- Claude Code knows the codebase - trust it to handle the details

## Mode Decision

Pick ONE mode and STOP:
- **Headless** for: reviews, analysis, questions, simple fixes, checks
- **Interactive** for: new features, refactoring, complex implementations

## Examples

User says: "Review the code in kireon backend"
→ Call start_headless_session ONCE, then respond with result

User says: "Implement dark mode"
→ Call start_interactive_session ONCE, then respond immediately

User says: "Analyze the Dockerfile"
→ Call start_headless_session ONCE, then respond with result

## Response Format

Keep it short (1-2 sentences) for voice output:
- "Ich starte eine Session im [project] für [task]."
- "Session läuft in [project]."
`;

// Tool definitions using Vercel AI SDK tool() helper
const startHeadlessSessionTool = tool({
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

const startInteractiveSessionTool = tool({
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

const sendSessionInputTool = tool({
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

const checkSessionStatusTool = tool({
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

const listActiveSessionsTool = tool({
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

const terminateSessionTool = tool({
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

// Tool registry for the CLI orchestration agent
const cliAgentTools = {
  start_headless_session: startHeadlessSessionTool,
  start_interactive_session: startInteractiveSessionTool,
  send_session_input: sendSessionInputTool,
  check_session_status: checkSessionStatusTool,
  list_active_sessions: listActiveSessionsTool,
  terminate_session: terminateSessionTool,
};

/**
 * Handle a developer request by delegating to the CLI orchestration agent.
 *
 * Uses the Observable Agent Runner pattern for real-time streaming events
 * to the WebSocket/UI.
 *
 * @param request - The user's coding request
 * @param history - Conversation history from the realtime session
 */
export async function handleDeveloperRequest(
  request: string,
  history: RealtimeItem[]
): Promise<string> {
  console.log('\n========================================');
  console.log('[CliAgent] Handling developer request');
  console.log(`[CliAgent] Request: ${request}`);
  console.log(`[CliAgent] History items: ${history.length}`);
  console.log(`[CliAgent] Using model: x-ai/grok-code-fast-1 via OpenRouter`);

  if (!OPENROUTER_API_KEY) {
    return 'Fehler: OPEN_ROUTER_API_KEY environment variable is not set';
  }

  // Format conversation history for context
  const historyText = history
    .map((item) => {
      if (item.type === 'message') {
        const role = item.role ?? 'unknown';
        // Extract text content from the item
        const content = item.content
          ?.map((c: { type: string; text?: string; transcript?: string }) => {
            if (c.type === 'text' || c.type === 'input_text') {
              return c.text;
            }
            if (c.type === 'audio' || c.type === 'input_audio') {
              return c.transcript ?? '[audio]';
            }
            return '';
          })
          .filter(Boolean)
          .join(' ');
        return `${role}: ${content}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  const userMessage = `
## Conversation History
${historyText || '(no previous conversation)'}

## Current Request
${request}

Analyze this request and take appropriate action. Remember:
- For quick tasks (reviews, simple fixes): use headless mode with claude -p
- For complex tasks (implementation, refactoring): use interactive mode
- For feature implementation, prefix with "use the 'feature planner fast' skill to implement..."
- Navigate to the correct project directory first
`.trim();

  console.log('[CliAgent] Full prompt to agent:');
  console.log('----------------------------------------');
  console.log(userMessage);
  console.log('----------------------------------------');

  // Also broadcast using the legacy format for backward compatibility
  wsBroadcast.cliAgentThinking(request);

  try {
    // Run the agent using the Observable Agent Runner pattern
    // This streams events to WebSocket in real-time
    const output = await runObservableAgent({
      name: 'Marvin',
      model: MODEL,
      system: AGENT_INSTRUCTIONS,
      prompt: userMessage,
      tools: cliAgentTools,
      maxSteps: 3, // One tool call + response (prevents multiple session starts)
    });

    // Also broadcast using legacy format for backward compatibility
    wsBroadcast.cliAgentResponse(output);

    console.log('[CliAgent] Agent response:');
    console.log('----------------------------------------');
    console.log(output);
    console.log('========================================\n');

    return output || 'Keine Antwort erhalten.';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CliAgent] Error:', errorMsg);
    wsBroadcast.error(`CLI Agent error: ${errorMsg}`);
    return `Es gab einen Fehler bei der Verarbeitung: ${errorMsg}`;
  }
}

/**
 * Check if the Mac daemon is available.
 */
export async function isMacDaemonAvailable(): Promise<boolean> {
  const health = await macClient.checkHealth();
  return health !== null;
}
