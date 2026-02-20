/**
 * Direct Input Handler - Routes text input to subagent sessions.
 *
 * Enables "chatable subagents" where users can type directly to a focused
 * subagent session instead of going through voice.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, stepCountIs, readUIMessageStream } from 'ai';
import { wsBroadcast } from '../api/websocket.js';
import { CliSessionsRepository } from '../db/index.js';
import { loadAgentConfig } from './loader.js';
import { cliAgentTools } from './cli/tools.js';
import { getCurrentOrchestratorId, setCurrentOrchestratorId } from './cli/index.js';

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
  const previousOrchestratorId = getCurrentOrchestratorId();
  setCurrentOrchestratorId(sessionId);

  try {
    // Emit start event
    wsBroadcast.streamChunk(sessionId, { type: 'start' });

    // For direct input, we DO want to show the user's message
    // This is actual user input, not a tool invocation
    wsBroadcast.streamChunk(sessionId, { type: 'user-transcript', text });

    // Stream response
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
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

    console.log(`[DirectInput] Starting UIMessageStream processing...`);

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

    console.log(`[DirectInput] Stream complete: ${updateCount} updates, ${fullText.length} chars`);

    // Emit finish event
    wsBroadcast.streamChunk(sessionId, { type: 'finish', finishReason: 'stop' });

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
  } finally {
    setCurrentOrchestratorId(previousOrchestratorId);
  }
}
