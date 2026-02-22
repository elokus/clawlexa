/**
 * Web Search Subagent - Uses llm-runtime with OpenRouter model configured in agent config.
 *
 * This demonstrates the handoff pattern with OpenRouter's :online suffix:
 * 1. Realtime model calls this tool with a query
 * 2. Tool delegates to configured OpenRouter model via llm-runtime
 * 3. Model performs web search and returns grounded result
 * 4. Realtime model SPEAKS the result to the user
 */

import { tool } from '@openai/agents/realtime';
import { z } from 'zod';
import { loadAgentConfig } from '../loader.js';
import { llmRuntime } from '../llm-runtime.js';
import { forwardLlmStreamToSession } from '../stream-events.js';

// Track current voice session for event emission (set by voice-agent before tool call)
let currentVoiceSessionId: string | undefined;

/**
 * Set the current voice session ID for stream event emission.
 * Called by VoiceSession before tool execution.
 */
export function setVoiceSessionId(sessionId: string | undefined): void {
  currentVoiceSessionId = sessionId;
}

export const webSearchTool = tool({
  name: 'web_search',
  description:
    'Search the web for current information. Use this when the user asks about ' +
    'recent news, current events, live data, weather, or anything that requires ' +
    'up-to-date information from the internet.',
  parameters: z.object({
    query: z.string().describe('The search query to look up on the web.'),
  }),
  async execute({ query }) {
    if (!query.trim()) {
      return 'Keine Suchanfrage angegeben.';
    }

    console.log(`[WebSearch] Searching with configured model for: ${query}`);

    try {
      const { config, prompt: systemPrompt } = await loadAgentConfig(import.meta.dirname);

      const { text: fullText, eventCount } = await forwardLlmStreamToSession(
        llmRuntime.streamOpenRouter({
          model: {
            provider: 'openrouter',
            model: config.model,
            modality: 'llm',
          },
          context: {
            systemPrompt,
            messages: [{ role: 'user', content: query }],
          },
        }),
        {
          sessionId: currentVoiceSessionId,
        }
      );

      console.log(`[WebSearch] Result (${eventCount} events): ${fullText.substring(0, 100)}...`);
      return fullText || 'Keine Ergebnisse gefunden.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WebSearch] Error: ${message}`);
      return `Die Websuche ist fehlgeschlagen: ${message}`;
    }
  },
});
