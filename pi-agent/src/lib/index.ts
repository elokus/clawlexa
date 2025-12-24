/**
 * Library utilities for the voice agent.
 *
 * Note: Agent streaming is now handled directly in each subagent using
 * AI SDK's streamText with stream_chunk events. See:
 * - src/subagents/cli/index.ts
 * - src/subagents/web-search/index.ts
 * - src/api/stream-types.ts
 */

// Re-export stream types for convenience
export type { AISDKStreamEvent, StreamChunkMessage } from '../api/stream-types.js';
export { createStreamChunk } from '../api/stream-types.js';
