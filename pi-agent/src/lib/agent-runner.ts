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
 */

import { streamText, stepCountIs, type ToolSet, type LanguageModel } from 'ai';
import { wsBroadcast, type WorkerActivityPayload } from '../api/websocket.js';

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

  // Broadcast: Agent started
  broadcast(name, 'thinking', { status: 'started', request: prompt });

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

    let fullText = '';
    let reasoningBuffer = '';

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
          broadcast(name, 'reasoning', { status: 'started' });
          break;
        }

        // Reasoning text chunk
        case 'reasoning-delta': {
          const text = (event as { text?: string }).text ?? '';
          reasoningBuffer += text;
          broadcast(name, 'reasoning', { delta: text, accumulated: reasoningBuffer });
          break;
        }

        // Reasoning complete
        case 'reasoning-end': {
          broadcast(name, 'reasoning', { status: 'complete', text: reasoningBuffer });
          break;
        }

        // Tool arguments streaming started
        case 'tool-input-start': {
          const { toolName, id } = event as { toolName: string; id?: string };
          console.log(`[AgentRunner] ${name}: Tool input starting: ${toolName}`);
          broadcast(name, 'tool_call', {
            status: 'streaming',
            tool: toolName,
            id: id ?? 'unknown',
          });
          break;
        }

        // Tool call executed - use 'input' property per AI SDK v5
        case 'tool-call': {
          // In AI SDK v5, tool event uses 'input' instead of 'args'
          const toolEvent = event as {
            toolName: string;
            toolCallId: string;
            input?: unknown;
            args?: unknown;
          };
          const args = toolEvent.input ?? toolEvent.args;

          console.log(`[AgentRunner] ${name}: Tool called: ${toolEvent.toolName}`);
          broadcast(name, 'tool_call', {
            status: 'called',
            tool: toolEvent.toolName,
            id: toolEvent.toolCallId,
            args,
          });
          break;
        }

        // Tool result received - use 'output' property per AI SDK v5
        case 'tool-result': {
          // In AI SDK v5, tool result uses 'output' instead of 'result'
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
            tool: resultEvent.toolName,
            id: resultEvent.toolCallId,
            result: output,
          });
          break;
        }

        // Text generation started
        case 'text-start':
          console.log(`[AgentRunner] ${name}: Text generation started`);
          break;

        // Text chunk
        case 'text-delta': {
          const delta = (event as { textDelta?: string }).textDelta ?? '';
          fullText += delta;
          // Optional: broadcast text chunks for real-time typing effect
          // broadcast(name, 'text', { delta, accumulated: fullText });
          break;
        }

        // Text generation complete
        case 'text-end':
          console.log(`[AgentRunner] ${name}: Text generation complete`);
          break;

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
          // Log unknown event types for debugging
          console.log(`[AgentRunner] ${name}: Unknown event type: ${(event as { type: string }).type}`);
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
 * Helper to broadcast worker activity events.
 */
function broadcast(
  agent: string,
  type: WorkerActivityPayload['type'],
  payload: unknown
): void {
  wsBroadcast.workerActivity({ agent, type, payload });
}

export { type ToolSet, type LanguageModel } from 'ai';
