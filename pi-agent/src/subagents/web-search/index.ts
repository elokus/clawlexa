/**
 * Web Search Subagent - Uses Vercel AI SDK with OpenRouter's grok model with web search.
 *
 * This demonstrates the handoff pattern with OpenRouter's :online suffix:
 * 1. Realtime model calls this tool with a query
 * 2. Tool delegates to grok-4-1-fast-reasoning:online via OpenRouter
 * 3. Model automatically performs web search and returns grounded result
 * 4. Realtime model SPEAKS the result to the user
 *
 * Note: This is a simple tool called from voice, not a session-based subagent.
 * Stream events are emitted for observability if a voiceSessionId is available.
 */

import { tool } from '@openai/agents/realtime';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, readUIMessageStream } from 'ai';
import { z } from 'zod';
import { loadAgentConfig } from '../loader.js';
import { wsBroadcast } from '../../api/websocket.js';

// OpenRouter provider - uses OPEN_ROUTER_API_KEY from environment
const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

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

    if (!OPENROUTER_API_KEY) {
      console.error('[WebSearch] OPEN_ROUTER_API_KEY not set');
      return 'Die Websuche ist nicht konfiguriert.';
    }

    console.log(`[WebSearch] Searching with grok:online for: ${query}`);

    try {
      // Load config and prompt from disk
      const { config, prompt: systemPrompt } = await loadAgentConfig(import.meta.dirname);

      // Create OpenRouter provider with model from config
      const openrouter = createOpenRouter({
        apiKey: OPENROUTER_API_KEY,
      });
      const model = openrouter.chat(config.model);

      // Use streamText directly (no tools for web search)
      const result = streamText({
        model,
        system: systemPrompt,
        prompt: query,
      });

      // Use UIMessageStream for proper streaming (works around OpenRouter fullStream bug)
      let prevText = '';
      let updateCount = 0;

      for await (const uiMessage of readUIMessageStream({
        stream: result.toUIMessageStream(),
      })) {
        updateCount++;

        // Process text parts
        for (const part of uiMessage.parts) {
          if (part.type === 'text') {
            const textPart = part as { text: string };
            if (textPart.text.length > prevText.length) {
              const delta = textPart.text.slice(prevText.length);
              // Emit stream event if we have a voice session
              if (currentVoiceSessionId) {
                wsBroadcast.streamChunk(currentVoiceSessionId, {
                  type: 'text-delta',
                  textDelta: delta,
                });
              }
              prevText = textPart.text;
            }
          }
        }
      }

      // Emit finish event
      if (currentVoiceSessionId) {
        wsBroadcast.streamChunk(currentVoiceSessionId, {
          type: 'finish',
          finishReason: 'stop',
        });
      }

      const fullText = prevText;
      console.log(`[WebSearch] Result (${updateCount} updates): ${fullText.substring(0, 100)}...`);

      // This string is returned to Realtime, which will speak it
      return fullText || 'Keine Ergebnisse gefunden.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WebSearch] Error: ${message}`);
      return `Die Websuche ist fehlgeschlagen: ${message}`;
    }
  },
});
