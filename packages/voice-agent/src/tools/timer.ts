/**
 * Timer Tools - Set, list, and cancel timers.
 *
 * Uses SQLite database for persistence and the scheduler for firing.
 */

import { tool } from '@openai/agents/realtime';
import { z } from 'zod';
import { TimersRepository, type TimerMode } from '../db/index.js';
import { parseTimeExpression, formatTimerResponse } from '../scheduler/index.js';

const timersRepo = new TimersRepository();

export const setTimerTool = tool({
  name: 'set_timer',
  description:
    'Set a timer or reminder. Use this when the user wants to be reminded of something ' +
    'or wants a timer. Supports natural language time expressions like "in 5 minutes", ' +
    '"in einer Stunde", "um 15 Uhr", "at 3pm", "morgen um 9 Uhr".',
  parameters: z.object({
    time: z
      .string()
      .describe(
        'When the timer should fire. Natural language like "in 5 minutes", ' +
          '"in einer Stunde", "um 15 Uhr", "tomorrow at 9am".'
      ),
    message: z
      .string()
      .nullable()
      .describe('The reminder message to speak when the timer fires. If not specified, defaults to "Timer abgelaufen".'),
    mode: z
      .enum(['tts', 'agent'])
      .nullable()
      .describe(
        'How to deliver the reminder. "tts" speaks the message directly (default), ' +
          '"agent" triggers a new agent conversation.'
      ),
  }),
  async execute({ time, message: rawMessage, mode }) {
    const message = rawMessage ?? 'Timer abgelaufen';
    // Parse the time expression
    const parsed = parseTimeExpression(time);
    if (!parsed) {
      return `Ich konnte die Zeit "${time}" nicht verstehen. Bitte sage zum Beispiel "in 5 Minuten" oder "um 15 Uhr".`;
    }

    // Don't allow timers in the past
    if (parsed.date <= new Date()) {
      return 'Die angegebene Zeit liegt in der Vergangenheit. Bitte gib eine Zeit in der Zukunft an.';
    }

    // Create the timer
    const timer = timersRepo.create({
      fire_at: parsed.date,
      message: message.trim(),
      mode: (mode ?? 'tts') as TimerMode,
    });

    console.log(`[Timer] Created #${timer.id}: "${message}" at ${parsed.date.toISOString()}`);

    return formatTimerResponse(message, parsed.date);
  },
});

export const listTimersTool = tool({
  name: 'list_timers',
  description:
    'List all pending timers and reminders. Use this when the user wants to see ' +
    'their active timers or asks "what timers do I have?".',
  parameters: z.object({}),
  async execute() {
    const pending = timersRepo.getPending();

    if (pending.length === 0) {
      return 'Du hast keine aktiven Timer.';
    }

    const now = new Date();
    const lines = pending.map((t) => {
      const fireAt = new Date(t.fire_at);
      const diffMs = fireAt.getTime() - now.getTime();
      const diffMinutes = Math.round(diffMs / 60000);

      let timeDesc: string;
      if (diffMinutes < 1) {
        timeDesc = 'gleich';
      } else if (diffMinutes < 60) {
        timeDesc = `in ${diffMinutes} Minuten`;
      } else {
        const hours = Math.floor(diffMinutes / 60);
        const mins = diffMinutes % 60;
        if (mins === 0) {
          timeDesc = `in ${hours} Stunde${hours !== 1 ? 'n' : ''}`;
        } else {
          timeDesc = `in ${hours} Stunde${hours !== 1 ? 'n' : ''} und ${mins} Minuten`;
        }
      }

      return `Timer ${t.id}: "${t.message}" ${timeDesc}`;
    });

    console.log(`[Timer] Listed ${pending.length} timers`);

    return `Du hast ${pending.length} aktive Timer: ${lines.join('. ')}.`;
  },
});

export const cancelTimerTool = tool({
  name: 'cancel_timer',
  description:
    'Cancel a timer by its ID. Use this when the user wants to delete or cancel ' +
    'a specific timer.',
  parameters: z.object({
    id: z.number().describe('The ID of the timer to cancel.'),
  }),
  async execute({ id }) {
    const timer = timersRepo.findById(id);

    if (!timer) {
      return `Timer ${id} wurde nicht gefunden.`;
    }

    if (timer.status !== 'pending') {
      return `Timer ${id} ist bereits ${timer.status === 'fired' ? 'abgelaufen' : 'abgebrochen'}.`;
    }

    const success = timersRepo.cancel(id);

    if (success) {
      console.log(`[Timer] Cancelled #${id}: "${timer.message}"`);
      return `Timer ${id} wurde abgebrochen: "${timer.message}"`;
    } else {
      return `Timer ${id} konnte nicht abgebrochen werden.`;
    }
  },
});
