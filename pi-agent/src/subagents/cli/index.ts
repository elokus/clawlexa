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

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { RealtimeItem } from '@openai/agents/realtime';
import { runObservableAgent } from '../../lib/agent-runner.js';
import { wsBroadcast } from '../../api/websocket.js';
import { loadAgentConfig } from '../loader.js';
import { cliAgentTools, isMacDaemonAvailable } from './tools.js';

// Re-export for use by developer-session.ts
export { isMacDaemonAvailable };

// OpenRouter provider for grok-code-fast-1
const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

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

  if (!OPENROUTER_API_KEY) {
    return 'Fehler: OPEN_ROUTER_API_KEY environment variable is not set';
  }

  // Load config and prompt from disk (enables future dynamic updates)
  const { config, prompt: systemPrompt } = await loadAgentConfig(import.meta.dirname);

  console.log(`[CliAgent] Using model: ${config.model} via OpenRouter`);

  // Create OpenRouter provider with model from config
  const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
  });
  const model = openrouter.chat(config.model);

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

  try {
    // Run the agent using the Observable Agent Runner pattern
    // This streams events to WebSocket in real-time
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

    return output || 'Keine Antwort erhalten.';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CliAgent] Error:', errorMsg);
    wsBroadcast.error(`CLI Agent error: ${errorMsg}`);
    return `Es gab einen Fehler bei der Verarbeitung: ${errorMsg}`;
  }
}
