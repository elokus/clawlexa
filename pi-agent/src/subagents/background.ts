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

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, stepCountIs, readUIMessageStream } from 'ai';
import type { RealtimeItem } from '@openai/agents/realtime';
import { wsBroadcast } from '../api/websocket.js';
import { loadAgentConfig } from './loader.js';
import { cliAgentTools } from './cli/tools.js';
import { CliSessionsRepository } from '../db/index.js';
import type { VoiceAgent } from '../agent/voice-agent.js';

const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

export interface BackgroundTaskOptions {
  /** The task description/request */
  task: string;
  /** Voice session ID for parent-child relationship */
  voiceSessionId: string;
  /** Voice conversation history for context */
  voiceHistory?: RealtimeItem[];
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
  const { task, voiceSessionId, voiceHistory = [], voiceAgent, completionMessage } = options;

  const sessionsRepo = new CliSessionsRepository();

  // Create subagent session with background=true
  const subagent = sessionsRepo.createSubagent({
    goal: task.substring(0, 100),
    agent_name: 'cli',
    model: 'x-ai/grok-code-fast-1', // Will be overridden by config
    parent_id: voiceSessionId,
    background: true,
  });

  console.log(`[Background] Spawned background subagent: ${subagent.id} (parent: ${voiceSessionId})`);

  // Broadcast tree update immediately so UI shows the new session
  wsBroadcast.sessionTreeUpdate(voiceSessionId);

  // Start the async execution (fire-and-forget)
  const completion = runBackgroundAgent(subagent.id, task, voiceHistory).then((result) => {
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
  voiceHistory: RealtimeItem[]
): Promise<string> {
  const sessionsRepo = new CliSessionsRepository();

  if (!OPENROUTER_API_KEY) {
    const error = 'OPEN_ROUTER_API_KEY not set';
    wsBroadcast.streamChunk(sessionId, { type: 'error', error });
    sessionsRepo.finish(sessionId, 'error');
    return error;
  }

  try {
    // Load config from CLI agent (reuse same config)
    const cliAgentDir = new URL('./cli', import.meta.url).pathname;
    const { config, prompt: systemPrompt } = await loadAgentConfig(cliAgentDir);

    const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
    const model = openrouter.chat(config.model);

    // Format voice context
    const voiceContextText = voiceHistory
      .map((item) => {
        if (item.type === 'message') {
          const role = item.role ?? 'unknown';
          const content = item.content
            ?.map((c: { type: string; text?: string; transcript?: string }) => {
              if (c.type === 'text' || c.type === 'input_text') return c.text;
              if (c.type === 'audio' || c.type === 'input_audio') return c.transcript ?? '[audio]';
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
## Background Task
This is a BACKGROUND task running independently. Complete it thoroughly.

## Voice Context (for reference)
${voiceContextText || '(no voice context)'}

## Task
${task}

Complete this task. When done, provide a concise summary of what was accomplished.
`.trim();

    console.log(`[Background] Starting agent for session ${sessionId}`);

    // Emit start event
    wsBroadcast.streamChunk(sessionId, { type: 'start' });

    // Run streaming agent
    const result = streamText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools: cliAgentTools,
      stopWhen: stepCountIs(config.maxSteps ?? 5),
    });

    // Process stream and emit events (same pattern as CLI agent)
    let prevText = '';
    let prevReasoning = '';
    let prevStepCount = 0;
    const emittedToolCalls = new Set<string>();
    const emittedToolResults = new Set<string>();

    for await (const uiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
    })) {
      for (const part of uiMessage.parts) {
        switch (part.type) {
          case 'step-start': {
            const stepStarts = uiMessage.parts.filter((p) => p.type === 'step-start').length;
            if (stepStarts > prevStepCount) {
              wsBroadcast.streamChunk(sessionId, { type: 'start-step' });
              prevStepCount = stepStarts;
            }
            break;
          }

          case 'reasoning': {
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
            const textPart = part as { text: string };
            if (textPart.text.length > prevText.length) {
              const delta = textPart.text.slice(prevText.length);
              wsBroadcast.streamChunk(sessionId, { type: 'text-delta', textDelta: delta });
              prevText = textPart.text;
            }
            break;
          }

          default: {
            if (part.type.startsWith('tool-')) {
              const toolPart = part as {
                type: string;
                toolCallId: string;
                state: string;
                input?: unknown;
                output?: unknown;
              };
              const toolName = part.type.replace('tool-', '');

              if (toolPart.state === 'input-available' && !emittedToolCalls.has(toolPart.toolCallId)) {
                wsBroadcast.streamChunk(sessionId, {
                  type: 'tool-call',
                  toolName,
                  toolCallId: toolPart.toolCallId,
                  input: toolPart.input,
                });
                emittedToolCalls.add(toolPart.toolCallId);
              }

              if (toolPart.state === 'output-available' && !emittedToolResults.has(toolPart.toolCallId)) {
                const outputStr =
                  typeof toolPart.output === 'string'
                    ? toolPart.output
                    : JSON.stringify(toolPart.output);
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

    // Emit finish and update session
    wsBroadcast.streamChunk(sessionId, { type: 'finish', finishReason: 'stop' });
    sessionsRepo.finish(sessionId, 'finished');

    // Broadcast tree update
    const session = sessionsRepo.findById(sessionId);
    if (session?.parent_id) {
      wsBroadcast.sessionTreeUpdate(session.parent_id);
    }

    console.log(`[Background] Completed session ${sessionId}`);
    return prevText || 'Task completed.';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Background] Error in session ${sessionId}:`, errorMsg);
    wsBroadcast.streamChunk(sessionId, { type: 'error', error: errorMsg });
    sessionsRepo.finish(sessionId, 'error');
    return `Error: ${errorMsg}`;
  }
}
