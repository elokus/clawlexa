import { afterEach, describe, expect, it } from 'bun:test';
import { fetchRuntimeProviderCatalog } from '../src/voice/auth-catalog.js';

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
});

