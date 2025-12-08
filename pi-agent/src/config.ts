import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env from parent directory (shared with Python agent)
loadEnv({ path: resolve(process.cwd(), '../.env') });

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
  },
  audio: {
    sampleRate: 24000,
    channels: 1,
    format: 'pcm16' as const,
  },
  agent: {
    defaultVoice: 'ash' as const,
    model: 'gpt-4o-mini-realtime-preview',
    conversationTimeout: 60_000, // 60 seconds
  },
  porcupine: {
    accessKey: process.env.PICOVOICE_ACCESS_KEY ?? '',
  },
  govee: {
    apiKey: process.env.GOVEE_API_KEY ?? '',
  },
} as const;

export function validateConfig(): void {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  if (!config.porcupine.accessKey) {
    throw new Error('PICOVOICE_ACCESS_KEY environment variable is required');
  }
}
