/**
 * Audio Session Hook - Manages voice session state and audio I/O.
 *
 * Provides:
 * - Profile selection (Jarvis / Marvin)
 * - Recording state management
 * - Audio capture/playback coordination
 * - Uses shared WebSocket from useWebSocket hook
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioController } from '../lib/audio';
import { useAgentStore } from '../stores/agent';
import { useWebSocket } from './useWebSocket';

export type ProfileId = 'jarvis' | 'marvin';

export interface AudioSessionState {
  /** Currently selected profile */
  activeProfile: ProfileId;
  /** Set the active profile */
  setActiveProfile: (profile: ProfileId) => void;
  /** Whether recording is active */
  isRecording: boolean;
  /** Toggle recording on/off */
  toggleSession: () => Promise<void>;
  /** Stop the session immediately */
  stopSession: () => void;
  /** Whether audio system is initializing */
  isInitializing: boolean;
  /** Error message if any */
  error: string | null;
}

export function useAudioSession(): AudioSessionState {
  const [activeProfile, setActiveProfile] = useState<ProfileId>('jarvis');
  const [isRecording, setIsRecording] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioControllerRef = useRef<AudioController | null>(null);
  const state = useAgentStore((s) => s.state);
  const connected = useAgentStore((s) => s.connected);

  // Use shared WebSocket connection
  const { send, sendBinary } = useWebSocket();

  // Initialize audio controller
  useEffect(() => {
    audioControllerRef.current = new AudioController({
      onError: (err) => {
        console.error('[AudioSession] Error:', err);
        setError(err.message);
      },
    });

    return () => {
      if (audioControllerRef.current) {
        audioControllerRef.current.stop();
      }
    };
  }, []);

  // Listen for incoming audio from WebSocket
  useEffect(() => {
    const handleAudio = (event: CustomEvent<ArrayBuffer>) => {
      if (audioControllerRef.current) {
        audioControllerRef.current.playAudio(event.detail);
      }
    };

    window.addEventListener('ws-audio', handleAudio as EventListener);

    return () => {
      window.removeEventListener('ws-audio', handleAudio as EventListener);
    };
  }, []);

  // Toggle session on/off
  const toggleSession = useCallback(async () => {
    if (isRecording) {
      // Stop recording
      if (audioControllerRef.current) {
        audioControllerRef.current.stop();
      }
      send('client_command', { command: 'stop_session' });
      setIsRecording(false);
      setError(null);
    } else {
      // Start recording
      setIsInitializing(true);
      setError(null);

      try {
        if (audioControllerRef.current) {
          // Set up audio callback to send via shared WebSocket
          audioControllerRef.current.setOnAudio((data) => {
            sendBinary(data);
          });
          await audioControllerRef.current.start();
        }

        // Send start command with selected profile
        send('client_command', { command: 'start_session', profile: activeProfile });
        setIsRecording(true);
      } catch (err) {
        console.error('[AudioSession] Failed to start:', err);
        setError((err as Error).message || 'Failed to start audio');
        setIsRecording(false);
      } finally {
        setIsInitializing(false);
      }
    }
  }, [isRecording, activeProfile, send, sendBinary]);

  // Stop session immediately
  const stopSession = useCallback(() => {
    if (audioControllerRef.current) {
      audioControllerRef.current.stop();
    }
    send('client_command', { command: 'stop_session' });
    setIsRecording(false);
  }, [send]);

  // Auto-stop recording when agent state goes to idle
  useEffect(() => {
    if (state === 'idle' && isRecording && connected) {
      // Session ended from server side
      if (audioControllerRef.current) {
        audioControllerRef.current.stop();
      }
      setIsRecording(false);
    }
  }, [state, isRecording, connected]);

  return {
    activeProfile,
    setActiveProfile,
    isRecording,
    toggleSession,
    stopSession,
    isInitializing,
    error,
  };
}
