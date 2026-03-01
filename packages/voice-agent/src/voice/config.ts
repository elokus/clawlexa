import { config } from '../config.js';
import type { AgentProfile } from '../agent/profiles.js';
import { resolveRuntimeConfigFromDocuments } from '@voiceclaw/voice-runtime';
import {
  ensureDefaultConfigFiles,
  loadAuthProfiles,
  loadVoiceConfig,
} from './settings.js';
import { getVoice } from './voices.js';
import type { VoiceRuntimeConfig } from './types.js';

function safeLoadConfig() {
  ensureDefaultConfigFiles();
  return {
    voice: loadVoiceConfig(),
    auth: loadAuthProfiles(),
  };
}

export function resolveVoiceRuntimeConfig(profile: AgentProfile): VoiceRuntimeConfig {
  const { voice: voiceDoc, auth: authDoc } = safeLoadConfig();
  const resolved = resolveRuntimeConfigFromDocuments({
    profileName: profile.name,
    profileVoice: profile.voice,
    fallbackModel: config.agent.model,
    voiceConfig: voiceDoc,
    authProfiles: authDoc,
    env: process.env,
  });

  // Resolve voice clone reference label → actual file paths
  if (resolved.decomposedTtsVoiceRef) {
    const entry = getVoice(resolved.decomposedTtsVoiceRef);
    if (entry) {
      resolved.providerSettings = {
        ...resolved.providerSettings,
        voiceRefAudio: entry.refAudioPath,
        voiceRefText: entry.meta.refText,
      };
    }
  }

  return resolved;
}
