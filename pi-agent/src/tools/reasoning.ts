/**
 * Reasoning Delegation Tool - Hands off to a reasoning model for complex tasks.
 *
 * This demonstrates delegation through tools (from the docs):
 * - Realtime model handles voice interaction
 * - Complex reasoning is delegated to gpt-5-mini (or similar)
 * - Result is returned for Realtime to speak
 *
 * Use cases:
 * - Multi-step planning
 * - Code analysis
 * - Complex calculations
 * - Decision making with multiple factors
 */

import { tool, type RealtimeContextData } from '@openai/agents/realtime';
import OpenAI from 'openai';
import { z } from 'zod';

const client = new OpenAI();

export const reasoningTool = tool<
  z.ZodObject<{
    task: z.ZodString;
    context: z.ZodNullable<z.ZodString>;
  }>,
  RealtimeContextData
>({
  name: 'deep_thinking',
  description:
    'Delegate complex reasoning tasks to a more capable model. Use this for: ' +
    'multi-step planning, analyzing complex problems, making decisions with ' +
    'multiple factors, code review, or any task requiring deeper thought. ' +
    'The result will be spoken back to the user.',
  parameters: z.object({
    task: z.string().describe('The task or question that requires deep reasoning.'),
    context: z
      .string()
      .nullable()
      .describe('Additional context about what the user needs. Pass null if none.'),
  }),
  async execute({ task, context }, details) {
    console.log(`[Reasoning] Task: ${task}`);

    // Access conversation history from the Realtime session
    const history = details?.context?.history ?? [];

    // Build context from recent conversation
    const recentMessages = history
      .filter((item) => item.type === 'message')
      .slice(-5) // Last 5 messages for context
      .map((item) => {
        if ('content' in item && Array.isArray(item.content)) {
          const content = item.content as Array<{ type?: string; text?: string }>;
          const text = content
            .filter((c) => c.text)
            .map((c) => c.text)
            .join(' ');
          const role = 'role' in item ? (item as { role: string }).role : 'unknown';
          return `${role}: ${text}`;
        }
        return null;
      })
      .filter(Boolean)
      .join('\n');

    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o', // Use gpt-5-mini when available
        messages: [
          {
            role: 'system',
            content: `Du bist ein intelligenter Assistent, der bei komplexen Aufgaben hilft.
Du erhältst eine Aufgabe und den Kontext aus einem Voice-Gespräch.
Deine Antwort wird vorgelesen, also:
- Halte dich kurz und prägnant (max 3-4 Sätze)
- Verwende natürliche Sprache, keine Aufzählungen
- Strukturiere komplexe Antworten in sprechbare Abschnitte`,
          },
          {
            role: 'user',
            content: `Aufgabe: ${task}
${context ? `\nZusätzlicher Kontext: ${context}` : ''}
${recentMessages ? `\nLetzter Gesprächsverlauf:\n${recentMessages}` : ''}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const result = response.choices[0]?.message?.content || 'Ich konnte keine Antwort generieren.';
      console.log(`[Reasoning] Result: ${result.substring(0, 100)}...`);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Reasoning] Error: ${message}`);
      return `Bei der Analyse ist ein Fehler aufgetreten: ${message}`;
    }
  },
});
