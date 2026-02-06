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
import { streamText, stepCountIs, readUIMessageStream } from 'ai';
import { wsBroadcast } from '../../api/websocket.js';
import { loadAgentConfig } from '../loader.js';
import { cliAgentTools } from './tools.js';
import { CliSessionsRepository, HandoffsRepository } from '../../db/index.js';
import { generateSessionName } from '../../utils/session-names.js';
import { formatVoiceContext, formatActiveProcesses, type HandoffPacket } from '../../context/handoff.js';

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

  // Format voice context from HandoffPacket (anti-telephone: lossless context transfer)
  const voiceContextText = formatVoiceContext(handoff);
  const activeProcessesText = formatActiveProcesses(handoff);

  // Format subagent's own history (persistent across voice sessions)
  const subagentHistoryText = subagentHistory
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n');

  // Update handoff packet with target session ID
  const handoffsRepo = new HandoffsRepository();
  handoffsRepo.setTargetSession(handoff.id, subagent.id);

  const userMessage = `
## Your Previous Conversation History (persistent)
${subagentHistoryText || '(this is a new session)'}

## Current Voice Context
${voiceContextText}

## Active Background Tasks
${activeProcessesText}

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

    // Use UIMessageStream for proper streaming (works around OpenRouter fullStream bug)
    // Track state to emit deltas between updates
    let prevText = '';
    let prevReasoning = '';
    let prevStepCount = 0;
    const emittedToolCalls = new Set<string>();
    const emittedToolResults = new Set<string>();
    let updateCount = 0;

    console.log(`[CliAgent] Starting UIMessageStream processing...`);

    for await (const uiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
    })) {
      updateCount++;

      // Process each part and emit events for changes
      for (const part of uiMessage.parts) {
        switch (part.type) {
          case 'step-start': {
            // Count step-starts to detect new steps
            const stepStarts = uiMessage.parts.filter((p) => p.type === 'step-start').length;
            if (stepStarts > prevStepCount) {
              console.log(`[CliAgent] New step started (step ${stepStarts})`);
              wsBroadcast.streamChunk(sessionId, { type: 'start-step' });
              prevStepCount = stepStarts;
            }
            break;
          }

          case 'reasoning': {
            // Emit reasoning deltas
            const reasoningPart = part as { reasoning?: string; text?: string };
            const currentReasoning = reasoningPart.text ?? reasoningPart.reasoning ?? '';
            if (currentReasoning.length > prevReasoning.length) {
              const delta = currentReasoning.slice(prevReasoning.length);
              wsBroadcast.streamChunk(sessionId, { type: 'reasoning-delta', text: delta });
              prevReasoning = currentReasoning;
            }
            break;
          }

          case 'text': {
            // Emit text deltas (this is the main fix - streaming text!)
            const textPart = part as { text: string };
            if (textPart.text.length > prevText.length) {
              const delta = textPart.text.slice(prevText.length);
              wsBroadcast.streamChunk(sessionId, { type: 'text-delta', textDelta: delta });
              prevText = textPart.text;
            }
            break;
          }

          default: {
            // Handle tool invocation parts (type is "tool-{toolName}")
            if (part.type.startsWith('tool-')) {
              const toolPart = part as {
                type: string;
                toolCallId: string;
                state: string;
                input?: unknown;
                output?: unknown;
              };
              const toolName = part.type.replace('tool-', '');

              // Emit tool-call when we first see input-available
              if (
                toolPart.state === 'input-available' &&
                !emittedToolCalls.has(toolPart.toolCallId)
              ) {
                console.log(`[CliAgent] Tool called: ${toolName}`);

                // Track tool calls that create terminal sessions
                if (SESSION_CREATING_TOOLS.includes(toolName) && currentOrchestratorId) {
                  setPendingToolCall(currentOrchestratorId, toolPart.toolCallId);
                }

                wsBroadcast.streamChunk(sessionId, {
                  type: 'tool-call',
                  toolName,
                  toolCallId: toolPart.toolCallId,
                  input: toolPart.input,
                });
                emittedToolCalls.add(toolPart.toolCallId);
              }

              // Emit tool-result when we see output-available
              if (
                toolPart.state === 'output-available' &&
                !emittedToolResults.has(toolPart.toolCallId)
              ) {
                const outputStr =
                  typeof toolPart.output === 'string'
                    ? toolPart.output
                    : JSON.stringify(toolPart.output);

                console.log(`[CliAgent] Tool result: ${toolName}`);
                wsBroadcast.streamChunk(sessionId, {
                  type: 'tool-result',
                  toolName,
                  toolCallId: toolPart.toolCallId,
                  output: outputStr,
                });
                emittedToolResults.add(toolPart.toolCallId);
              }
            }
            break;
          }
        }
      }
    }

    // Get the final text
    const fullText = prevText;

    console.log('[CliAgent] Stream processing complete:');
    console.log(`[CliAgent] Total updates: ${updateCount}`);
    console.log(`[CliAgent] Final text length: ${fullText.length}`);
    console.log(`[CliAgent] Final text: ${fullText || '(empty)'}`);
    console.log('========================================\n');

    // Emit finish event
    wsBroadcast.streamChunk(sessionId, { type: 'finish', finishReason: 'stop' });

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
    currentOrchestratorId = undefined;
  }
}
