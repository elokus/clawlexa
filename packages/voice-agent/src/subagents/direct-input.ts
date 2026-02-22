/**
 * Direct Input Handler - Routes text input to subagent sessions.
 *
 * Enables "chatable subagents" where users can type directly to a focused
 * subagent session instead of going through voice.
 */

import { wsBroadcast } from '../api/websocket.js';
import { CliSessionsRepository } from '../db/index.js';
import { loadAgentConfig } from './loader.js';
import { cliAgentToolDefinitions, executeCliAgentTool } from '../tools/cli-agent-tools.js';
import { getCurrentOrchestratorId, setCurrentOrchestratorId } from './cli/index.js';
import { llmRuntime } from './llm-runtime.js';
import { forwardLlmStreamToSession } from './stream-events.js';

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

  const previousOrchestratorId = getCurrentOrchestratorId();
  setCurrentOrchestratorId(sessionId);

  try {
    // For direct input, we DO want to show the user's message
    // This is actual user input, not a tool invocation
    wsBroadcast.streamChunk(sessionId, { type: 'user-transcript', text });
    console.log('[DirectInput] Starting llm-runtime stream processing...');
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
      { sessionId }
    );

    console.log(`[DirectInput] Stream complete: ${updateCount} events, ${fullText.length} chars`);

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
