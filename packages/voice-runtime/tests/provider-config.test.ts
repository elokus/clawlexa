import { describe, expect, test } from 'bun:test';
import {
  parseDecomposedProviderConfig,
  parseGeminiProviderConfig,
  parseOpenAIProviderConfig,
  parsePipecatProviderConfig,
  parseProviderConfig,
  parseUltravoxProviderConfig,
} from '../src/provider-config.js';

describe('provider-config parsers', () => {
  test('parses OpenAI provider config', () => {
    const parsed = parseOpenAIProviderConfig({
      apiKey: 'sk-test',
      turnDetection: 'semantic_vad',
    });
    expect(parsed.apiKey).toBe('sk-test');
    expect(parsed.turnDetection).toBe('semantic_vad');
  });

  test('rejects invalid Ultravox numeric fields', () => {
    expect(() =>
      parseUltravoxProviderConfig({
        clientBufferSizeMs: -1,
      })
    ).toThrow('providerConfig.clientBufferSizeMs must be a positive number');
  });

  test('rejects invalid Gemini apiVersion', () => {
    expect(() =>
      parseGeminiProviderConfig({
        apiVersion: 'v2',
      })
    ).toThrow('providerConfig.apiVersion must be one of: v1alpha, v1beta');
  });

  test('parses decomposed config with turn overrides', () => {
    const parsed = parseDecomposedProviderConfig({
      sttProvider: 'deepgram',
      turn: {
        silenceMs: 900,
        minRms: 0.02,
      },
    });
    expect(parsed.sttProvider).toBe('deepgram');
    expect(parsed.turn?.silenceMs).toBe(900);
    expect(parsed.turn?.minRms).toBe(0.02);
  });

  test('requires llm model ref when pipecat pipeline is set', () => {
    expect(() =>
      parsePipecatProviderConfig({
        serverUrl: 'ws://localhost:7860',
        pipeline: {},
      })
    ).toThrow('providerConfig.pipeline.llm.provider and providerConfig.pipeline.llm.model are required');
  });

  test('parses via generic provider parser', () => {
    const parsed = parseProviderConfig('ultravox-ws', {
      apiKey: 'uvx',
      model: 'fixie-ai/ultravox-70B',
    });
    expect(parsed.apiKey).toBe('uvx');
    expect(parsed.model).toBe('fixie-ai/ultravox-70B');
  });
});
