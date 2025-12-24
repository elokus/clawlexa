/**
 * Direct Input Handler - Routes text input to subagent sessions.
 *
 * Enables "chatable subagents" where users can type directly to a focused
 * subagent session instead of going through voice.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, stepCountIs } from 'ai';
import { wsBroadcast } from '../api/websocket.js';
import { CliSessionsRepository } from '../db/index.js';
import { loadAgentConfig } from './loader.js';
import { cliAgentTools } from './cli/tools.js';

const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

/**
 * Handle direct text input to a subagent session.
 * Resumes the session's conversation and streams the response.
 */
export async function handleDirectInput(sessionId: string, text: string): Promise<void> {
  const sessionsRepo = new CliSessionsRepository();
  const session = sessionsRepo.findById(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (session.type !== 'subagent') {
    throw new Error(`Cannot send input to ${session.type} session`);
  }

  if (session.status === 'finished' || session.status === 'cancelled') {
    throw new Error(`Session is ${session.status}`);
  }

  console.log(`[DirectInput] Processing input for session ${sessionId.slice(0, 8)} (${session.agent_name})`);

  // Route based on agent type
  switch (session.agent_name) {
    case 'cli':
      await handleCliInput(session, text, sessionsRepo);
      break;
    default:
      throw new Error(`Unsupported agent type: ${session.agent_name}`);
  }
}

/**
 * Handle input to a CLI subagent session.
 */
async function handleCliInput(
  session: ReturnType<CliSessionsRepository['findById']> & object,
  text: string,
  sessionsRepo: CliSessionsRepository
): Promise<void> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPEN_ROUTER_API_KEY not set');
  }

  const sessionId = session.id;

  // Load agent config
  const configPath = new URL('./cli', import.meta.url).pathname;
  const { config, prompt: systemPrompt } = await loadAgentConfig(configPath);

  // Load conversation history
  const history: Array<{ role: string; content: string }> = JSON.parse(
    session.conversation_history || '[]'
  );

  // Add user message
  history.push({ role: 'user', content: text });

  // Format for AI SDK
  const messages = history.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  console.log(`[DirectInput] CLI session ${sessionId.slice(0, 8)}: ${history.length} messages in history`);

  // Create OpenRouter model
  const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
  const model = openrouter.chat(config.model);

  let fullText = '';

  try {
    // Emit start event
    wsBroadcast.streamChunk(sessionId, { type: 'start' });

    // Stream response
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: cliAgentTools,
      stopWhen: stepCountIs(config.maxSteps ?? 3),
    });

    // Process stream and emit events
    for await (const event of result.fullStream) {
      switch (event.type) {
        case 'start-step':
          wsBroadcast.streamChunk(sessionId, { type: 'start-step' });
          break;

        case 'text-delta': {
          const textDelta = (event as { textDelta?: string }).textDelta ?? '';
          fullText += textDelta;
          wsBroadcast.streamChunk(sessionId, { type: 'text-delta', textDelta });
          break;
        }

        case 'tool-call': {
          const { toolName, toolCallId, input, args } = event as {
            toolName: string;
            toolCallId: string;
            input?: unknown;
            args?: unknown;
          };
          wsBroadcast.streamChunk(sessionId, {
            type: 'tool-call',
            toolName,
            toolCallId,
            input: input ?? args,
          });
          break;
        }

        case 'tool-result': {
          const { toolName, toolCallId, output, result } = event as {
            toolName: string;
            toolCallId: string;
            output?: unknown;
            result?: unknown;
          };
          wsBroadcast.streamChunk(sessionId, {
            type: 'tool-result',
            toolName,
            toolCallId,
            output: typeof (output ?? result) === 'string' ? (output ?? result) : JSON.stringify(output ?? result),
          });
          break;
        }

        case 'finish-step': {
          const { finishReason, usage } = event as {
            finishReason?: string;
            usage?: Record<string, number>;
          };
          wsBroadcast.streamChunk(sessionId, { type: 'finish-step', finishReason, usage });
          break;
        }

        case 'finish':
          wsBroadcast.streamChunk(sessionId, {
            type: 'finish',
            finishReason: event.finishReason ?? 'stop',
          });
          break;

        case 'error': {
          const errorMsg = String((event as { error?: unknown }).error);
          console.error(`[DirectInput] Error:`, errorMsg);
          wsBroadcast.streamChunk(sessionId, { type: 'error', error: errorMsg });
          break;
        }
      }
    }

    // Save updated history
    history.push({ role: 'assistant', content: fullText || 'No response' });
    sessionsRepo.update(session.id, {
      conversation_history: JSON.stringify(history),
    });

    console.log(`[DirectInput] Response saved to session ${sessionId.slice(0, 8)}`);

    // Broadcast tree update
    const parentId = session.parent_id;
    wsBroadcast.sessionTreeUpdate(parentId ?? sessionId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[DirectInput] Error:`, errorMsg);
    wsBroadcast.streamChunk(sessionId, { type: 'error', error: errorMsg });
    throw error;
  }
}
