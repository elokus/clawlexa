import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { createDefaultRuntimeVoiceConfig } from '@voiceclaw/voice-runtime';

// Load .env from repo root (two levels up from packages/voice-agent)
loadEnv({ path: resolve(process.cwd(), '../../.env') });

const runtimeVoiceDefaults = createDefaultRuntimeVoiceConfig(process.env).voice;

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
  },
  openrouter: {
    apiKey: process.env.OPEN_ROUTER_API_KEY ?? '',
  },
  google: {
    apiKey: process.env.GOOGLE_API_KEY ?? '',
  },
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY ?? '',
  },
  ultravox: {
    apiKey: process.env.ULTRAVOX_API_KEY ?? '',
  },
  audio: {
    sampleRate: 24000,
    channels: 1,
    format: 'pcm16' as const,
  },
  localAudio: {
    inputDevice: process.env.LOCAL_AUDIO_INPUT_DEVICE ?? 'default',
    outputDevice: process.env.LOCAL_AUDIO_OUTPUT_DEVICE ?? 'default',
    preferEchoCancelSource: parseBooleanEnv(
      process.env.LOCAL_PREFER_ECHO_CANCEL_SOURCE,
      true
    ),
  },
  agent: {
    defaultVoice: 'ash' as const,
    model: process.env.AGENT_MODEL ?? runtimeVoiceDefaults.voiceToVoice.model,
    conversationTimeout: 60_000, // 60 seconds
  },
  porcupine: {
    accessKey: process.env.PICOVOICE_ACCESS_KEY ?? '',
  },
  govee: {
    apiKey: process.env.GOVEE_API_KEY ?? '',
  },
  voice: {
    mode: process.env.VOICE_MODE ?? runtimeVoiceDefaults.mode,
    provider: process.env.VOICE_PROVIDER ?? runtimeVoiceDefaults.voiceToVoice.provider,
    language: process.env.VOICE_LANGUAGE ?? 'de',
    gemini: {
      model: process.env.GEMINI_LIVE_MODEL ?? runtimeVoiceDefaults.voiceToVoice.geminiModel,
      voice: process.env.GEMINI_VOICE ?? runtimeVoiceDefaults.voiceToVoice.geminiVoice,
    },
    decomposed: {
      sttModel: process.env.DECOMPOSED_STT_MODEL ?? runtimeVoiceDefaults.decomposed.stt.model,
      llmModel: process.env.DECOMPOSED_LLM_MODEL ?? runtimeVoiceDefaults.decomposed.llm.model,
      ttsModel: process.env.DECOMPOSED_TTS_MODEL ?? runtimeVoiceDefaults.decomposed.tts.model,
    },
    turn: {
      silenceMs: parseInt(process.env.VOICE_TURN_SILENCE_MS ?? '700', 10),
      minSpeechMs: parseInt(process.env.VOICE_TURN_MIN_SPEECH_MS ?? '350', 10),
      minRms: parseFloat(process.env.VOICE_TURN_MIN_RMS ?? '0.015'),
    },
  },
} as const;

export function validateConfig(): void {
  const transportMode = process.env.TRANSPORT_MODE ?? 'web';
  if (transportMode !== 'web' && !config.porcupine.accessKey) {
    throw new Error('PICOVOICE_ACCESS_KEY environment variable is required');
  }
}
