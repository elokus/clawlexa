import { describe, expect, test } from 'bun:test';
import {
  createDefaultRuntimeAuthProfiles,
  createDefaultRuntimeVoiceConfig,
  getRuntimeConfigManifest,
  resolveRuntimeConfigFromDocuments,
} from '../src/control-plane.js';

describe('runtime config manifest', () => {
  test('includes local model catalogs for decomposed stages', () => {
    const manifest = getRuntimeConfigManifest();

    const sttStage = manifest.decomposedStages.find((stage) => stage.id === 'stt');
    const ttsStage = manifest.decomposedStages.find((stage) => stage.id === 'tts');
    expect(sttStage).toBeDefined();
    expect(ttsStage).toBeDefined();

    const localStt = sttStage?.providers.find((provider) => provider.id === 'local');
    const localTts = ttsStage?.providers.find((provider) => provider.id === 'local');
    expect(localStt?.modelCatalogKey).toBe('local-stt');
    expect(localTts?.modelCatalogKey).toBe('local-tts');
  });

  test('includes realtime-text-tts mode', () => {
    const manifest = getRuntimeConfigManifest();
    expect(manifest.modes).toContain('realtime-text-tts');
  });

  test('realtime-text-tts uses v2v voice when decomposed tts voice is blank', () => {
    const voiceConfig = createDefaultRuntimeVoiceConfig({});
    voiceConfig.voice.mode = 'realtime-text-tts';
    voiceConfig.voice.voiceToVoice.voice = 'ash';
    voiceConfig.voice.decomposed.tts.voice = '';

    const resolved = resolveRuntimeConfigFromDocuments({
      profileName: 'jarvis',
      profileVoice: 'echo',
      fallbackModel: 'gpt-4.1',
      voiceConfig,
      authProfiles: createDefaultRuntimeAuthProfiles(),
      env: {},
    });

    expect(resolved.mode).toBe('realtime-text-tts');
    expect(resolved.voice).toBe('ash');
  });

  test('realtime-text-tts falls back to profile voice when configured voices are blank', () => {
    const voiceConfig = createDefaultRuntimeVoiceConfig({});
    voiceConfig.voice.mode = 'realtime-text-tts';
    voiceConfig.voice.voiceToVoice.voice = '   ';
    voiceConfig.voice.decomposed.tts.voice = '';

    const resolved = resolveRuntimeConfigFromDocuments({
      profileName: 'jarvis',
      profileVoice: 'echo',
      fallbackModel: 'gpt-4.1',
      voiceConfig,
      authProfiles: createDefaultRuntimeAuthProfiles(),
      env: {},
    });

    expect(resolved.voice).toBe('echo');
  });
});
