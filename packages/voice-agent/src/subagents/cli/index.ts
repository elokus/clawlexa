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

import { wsBroadcast } from '../../api/websocket.js';
import { loadAgentConfig } from '../loader.js';
import {
  cliAgentToolDefinitions,
  executeCliAgentTool,
  isMacDaemonAvailable,
} from '../../tools/cli-agent-tools.js';
import { CliSessionsRepository, HandoffsRepository } from '../../db/index.js';
import { generateSessionName } from '../../utils/session-names.js';
import { formatVoiceContext, formatActiveProcesses, type HandoffPacket } from '../../context/handoff.js';
import { llmRuntime } from '../llm-runtime.js';
import { forwardLlmStreamToSession } from '../stream-events.js';

// Re-export for use by developer-session.ts
export { isMacDaemonAvailable };

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
 * Set or clear the current orchestrator session ID.
 * Used by direct input routing so CLI tools can resolve the active orchestrator context.
 */
export function setCurrentOrchestratorId(orchestratorId: string | undefined): void {
  currentOrchestratorId = orchestratorId;
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
 * 3. Runs the agent with full context from the HandoffPacket
 * 4. Emits stream_chunk events in AI SDK format
 * 5. Saves the updated conversation history back to the database
 *
 * @param handoff - HandoffPacket with full voice context (anti-telephone)
 * @param voiceSessionId - Voice session ID to establish parent-child relationship
 * @param sessionName - Optional pre-generated session name (used by ProcessManager for non-blocking tools)
 */
export async function handleDeveloperRequest(
  handoff: HandoffPacket,
  voiceSessionId?: string,
  sessionName?: string
): Promise<string> {
  const sessionsRepo = new CliSessionsRepository();
  const request = handoff.request;

  console.log('\n========================================');
  console.log('[CliAgent] Handling developer request');
  console.log(`[CliAgent] Request: ${request}`);
  console.log(`[CliAgent] Voice context entries: ${handoff.voiceContext.length}`);
  console.log(`[CliAgent] Active processes: ${handoff.activeProcesses.length}`);
  console.log(`[CliAgent] Voice session ID: ${voiceSessionId ?? 'none'}`);

  // Load config and prompt from disk
  const { config, prompt: systemPrompt } = await loadAgentConfig(import.meta.dirname);

  // Find or create the CLI subagent session
  // IMPORTANT: Scope to current voice session to avoid reusing subagents from old sessions
  let subagent = sessionsRepo.findRunningSubagent('cli', voiceSessionId);

  if (subagent) {
    console.log(`[CliAgent] Resuming existing subagent: ${subagent.id} (parent: ${voiceSessionId ?? 'none'})`);
  } else {
    const activeNames = sessionsRepo.getActiveSessionNames();
    const name = sessionName ?? generateSessionName(activeNames);
    subagent = sessionsRepo.createSubagent({
      goal: request.substring(0, 100),
      agent_name: 'cli',
      model: config.model,
      parent_id: voiceSessionId, // Link to voice session for hierarchy
      name,
    });
    console.log(`[CliAgent] Created new subagent: ${subagent.id} "${name}" (parent: ${voiceSessionId ?? 'none'})`);

    // Broadcast tree update - use voice session as root if available, otherwise subagent
    wsBroadcast.sessionTreeUpdate(voiceSessionId ?? subagent.id);
  }

  // Set subagent ID for tools to access during this request
  setCurrentOrchestratorId(subagent.id);
  const sessionId = subagent.id;

  console.log(`[CliAgent] Using model: ${config.model} via llm-runtime/openrouter`);

  // Load subagent's conversation history from database
  const subagentHistory: Array<{ role: string; content: string }> = JSON.parse(
    subagent.conversation_history || '[]'
  );

  // Format voice context from HandoffPacket (anti-telephone: lossless context transfer)
  const voiceContextText = formatVoiceContext(handoff);
  const activeProcessesText = formatActiveProcesses(handoff);

  // Update handoff packet with target session ID
  const handoffsRepo = new HandoffsRepository();
  handoffsRepo.setTargetSession(handoff.id, subagent.id);

  // Build messages array from subagent history + new request
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Restore previous conversation turns as proper messages
  for (const msg of subagentHistory) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // New user message with voice context
  const userMessage = [
    voiceContextText ? `## Voice Context\n${voiceContextText}` : '',
    activeProcessesText ? `## Active Background Tasks\n${activeProcessesText}` : '',
    `## Request\n${request}`,
    '',
    'Analyze this request and take appropriate action. Remember:',
    '- For quick tasks (reviews, simple fixes): use headless mode with claude -p',
    '- For complex tasks (implementation, refactoring): use interactive mode',
    '- For feature implementation, prefix with "use the \'feature planner fast\' skill to implement..."',
    '- Navigate to the correct project directory first',
  ].filter(Boolean).join('\n\n');

  messages.push({ role: 'user', content: userMessage });

  console.log(`[CliAgent] Messages count: ${messages.length} (${subagentHistory.length} history + 1 new)`);

  try {
    // Emit user message for frontend display before starting stream
    wsBroadcast.streamChunk(sessionId, { type: 'user-transcript', text: request });

    console.log(`[CliAgent] Starting llm-runtime stream processing...`);
    const { text: fullText, eventCount: updateCount } = await forwardLlmStreamToSession(
      llmRuntime.streamOpenRouter({
        model: {
          provider: 'openrouter',
          model: config.model,
          modality: 'llm',
        },
        context: {
          systemPrompt,
          messages,
          tools: cliAgentToolDefinitions,
        },
        options: {
          maxSteps: config.maxSteps ?? 3,
        },
        toolHandler: executeCliAgentTool,
      }),
      {
        sessionId,
        onToolCall: ({ toolName, toolCallId }) => {
          console.log(`[CliAgent] Tool called: ${toolName}`);
          if (SESSION_CREATING_TOOLS.includes(toolName) && currentOrchestratorId) {
            setPendingToolCall(currentOrchestratorId, toolCallId);
          }
        },
        onToolResult: ({ toolName }) => {
          console.log(`[CliAgent] Tool result: ${toolName}`);
        },
      }
    );

    console.log('[CliAgent] Stream processing complete:');
    console.log(`[CliAgent] Total updates: ${updateCount}`);
    console.log(`[CliAgent] Final text length: ${fullText.length}`);
    console.log(`[CliAgent] Final text: ${fullText || '(empty)'}`);
    console.log('========================================\n');

    // Determine final response
    let finalResponse = fullText;

    // Save conversation to history
    sessionsRepo.appendToHistory(subagent.id, [
      { role: 'user', content: request },
      { role: 'assistant', content: finalResponse || 'No response' },
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

    return finalResponse || 'Keine Antwort erhalten.';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CliAgent] Error:', errorMsg);
    wsBroadcast.streamChunk(sessionId, { type: 'error', error: errorMsg });
    wsBroadcast.error(`CLI Agent error: ${errorMsg}`);
    return `Es gab einen Fehler bei der Verarbeitung: ${errorMsg}`;
  } finally {
    // Clear subagent ID to avoid leaking to subsequent requests
    setCurrentOrchestratorId(undefined);
  }
}
