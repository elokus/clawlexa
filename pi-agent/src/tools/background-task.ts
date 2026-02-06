/**
 * Background Task Tool - Spawns detached subagent sessions that don't block voice input.
 *
 * This tool demonstrates the background session pattern:
 * - Returns immediately without waiting for the task to complete
 * - The voice agent can continue listening for new commands
 * - When the background task completes, it notifies the voice agent (if still active)
 *
 * Use cases:
 * - Long-running code reviews
 * - Feature implementations
 * - Any task where the user wants to queue work and continue talking
 */

import { tool, RealtimeContextData } from '@openai/agents/realtime';
import { z } from 'zod';
import { spawnBackgroundSubagent } from '../subagents/background.js';
import type { VoiceAgent } from '../agent/voice-agent.js';

const backgroundTaskParameters = z.object({
  task: z
    .string()
    .describe(
      'The task to run in the background. Be specific about what needs to be done.'
    ),
  notify_on_completion: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to notify the user when the task completes (default: true)'),
});

/**
 * Factory function to create the background_task tool with injected dependencies.
 *
 * @param voiceAgent - Reference to the voice agent for completion notifications
 * @param sessionId - Current voice session ID for parent-child tracking
 */
export function createBackgroundTaskTool(voiceAgent: VoiceAgent, sessionId: string) {
  return tool<typeof backgroundTaskParameters, RealtimeContextData>({
    name: 'background_task',
    description: `Start a task in the background without blocking the conversation.
Use this when:
- The user wants to queue a task and continue with other things
- The task might take a while (code reviews, implementations)
- The user explicitly says "in the background" or "while I do other things"

The task will run independently and notify the user when complete.
Examples:
- "Review the kireon backend code in the background"
- "Start implementing dark mode while I think about the API"
- "Run the tests in the background and tell me when done"`,
    parameters: backgroundTaskParameters,
    async execute({ task, notify_on_completion }) {
      console.log('[BackgroundTask] Spawning background task:', task);

      // Build HandoffPacket with full voice context (anti-telephone)
      const handoff = voiceAgent?.createHandoffPacket(task);

      // Spawn the background subagent
      const { sessionId: bgSessionId } = spawnBackgroundSubagent({
        task,
        voiceSessionId: sessionId,
        handoff,
        voiceAgent: notify_on_completion ? voiceAgent : undefined,
        completionMessage: (result) =>
          `Deine Hintergrund-Aufgabe ist fertig: ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`,
      });

      // Return immediately - don't await the completion
      return `Ich habe die Aufgabe im Hintergrund gestartet (Session: ${bgSessionId.substring(0, 8)}). Du kannst weiter mit mir sprechen - ich sage dir Bescheid wenn es fertig ist.`;
    },
  });
}
