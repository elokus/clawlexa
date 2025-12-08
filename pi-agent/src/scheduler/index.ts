/**
 * Timer Scheduler
 *
 * Background service that checks for due timers and fires them.
 * Supports two modes:
 *   - 'tts': Direct TTS output for the message
 *   - 'agent': Inject as synthetic user message to the agent
 */

import { TimersRepository, type Timer } from '../db/index.js';
import { EventEmitter } from 'events';

export interface SchedulerEvents {
  timerFired: (timer: Timer) => void;
  error: (error: Error) => void;
}

export class Scheduler extends EventEmitter {
  private timersRepo: TimersRepository;
  private intervalId: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;

  constructor(checkIntervalMs: number = 1000) {
    super();
    this.timersRepo = new TimersRepository();
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Start the scheduler background loop.
   */
  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    console.log('[Scheduler] Starting timer scheduler');
    this.intervalId = setInterval(() => this.checkTimers(), this.checkIntervalMs);

    // Check immediately on start
    this.checkTimers();
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.intervalId) {
      console.log('[Scheduler] Stopping timer scheduler');
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check for due timers and fire them.
   */
  private checkTimers(): void {
    try {
      const dueTimers = this.timersRepo.getDue();

      for (const timer of dueTimers) {
        console.log(`[Scheduler] Firing timer #${timer.id}: ${timer.message}`);

        // Mark as fired first to prevent double-firing
        this.timersRepo.markFired(timer.id);

        // Emit event for the main app to handle
        this.emit('timerFired', timer);
      }
    } catch (error) {
      console.error('[Scheduler] Error checking timers:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Get the next pending timer.
   */
  getNextTimer(): Timer | null {
    return this.timersRepo.getNext();
  }

  /**
   * Get all pending timers.
   */
  getPendingTimers(): Timer[] {
    return this.timersRepo.getPending();
  }

  /**
   * Check if scheduler is running.
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

// Re-export time parsing utilities
export { parseTimeExpression, formatTimerResponse } from './time-parser.js';
