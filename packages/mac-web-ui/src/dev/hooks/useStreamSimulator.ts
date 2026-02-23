// ═══════════════════════════════════════════════════════════════════════════
// Stream Simulator Hook - Plays back stream events with realistic timing
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useRef, useEffect } from 'react';
import type { StreamEvent, StreamScenario } from '../registry';

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'finished';

export interface StreamSimulatorState {
  /** Current playback state */
  state: PlaybackState;
  /** Events emitted so far */
  events: StreamEvent[];
  /** Current event index */
  currentIndex: number;
  /** Total events in scenario */
  totalEvents: number;
  /** Playback speed multiplier (1 = normal, 2 = 2x, etc.) */
  speed: number;
  /** Whether using backend stream */
  useBackend: boolean;
  /** Backend availability status */
  backendAvailable: boolean | null;
}

export interface StreamSimulatorActions {
  /** Start or resume playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Reset to initial state */
  reset: () => void;
  /** Skip to next event immediately */
  step: () => void;
  /** Set playback speed */
  setSpeed: (speed: number) => void;
  /** Toggle backend/frontend mode */
  setUseBackend: (use: boolean) => void;
  /** Load a new scenario */
  loadScenario: (scenario: StreamScenario) => void;
}

export function useStreamSimulator(
  initialScenario: StreamScenario | null,
  backendRoute?: string
): [StreamSimulatorState, StreamSimulatorActions] {
  const [state, setState] = useState<PlaybackState>('idle');
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [useBackend, setUseBackendState] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);

  const scenarioRef = useRef<StreamScenario | null>(initialScenario);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Use refs to avoid stale closures in setTimeout callbacks
  const currentIndexRef = useRef(0);
  const speedRef = useRef(1);
  const isPlayingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Check backend availability on mount
  useEffect(() => {
    if (backendRoute) {
      checkBackendAvailability(backendRoute).then(setBackendAvailable);
    }
  }, [backendRoute]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const emitNextEvent = useCallback(() => {
    const scenario = scenarioRef.current;
    const idx = currentIndexRef.current;

    if (!scenario || idx >= scenario.events.length || !isPlayingRef.current) {
      if (idx >= (scenario?.events.length ?? 0)) {
        setState('finished');
        isPlayingRef.current = false;
      }
      return;
    }

    const event = scenario.events[idx];
    setEvents((prev) => [...prev, event]);

    const nextIndex = idx + 1;
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);

    // Schedule next event
    if (nextIndex < scenario.events.length) {
      const nextEvent = scenario.events[nextIndex];
      const delay = (nextEvent.delay || 100) / speedRef.current;
      timeoutRef.current = setTimeout(emitNextEvent, delay);
    } else {
      setState('finished');
      isPlayingRef.current = false;
    }
  }, []);

  const play = useCallback(() => {
    if (useBackend && backendRoute) {
      playFromBackend(backendRoute);
    } else {
      setState('playing');
      isPlayingRef.current = true;
      emitNextEvent();
    }
  }, [useBackend, backendRoute, emitNextEvent]);

  const playFromBackend = useCallback((route: string) => {
    setState('playing');
    setEvents([]);
    setCurrentIndex(0);

    // Use Server-Sent Events for streaming
    const eventSource = new EventSource(`/api${route}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (e) => {
      try {
        const event: StreamEvent = JSON.parse(e.data);
        setEvents((prev) => [...prev, event]);
        setCurrentIndex((prev) => prev + 1);
      } catch (err) {
        console.error('[StreamSimulator] Failed to parse event:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setState('finished');
    };

    eventSource.addEventListener('done', () => {
      eventSource.close();
      setState('finished');
    });
  }, []);

  const pause = useCallback(() => {
    isPlayingRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState('paused');
  }, []);

  const reset = useCallback(() => {
    isPlayingRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState('idle');
    setEvents([]);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
  }, []);

  const step = useCallback(() => {
    const scenario = scenarioRef.current;
    const idx = currentIndexRef.current;
    if (!scenario || idx >= scenario.events.length) return;

    const event = scenario.events[idx];
    setEvents((prev) => [...prev, event]);

    const nextIndex = idx + 1;
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);

    if (nextIndex >= scenario.events.length) {
      setState('finished');
    } else {
      setState('paused');
    }
  }, []);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
  }, []);

  const setUseBackend = useCallback((use: boolean) => {
    reset();
    setUseBackendState(use);
  }, [reset]);

  const loadScenario = useCallback((scenario: StreamScenario) => {
    reset();
    scenarioRef.current = scenario;
  }, [reset]);

  return [
    {
      state,
      events,
      currentIndex,
      totalEvents: scenarioRef.current?.events.length || 0,
      speed,
      useBackend,
      backendAvailable,
    },
    {
      play,
      pause,
      reset,
      step,
      setSpeed,
      setUseBackend,
      loadScenario,
    },
  ];
}

async function checkBackendAvailability(route: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/demo/health`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
