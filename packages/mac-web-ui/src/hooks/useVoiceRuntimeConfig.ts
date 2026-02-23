import { useCallback, useEffect, useState } from 'react';
import {
  fetchVoiceConfig,
  saveVoiceConfig,
  type VoiceConfigDocument,
} from '../lib/voice-config-api';

export interface VoiceRuntimeConfigState {
  config: VoiceConfigDocument | null;
  setConfig: (next: VoiceConfigDocument) => void;
  loading: boolean;
  saving: boolean;
  error: string | null;
  reload: () => Promise<void>;
  save: () => Promise<void>;
}

export function useVoiceRuntimeConfig(): VoiceRuntimeConfigState {
  const [config, setConfig] = useState<VoiceConfigDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchVoiceConfig();
      setConfig(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!config) return;

    setSaving(true);
    setError(null);
    try {
      const next = await saveVoiceConfig(config);
      setConfig(next);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [config]);

  return {
    config,
    setConfig,
    loading,
    saving,
    error,
    reload: load,
    save,
  };
}
