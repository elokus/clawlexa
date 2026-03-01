/**
 * Event Recorder - Captures all WebSocket broadcasts for simulation/debugging.
 *
 * Usage:
 *   import { eventRecorder } from './event-recorder';
 *
 *   // Start recording
 *   eventRecorder.start();
 *
 *   // ... events are automatically captured via broadcast wrapper ...
 *
 *   // Stop and get events
 *   const events = eventRecorder.stop();
 *
 *   // Export to scenario format
 *   const scenario = eventRecorder.exportScenario('my-scenario', 'Description');
 */

import type { WSMessageType } from '@voiceclaw/voice-runtime';

export interface RecordedEvent {
  type: WSMessageType;
  payload: unknown;
  timestamp: number;
  /** Delay from previous event (calculated on export) */
  delay?: number;
}

export interface ExportedScenario {
  id: string;
  name: string;
  description: string;
  capturedAt: string;
  events: RecordedEvent[];
}

class EventRecorder {
  private events: RecordedEvent[] = [];
  private isRecording = false;
  private startTime = 0;

  /**
   * Start recording events.
   * Clears any previously recorded events.
   */
  start(): void {
    this.events = [];
    this.isRecording = true;
    this.startTime = Date.now();
    console.log('[EventRecorder] Recording started');
  }

  /**
   * Stop recording and return captured events.
   */
  stop(): RecordedEvent[] {
    this.isRecording = false;
    const duration = Date.now() - this.startTime;
    console.log(`[EventRecorder] Recording stopped. Captured ${this.events.length} events in ${duration}ms`);
    return this.events;
  }

  /**
   * Check if currently recording.
   */
  get recording(): boolean {
    return this.isRecording;
  }

  /**
   * Get event count.
   */
  get count(): number {
    return this.events.length;
  }

  /**
   * Record an event (called by broadcast wrapper).
   */
  record(type: WSMessageType, payload: unknown, timestamp: number): void {
    if (!this.isRecording) return;

    this.events.push({ type, payload, timestamp });
  }

  /**
   * Export recorded events as a scenario with delays calculated.
   */
  exportScenario(name: string, description: string): ExportedScenario {
    // Calculate delays between events
    const eventsWithDelays = this.events.map((event, index) => {
      const prevEvent = this.events[index - 1];
      const prevTimestamp = index > 0 && prevEvent ? prevEvent.timestamp : event.timestamp;
      const delay = event.timestamp - prevTimestamp;

      return {
        type: event.type,
        payload: event.payload,
        timestamp: event.timestamp,
        delay: Math.max(0, delay), // First event has delay 0
      };
    });

    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      description,
      capturedAt: new Date().toISOString(),
      events: eventsWithDelays,
    };
  }

  /**
   * Export scenario as JSON string (for file saving).
   */
  exportScenarioJson(name: string, description: string): string {
    const scenario = this.exportScenario(name, description);
    return JSON.stringify(scenario, null, 2);
  }

  /**
   * Clear recorded events without stopping.
   */
  clear(): void {
    this.events = [];
    this.startTime = Date.now();
    console.log('[EventRecorder] Events cleared');
  }

  /**
   * Get current events (without stopping).
   */
  getEvents(): RecordedEvent[] {
    return [...this.events];
  }
}

// Singleton instance
export const eventRecorder = new EventRecorder();
