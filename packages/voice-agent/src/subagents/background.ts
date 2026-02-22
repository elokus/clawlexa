/**
 * Background Subagent Spawner
 *
 * Provides utilities for spawning subagents that run independently in the background
 * without blocking the voice agent. Background sessions:
 * - Don't block the voice agent's tool execution
 * - Can notify the voice agent upon completion via callback
 * - Are tracked in the session tree with background=true
 * - Stream events to the frontend via WebSocket like normal subagents
 */

import { wsBroadcast } from '../api/websocket.js';
import { loadAgentConfig } from './loader.js';
import { cliAgentToolDefinitions, executeCliAgentTool } from '../tools/cli-agent-tools.js';
import { CliSessionsRepository } from '../db/index.js';
import { generateSessionName } from '../utils/session-names.js';
import type { VoiceAgent } from '../agent/voice-agent.js';
import { formatVoiceContext, type HandoffPacket } from '../context/handoff.js';
import { llmRuntime } from './llm-runtime.js';
import { forwardLlmStreamToSession } from './stream-events.js';

export interface BackgroundTaskOptions {
  /** The task description/request */
  task: string;
  /** Voice session ID for parent-child relationship */
  voiceSessionId: string;
  /** HandoffPacket with structured voice context (anti-telephone) */
  handoff?: HandoffPacket;
  /** Reference to voice agent for completion notification */
  voiceAgent?: VoiceAgent;
  /** Custom completion message (default: summarizes result) */
  completionMessage?: (result: string) => string;
}

export interface BackgroundTaskResult {
  /** The spawned session ID */
  sessionId: string;
  /** Promise that resolves when the task completes */
  completion: Promise<string>;
}

/**
 * Spawn a background subagent that runs independently without blocking.
 *
 * The function returns immediately with the session ID. The subagent runs
 * asynchronously and can optionally notify the voice agent when done.
 *
 * @example
 * ```typescript
 * // In a tool's execute function:
 * const { sessionId } = spawnBackgroundSubagent({
 *   task: "Review the code in project X",
 *   voiceSessionId: currentVoiceSessionId,
 *   voiceAgent: agent,  // For completion notification
 * });
 * return `Started background task ${sessionId}. I'll let you know when it's done.`;
 * ```
 */
export function spawnBackgroundSubagent(options: BackgroundTaskOptions): BackgroundTaskResult {
  const { task, voiceSessionId, handoff, voiceAgent, completionMessage } = options;

  const sessionsRepo = new CliSessionsRepository();

  // Create subagent session with background=true
  const activeNames = sessionsRepo.getActiveSessionNames();
  const sessionName = generateSessionName(activeNames);
  const subagent = sessionsRepo.createSubagent({
    goal: task.substring(0, 100),
    agent_name: 'cli',
    model: 'x-ai/grok-code-fast-1', // Will be overridden by config
    parent_id: voiceSessionId,
    background: true,
    name: sessionName,
  });

  console.log(`[Background] Spawned background subagent: ${subagent.id} "${sessionName}" (parent: ${voiceSessionId})`);

  // Broadcast tree update immediately so UI shows the new session
  wsBroadcast.sessionTreeUpdate(voiceSessionId);

  // Start the async execution (fire-and-forget)
  const completion = runBackgroundAgent(subagent.id, task, handoff).then((result) => {
    // Notify voice agent if still active and callback provided
    if (voiceAgent?.isActive()) {
      const message = completionMessage
        ? completionMessage(result)
        : `[Background task completed] ${result.substring(0, 300)}`;
      voiceAgent.sendMessage(message);
      console.log(`[Background] Notified voice agent of completion: ${subagent.id}`);
    } else {
      console.log(`[Background] Task completed but voice agent inactive: ${subagent.id}`);
    }
    return result;
  });

  return {
    sessionId: subagent.id,
    completion,
  };
}

/**
 * Run the background agent's main loop.
 * This is similar to handleDeveloperRequest but designed for background execution.
 */
async function runBackgroundAgent(
  sessionId: string,
  task: string,
  handoff?: HandoffPacket
): Promise<string> {
  const sessionsRepo = new CliSessionsRepository();

  try {
    // Load config from CLI agent (reuse same config)
    const cliAgentDir = new URL('./cli', import.meta.url).pathname;
    const { config, prompt: systemPrompt } = await loadAgentConfig(cliAgentDir);

    // Format voice context from HandoffPacket (anti-telephone: lossless context transfer)
    const voiceContextText = handoff ? formatVoiceContext(handoff) : '(no voice context)';

    const userMessage = `
## Background Task
This is a BACKGROUND task running independently. Complete it thoroughly.

## Voice Context (for reference)
${voiceContextText}

## Task
${task}

Complete this task. When done, provide a concise summary of what was accomplished.
`.trim();

    console.log(`[Background] Starting agent for session ${sessionId}`);
    const { text: fullText } = await forwardLlmStreamToSession(
      llmRuntime.streamOpenRouter({
        model: {
          provider: 'openrouter',
          model: config.model,
          modality: 'llm',
        },
        context: {
          systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          tools: cliAgentToolDefinitions,
        },
        options: {
          maxSteps: config.maxSteps ?? 5,
        },
        toolHandler: executeCliAgentTool,
      }),
      { sessionId }
    );

    // Update session status
    sessionsRepo.finish(sessionId, 'finished');

    // Broadcast tree update
    const session = sessionsRepo.findById(sessionId);
    if (session?.parent_id) {
      wsBroadcast.sessionTreeUpdate(session.parent_id);
    }

    console.log(`[Background] Completed session ${sessionId}`);
    return fullText || 'Task completed.';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Background] Error in session ${sessionId}:`, errorMsg);
    wsBroadcast.streamChunk(sessionId, { type: 'error', error: errorMsg });
    sessionsRepo.finish(sessionId, 'error');
    return `Error: ${errorMsg}`;
  }
}
