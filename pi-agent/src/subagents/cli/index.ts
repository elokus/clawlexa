/**
 * CLI Orchestration Agent - Uses Vercel AI SDK with grok-code-fast-1 via OpenRouter.
 *
 * This agent is a STATEFUL orchestrator that:
 * - Persists conversation history in the database
 * - Can be resumed by subsequent voice commands
 * - Manages multiple terminal sessions as children
 *
 * Session Hierarchy:
 *   Voice (fire-and-forget, not persisted)
 *     → Orchestrator (stateful, conversation history)
 *       → Terminal 1 (long-running Claude Code CLI)
 *       → Terminal 2
 *
 * Flow:
 * 1. Voice agent receives coding request
 * 2. Voice calls developer_session tool
 * 3. This handler finds/creates CLI orchestrator session
 * 4. Agent processes request with full conversation history
 * 5. Terminals are created as children of the orchestrator
 * 6. Orchestrator stays running while any terminals are active
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { RealtimeItem } from '@openai/agents/realtime';
import { runObservableAgent } from '../../lib/agent-runner.js';
import { wsBroadcast } from '../../api/websocket.js';
import { loadAgentConfig } from '../loader.js';
import { cliAgentTools, isMacDaemonAvailable } from './tools.js';
import { CliSessionsRepository } from '../../db/index.js';

// Re-export for use by developer-session.ts
export { isMacDaemonAvailable };

// OpenRouter provider for grok-code-fast-1
const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

// Module-level context for orchestrator session tracking
// Set before running the agent, accessed by tools during execution
let currentOrchestratorId: string | undefined;

/**
 * Get the current orchestrator session ID for terminal tracking.
 * Called by CLI tools when creating new terminal sessions.
 */
export function getCurrentOrchestratorId(): string | undefined {
  return currentOrchestratorId;
}

/**
 * @deprecated Use getCurrentOrchestratorId instead
 */
export function getCurrentParentId(): string | undefined {
  return currentOrchestratorId;
}

/**
 * Handle a developer request by delegating to the CLI orchestration agent.
 *
 * This function:
 * 1. Finds an existing running CLI orchestrator OR creates a new one
 * 2. Loads the orchestrator's conversation history from the database
 * 3. Runs the agent with full context
 * 4. Saves the updated conversation history back to the database
 *
 * The orchestrator stays 'running' while it has active terminal sessions.
 *
 * @param request - The user's coding request
 * @param history - Conversation history from the realtime session (voice context)
 * @param _parentId - Deprecated: Voice sessions are no longer tracked
 */
export async function handleDeveloperRequest(
  request: string,
  history: RealtimeItem[],
  _parentId?: string
): Promise<string> {
  const sessionsRepo = new CliSessionsRepository();

  console.log('\n========================================');
  console.log('[CliAgent] Handling developer request');
  console.log(`[CliAgent] Request: ${request}`);
  console.log(`[CliAgent] Voice context items: ${history.length}`);

  if (!OPENROUTER_API_KEY) {
    return 'Fehler: OPEN_ROUTER_API_KEY environment variable is not set';
  }

  // Load config and prompt from disk
  const { config, prompt: systemPrompt } = await loadAgentConfig(import.meta.dirname);

  // Find or create the CLI orchestrator session
  let orchestrator = sessionsRepo.findRunningOrchestrator('cli');

  if (orchestrator) {
    console.log(`[CliAgent] Resuming existing orchestrator: ${orchestrator.id}`);
  } else {
    orchestrator = sessionsRepo.createOrchestrator({
      goal: request.substring(0, 100),
      agent_name: 'cli',
      model: config.model,
    });
    console.log(`[CliAgent] Created new orchestrator: ${orchestrator.id}`);

    // Broadcast new orchestrator session to UI
    wsBroadcast.sessionTreeUpdate(orchestrator.id);
  }

  // Set orchestrator ID for tools to access during this request
  currentOrchestratorId = orchestrator.id;

  console.log(`[CliAgent] Using model: ${config.model} via OpenRouter`);

  // Create OpenRouter provider with model from config
  const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
  });
  const model = openrouter.chat(config.model);

  // Load orchestrator's conversation history from database
  const orchestratorHistory: Array<{ role: string; content: string }> = JSON.parse(
    orchestrator.conversation_history || '[]'
  );

  // Format voice conversation context (current session only)
  const voiceContextText = history
    .map((item) => {
      if (item.type === 'message') {
        const role = item.role ?? 'unknown';
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

  // Format orchestrator's own history (persistent across voice sessions)
  const orchestratorHistoryText = orchestratorHistory
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n');

  const userMessage = `
## Your Previous Conversation History (persistent)
${orchestratorHistoryText || '(this is a new session)'}

## Current Voice Context
${voiceContextText || '(direct request, no voice context)'}

## Current Request
${request}

Analyze this request and take appropriate action. Remember:
- For quick tasks (reviews, simple fixes): use headless mode with claude -p
- For complex tasks (implementation, refactoring): use interactive mode
- For feature implementation, prefix with "use the 'feature planner fast' skill to implement..."
- Navigate to the correct project directory first
- You can reference previous conversations above for context
`.trim();

  console.log('[CliAgent] Full prompt to agent:');
  console.log('----------------------------------------');
  console.log(userMessage);
  console.log('----------------------------------------');

  try {
    // Run the agent using the Observable Agent Runner pattern
    const output = await runObservableAgent({
      name: config.name,
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools: cliAgentTools,
      maxSteps: config.maxSteps ?? 3,
    });

    console.log('[CliAgent] Agent response:');
    console.log('----------------------------------------');
    console.log(output);
    console.log('========================================\n');

    // Save conversation to history
    sessionsRepo.appendToHistory(orchestrator.id, [
      { role: 'user', content: request },
      { role: 'assistant', content: output || 'No response' },
    ]);

    // Check if orchestrator should finish (no running children)
    const runningChildren = sessionsRepo.getRunningChildren(orchestrator.id);
    if (runningChildren.length === 0) {
      // No active terminals, but keep orchestrator running for potential follow-ups
      // It will be auto-cleaned after 24h of inactivity
      console.log('[CliAgent] No active terminals, orchestrator stays running for follow-ups');
    } else {
      console.log(`[CliAgent] Orchestrator has ${runningChildren.length} active terminal(s)`);
    }

    // Broadcast tree update
    wsBroadcast.sessionTreeUpdate(orchestrator.id);

    return output || 'Keine Antwort erhalten.';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CliAgent] Error:', errorMsg);
    wsBroadcast.error(`CLI Agent error: ${errorMsg}`);
    return `Es gab einen Fehler bei der Verarbeitung: ${errorMsg}`;
  } finally {
    // Clear orchestrator ID to avoid leaking to subsequent requests
    currentOrchestratorId = undefined;
  }
}
