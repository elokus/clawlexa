/**
 * Hook for VoiceRuntime lifecycle and event wiring.
 *
 * Creates a VoiceRuntime via the factory, creates an EventMux for
 * fan-out (PackageBackedVoiceRuntime only supports one handler per event),
 * and dispatches state actions through the mux.
 */

import { useRef, useCallback, useEffect } from 'react';
import { randomUUID } from 'crypto';
import { createVoiceRuntime, type VoiceRuntime } from '../../../voice/index.js';
import { resolveVoiceRuntimeConfig } from '../../../voice/config.js';
import { profiles, loadProfilePrompts, type AgentProfile } from '../../../agent/profiles.js';
import type { VoiceProviderName } from '../../../voice/types.js';
import { useInspector } from '../state.js';
import { createEventMux, type EventMux } from '../util/event-mux.js';
import type { ResolvedConfigDisplay, LatencyStage } from '../types.js';

function getProfile(name: string): AgentProfile {
  const profile = profiles[name.toLowerCase()];
  if (!profile) {
    const available = Object.keys(profiles).join(', ');
    throw new Error(`Unknown profile "${name}". Available: ${available}`);
  }
  return profile;
}

function buildConfigDisplay(profile: AgentProfile, providerOverride?: string): ResolvedConfigDisplay {
  const config = resolveVoiceRuntimeConfig(profile);
  return {
    provider: (providerOverride ?? config.provider) as VoiceProviderName,
    mode: config.mode,
    model: config.model,
    voice: config.voice ?? profile.voice,
    language: config.language,
    sttProvider: config.mode === 'decomposed' ? config.decomposedSttProvider : undefined,
    sttModel: config.mode === 'decomposed' ? config.decomposedSttModel : undefined,
    llmProvider: config.mode === 'decomposed' ? config.decomposedLlmProvider : undefined,
    llmModel: config.mode === 'decomposed' ? config.decomposedLlmModel : undefined,
    ttsProvider: config.mode === 'decomposed' ? config.decomposedTtsProvider : undefined,
    ttsModel: config.mode === 'decomposed' ? config.decomposedTtsModel : undefined,
  };
}

export interface ConnectResult {
  runtime: VoiceRuntime;
  mux: EventMux;
}

export interface RuntimeHandle {
  connect: () => Promise<ConnectResult | null>;
  disconnect: () => void;
  sendMessage: (text: string) => void;
  interrupt: () => void;
}

export function useRuntime(profileName: string, providerOverride?: string): RuntimeHandle {
  const { dispatch } = useInspector();
  const runtimeRef = useRef<VoiceRuntime | null>(null);
  const profileRef = useRef<AgentProfile | null>(null);

  const connect = useCallback(async (): Promise<ConnectResult | null> => {
    // Disconnect previous if any
    if (runtimeRef.current?.isConnected()) {
      runtimeRef.current.disconnect();
    }

    // Load prompts if needed
    await loadProfilePrompts();

    const profile = getProfile(profileName);
    profileRef.current = profile;

    // Apply provider override via env (factory reads it)
    if (providerOverride) {
      process.env.VOICE_PROVIDER = providerOverride;
    }

    const sessionId = randomUUID();
    const configDisplay = buildConfigDisplay(profile, providerOverride);

    dispatch({
      type: 'CONNECT_START',
      provider: configDisplay.provider,
      voiceMode: configDisplay.mode,
      config: configDisplay,
    });

    const runtime = createVoiceRuntime(profile, sessionId);
    runtimeRef.current = runtime;

    // Create event mux — all hooks must use this instead of runtime.on()
    // because PackageBackedVoiceRuntime only supports one handler per event.
    const mux = createEventMux(runtime);

    // Wire state dispatch handlers via mux
    mux.on('connected', () => {
      dispatch({ type: 'CONNECTED' });
    });

    mux.on('disconnected', () => {
      dispatch({ type: 'DISCONNECTED' });
    });

    mux.on('stateChange', (state) => {
      dispatch({ type: 'STATE_CHANGE', state });
    });

    mux.on('transcript', (text, role, itemId, order) => {
      dispatch({ type: 'TRANSCRIPT', role, text, itemId, order });
    });

    mux.on('transcriptDelta', (delta, role, itemId, order) => {
      dispatch({ type: 'TRANSCRIPT_DELTA', role, delta, itemId, order });
    });

    mux.on('userItemCreated', (itemId, order) => {
      dispatch({ type: 'USER_ITEM_CREATED', itemId, order });
    });

    mux.on('assistantItemCreated', (itemId, previousItemId, order) => {
      dispatch({ type: 'ASSISTANT_ITEM_CREATED', itemId, previousItemId, order });
    });

    mux.on('latency', (metric) => {
      dispatch({
        type: 'LATENCY',
        stage: metric.stage as LatencyStage,
        durationMs: metric.durationMs,
      });
    });

    mux.on('toolStart', (name, args, callId) => {
      dispatch({ type: 'TOOL_START', name, args, callId });
    });

    mux.on('toolEnd', (name, result, callId) => {
      dispatch({ type: 'TOOL_END', name, result, callId });
    });

    mux.on('error', (error) => {
      dispatch({ type: 'ERROR', message: error.message });
    });

    // Connect
    try {
      await runtime.connect();
      return { runtime, mux };
    } catch (error) {
      dispatch({ type: 'ERROR', message: `Connection failed: ${(error as Error).message}` });
      dispatch({ type: 'DISCONNECTED' });
      return null;
    }
  }, [profileName, providerOverride, dispatch]);

  const disconnect = useCallback(() => {
    if (runtimeRef.current?.isConnected()) {
      runtimeRef.current.disconnect();
    }
    runtimeRef.current = null;
  }, []);

  const sendMessage = useCallback((text: string) => {
    runtimeRef.current?.sendMessage(text);
  }, []);

  const interrupt = useCallback(() => {
    runtimeRef.current?.interrupt();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (runtimeRef.current?.isConnected()) {
        runtimeRef.current.disconnect();
      }
    };
  }, []);

  return {
    connect,
    disconnect,
    sendMessage,
    interrupt,
  };
}
