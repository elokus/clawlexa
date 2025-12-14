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
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { runObservableAgent } from '../lib/agent-runner.js';

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

    try {
      // Use runObservableAgent for unified WebSocket streaming
      // The :online suffix automatically enables web search via OpenRouter
      const text = await runObservableAgent({
        name: 'Jarvis',
        model: WEB_SEARCH_MODEL,
        system: SYSTEM_PROMPT,
        prompt: query,
        tools: {}, // No sub-tools for web search (model has built-in web access)
        maxSteps: 1, // Single step - just search and respond
      });

      console.log(`[WebSearch] Result: ${text.substring(0, 100)}...`);

      // This string is returned to Realtime, which will speak it
      return text || 'Keine Ergebnisse gefunden.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WebSearch] Error: ${message}`);
      return `Die Websuche ist fehlgeschlagen: ${message}`;
    }
  },
});
