/**
 * Unified stream protocol types.
 *
 * The canonical contract is defined in @voiceclaw/voice-runtime so
 * voice-agent and web-ui consume one shared event schema.
 */

export type {
  AISDKFinishStepUsage,
  AISDKStreamEvent,
  SpokenWordCue,
  SpokenWordCueUpdate,
  SpokenPrecision,
  StreamChunkMessage,
  StreamSessionMeta,
  StreamSessionStatus,
} from '@voiceclaw/voice-runtime';

export { createStreamChunk } from '@voiceclaw/voice-runtime';
