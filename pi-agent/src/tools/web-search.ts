/**
 * Web Search Tool - Delegates to gpt-4.1-mini with web_search capability.
 *
 * This demonstrates the handoff pattern:
 * 1. Realtime model calls this tool with a query
 * 2. Tool delegates to Responses API (gpt-4.1-mini + web_search)
 * 3. Result is returned as string
 * 4. Realtime model SPEAKS the result to the user
 */

import { tool } from '@openai/agents/realtime';
import OpenAI from 'openai';
import { z } from 'zod';

const client = new OpenAI();

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

    console.log(`[WebSearch] Searching for: ${query}`);

    try {
      // Delegate to Responses API with web_search tool
      const response = await client.responses.create({
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content:
              'Du bist ein fokussierter Recherche-Assistent. ' +
              'Nutze die Web-Suche um Fragen präzise zu beantworten. ' +
              'Antworte auf Deutsch. Halte die Antwort kurz und prägnant, ' +
              'maximal 2-3 Sätze. Nenne wichtige Quellen wenn relevant.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
      });

      const result = response.output_text || 'Keine Ergebnisse gefunden.';
      console.log(`[WebSearch] Result: ${result.substring(0, 100)}...`);

      // This string is returned to Realtime, which will speak it
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WebSearch] Error: ${message}`);
      return `Die Websuche ist fehlgeschlagen: ${message}`;
    }
  },
});
