/**
 * Audio Session Hook - Manages voice session state and audio I/O.
 *
 * Provides:
 * - Profile selection (Jarvis / Marvin)
 * - Recording state management
 * - Audio capture/playback coordination
 * - Uses shared WebSocket from useWebSocket hook
 * - Master/Replica awareness for multi-client support
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioController } from '../lib/audio';
import { useConnectionState, useVoiceState, useServiceState } from '../stores';
import { useWebSocket } from './useWebSocket';

export type ProfileId = 'jarvis' | 'marvin';

export type AudioMode = 'web' | 'local';

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
  /** Whether this client is the master (handles audio I/O) */
  isMaster: boolean;
  /** Request to become the master client */
  requestMaster: () => void;
  /** Whether the backend service is active (soft power) */
  serviceActive: boolean;
  /** Current audio mode (web/local) */
  audioMode: AudioMode;
  /** Toggle service on/off */
  toggleService: () => void;
  /** Set audio mode */
  setAudioMode: (mode: AudioMode) => void;
}

export function useAudioSession(): AudioSessionState {
  const [activeProfile, setActiveProfile] = useState<ProfileId>('jarvis');
  const [isRecording, setIsRecording] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioControllerRef = useRef<AudioController | null>(null);
  const prevStateRef = useRef<string | null>(null);
  // Track state in ref for use in audio callback (avoids stale closure)
  const stateRef = useRef<string>('idle');

  const { voiceState } = useVoiceState();
  const { connected, isMaster } = useConnectionState();
  const { serviceActive, audioMode } = useServiceState();

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = voiceState;
  }, [voiceState]);

  // Use shared WebSocket connection
  const { send, sendBinary, requestMaster } = useWebSocket();

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
        try {
          audioControllerRef.current.playAudio(event.detail);
        } catch (err) {
          console.error('[AudioSession] Error playing audio:', err);
        }
      }
    };

    window.addEventListener('ws-audio', handleAudio as EventListener);

    return () => {
      window.removeEventListener('ws-audio', handleAudio as EventListener);
    };
  }, []);

  // Listen for audio control messages (interrupt from server when user speaks over agent)
  useEffect(() => {
    const handleAudioControl = (event: CustomEvent<string>) => {
      const action = event.detail;
      if (action === 'interrupt') {
        if (audioControllerRef.current) {
          audioControllerRef.current.interrupt();
        }
      }
    };

    window.addEventListener('ws-audio-control', handleAudioControl as EventListener);

    return () => {
      window.removeEventListener('ws-audio-control', handleAudioControl as EventListener);
    };
  }, []);

  // Stop recording if WebSocket disconnects
  useEffect(() => {
    if (!connected && isRecording) {
      console.log('[AudioSession] WebSocket disconnected, stopping recording');
      if (audioControllerRef.current) {
        audioControllerRef.current.stop();
      }
      setIsRecording(false);
      setError('Connection lost');
    }
  }, [connected, isRecording]);

  // Toggle service on/off (soft power)
  const toggleService = useCallback(() => {
    if (serviceActive) {
      console.log('[AudioSession] Stopping service');
      send('client_command', { command: 'stop_service' });
    } else {
      console.log('[AudioSession] Starting service');
      send('client_command', { command: 'start_service' });
    }
  }, [serviceActive, send]);

  // Set audio mode (web/local)
  const setAudioModeCmd = useCallback((mode: AudioMode) => {
    console.log('[AudioSession] Setting audio mode:', mode);
    send('client_command', { command: 'set_audio_mode', mode });
  }, [send]);

  // Toggle session on/off
  const toggleSession = useCallback(async () => {
    console.log('[AudioSession] toggleSession called, isRecording:', isRecording, 'isMaster:', isMaster, 'serviceActive:', serviceActive);

    // Check if service is active
    if (!serviceActive && !isRecording) {
      console.log('[AudioSession] Service is not active, cannot start recording');
      setError('Service is not active');
      return;
    }

    if (isRecording) {
      // Stop recording
      console.log('[AudioSession] Stopping recording');
      if (audioControllerRef.current) {
        audioControllerRef.current.stop();
      }
      send('client_command', { command: 'stop_session' });
      setIsRecording(false);
      setError(null);
    } else {
      // Start recording
      console.log('[AudioSession] Starting recording with profile:', activeProfile);
      setIsInitializing(true);
      setError(null);

      try {
        // Send start command FIRST so backend is ready for audio
        console.log('[AudioSession] Sending start_session command');
        send('client_command', { command: 'start_session', profile: activeProfile });

        if (audioControllerRef.current) {
          // Set up audio callback to send via shared WebSocket
          let audioChunkCount = 0;
          let skippedChunkCount = 0;
          audioControllerRef.current.setOnAudio((data) => {
            // Don't send audio while agent is speaking/thinking (prevents echo feedback)
            const currentState = stateRef.current;
            if (currentState === 'speaking' || currentState === 'thinking') {
              skippedChunkCount++;
              if (skippedChunkCount === 1 || skippedChunkCount % 50 === 0) {
                console.log(`[AudioSession] Skipping audio (state: ${currentState}), skipped: ${skippedChunkCount}`);
              }
              return;
            }

            // Reset skip count when we start sending again
            if (skippedChunkCount > 0) {
              console.log(`[AudioSession] Resuming audio send after skipping ${skippedChunkCount} chunks`);
              skippedChunkCount = 0;
            }

            audioChunkCount++;
            if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
              console.log(`[AudioSession] Sending audio chunk #${audioChunkCount}, size: ${data.byteLength}`);
            }
            sendBinary(data);
          });
          await audioControllerRef.current.start();
          console.log('[AudioSession] Audio capture started');
        }

        setIsRecording(true);
      } catch (err) {
        console.error('[AudioSession] Failed to start:', err);
        setError((err as Error).message || 'Failed to start audio');
        setIsRecording(false);
      } finally {
        setIsInitializing(false);
      }
    }
  }, [isRecording, activeProfile, send, sendBinary, isMaster, serviceActive]);

  // Stop session immediately
  const stopSession = useCallback(() => {
    if (audioControllerRef.current) {
      audioControllerRef.current.stop();
    }
    send('client_command', { command: 'stop_session' });
    setIsRecording(false);
  }, [send]);

  // Auto-stop recording when agent state TRANSITIONS to idle (not on initial idle)
  useEffect(() => {
    const prevState = prevStateRef.current;
    prevStateRef.current = voiceState;

    // Only stop if we transitioned FROM a non-idle state TO idle
    // This prevents stopping immediately when starting (state is already idle)
    if (
      voiceState === 'idle' &&
      prevState !== null &&
      prevState !== 'idle' &&
      isRecording &&
      connected
    ) {
      console.log(`[AudioSession] State transitioned ${prevState} → idle, stopping`);
      if (audioControllerRef.current) {
        audioControllerRef.current.stop();
      }
      setIsRecording(false);
    }
  }, [voiceState, isRecording, connected]);

  return {
    activeProfile,
    setActiveProfile,
    isRecording,
    toggleSession,
    stopSession,
    isInitializing,
    error,
    isMaster,
    requestMaster,
    serviceActive,
    audioMode,
    toggleService,
    setAudioMode: setAudioModeCmd,
  };
}
