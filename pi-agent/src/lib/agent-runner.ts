/**
 * Observable Agent Runner - Vercel AI SDK v5 streaming pattern.
 *
 * This module provides a standardized way to run worker agents with real-time
 * event streaming to the Web UI via WebSocket. It handles:
 * - Reasoning events (for thinking models like Grok, DeepSeek)
 * - Tool calls and results
 * - Text generation streaming
 * - Error handling
 *
 * Uses the Vercel AI SDK v5 `streamText` with `fullStream` for granular events.
 *
 * Emits unified `subagent_activity` events:
 * - reasoning_start/delta/end: Streaming reasoning (collapsed by default in UI)
 * - tool_call/tool_result: Tool invocations with arguments and results
 * - response: Final generated text
 * - error/complete: Status events
 */

import { streamText, stepCountIs, type ToolSet, type LanguageModel } from 'ai';
import { wsBroadcast, type SubagentEventType } from '../api/websocket.js';

export interface AgentRunnerOptions {
  /** The language model to use (e.g., openrouter.chat('x-ai/grok-code-fast-1')) */
  model: LanguageModel;
  /** System prompt for the agent */
  system: string;
  /** User prompt/request */
  prompt: string;
  /** Tools available to the agent */
  tools: ToolSet;
  /** Agent name for UI display (e.g., "Marvin", "CLI Agent") */
  name: string;
  /** Maximum steps for multi-step tool calling (default: 3) */
  maxSteps?: number;
}

/**
 * Run an agent with observable streaming events.
 *
 * Broadcasts real-time events to the WebSocket for UI updates:
 * - thinking: Agent is processing/reasoning
 * - tool_call: Tool invocation with arguments
 * - tool_result: Tool return value
 * - text: Generated text chunks
 * - response: Final complete response
 * - error: Any errors encountered
 *
 * @param opts - Agent configuration options
 * @returns The complete generated text response
 */
export async function runObservableAgent(opts: AgentRunnerOptions): Promise<string> {
  const { model, system, prompt, tools, name, maxSteps = 3 } = opts;

  // Track reasoning timing
  let reasoningStartTime = 0;
  let reasoningBuffer = '';
  let fullText = '';

  try {
    // Start streaming with Vercel AI SDK v5
    // Use stopWhen with stepCountIs() for multi-step tool calling limits
    const result = streamText({
      model,
      system,
      prompt,
      tools,
      stopWhen: stepCountIs(maxSteps),
    });

    // Process the full event stream
    for await (const event of result.fullStream) {
      switch (event.type) {
        // Stream started
        case 'start':
          console.log(`[AgentRunner] ${name}: Stream started`);
          break;

        // New step started
        case 'start-step':
          console.log(`[AgentRunner] ${name}: New step started`);
          break;

        // Reasoning started (for thinking models like Grok, DeepSeek R1)
        case 'reasoning-start': {
          reasoningBuffer = '';
          reasoningStartTime = Date.now();
          broadcast(name, 'reasoning_start', {});
          break;
        }

        // Reasoning text chunk
        case 'reasoning-delta': {
          const text = (event as { text?: string }).text ?? '';
          reasoningBuffer += text;
          broadcast(name, 'reasoning_delta', { delta: text });
          break;
        }

        // Reasoning complete
        case 'reasoning-end': {
          const durationMs = Date.now() - reasoningStartTime;
          broadcast(name, 'reasoning_end', { text: reasoningBuffer, durationMs });
          break;
        }

        // Tool call executed - use 'input' property per AI SDK v5
        case 'tool-call': {
          const toolEvent = event as {
            toolName: string;
            toolCallId: string;
            input?: unknown;
            args?: unknown;
          };
          const args = toolEvent.input ?? toolEvent.args;

          console.log(`[AgentRunner] ${name}: Tool called: ${toolEvent.toolName}`);
          broadcast(name, 'tool_call', {
            toolName: toolEvent.toolName,
            toolCallId: toolEvent.toolCallId,
            args,
          });
          break;
        }

        // Tool result received - use 'output' property per AI SDK v5
        case 'tool-result': {
          const resultEvent = event as {
            toolName: string;
            toolCallId: string;
            input?: unknown;
            output?: unknown;
            result?: unknown;
          };
          const output = resultEvent.output ?? resultEvent.result;

          console.log(`[AgentRunner] ${name}: Tool result: ${resultEvent.toolName}`);
          broadcast(name, 'tool_result', {
            toolName: resultEvent.toolName,
            toolCallId: resultEvent.toolCallId,
            result: typeof output === 'string' ? output : JSON.stringify(output),
          });
          break;
        }

        // Text chunk
        case 'text-delta': {
          const delta = (event as { textDelta?: string }).textDelta ?? '';
          fullText += delta;
          break;
        }

        // Step finished
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
          console.log(`[AgentRunner] ${name}: Step finished: ${stepEvent.finishReason}`);
          if (stepEvent.usage) {
            console.log(`[AgentRunner] ${name}: Usage:`, stepEvent.usage);
          }
          break;
        }

        // Stream finished
        case 'finish': {
          console.log(`[AgentRunner] ${name}: Stream finished: ${event.finishReason}`);
          break;
        }

        // Error occurred
        case 'error': {
          const errorEvent = event as { error?: unknown };
          const errorMsg = String(errorEvent.error);
          console.error(`[AgentRunner] ${name}: Error:`, errorMsg);
          broadcast(name, 'error', { message: errorMsg });
          break;
        }

        default:
          // Ignore other events (start-step, text-start, text-end, tool-input-start, etc.)
          break;
      }
    }

    // Broadcast final response
    broadcast(name, 'response', { text: fullText });
    broadcast(name, 'complete', { success: true });

    return fullText;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AgentRunner] ${name}: Execution failed:`, errorMsg);

    broadcast(name, 'error', { message: errorMsg });
    broadcast(name, 'complete', { success: false, error: errorMsg });

    throw error;
  }
}

/**
 * Helper to broadcast subagent activity events.
 */
function broadcast(agent: string, type: SubagentEventType, payload: unknown): void {
  wsBroadcast.subagentActivity({ agent, type, payload });
}

export { type ToolSet, type LanguageModel } from 'ai';
