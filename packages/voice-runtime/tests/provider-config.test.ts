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
      customSttMode: 'hybrid',
      deepgramTtsPunctuationChunkingEnabled: false,
      turn: {
        silenceMs: 900,
        minRms: 0.02,
        bargeInEnabled: false,
        speechStartDebounceMs: 140,
        vadEngine: 'webrtc-vad',
        neuralFilterEnabled: true,
        rnnoiseSpeechThreshold: 0.61,
        rnnoiseEchoSpeechThresholdBoost: 0.12,
        webrtcVadMode: 3,
        webrtcVadSpeechRatioThreshold: 0.7,
        webrtcVadEchoSpeechRatioBoost: 0.15,
        assistantOutputMinRms: 0.009,
        assistantOutputSilenceMs: 320,
        spokenStreamEnabled: true,
        wordAlignmentEnabled: true,
        spokenHighlightMsPerWord: 360,
        spokenHighlightPunctuationPauseMs: 180,
      },
    });
    expect(parsed.sttProvider).toBe('deepgram');
    expect(parsed.customSttMode).toBe('hybrid');
    expect(parsed.deepgramTtsPunctuationChunkingEnabled).toBe(false);
    expect(parsed.turn?.silenceMs).toBe(900);
    expect(parsed.turn?.minRms).toBe(0.02);
    expect(parsed.turn?.bargeInEnabled).toBe(false);
    expect(parsed.turn?.speechStartDebounceMs).toBe(140);
    expect(parsed.turn?.vadEngine).toBe('webrtc-vad');
    expect(parsed.turn?.neuralFilterEnabled).toBe(true);
    expect(parsed.turn?.rnnoiseSpeechThreshold).toBe(0.61);
    expect(parsed.turn?.rnnoiseEchoSpeechThresholdBoost).toBe(0.12);
    expect(parsed.turn?.webrtcVadMode).toBe(3);
    expect(parsed.turn?.webrtcVadSpeechRatioThreshold).toBe(0.7);
    expect(parsed.turn?.webrtcVadEchoSpeechRatioBoost).toBe(0.15);
    expect(parsed.turn?.assistantOutputMinRms).toBe(0.009);
    expect(parsed.turn?.assistantOutputSilenceMs).toBe(320);
    expect(parsed.turn?.spokenStreamEnabled).toBe(true);
    expect(parsed.turn?.wordAlignmentEnabled).toBe(true);
    expect(parsed.turn?.spokenHighlightMsPerWord).toBe(360);
    expect(parsed.turn?.spokenHighlightPunctuationPauseMs).toBe(180);
  });

  test('parses extended decomposed tts provider settings', () => {
    const parsed = parseDecomposedProviderConfig({
      ttsProvider: 'google-chirp',
      ttsModel: 'chirp-3-hd',
      ttsVoice: 'en-US-Chirp3-HD-Charon',
      googleChirpEndpoint: 'https://texttospeech.googleapis.com/v1/text:synthesize',
      cartesiaTtsWsUrl: 'wss://api.cartesia.ai/tts/websocket',
      fishTtsWsUrl: 'wss://api.fish.audio/v1/tts/live',
      rimeTtsWsUrl: 'wss://users-ws.rime.ai/ws3',
      kokoroEndpoint: 'http://localhost:8880/v1/audio/speech',
      pocketTtsEndpoint: 'http://localhost:8000/tts',
      cartesiaApiKey: 'cartesia-test',
      fishAudioApiKey: 'fish-test',
      rimeApiKey: 'rime-test',
    });

    expect(parsed.ttsProvider).toBe('google-chirp');
    expect(parsed.googleChirpEndpoint).toBe(
      'https://texttospeech.googleapis.com/v1/text:synthesize'
    );
    expect(parsed.cartesiaApiKey).toBe('cartesia-test');
    expect(parsed.fishAudioApiKey).toBe('fish-test');
    expect(parsed.rimeApiKey).toBe('rime-test');
  });

  test('rejects invalid decomposed Deepgram punctuation chunking type', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        deepgramTtsPunctuationChunkingEnabled: 'false',
      })
    ).toThrow('providerConfig.deepgramTtsPunctuationChunkingEnabled must be a boolean');
  });

  test('rejects invalid decomposed customSttMode', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        customSttMode: 'legacy',
      })
    ).toThrow('providerConfig.customSttMode must be one of: provider, custom, hybrid');
  });

  test('rejects invalid decomposed rnnoise speech threshold', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        turn: {
          rnnoiseSpeechThreshold: 1.5,
        },
      })
    ).toThrow('providerConfig.turn.rnnoiseSpeechThreshold must be a number between 0 and 1');
  });

  test('rejects invalid decomposed webrtc vad mode', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        turn: {
          webrtcVadMode: 7,
        },
      })
    ).toThrow('providerConfig.turn.webrtcVadMode must be an integer between 0 and 3');
  });

  test('rejects invalid decomposed speech start debounce', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        turn: {
          speechStartDebounceMs: -1,
        },
      })
    ).toThrow('providerConfig.turn.speechStartDebounceMs must be a non-negative number');
  });

  test('rejects invalid decomposed assistant output min RMS', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        turn: {
          assistantOutputMinRms: -0.1,
        },
      })
    ).toThrow('providerConfig.turn.assistantOutputMinRms must be a non-negative number');
  });

  test('rejects invalid decomposed barge-in enabled type', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        turn: {
          bargeInEnabled: 'false',
        },
      })
    ).toThrow('providerConfig.turn.bargeInEnabled must be a boolean');
  });

  test('rejects invalid decomposed spoken highlight speed', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        turn: {
          spokenHighlightMsPerWord: 0,
        },
      })
    ).toThrow('providerConfig.turn.spokenHighlightMsPerWord must be a positive number');
  });

  test('rejects invalid decomposed spoken punctuation pause', () => {
    expect(() =>
      parseDecomposedProviderConfig({
        turn: {
          spokenHighlightPunctuationPauseMs: -1,
        },
      })
    ).toThrow(
      'providerConfig.turn.spokenHighlightPunctuationPauseMs must be a non-negative number'
    );
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
