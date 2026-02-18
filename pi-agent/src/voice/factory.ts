import type { AgentProfile } from '../agent/profiles.js';
import type { VoiceAgent } from '../agent/voice-agent.js';
import { resolveVoiceRuntimeConfig } from './config.js';
import { DecomposedRuntime } from './decomposed-runtime.js';
import { GeminiLiveRuntime } from './gemini-live-runtime.js';
import { OpenAIRealtimeRuntime } from './openai-realtime-runtime.js';
import { UltravoxRealtimeRuntime } from './ultravox-realtime-runtime.js';
import type { VoiceRuntime } from './types.js';

export function createVoiceRuntime(
  profile: AgentProfile,
  sessionId: string,
  voiceAgent?: VoiceAgent
): VoiceRuntime {
  const runtimeConfig = resolveVoiceRuntimeConfig(profile);
  console.log(
    `[VoiceRuntime] profile=${profile.name} mode=${runtimeConfig.mode} provider=${runtimeConfig.provider}` +
      ` stt=${runtimeConfig.decomposedSttProvider}/${runtimeConfig.decomposedSttModel}` +
      ` llm=${runtimeConfig.decomposedLlmProvider}/${runtimeConfig.decomposedLlmModel}` +
      ` tts=${runtimeConfig.decomposedTtsProvider}/${runtimeConfig.decomposedTtsModel}`
  );

  if (runtimeConfig.mode === 'decomposed' || runtimeConfig.provider === 'decomposed') {
    return new DecomposedRuntime(profile, runtimeConfig);
  }

  if (runtimeConfig.provider === 'gemini-live') {
    return new GeminiLiveRuntime(profile, runtimeConfig);
  }

  if (runtimeConfig.provider === 'ultravox-realtime') {
    return new UltravoxRealtimeRuntime(profile, runtimeConfig, sessionId, voiceAgent);
  }

  return new OpenAIRealtimeRuntime(profile, sessionId, runtimeConfig, voiceAgent);
}
