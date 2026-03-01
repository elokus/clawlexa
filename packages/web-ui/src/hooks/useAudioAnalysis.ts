/**
 * Audio Analysis Hook — reads real-time frequency data from AudioController's
 * AnalyserNodes and exposes smoothed band data via refs (no re-renders).
 *
 * Used by the ferrofluid visualization to drive shader uniforms.
 */

import { useRef, useEffect } from 'react';
import { useAudioControllerRef } from '../contexts/audio-context';

export interface AudioBands {
  bass: number;    // 0-1, bins 0-3
  lowMid: number;  // 0-1, bins 4-8
  mid: number;     // 0-1, bins 9-20
  treble: number;  // 0-1, bins 21+
  volume: number;  // 0-1, overall average
}

const EMPTY_BANDS: AudioBands = { bass: 0, lowMid: 0, mid: 0, treble: 0, volume: 0 };
const SMOOTHING = 0.15;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothBands(prev: AudioBands, raw: AudioBands, t: number): AudioBands {
  return {
    bass: lerp(prev.bass, raw.bass, t),
    lowMid: lerp(prev.lowMid, raw.lowMid, t),
    mid: lerp(prev.mid, raw.mid, t),
    treble: lerp(prev.treble, raw.treble, t),
    volume: lerp(prev.volume, raw.volume, t),
  };
}

function analyzeBands(analyser: AnalyserNode, dataArray: Uint8Array<ArrayBuffer>): AudioBands {
  analyser.getByteFrequencyData(dataArray);
  const len = dataArray.length;

  let bass = 0, lowMid = 0, mid = 0, treble = 0, total = 0;
  let bassN = 0, lowMidN = 0, midN = 0, trebleN = 0;

  for (let i = 0; i < len; i++) {
    const val = dataArray[i]! / 255;
    total += val;
    if (i <= 3)       { bass += val; bassN++; }
    else if (i <= 8)  { lowMid += val; lowMidN++; }
    else if (i <= 20) { mid += val; midN++; }
    else              { treble += val; trebleN++; }
  }

  return {
    bass: bassN > 0 ? bass / bassN : 0,
    lowMid: lowMidN > 0 ? lowMid / lowMidN : 0,
    mid: midN > 0 ? mid / midN : 0,
    treble: trebleN > 0 ? treble / trebleN : 0,
    volume: len > 0 ? total / len : 0,
  };
}

export function useAudioAnalysis(): {
  micBands: React.RefObject<AudioBands>;
  speakerBands: React.RefObject<AudioBands>;
} {
  const audioControllerRef = useAudioControllerRef();

  const micBands = useRef<AudioBands>({ ...EMPTY_BANDS });
  const speakerBands = useRef<AudioBands>({ ...EMPTY_BANDS });

  // Persistent typed arrays to avoid allocation per frame
  const micDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const speakerDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const ctrl = audioControllerRef.current;

      // Mic analysis
      const micAnalyser = ctrl?.getMicAnalyser();
      if (micAnalyser) {
        if (!micDataRef.current || micDataRef.current.length !== micAnalyser.frequencyBinCount) {
          micDataRef.current = new Uint8Array(micAnalyser.frequencyBinCount);
        }
        const raw = analyzeBands(micAnalyser, micDataRef.current);
        micBands.current = smoothBands(micBands.current, raw, SMOOTHING);
      } else {
        micBands.current = smoothBands(micBands.current, EMPTY_BANDS, SMOOTHING);
      }

      // Speaker analysis
      const speakerAnalyser = ctrl?.getSpeakerAnalyser();
      if (speakerAnalyser) {
        if (!speakerDataRef.current || speakerDataRef.current.length !== speakerAnalyser.frequencyBinCount) {
          speakerDataRef.current = new Uint8Array(speakerAnalyser.frequencyBinCount);
        }
        const raw = analyzeBands(speakerAnalyser, speakerDataRef.current);
        speakerBands.current = smoothBands(speakerBands.current, raw, SMOOTHING);
      } else {
        speakerBands.current = smoothBands(speakerBands.current, EMPTY_BANDS, SMOOTHING);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [audioControllerRef]);

  return { micBands, speakerBands };
}
