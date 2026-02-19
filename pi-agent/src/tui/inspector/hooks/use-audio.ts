/**
 * Hook for audio transport lifecycle in the inspector.
 *
 * Primary path: attach LocalTransport directly to VoiceRuntime
 * (`runtime.attachAudioTransport`) so playback/interruption flow is managed
 * by the unified runtime layer.
 */

import { useRef, useCallback, useEffect } from 'react';
import { LocalTransport } from '../../../transport/local.js';
import type { VoiceRuntime } from '../../../voice/types.js';
import type { EventMux } from '../util/event-mux.js';
import { useInspector } from '../state.js';

export interface AudioHandle {
  start: (runtime: VoiceRuntime, mux: EventMux) => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
  cycleInputDevice: () => void;
  cycleOutputDevice: () => void;
}

export function useAudio(): AudioHandle {
  const { state, dispatch } = useInspector();
  const transportRef = useRef<LocalTransport | null>(null);
  const runtimeRef = useRef<VoiceRuntime | null>(null);
  const mutedRef = useRef(false);
  const runtimeManagedTransportRef = useRef(false);
  const inputDevicesRef = useRef<string[]>(['default']);
  const outputDevicesRef = useRef<string[]>(['default']);
  const selectedInputDeviceRef = useRef('default');
  const selectedOutputDeviceRef = useRef('default');
  const defaultInputDeviceRef = useRef('default');
  const defaultOutputDeviceRef = useRef('default');

  function resolveSelectedDevice(preferred: string, available: string[], fallback: string): string {
    if (available.includes(preferred)) return preferred;
    if (available.includes(fallback)) return fallback;
    return available[0] ?? 'default';
  }

  const refreshAudioDevices = useCallback(() => {
    const devices = LocalTransport.listAudioDevices();
    inputDevicesRef.current = devices.inputDevices.length > 0 ? devices.inputDevices : ['default'];
    outputDevicesRef.current = devices.outputDevices.length > 0 ? devices.outputDevices : ['default'];
    defaultInputDeviceRef.current = devices.defaultInputDevice || 'default';
    defaultOutputDeviceRef.current = devices.defaultOutputDevice || 'default';

    const selectedInput = resolveSelectedDevice(
      state.audioDevices.inputDevice,
      inputDevicesRef.current,
      devices.defaultInputDevice
    );
    const selectedOutput = resolveSelectedDevice(
      state.audioDevices.outputDevice,
      outputDevicesRef.current,
      devices.defaultOutputDevice
    );

    selectedInputDeviceRef.current = selectedInput;
    selectedOutputDeviceRef.current = selectedOutput;

    dispatch({
      type: 'AUDIO_DEVICES_LOADED',
      inputDevices: inputDevicesRef.current,
      outputDevices: outputDevicesRef.current,
      inputDevice: selectedInput,
      outputDevice: selectedOutput,
    });
  }, [dispatch, state.audioDevices.inputDevice, state.audioDevices.outputDevice]);

  function toTransportDevice(selected: string, defaultDevice: string): string {
    if (!selected || selected === 'default') return 'default';
    if (selected === defaultDevice) return 'default';
    return selected;
  }

  useEffect(() => {
    mutedRef.current = state.muted;
    transportRef.current?.setCaptureEnabled(!state.muted);
  }, [state.muted]);

  const start = useCallback(async (runtime: VoiceRuntime, mux: EventMux) => {
    // Clean up previous transport/runtime attachment.
    const previousRuntime = runtimeRef.current;
    if (runtimeManagedTransportRef.current && previousRuntime?.detachAudioTransport) {
      await previousRuntime.detachAudioTransport().catch(() => {});
    }
    if (transportRef.current) {
      transportRef.current.stop();
      transportRef.current = null;
    }

    refreshAudioDevices();
    const transport = new LocalTransport({
      inputDevice: toTransportDevice(
        selectedInputDeviceRef.current,
        defaultInputDeviceRef.current
      ),
      outputDevice: toTransportDevice(
        selectedOutputDeviceRef.current,
        defaultOutputDeviceRef.current
      ),
    });
    transportRef.current = transport;
    runtimeRef.current = runtime;
    runtimeManagedTransportRef.current =
      typeof runtime.attachAudioTransport === 'function' &&
      typeof runtime.detachAudioTransport === 'function';

    transport.setCaptureEnabled(!mutedRef.current);
    transport.on('error', (error: Error) => {
      dispatch({ type: 'ERROR', message: `Audio transport: ${error.message}` });
    });

    const startFallbackTransport = () => {
      runtimeManagedTransportRef.current = false;
      transport.on('audio', (chunk: ArrayBuffer) => {
        if (!mutedRef.current) {
          runtime.sendAudio(chunk);
        }
      });
      transport.start();
    };

    if (runtimeManagedTransportRef.current) {
      try {
        await runtime.attachAudioTransport!(transport);
      } catch (error) {
        dispatch({
          type: 'ERROR',
          message: `Attach audio transport failed: ${(error as Error).message}`,
        });
        startFallbackTransport();
      }
    } else {
      // Back-compat fallback for runtimes without attachAudioTransport.
      startFallbackTransport();
    }

    // Runtime audio events are still observed for metrics/diagnostics.
    let audioChunkCount = 0;
    mux.on('audio', (audio) => {
      audioChunkCount++;
      if (audioChunkCount <= 3) {
        console.error(
          `[TUI Audio] chunk #${audioChunkCount}: ${audio.data.byteLength}B rate=${audio.sampleRate ?? 'undefined'}`
        );
      }

      if (!runtimeManagedTransportRef.current) {
        transport.play(audio.data, audio.sampleRate);
      }

      dispatch({ type: 'AUDIO_CHUNK', timestamp: Date.now() });
    });

    mux.on('audioInterrupted', () => {
      dispatch({ type: 'AUDIO_INTERRUPTED' });
      // Runtime-managed mode already interrupts playback in VoiceSession.
      if (!runtimeManagedTransportRef.current && transport.isPlayingAudio()) {
        transport.interrupt();
      }
    });
  }, [dispatch, refreshAudioDevices]);

  const stop = useCallback(() => {
    if (runtimeManagedTransportRef.current && runtimeRef.current?.detachAudioTransport) {
      void runtimeRef.current.detachAudioTransport().catch(() => {});
    }
    if (transportRef.current) {
      transportRef.current.stop();
      transportRef.current = null;
    }
    runtimeManagedTransportRef.current = false;
    runtimeRef.current = null;
  }, []);

  const toggleMute = useCallback(() => {
    dispatch({ type: 'TOGGLE_MUTE' });
  }, [dispatch]);

  const cycleInputDevice = useCallback(() => {
    const devices = inputDevicesRef.current;
    if (devices.length === 0) return;
    const current = selectedInputDeviceRef.current;
    const currentIndex = Math.max(0, devices.indexOf(current));
    const next = devices[(currentIndex + 1) % devices.length] ?? devices[0]!;
    selectedInputDeviceRef.current = next;
    transportRef.current?.setInputDevice(toTransportDevice(next, defaultInputDeviceRef.current));
    dispatch({ type: 'AUDIO_INPUT_DEVICE_SET', device: next });
  }, [dispatch]);

  const cycleOutputDevice = useCallback(() => {
    const devices = outputDevicesRef.current;
    if (devices.length === 0) return;
    const current = selectedOutputDeviceRef.current;
    const currentIndex = Math.max(0, devices.indexOf(current));
    const next = devices[(currentIndex + 1) % devices.length] ?? devices[0]!;
    selectedOutputDeviceRef.current = next;
    transportRef.current?.setOutputDevice(toTransportDevice(next, defaultOutputDeviceRef.current));
    dispatch({ type: 'AUDIO_OUTPUT_DEVICE_SET', device: next });
  }, [dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return stop;
  }, [stop]);

  return { start, stop, toggleMute, cycleInputDevice, cycleOutputDevice };
}
