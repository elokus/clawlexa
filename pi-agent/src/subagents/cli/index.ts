/**
 * CLI Orchestration Agent - Uses Vercel AI SDK with grok-code-fast-1 via OpenRouter.
 *
 * This agent is a STATEFUL orchestrator that:
 * - Persists conversation history in the database
 * - Can be resumed by subsequent voice commands
 * - Manages multiple terminal sessions as children
 * - Emits AI SDK format events via stream_chunk for frontend
 *
 * Session Hierarchy:
 *   Voice (persisted in DB)
 *     → Subagent/Orchestrator (stateful, conversation history)
 *       → Terminal 1 (long-running Claude Code CLI)
 *       → Terminal 2
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, stepCountIs } from 'ai';
import type { RealtimeItem } from '@openai/agents/realtime';
import { wsBroadcast } from '../../api/websocket.js';
import { loadAgentConfig } from '../loader.js';
import { cliAgentTools } from './tools.js';
import { CliSessionsRepository } from '../../db/index.js';

// Re-export for use by developer-session.ts
export { isMacDaemonAvailable } from './tools.js';

// OpenRouter provider for grok-code-fast-1
const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

// Module-level context for orchestrator session tracking
// Set before running the agent, accessed by tools during execution
let currentOrchestratorId: string | undefined;

// Track pending tool calls for session-creating tools
// Maps orchestratorId → toolCallId
// Set when tool-call event fires, consumed by tools when creating sessions
const pendingSessionToolCalls = new Map<string, string>();

// Tools that create terminal sessions - need to track their tool call IDs
const SESSION_CREATING_TOOLS = ['start_headless_session', 'start_interactive_session'];

/**
 * Get the current orchestrator session ID for terminal tracking.
 * Called by CLI tools when creating new terminal sessions.
 */
export function getCurrentOrchestratorId(): string | undefined {
  return currentOrchestratorId;
}

/**
 * Set a pending tool call ID for session-creating tools.
 * Called internally when we see a tool-call event for session-creating tools.
 */
export function setPendingToolCall(orchestratorId: string, toolCallId: string): void {
  pendingSessionToolCalls.set(orchestratorId, toolCallId);
}

/**
 * Consume the pending tool call ID for the given orchestrator.
 * Called by CLI tools when creating terminal sessions.
 * Returns the toolCallId and removes it from the map.
 */
export function consumePendingToolCall(orchestratorId: string): string | undefined {
  const toolCallId = pendingSessionToolCalls.get(orchestratorId);
  pendingSessionToolCalls.delete(orchestratorId);
  return toolCallId;
}

/**
 * Handle a developer request by delegating to the CLI orchestration agent.
 *
 * This function:
 * 1. Finds an existing running CLI subagent OR creates a new one
 * 2. Loads the subagent's conversation history from the database
 * 3. Runs the agent with full context
 * 4. Emits stream_chunk events in AI SDK format
 * 5. Saves the updated conversation history back to the database
 *
 * @param request - The user's coding request
 * @param history - Conversation history from the realtime session (voice context)
 * @param voiceSessionId - Voice session ID to establish parent-child relationship
 */
export async function handleDeveloperRequest(
  request: string,
  history: RealtimeItem[],
  voiceSessionId?: string
): Promise<string> {
  const sessionsRepo = new CliSessionsRepository();

  console.log('\n========================================');
  console.log('[CliAgent] Handling developer request');
  console.log(`[CliAgent] Request: ${request}`);
  console.log(`[CliAgent] Voice context items: ${history.length}`);
  console.log(`[CliAgent] Voice session ID: ${voiceSessionId ?? 'none'}`);

  if (!OPENROUTER_API_KEY) {
    return 'Fehler: OPEN_ROUTER_API_KEY environment variable is not set';
  }

  // Load config and prompt from disk
  const { config, prompt: systemPrompt } = await loadAgentConfig(import.meta.dirname);

  // Find or create the CLI subagent session
  // IMPORTANT: Scope to current voice session to avoid reusing subagents from old sessions
  let subagent = sessionsRepo.findRunningSubagent('cli', voiceSessionId);

  if (subagent) {
    console.log(`[CliAgent] Resuming existing subagent: ${subagent.id} (parent: ${voiceSessionId ?? 'none'})`);
  } else {
    subagent = sessionsRepo.createSubagent({
      goal: request.substring(0, 100),
      agent_name: 'cli',
      model: config.model,
      parent_id: voiceSessionId, // Link to voice session for hierarchy
    });
    console.log(`[CliAgent] Created new subagent: ${subagent.id} (parent: ${voiceSessionId ?? 'none'})`);

    // Broadcast tree update - use voice session as root if available, otherwise subagent
    wsBroadcast.sessionTreeUpdate(voiceSessionId ?? subagent.id);
  }

  // Set subagent ID for tools to access during this request
  currentOrchestratorId = subagent.id;
  const sessionId = subagent.id;

  console.log(`[CliAgent] Using model: ${config.model} via OpenRouter`);

  // Create OpenRouter provider with model from config
  const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
  });
  const model = openrouter.chat(config.model);

  // Load subagent's conversation history from database
  const subagentHistory: Array<{ role: string; content: string }> = JSON.parse(
    subagent.conversation_history || '[]'
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

  // Format subagent's own history (persistent across voice sessions)
  const subagentHistoryText = subagentHistory
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n');

  const userMessage = `
## Your Previous Conversation History (persistent)
${subagentHistoryText || '(this is a new session)'}

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

  // Track state for streaming
  let reasoningStartTime = 0;
  let reasoningBuffer = '';
  let fullText = '';

  try {
    // Emit start event
    wsBroadcast.streamChunk(sessionId, { type: 'start' });

    // Start streaming with Vercel AI SDK
    const result = streamText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools: cliAgentTools,
      stopWhen: stepCountIs(config.maxSteps ?? 3),
    });

    // Process the full event stream and emit as stream_chunk
    for await (const event of result.fullStream) {
      switch (event.type) {
        case 'start':
          console.log(`[CliAgent] Stream started`);
          break;

        case 'start-step':
          console.log(`[CliAgent] New step started`);
          wsBroadcast.streamChunk(sessionId, { type: 'start-step' });
          break;

        case 'reasoning-start':
          reasoningBuffer = '';
          reasoningStartTime = Date.now();
          wsBroadcast.streamChunk(sessionId, { type: 'reasoning-start' });
          break;

        case 'reasoning-delta': {
          const text = (event as { text?: string }).text ?? '';
          reasoningBuffer += text;
          wsBroadcast.streamChunk(sessionId, { type: 'reasoning-delta', text });
          break;
        }

        case 'reasoning-end': {
          const durationMs = Date.now() - reasoningStartTime;
          wsBroadcast.streamChunk(sessionId, {
            type: 'reasoning-end',
            text: reasoningBuffer,
            durationMs,
          });
          break;
        }

        case 'tool-call': {
          const toolEvent = event as {
            toolName: string;
            toolCallId: string;
            input?: unknown;
            args?: unknown;
          };
          const input = toolEvent.input ?? toolEvent.args;

          console.log(`[CliAgent] Tool called: ${toolEvent.toolName}`);

          // Track tool calls that create terminal sessions
          if (SESSION_CREATING_TOOLS.includes(toolEvent.toolName) && currentOrchestratorId) {
            setPendingToolCall(currentOrchestratorId, toolEvent.toolCallId);
          }

          wsBroadcast.streamChunk(sessionId, {
            type: 'tool-call',
            toolName: toolEvent.toolName,
            toolCallId: toolEvent.toolCallId,
            input,
          });
          break;
        }

        case 'tool-result': {
          const resultEvent = event as {
            toolName: string;
            toolCallId: string;
            output?: unknown;
            result?: unknown;
          };
          const output = resultEvent.output ?? resultEvent.result;

          console.log(`[CliAgent] Tool result: ${resultEvent.toolName}`);
          wsBroadcast.streamChunk(sessionId, {
            type: 'tool-result',
            toolName: resultEvent.toolName,
            toolCallId: resultEvent.toolCallId,
            output: typeof output === 'string' ? output : JSON.stringify(output),
          });
          break;
        }

        case 'text-delta': {
          // AI SDK v5 uses 'text-delta' with 'textDelta' property
          const textDelta = (event as { textDelta?: string }).textDelta ?? '';
          fullText += textDelta;
          wsBroadcast.streamChunk(sessionId, { type: 'text-delta', textDelta });
          break;
        }

        case 'finish-step': {
          const stepEvent = event as {
            finishReason?: string;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              totalTokens?: number;
              reasoningTokens?: number;
            };
          };
          console.log(`[CliAgent] Step finished: ${stepEvent.finishReason}`);
          wsBroadcast.streamChunk(sessionId, {
            type: 'finish-step',
            finishReason: stepEvent.finishReason,
            usage: stepEvent.usage,
          });
          break;
        }

        case 'finish':
          console.log(`[CliAgent] Stream finished: ${event.finishReason}`);
          wsBroadcast.streamChunk(sessionId, {
            type: 'finish',
            finishReason: event.finishReason ?? 'stop',
          });
          break;

        case 'error': {
          const errorEvent = event as { error?: unknown };
          const errorMsg = String(errorEvent.error);
          console.error(`[CliAgent] Error:`, errorMsg);
          wsBroadcast.streamChunk(sessionId, { type: 'error', error: errorMsg });
          break;
        }

        default:
          // Ignore other events (text-start, text-end, tool-input-start, etc.)
          break;
      }
    }

    console.log('[CliAgent] Agent response:');
    console.log('----------------------------------------');
    console.log(fullText);
    console.log('========================================\n');

    // Save conversation to history
    sessionsRepo.appendToHistory(subagent.id, [
      { role: 'user', content: request },
      { role: 'assistant', content: fullText || 'No response' },
    ]);

    // Check if subagent should finish (no running children)
    const runningChildren = sessionsRepo.getRunningChildren(subagent.id);
    if (runningChildren.length === 0) {
      console.log('[CliAgent] No active terminals, subagent stays running for follow-ups');
    } else {
      console.log(`[CliAgent] Subagent has ${runningChildren.length} active terminal(s)`);
    }

    // Broadcast tree update - use voice session as root if available
    wsBroadcast.sessionTreeUpdate(voiceSessionId ?? subagent.id);

    return fullText || 'Keine Antwort erhalten.';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CliAgent] Error:', errorMsg);
    wsBroadcast.streamChunk(sessionId, { type: 'error', error: errorMsg });
    wsBroadcast.error(`CLI Agent error: ${errorMsg}`);
    return `Es gab einen Fehler bei der Verarbeitung: ${errorMsg}`;
  } finally {
    // Clear subagent ID to avoid leaking to subsequent requests
    currentOrchestratorId = undefined;
  }
}
