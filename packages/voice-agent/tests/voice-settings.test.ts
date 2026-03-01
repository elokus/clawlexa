import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'bun:test';

describe('voice settings schema compatibility', () => {
  test('preserves profile override decomposed TTS voiceRef on save', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-settings-'));
    const voiceConfigPath = path.join(tmpDir, 'voice.config.json');
    const authProfilesPath = path.join(tmpDir, 'auth-profiles.json');

    const prevVoiceConfigPath = process.env.VOICE_CONFIG_PATH;
    const prevAuthProfilesPath = process.env.AUTH_PROFILES_PATH;
    const prevVoiceConfigDir = process.env.VOICE_CONFIG_DIR;

    try {
      process.env.VOICE_CONFIG_PATH = voiceConfigPath;
      process.env.AUTH_PROFILES_PATH = authProfilesPath;
      delete process.env.VOICE_CONFIG_DIR;

      const settings = await import(`../src/voice/settings.ts?voice-settings-test=${Date.now()}`);
      settings.ensureDefaultConfigFiles();

      const config = settings.loadVoiceConfig();
      config.voice.decomposed.tts.voiceRef = 'global-base-voice';
      config.voice.profileOverrides.jarvis = {
        mode: 'decomposed',
        decomposed: {
          tts: {
            voiceRef: 'marlon excited v2',
          },
        },
      };

      const saved = settings.saveVoiceConfig(config);
      expect(saved.voice.decomposed.tts.voiceRef).toBe('global-base-voice');
      expect(saved.voice.profileOverrides.jarvis?.decomposed?.tts?.voiceRef).toBe('marlon excited v2');

      const onDisk = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf8')) as {
        voice: {
          decomposed: { tts: { voiceRef?: string } };
          profileOverrides: Record<string, { decomposed?: { tts?: { voiceRef?: string } } }>;
        };
      };
      expect(onDisk.voice.decomposed.tts.voiceRef).toBe('global-base-voice');
      expect(onDisk.voice.profileOverrides.jarvis?.decomposed?.tts?.voiceRef).toBe('marlon excited v2');
    } finally {
      if (prevVoiceConfigPath === undefined) {
        delete process.env.VOICE_CONFIG_PATH;
      } else {
        process.env.VOICE_CONFIG_PATH = prevVoiceConfigPath;
      }

      if (prevAuthProfilesPath === undefined) {
        delete process.env.AUTH_PROFILES_PATH;
      } else {
        process.env.AUTH_PROFILES_PATH = prevAuthProfilesPath;
      }

      if (prevVoiceConfigDir === undefined) {
        delete process.env.VOICE_CONFIG_DIR;
      } else {
        process.env.VOICE_CONFIG_DIR = prevVoiceConfigDir;
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
