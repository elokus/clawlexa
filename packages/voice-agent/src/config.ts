import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env from repo root (two levels up from packages/voice-agent)
loadEnv({ path: resolve(process.cwd(), '../../.env') });

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
  agent: {
    defaultVoice: 'ash' as const,
    model: 'gpt-realtime-mini-2025-10-06',
    conversationTimeout: 60_000, // 60 seconds
  },
  porcupine: {
    accessKey: process.env.PICOVOICE_ACCESS_KEY ?? '',
  },
  govee: {
    apiKey: process.env.GOVEE_API_KEY ?? '',
  },
  voice: {
    mode: process.env.VOICE_MODE ?? 'voice-to-voice',
    provider: process.env.VOICE_PROVIDER ?? 'openai-realtime',
    language: process.env.VOICE_LANGUAGE ?? 'de',
    gemini: {
      model: process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-preview',
      voice: process.env.GEMINI_VOICE ?? 'Puck',
    },
    decomposed: {
      sttModel: process.env.DECOMPOSED_STT_MODEL ?? 'gpt-4o-mini-transcribe',
      llmModel: process.env.DECOMPOSED_LLM_MODEL ?? 'openai/gpt-4o-mini',
      ttsModel: process.env.DECOMPOSED_TTS_MODEL ?? 'gpt-4o-mini-tts',
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
