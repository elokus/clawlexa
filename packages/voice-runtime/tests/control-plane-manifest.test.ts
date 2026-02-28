import { describe, expect, test } from 'bun:test';
import { getRuntimeConfigManifest } from '../src/control-plane.js';

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
});
