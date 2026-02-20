/**
 * Provider contract check for onboarding new voice/STT/TTS/LLM providers.
 *
 * Usage:
 * - bun run src/scratch-provider-contract.ts deepgram
 * - bun run src/scratch-provider-contract.ts ultravox
 * - bun run src/scratch-provider-contract.ts openai
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import {
  loadAuthProfiles,
  loadVoiceConfig,
  resolveApiKey,
  type AuthProvider,
} from './voice/settings.js';

loadEnv({ path: resolve(process.cwd(), '../.env') });

interface ProviderContract {
  provider: AuthProvider;
  endpoint: string;
  method: 'GET' | 'POST';
  auth: 'bearer' | 'token' | 'x-api-key' | 'query-key';
  body?: unknown;
  notes: string;
}

const CONTRACTS: Record<AuthProvider, ProviderContract> = {
  openai: {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/models',
    method: 'GET',
    auth: 'bearer',
    notes: 'LLM + TTS + STT provider; used in openai-realtime and decomposed LLM/TTS/STT.',
  },
  openrouter: {
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/models',
    method: 'GET',
    auth: 'bearer',
    notes: 'LLM aggregator provider; used for decomposed LLM fallback.',
  },
  google: {
    provider: 'google',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    method: 'GET',
    auth: 'query-key',
    notes: 'Gemini Live + text model provider.',
  },
  deepgram: {
    provider: 'deepgram',
    endpoint: 'https://api.deepgram.com/v1/projects',
    method: 'GET',
    auth: 'token',
    notes: 'Decomposed STT/TTS provider. STT endpoint: /v1/listen, TTS endpoint: /v1/speak.',
  },
  ultravox: {
    provider: 'ultravox',
    endpoint: 'https://api.ultravox.ai/api/models',
    method: 'GET',
    auth: 'x-api-key',
    notes: 'Voice-to-voice provider. Call creation endpoint: /api/calls.',
  },
};

async function runContractCheck(provider: AuthProvider): Promise<void> {
  const contract = CONTRACTS[provider];
  const voiceConfig = loadVoiceConfig();
  const authProfiles = loadAuthProfiles();
  const key = resolveApiKey(provider, { authProfiles });

  console.log(`\n[contract] provider=${provider}`);
  console.log(`[contract] endpoint=${contract.endpoint}`);
  console.log(`[contract] notes=${contract.notes}`);

  if (!key) {
    throw new Error(
      `No API key resolved for ${provider}. Set env var or defaults.${provider} in auth-profiles.json`
    );
  }

  const headers: Record<string, string> = {};
  let endpoint = contract.endpoint;

  switch (contract.auth) {
    case 'bearer':
      headers.Authorization = `Bearer ${key}`;
      break;
    case 'token':
      headers.Authorization = `Token ${key}`;
      break;
    case 'x-api-key':
      headers['X-API-Key'] = key;
      break;
    case 'query-key': {
      const url = new URL(endpoint);
      url.searchParams.set('key', key);
      endpoint = url.toString();
      break;
    }
  }

  const response = await fetch(endpoint, {
    method: contract.method,
    headers,
    ...(contract.body ? { body: JSON.stringify(contract.body) } : {}),
  });

  if (!response.ok) {
    throw new Error(`Contract request failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.text();
  console.log(`[contract] success status=${response.status} bodySize=${body.length}`);

  console.log('[contract] current configured runtime:');
  console.log(`- mode=${voiceConfig.voice.mode}`);
  console.log(`- voice-to-voice provider=${voiceConfig.voice.voiceToVoice.provider}`);
  console.log(`- decomposed stt=${voiceConfig.voice.decomposed.stt.provider}/${voiceConfig.voice.decomposed.stt.model}`);
  console.log(`- decomposed llm=${voiceConfig.voice.decomposed.llm.provider}/${voiceConfig.voice.decomposed.llm.model}`);
  console.log(`- decomposed tts=${voiceConfig.voice.decomposed.tts.provider}/${voiceConfig.voice.decomposed.tts.model}`);
}

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? '').trim();
  if (!arg) {
    console.log('Usage: bun run src/scratch-provider-contract.ts <openai|openrouter|google|deepgram|ultravox>');
    process.exit(1);
  }

  if (!(arg in CONTRACTS)) {
    throw new Error(`Unsupported provider: ${arg}`);
  }

  await runContractCheck(arg as AuthProvider);
  console.log('\n[contract] done');
}

main().catch((error) => {
  console.error('[contract] failed:', error);
  process.exit(1);
});
