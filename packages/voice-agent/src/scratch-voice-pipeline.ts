/**
 * Voice pipeline scratch lab for provider/auth integration.
 *
 * Scenarios:
 * - `bun run src/scratch-voice-pipeline.ts auth`
 * - `bun run src/scratch-voice-pipeline.ts ultravox`
 * - `bun run src/scratch-voice-pipeline.ts deepgram`
 * - `bun run src/scratch-voice-pipeline.ts decomposed`
 * - `bun run src/scratch-voice-pipeline.ts all`
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import WebSocket from 'ws';
import OpenAI from 'openai';
import {
  loadVoiceConfig,
  loadAuthProfiles,
  resolveApiKey,
  type AuthProvider,
} from './voice/settings.js';

loadEnv({ path: resolve(process.cwd(), '../.env') });

const TURN_COMPLETION_PROMPT = [
  'You must start every response with exactly one marker character:',
  '✓ when the user turn is complete and you should answer now.',
  '○ when the user seems to have paused mid-thought and likely continues soon.',
  '◐ when the user seems to be thinking and may continue after a longer pause.',
  'If marker is ○ or ◐ output only that single marker.',
].join('\n');

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}

function maskSecret(value: string): string {
  if (!value) return '(missing)';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function runAuthDiagnostics(): Promise<void> {
  const authProfiles = loadAuthProfiles();

  const providers: AuthProvider[] = ['openai', 'openrouter', 'google', 'deepgram', 'ultravox'];
  console.log('\n[auth] resolved API keys');
  for (const provider of providers) {
    const key = resolveApiKey(provider, { authProfiles });
    const defaultProfile = authProfiles.defaults[provider] ?? '(none)';
    console.log(`- ${provider.padEnd(10)} profile=${defaultProfile.padEnd(20)} key=${maskSecret(key)}`);
  }
}

async function deepgramTts(text: string, model: string, apiKey: string): Promise<Buffer> {
  const url = new URL('https://api.deepgram.com/v1/speak');
  url.searchParams.set('model', model);
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', '24000');
  url.searchParams.set('container', 'wav');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Deepgram TTS failed (${response.status}): ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function deepgramStt(wavAudio: Buffer, model: string, language: string, apiKey: string): Promise<string> {
  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', model);
  url.searchParams.set('language', language);
  url.searchParams.set('smart_format', 'true');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: wavAudio,
  });

  if (!response.ok) {
    throw new Error(`Deepgram STT failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as DeepgramListenResponse;
  return payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}

async function runDeepgramRoundtrip(): Promise<{ transcript: string }> {
  const voiceConfig = loadVoiceConfig();
  const apiKey = resolveApiKey('deepgram');
  if (!apiKey) {
    throw new Error('Deepgram key missing. Set DEEPGRAM_API_KEY or auth-profiles.json');
  }

  const ttsModel = voiceConfig.voice.decomposed.tts.model || 'aura-2-thalia-en';
  const sttModel = voiceConfig.voice.decomposed.stt.model || 'nova-3';
  const language = voiceConfig.voice.decomposed.stt.language || voiceConfig.voice.language;

  const sourceText = 'Hallo, das ist ein Deepgram Rundlauf Test.';
  console.log(`\n[deepgram] TTS model=${ttsModel} -> generating audio`);
  const ttsAudio = await deepgramTts(sourceText, ttsModel, apiKey);
  console.log(`[deepgram] generated ${ttsAudio.length} bytes`);

  console.log(`[deepgram] STT model=${sttModel} language=${language} -> transcribing audio`);
  const transcript = await deepgramStt(ttsAudio, sttModel, language, apiKey);
  console.log(`[deepgram] transcript: "${transcript || '(empty)'}"`);

  return { transcript };
}

async function runUltravoxHandshake(): Promise<void> {
  const voiceConfig = loadVoiceConfig();
  const apiKey = resolveApiKey('ultravox');
  if (!apiKey) {
    throw new Error('Ultravox key missing. Set ULTRAVOX_API_KEY or auth-profiles.json');
  }

  const createResponse = await fetch('https://api.ultravox.ai/api/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      model: voiceConfig.voice.voiceToVoice.ultravoxModel,
      systemPrompt: 'You are an integration smoke test assistant. Keep replies short.',
      medium: {
        serverWebSocket: {
          inputSampleRate: 48000,
          outputSampleRate: 48000,
          clientBufferSizeMs: 60,
        },
      },
    }),
  });

  if (!createResponse.ok) {
    throw new Error(`Ultravox call creation failed (${createResponse.status}): ${await createResponse.text()}`);
  }

  const call = (await createResponse.json()) as { joinUrl?: string; websocketUrl?: string };
  const joinUrl = call.joinUrl ?? call.websocketUrl;
  if (!joinUrl) {
    throw new Error('Ultravox API did not return joinUrl/websocketUrl');
  }

  console.log('\n[ultravox] call created, connecting websocket...');

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(joinUrl);
    const timeout = setTimeout(() => {
      ws.terminate();
      rejectPromise(new Error('Timed out waiting for Ultravox websocket response'));
    }, 15000);

    ws.on('open', () => {
      // Wait for call_started before sending test utterance.
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const size = Buffer.isBuffer(data) ? data.length : Buffer.from(data as ArrayBuffer).length;
        console.log(`[ultravox] received audio chunk (${size} bytes)`);
        ws.send(JSON.stringify({ type: 'hang_up' }));
        ws.close();
        clearTimeout(timeout);
        resolvePromise();
        return;
      }

      const text = data.toString();
      console.log(`[ultravox] message: ${text.slice(0, 180)}`);
      try {
        const payload = JSON.parse(text) as { type?: string; text?: string };
        if (payload.type === 'call_started') {
          ws.send(JSON.stringify({ type: 'user_text_message', text: 'Say exactly: ultravox-ok' }));
          return;
        }

        if (payload.type === 'transcript') {
          ws.send(JSON.stringify({ type: 'hang_up' }));
          ws.close();
          clearTimeout(timeout);
          resolvePromise();
          return;
        }
      } catch {
        // Non-JSON data; ignore and wait for transcript/state.
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error as Error);
    });
  });
}

async function runDecomposedPipeline(): Promise<void> {
  const voiceConfig = loadVoiceConfig();
  const openaiKey = resolveApiKey('openai');
  const deepgramKey = resolveApiKey('deepgram');

  if (!openaiKey) {
    throw new Error('OpenAI key missing. Set OPENAI_API_KEY or auth-profiles.json');
  }
  if (!deepgramKey) {
    throw new Error('Deepgram key missing. Set DEEPGRAM_API_KEY or auth-profiles.json');
  }

  const deepgramResult = await runDeepgramRoundtrip();
  const userText = deepgramResult.transcript || 'Bitte teste die Decomposed Pipeline.';

  const openai = new OpenAI({ apiKey: openaiKey });

  console.log(`\n[decomposed] LLM model=${voiceConfig.voice.decomposed.llm.model} with turn completion markers`);

  const completion = await openai.chat.completions.create({
    model: voiceConfig.voice.decomposed.llm.model,
    messages: [
      {
        role: 'system',
        content: `${TURN_COMPLETION_PROMPT}\nAntworte auf Deutsch.`,
      },
      {
        role: 'user',
        content: userText,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  const marker = raw[0] ?? '(none)';
  const assistantText = ['✓', '○', '◐'].includes(marker) ? raw.slice(1).trim() : raw;

  console.log(`[decomposed] marker=${marker} raw="${raw.slice(0, 120)}"`);

  if (marker === '○' || marker === '◐') {
    console.log('[decomposed] turn marked as incomplete, skipping TTS by design.');
    return;
  }

  const ttsModel = voiceConfig.voice.decomposed.tts.model || 'aura-2-thalia-en';
  const ttsAudio = await deepgramTts(
    assistantText || 'Die Pipeline ist verbunden.',
    ttsModel,
    deepgramKey
  );

  console.log(`[decomposed] Deepgram TTS output bytes=${ttsAudio.length}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'all';

  if (mode === 'auth' || mode === 'all') {
    await runAuthDiagnostics();
  }

  if (mode === 'ultravox' || mode === 'all') {
    await runUltravoxHandshake();
  }

  if (mode === 'deepgram' || mode === 'all') {
    await runDeepgramRoundtrip();
  }

  if (mode === 'decomposed' || mode === 'all') {
    await runDecomposedPipeline();
  }

  console.log('\n[scratch] done');
}

main().catch((error) => {
  console.error('\n[scratch] failed:', error);
  process.exit(1);
});
