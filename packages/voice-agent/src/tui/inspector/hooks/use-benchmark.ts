/**
 * Hook for VoiceSessionBenchmark wiring.
 *
 * Always enabled in the inspector (bypasses VOICE_BENCHMARK_ENABLED env check).
 * Wires runtime events to the benchmark recorder for live metric capture.
 */

import { useRef, useCallback, useEffect } from 'react';
import {
  VoiceSessionBenchmark,
  mergeThresholds,
  parseThresholdOverridesFromEnv,
  resolveOutputDir,
} from '../../../voice/benchmark-recorder.js';
import type { VoiceProviderName } from '../../../voice/types.js';
import type { EventMux } from '../util/event-mux.js';
import { useInspector } from '../state.js';

export interface BenchmarkHandle {
  attach: (mux: EventMux, provider: VoiceProviderName, profile: string, sessionId: string) => void;
  finalize: (reason: 'disconnected' | 'deactivate' | 'connect-failed') => void;
}

export function useBenchmark(): BenchmarkHandle {
  const { dispatch } = useInspector();
  const benchRef = useRef<VoiceSessionBenchmark | null>(null);

  const attach = useCallback((
    mux: EventMux,
    provider: VoiceProviderName,
    profile: string,
    sessionId: string,
  ) => {
    const thresholds = mergeThresholds(provider, parseThresholdOverridesFromEnv());
    const benchmark = new VoiceSessionBenchmark({
      sessionId,
      profile,
      provider,
      enabled: true, // Always enabled in inspector
      outputDir: resolveOutputDir(),
      thresholds,
    });
    benchRef.current = benchmark;

    // Wire runtime events to benchmark via mux (not runtime.on directly!)
    mux.on('stateChange', (state) => {
      benchmark.onStateChange(state);
    });

    mux.on('audio', (audio) => {
      benchmark.onAudio(audio);
    });

    mux.on('transcript', (text, role, itemId) => {
      benchmark.onTranscriptFinal(text, role, itemId);
    });

    mux.on('transcriptDelta', (delta, role, itemId) => {
      benchmark.onTranscriptDelta(delta, role, itemId);
    });

    mux.on('assistantItemCreated', (itemId) => {
      benchmark.onAssistantItemCreated(itemId);
    });

    mux.on('audioInterrupted', () => {
      benchmark.markInterruptionRequested();
    });
  }, []);

  const finalize = useCallback((reason: 'disconnected' | 'deactivate' | 'connect-failed') => {
    if (!benchRef.current) return;

    const result = benchRef.current.finalize(reason);
    benchRef.current = null;

    if (result?.report) {
      dispatch({
        type: 'BENCHMARK_FINALIZED',
        report: result.report,
        outputPath: result.outputPath,
      });
    }
  }, [dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (benchRef.current) {
        benchRef.current.finalize('disconnected');
      }
    };
  }, []);

  return { attach, finalize };
}
