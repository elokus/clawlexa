import { afterEach, describe, expect, it } from 'bun:test';
import {
  fetchRuntimeProviderCatalog,
  resolveRuntimeAuthKeySet,
  runtimeAuthKeySetToProviderMap,
} from '../src/voice/auth-catalog.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ai-core voice auth catalog', () => {
  it('normalizes deepgram tts voices with inferred language and readable names', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          stt: [{ canonical_name: 'nova-3', streaming: true }],
          tts: [
            { canonical_name: 'aura-2-viktoria-de' },
            { canonical_name: 'aura-2-thalia-en' },
            { canonical_name: 'custom-voice' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as typeof fetch;

    const catalog = await fetchRuntimeProviderCatalog({
      openaiApiKey: '',
      deepgramApiKey: 'dg-test',
      ultravoxApiKey: '',
    });

    expect(catalog.entries['deepgram-tts']?.voices).toEqual([
      {
        id: 'aura-2-thalia-en',
        name: 'Thalia',
        language: 'en',
      },
      {
        id: 'aura-2-viktoria-de',
        name: 'Viktoria',
        language: 'de',
      },
      {
        id: 'custom-voice',
        name: 'custom-voice',
        language: undefined,
      },
    ]);
  });

  it('resolves added tts provider auth keys from env', () => {
    const keys = resolveRuntimeAuthKeySet({
      authProfiles: { profiles: {}, defaults: {} },
      env: {
        CARTESIA_API_KEY: 'cartesia-key',
        FISH_AUDIO_API_KEY: 'fish-key',
        RIME_API_KEY: 'rime-key',
      },
    });

    expect(keys.cartesiaApiKey).toBe('cartesia-key');
    expect(keys.fishAudioApiKey).toBe('fish-key');
    expect(keys.rimeApiKey).toBe('rime-key');

    const byProvider = runtimeAuthKeySetToProviderMap(keys);
    expect(byProvider.cartesia).toBe('cartesia-key');
    expect(byProvider.fish).toBe('fish-key');
    expect(byProvider.rime).toBe('rime-key');
  });

  it('includes local provider model catalogs for decomposed STT/TTS', async () => {
    const catalog = await fetchRuntimeProviderCatalog({
      openaiApiKey: '',
      deepgramApiKey: '',
      ultravoxApiKey: '',
    });

    expect(catalog.entries['local-stt']?.models).toContain(
      'mlx-community/parakeet-tdt-0.6b-v3'
    );
    expect(catalog.entries['local-tts']?.models).toContain('qwen3-0.6b');
    expect(catalog.entries['local-tts']?.models).toContain(
      'mlx-community/Kokoro-82M-bf16'
    );
  });

  it('includes gpt-realtime-1.5 in OpenAI realtime fallback models', async () => {
    const catalog = await fetchRuntimeProviderCatalog({
      openaiApiKey: '',
      deepgramApiKey: '',
      ultravoxApiKey: '',
    });

    expect(catalog.entries['openai-realtime']?.models).toContain('gpt-realtime-1.5');
  });
});
