/**
 * CLI Orchestration Agent - GPT-5 text-based agent for managing Mac CLI sessions.
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

import { Agent, run, tool } from '@openai/agents';
import type { RealtimeItem } from '@openai/agents/realtime';
import { z } from 'zod';
import {
  generateId,
  CliSessionsRepository,
  CliEventsRepository,
} from '../db/index.js';
import * as macClient from './mac-client.js';
import { waitForSessionCompletion } from '../api/webhooks.js';

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

// Define tools using the tool() helper from @openai/agents

const startHeadlessSessionTool = tool({
  name: 'start_headless_session',
  description:
    'Start a headless Claude session with -p flag for quick tasks. Returns the result directly. IMPORTANT: After calling this tool, you MUST stop and provide your final response - do not call any more tools.',
  parameters: z.object({
    project_path: z
      .string()
      .describe('Full path to the project directory, e.g., ~/Code/Work/kireon/kireon-backend'),
    prompt: z.string().describe('The prompt to send to Claude with -p flag'),
  }),
  async execute({ project_path, prompt }) {
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
  name: 'start_interactive_session',
  description:
    'Start an interactive Claude session for complex tasks that need iteration. Returns immediately with "Session gestartet". IMPORTANT: After calling this tool, you MUST stop and provide your final response - do not call any more tools.',
  parameters: z.object({
    project_path: z.string().describe('Full path to the project directory'),
    initial_prompt: z.string().describe('Initial prompt/goal to send after session starts'),
  }),
  async execute({ project_path, initial_prompt }) {
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
  name: 'send_session_input',
  description: 'Send input/feedback to a running interactive session',
  parameters: z.object({
    session_id: z.string().describe('The session ID'),
    input: z.string().describe('The input to send'),
  }),
  async execute({ session_id, input }) {
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
  name: 'check_session_status',
  description: 'Check the status and recent output of a session',
  parameters: z.object({
    session_id: z.string().describe('The session ID'),
  }),
  async execute({ session_id }) {
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
  name: 'list_active_sessions',
  description: 'List all active CLI sessions',
  parameters: z.object({}),
  async execute() {
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
  name: 'terminate_session',
  description: 'Terminate/cancel a running session',
  parameters: z.object({
    session_id: z.string().describe('The session ID to terminate'),
  }),
  async execute({ session_id }) {
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

// Collect all tools
const cliAgentTools = [
  startHeadlessSessionTool,
  startInteractiveSessionTool,
  sendSessionInputTool,
  checkSessionStatusTool,
  listActiveSessionsTool,
  terminateSessionTool,
];

// Create the CLI orchestration agent
const cliOrchestratorAgent = new Agent({
  name: 'CLI Orchestrator',
  instructions: AGENT_INSTRUCTIONS,
  model: 'gpt-5', // GPT-5 equivalent (newest model)
  tools: cliAgentTools,
});

/**
 * Handle a developer request by delegating to the CLI orchestration agent.
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

  const fullPrompt = `
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
  console.log(fullPrompt);
  console.log('----------------------------------------');

  try {
    // maxTurns: 2 = one tool call + one final response (prevents multiple session starts)
    const result = await run(cliOrchestratorAgent, fullPrompt, { maxTurns: 2 });

    const output =
      typeof result.finalOutput === 'string'
        ? result.finalOutput
        : JSON.stringify(result.finalOutput, null, 2);

    console.log('[CliAgent] Agent response:');
    console.log('----------------------------------------');
    console.log(output);
    console.log('========================================\n');

    return output;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CliAgent] Error:', errorMsg);
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
