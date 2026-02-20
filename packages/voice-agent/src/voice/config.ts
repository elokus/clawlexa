import { config } from '../config.js';
import type { AgentProfile } from '../agent/profiles.js';
import {
  ensureDefaultConfigFiles,
  loadAuthProfiles,
  loadVoiceConfig,
  resolveApiKey,
} from './settings.js';
import type { VoiceRuntimeConfig } from './types.js';

function normalizeProvider(
  value: string | undefined
): VoiceRuntimeConfig['provider'] {
  if (value === 'gemini-live') return 'gemini-live';
  if (value === 'ultravox-realtime') return 'ultravox-realtime';
  if (value === 'pipecat-rtvi') return 'pipecat-rtvi';
  if (value === 'decomposed') return 'decomposed';
  return 'openai-realtime';
}

function normalizeMode(value: string | undefined): VoiceRuntimeConfig['mode'] {
  if (value === 'decomposed') return 'decomposed';
  return 'voice-to-voice';
}

function safeLoadConfig() {
  ensureDefaultConfigFiles();
  return {
    voice: loadVoiceConfig(),
    auth: loadAuthProfiles(),
  };
}

export function resolveVoiceRuntimeConfig(profile: AgentProfile): VoiceRuntimeConfig {
  const { voice: voiceDoc, auth: authDoc } = safeLoadConfig();

  const profileKey = profile.name.toLowerCase();
  const override = voiceDoc.voice.profileOverrides[profileKey] ?? {};

  // Env var overrides for quick experiments still win over JSON.
  const mode = process.env.VOICE_MODE
    ? normalizeMode(process.env.VOICE_MODE)
    : override.mode ?? voiceDoc.voice.mode;

  const configuredProvider = override.provider ?? voiceDoc.voice.voiceToVoice.provider;
  const provider = process.env.VOICE_PROVIDER
    ? normalizeProvider(process.env.VOICE_PROVIDER)
    : mode === 'decomposed'
      ? 'decomposed'
      : configuredProvider;

  let voice: string;
  if (mode === 'decomposed') {
    voice = override.voice ?? voiceDoc.voice.decomposed.tts.voice ?? profile.voice;
  } else if (provider === 'ultravox-realtime') {
    voice = override.voice ?? voiceDoc.voice.voiceToVoice.voice;
  } else if (provider === 'gemini-live') {
    voice = override.voice ?? voiceDoc.voice.voiceToVoice.geminiVoice;
  } else if (provider === 'pipecat-rtvi') {
    voice = override.voice ?? voiceDoc.voice.voiceToVoice.voice ?? profile.voice;
  } else {
    voice = override.voice ?? voiceDoc.voice.voiceToVoice.voice ?? profile.voice;
  }
  const voiceToVoiceAuthProfile = voiceDoc.voice.voiceToVoice.authProfile;
  const decomposedLlmAuthProfile = voiceDoc.voice.decomposed.llm.authProfile;
  const decomposedSttAuthProfile = voiceDoc.voice.decomposed.stt.authProfile;
  const decomposedTtsAuthProfile = voiceDoc.voice.decomposed.tts.authProfile;

  return {
    mode,
    provider,
    language: voiceDoc.voice.language,
    voice,

    // Voice-to-voice
    model: voiceDoc.voice.voiceToVoice.model || config.agent.model,
    geminiModel: voiceDoc.voice.voiceToVoice.geminiModel,
    geminiVoice: voiceDoc.voice.voiceToVoice.geminiVoice,
    ultravoxModel: voiceDoc.voice.voiceToVoice.ultravoxModel,
    pipecatServerUrl: voiceDoc.voice.voiceToVoice.pipecatServerUrl,
    pipecatTransport: voiceDoc.voice.voiceToVoice.pipecatTransport,
    pipecatBotId: voiceDoc.voice.voiceToVoice.pipecatBotId,

    // Decomposed
    decomposedSttProvider: voiceDoc.voice.decomposed.stt.provider,
    decomposedSttModel: voiceDoc.voice.decomposed.stt.model,
    decomposedLlmProvider: voiceDoc.voice.decomposed.llm.provider,
    decomposedLlmModel: voiceDoc.voice.decomposed.llm.model,
    decomposedTtsProvider: voiceDoc.voice.decomposed.tts.provider,
    decomposedTtsModel: voiceDoc.voice.decomposed.tts.model,
    decomposedTtsVoice: voiceDoc.voice.decomposed.tts.voice,

    auth: {
      openaiApiKey: resolveApiKey('openai', {
        authProfileId:
          mode === 'decomposed'
            ? decomposedLlmAuthProfile
            : provider === 'openai-realtime'
              ? voiceToVoiceAuthProfile
              : undefined,
        authProfiles: authDoc,
      }),
      openrouterApiKey: resolveApiKey('openrouter', {
        authProfileId: decomposedLlmAuthProfile,
        authProfiles: authDoc,
      }),
      googleApiKey: resolveApiKey('google', {
        authProfileId: provider === 'gemini-live' ? voiceToVoiceAuthProfile : undefined,
        authProfiles: authDoc,
      }),
      deepgramApiKey: resolveApiKey('deepgram', {
        authProfileId: decomposedSttAuthProfile ?? decomposedTtsAuthProfile,
        authProfiles: authDoc,
      }),
      ultravoxApiKey: resolveApiKey('ultravox', {
        authProfileId: provider === 'ultravox-realtime' ? voiceToVoiceAuthProfile : undefined,
        authProfiles: authDoc,
      }),
    },

    turn: {
      strategy: voiceDoc.voice.turn.strategy,
      silenceMs: voiceDoc.voice.turn.silenceMs,
      minSpeechMs: voiceDoc.voice.turn.minSpeechMs,
      minRms: voiceDoc.voice.turn.minRms,
      llmCompletionEnabled: voiceDoc.voice.turn.llmCompletion.enabled,
      llmShortTimeoutMs: voiceDoc.voice.turn.llmCompletion.shortTimeoutMs,
      llmLongTimeoutMs: voiceDoc.voice.turn.llmCompletion.longTimeoutMs,
      llmShortReprompt: voiceDoc.voice.turn.llmCompletion.shortReprompt,
      llmLongReprompt: voiceDoc.voice.turn.llmCompletion.longReprompt,
    },
  };
}
