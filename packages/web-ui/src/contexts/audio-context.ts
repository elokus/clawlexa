import { createContext, useContext } from 'react';
import type { AudioController } from '../lib/audio';

/**
 * React context for the AudioController ref.
 * Allows any component to query real-time playback position
 * via audioController.getPlaybackPositionMs() without prop drilling.
 */
export const AudioControllerContext = createContext<React.RefObject<AudioController | null>>(
  { current: null }
);

export function useAudioControllerRef(): React.RefObject<AudioController | null> {
  return useContext(AudioControllerContext);
}
