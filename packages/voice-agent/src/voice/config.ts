import { config } from '../config.js';
import type { AgentProfile } from '../agent/profiles.js';
import { resolveRuntimeConfigFromDocuments } from '@voiceclaw/voice-runtime';
import {
  ensureDefaultConfigFiles,
  loadAuthProfiles,
  loadVoiceConfig,
} from './settings.js';
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
  return resolveRuntimeConfigFromDocuments({
    profileName: profile.name,
    profileVoice: profile.voice,
    fallbackModel: config.agent.model,
    voiceConfig: voiceDoc,
    authProfiles: authDoc,
    env: process.env,
  });
}
