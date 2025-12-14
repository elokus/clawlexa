/**
 * Web Search Tool - Uses Vercel AI SDK with OpenRouter's grok model with web search.
 *
 * This demonstrates the handoff pattern with OpenRouter's :online suffix:
 * 1. Realtime model calls this tool with a query
 * 2. Tool delegates to grok-4-1-fast-reasoning:online via OpenRouter
 * 3. Model automatically performs web search and returns grounded result
 * 4. Realtime model SPEAKS the result to the user
 *
 * Uses the Observable Agent Runner pattern for real-time WebSocket events.
 */

import { tool } from '@openai/agents/realtime';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { wsBroadcast } from '../api/websocket.js';

// OpenRouter provider - uses OPEN_ROUTER_API_KEY from environment
const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

const openrouter = createOpenRouter({
  apiKey: OPENROUTER_API_KEY ?? '',
});

// Use grok with :online suffix for automatic web search
// This enables both Web Search and X Search for xAI models
const WEB_SEARCH_MODEL = openrouter.chat('x-ai/grok-4-1-fast-reasoning:online');

const SYSTEM_PROMPT = `Du bist ein fokussierter Recherche-Assistent mit Webzugang.
Antworte auf Deutsch. Halte die Antwort kurz und prägnant, maximal 2-3 Sätze.
Nenne wichtige Quellen wenn relevant, aber formatiere sie als natürliche Sprache.
Zitiere KEINE URLs direkt - beschreibe stattdessen die Quelle.`;

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

    // Broadcast that web search is starting
    wsBroadcast.workerActivity({
      agent: 'Jarvis',
      type: 'thinking',
      payload: { status: 'started', request: `Web search: ${query}` },
    });

    try {
      // Use generateText with OpenRouter's grok:online model
      // The :online suffix automatically enables web search
      const result = await generateText({
        model: WEB_SEARCH_MODEL,
        system: SYSTEM_PROMPT,
        prompt: query,
      });

      const text = result.text || 'Keine Ergebnisse gefunden.';

      console.log(`[WebSearch] Result: ${text.substring(0, 100)}...`);

      // Log usage if available (AI SDK v5 uses inputTokens/outputTokens)
      if (result.usage) {
        console.log(`[WebSearch] Usage: input=${result.usage.inputTokens}, output=${result.usage.outputTokens}`);
      }

      // Broadcast completion
      wsBroadcast.workerActivity({
        agent: 'Jarvis',
        type: 'response',
        payload: { text },
      });

      wsBroadcast.workerActivity({
        agent: 'Jarvis',
        type: 'complete',
        payload: { success: true },
      });

      // This string is returned to Realtime, which will speak it
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WebSearch] Error: ${message}`);

      // Broadcast error
      wsBroadcast.workerActivity({
        agent: 'Jarvis',
        type: 'error',
        payload: { message },
      });

      return `Die Websuche ist fehlgeschlagen: ${message}`;
    }
  },
});
