// ═══════════════════════════════════════════════════════════════════════════
// Config Store - Settings state management
// Manages voice config, catalog, auth profiles, and settings UI state.
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import {
  fetchVoiceConfig,
  fetchVoiceCatalog,
  fetchAuthProfiles,
  fetchEffectiveVoiceConfig,
  saveVoiceConfig,
  saveAuthProfiles,
  testAuthProfile,
  type VoiceConfigDocument,
  type VoiceCatalog,
  type AuthProfilesDocument,
} from '../lib/voice-config-api';
import type { SettingsPage } from '../hooks/useRouter';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface EffectiveConfig {
  profile: string;
  mode: string;
  provider: string;
  language: string;
  voice: string;
  model: string;
  decomposed: { stt: string; llm: string; tts: string };
  auth: Record<string, string>;
  turn: VoiceConfigDocument['voice']['turn'];
}

interface ConfigStore {
  // ─── Voice Config ──────────────────────────────────────────────────────
  config: VoiceConfigDocument | null;
  originalConfig: VoiceConfigDocument | null; // snapshot for dirty tracking
  configLoading: boolean;
  configError: string | null;
  saving: boolean;

  // ─── Catalog ───────────────────────────────────────────────────────────
  catalog: VoiceCatalog | null;
  catalogLoading: boolean;
  catalogError: string | null;

  // ─── Auth Profiles ─────────────────────────────────────────────────────
  authProfiles: AuthProfilesDocument | null;
  originalAuthProfiles: AuthProfilesDocument | null;
  authLoading: boolean;
  authError: string | null;
  authSaving: boolean;
  authTestResults: Record<string, { ok: boolean; message: string } | 'testing'>;

  // ─── Effective Configs (per profile) ───────────────────────────────────
  effectiveConfigs: Record<string, EffectiveConfig>;

  // ─── UI State ──────────────────────────────────────────────────────────
  activePage: SettingsPage;
  advancedVisible: Record<SettingsPage, boolean>;

  // ─── Computed ──────────────────────────────────────────────────────────
  isDirty: boolean;
  isAuthDirty: boolean;

  // ─── Actions ───────────────────────────────────────────────────────────
  loadConfig: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  loadAuthProfiles: () => Promise<void>;
  loadEffectiveConfig: (profile: string) => Promise<void>;
  loadAll: () => Promise<void>;

  setConfig: (config: VoiceConfigDocument) => void;
  updatePath: (path: string, value: unknown) => void;
  updateMany: (updates: Array<{ path: string; value: unknown }>) => void;
  saveConfig: () => Promise<void>;
  discardConfig: () => void;

  setAuthProfiles: (profiles: AuthProfilesDocument) => void;
  saveAuth: () => Promise<void>;
  discardAuth: () => void;
  testAuth: (profileId: string, provider: string) => Promise<void>;

  setActivePage: (page: SettingsPage) => void;
  toggleAdvanced: (page: SettingsPage) => void;
}

// ─────────────────────────────────────────────────────────────────────────
// Path helpers (shared with VoiceRuntimePanel)
// ─────────────────────────────────────────────────────────────────────────

function getPathValue(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split('.');
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function setPathValue<T extends object>(obj: T, path: string, value: unknown): T {
  const segments = path.split('.');
  if (segments.length === 0) return obj;

  const root = { ...(obj as Record<string, unknown>) };
  let cursor: Record<string, unknown> = root;
  let source: unknown = obj;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    const sourceObj =
      source && typeof source === 'object'
        ? (source as Record<string, unknown>)
        : undefined;
    const sourceNext = sourceObj?.[segment];

    const next =
      sourceNext && typeof sourceNext === 'object' && !Array.isArray(sourceNext)
        ? { ...(sourceNext as Record<string, unknown>) }
        : {};

    cursor[segment] = next;
    cursor = next;
    source = sourceNext;
  }

  cursor[segments[segments.length - 1]!] = value;
  return root as T;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────

export const useConfigStore = create<ConfigStore>((set, get) => ({
  // Initial state
  config: null,
  originalConfig: null,
  configLoading: false,
  configError: null,
  saving: false,

  catalog: null,
  catalogLoading: false,
  catalogError: null,

  authProfiles: null,
  originalAuthProfiles: null,
  authLoading: false,
  authError: null,
  authSaving: false,
  authTestResults: {},

  effectiveConfigs: {},

  activePage: 'agents',
  advancedVisible: {
    agents: false,
    'tool-generator': false,
    'voice-pipeline': false,
    voices: false,
    audio: false,
    credentials: false,
    models: false,
    system: false,
  },

  isDirty: false,
  isAuthDirty: false,

  // ─── Load Actions ────────────────────────────────────────────────────

  loadConfig: async () => {
    set({ configLoading: true, configError: null });
    try {
      const config = await fetchVoiceConfig();
      set({
        config,
        originalConfig: JSON.parse(JSON.stringify(config)),
        configLoading: false,
        isDirty: false,
      });
    } catch (err) {
      set({
        configError: (err as Error).message,
        configLoading: false,
      });
    }
  },

  loadCatalog: async () => {
    set({ catalogLoading: true, catalogError: null });
    try {
      const catalog = await fetchVoiceCatalog();
      set({ catalog, catalogLoading: false });
    } catch (err) {
      set({
        catalogError: (err as Error).message,
        catalogLoading: false,
      });
    }
  },

  loadAuthProfiles: async () => {
    set({ authLoading: true, authError: null });
    try {
      const profiles = await fetchAuthProfiles(true);
      set({
        authProfiles: profiles,
        originalAuthProfiles: JSON.parse(JSON.stringify(profiles)),
        authLoading: false,
        isAuthDirty: false,
      });
    } catch (err) {
      set({
        authError: (err as Error).message,
        authLoading: false,
      });
    }
  },

  loadEffectiveConfig: async (profile: string) => {
    try {
      const effective = await fetchEffectiveVoiceConfig(profile);
      set((s) => ({
        effectiveConfigs: { ...s.effectiveConfigs, [profile]: effective },
      }));
    } catch {
      // Non-critical — just skip
    }
  },

  loadAll: async () => {
    const { loadConfig, loadCatalog, loadAuthProfiles, loadEffectiveConfig } = get();
    await Promise.all([
      loadConfig(),
      loadCatalog(),
      loadAuthProfiles(),
      loadEffectiveConfig('jarvis'),
      loadEffectiveConfig('marvin'),
    ]);
  },

  // ─── Config Mutations ────────────────────────────────────────────────

  setConfig: (config) => {
    const { originalConfig } = get();
    set({
      config,
      isDirty: !deepEqual(config, originalConfig),
    });
  },

  updatePath: (path, value) => {
    const { config, originalConfig } = get();
    if (!config) return;
    const next = setPathValue(config, path, value);
    set({
      config: next,
      isDirty: !deepEqual(next, originalConfig),
    });
  },

  updateMany: (updates) => {
    const { config, originalConfig } = get();
    if (!config) return;
    let next = config;
    for (const { path, value } of updates) {
      next = setPathValue(next, path, value);
    }
    set({
      config: next,
      isDirty: !deepEqual(next, originalConfig),
    });
  },

  saveConfig: async () => {
    const { config } = get();
    if (!config) return;
    set({ saving: true, configError: null });
    try {
      const saved = await saveVoiceConfig(config);
      set({
        config: saved,
        originalConfig: JSON.parse(JSON.stringify(saved)),
        saving: false,
        isDirty: false,
      });
    } catch (err) {
      set({
        configError: (err as Error).message,
        saving: false,
      });
    }
  },

  discardConfig: () => {
    const { originalConfig } = get();
    if (!originalConfig) return;
    set({
      config: JSON.parse(JSON.stringify(originalConfig)),
      isDirty: false,
      configError: null,
    });
  },

  // ─── Auth Mutations ──────────────────────────────────────────────────

  setAuthProfiles: (profiles) => {
    const { originalAuthProfiles } = get();
    set({
      authProfiles: profiles,
      isAuthDirty: !deepEqual(profiles, originalAuthProfiles),
    });
  },

  saveAuth: async () => {
    const { authProfiles } = get();
    if (!authProfiles) return;
    set({ authSaving: true, authError: null });
    try {
      const saved = await saveAuthProfiles(authProfiles);
      set({
        authProfiles: saved,
        originalAuthProfiles: JSON.parse(JSON.stringify(saved)),
        authSaving: false,
        isAuthDirty: false,
      });
    } catch (err) {
      set({
        authError: (err as Error).message,
        authSaving: false,
      });
    }
  },

  discardAuth: () => {
    const { originalAuthProfiles } = get();
    if (!originalAuthProfiles) return;
    set({
      authProfiles: JSON.parse(JSON.stringify(originalAuthProfiles)),
      isAuthDirty: false,
      authError: null,
    });
  },

  testAuth: async (profileId, provider) => {
    set((s) => ({
      authTestResults: { ...s.authTestResults, [profileId]: 'testing' },
    }));
    try {
      const result = await testAuthProfile({ provider, authProfileId: profileId });
      set((s) => ({
        authTestResults: {
          ...s.authTestResults,
          [profileId]: { ok: result.ok, message: result.message },
        },
      }));
    } catch (err) {
      set((s) => ({
        authTestResults: {
          ...s.authTestResults,
          [profileId]: { ok: false, message: (err as Error).message },
        },
      }));
    }
  },

  // ─── UI State ────────────────────────────────────────────────────────

  setActivePage: (page) => set({ activePage: page }),

  toggleAdvanced: (page) =>
    set((s) => ({
      advancedVisible: {
        ...s.advancedVisible,
        [page]: !s.advancedVisible[page],
      },
    })),
}));

// ─────────────────────────────────────────────────────────────────────────
// Selector Hooks
// ─────────────────────────────────────────────────────────────────────────

export function useSettingsPage(): SettingsPage {
  return useConfigStore((s) => s.activePage);
}

export function useConfigDirty(): boolean {
  return useConfigStore((s) => s.isDirty);
}

export function useAuthDirty(): boolean {
  return useConfigStore((s) => s.isAuthDirty);
}

export function useAnyDirty(): boolean {
  return useConfigStore((s) => s.isDirty || s.isAuthDirty);
}

export function useAdvancedVisible(page: SettingsPage): boolean {
  return useConfigStore((s) => s.advancedVisible[page]);
}

// ─────────────────────────────────────────────────────────────────────────
// Agent Override Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the effective voice config for an agent by merging global defaults
 * with the agent's profileOverrides. Returns a flat object with the
 * effective values for mode, decomposed stages, and voiceToVoice.
 */
export function getEffectiveAgentConfig(
  config: VoiceConfigDocument | null,
  agentName: string
): {
  mode: string;
  decomposed: {
    stt: { provider: string; model: string; language: string; authProfile?: string };
    llm: { provider: string; model: string; authProfile?: string };
    tts: { provider: string; model: string; voice: string; authProfile?: string; voiceRef?: string };
  };
  voiceToVoice: {
    provider: string;
    model: string;
    voice: string;
  };
} | null {
  if (!config) return null;
  const key = agentName.toLowerCase();
  const override = config.voice.profileOverrides[key];
  const d = override?.decomposed;
  const v = override?.voiceToVoice;

  return {
    mode: override?.mode ?? config.voice.mode,
    decomposed: {
      stt: {
        provider: d?.stt?.provider ?? config.voice.decomposed.stt.provider,
        model: d?.stt?.model ?? config.voice.decomposed.stt.model,
        language: d?.stt?.language ?? config.voice.decomposed.stt.language,
        authProfile: d?.stt?.authProfile ?? config.voice.decomposed.stt.authProfile,
      },
      llm: {
        provider: d?.llm?.provider ?? config.voice.decomposed.llm.provider,
        model: d?.llm?.model ?? config.voice.decomposed.llm.model,
        authProfile: d?.llm?.authProfile ?? config.voice.decomposed.llm.authProfile,
      },
      tts: {
        provider: d?.tts?.provider ?? config.voice.decomposed.tts.provider,
        model: d?.tts?.model ?? config.voice.decomposed.tts.model,
        voice: d?.tts?.voice ?? config.voice.decomposed.tts.voice,
        authProfile: d?.tts?.authProfile ?? config.voice.decomposed.tts.authProfile,
        voiceRef: d?.tts?.voiceRef ?? config.voice.decomposed.tts.voiceRef,
      },
    },
    voiceToVoice: {
      provider: v?.provider ?? override?.provider ?? config.voice.voiceToVoice.provider,
      model: v?.model ?? (config.voice.voiceToVoice.model as string ?? ''),
      voice: v?.voice ?? override?.voice ?? (config.voice.voiceToVoice.voice as string ?? ''),
    },
  };
}

/**
 * Write a value to a specific agent's profileOverrides path.
 * The path is relative to the override object (e.g., "decomposed.tts.provider").
 */
export function updateAgentOverride(agentName: string, path: string, value: unknown): void {
  const store = useConfigStore.getState();
  const fullPath = `voice.profileOverrides.${agentName.toLowerCase()}.${path}`;
  store.updatePath(fullPath, value);
}

/**
 * Remove a specific override path, falling back to global default.
 * Deletes the key from the override object.
 */
export function clearAgentOverride(agentName: string, path: string): void {
  const store = useConfigStore.getState();
  const { config, originalConfig } = store;
  if (!config) return;

  const key = agentName.toLowerCase();
  const overridePath = `voice.profileOverrides.${key}.${path}`;

  // Set to undefined to clear the override
  const next = setPathValue(config, overridePath, undefined);
  useConfigStore.setState({
    config: next,
    isDirty: !deepEqual(next, originalConfig),
  });
}

/**
 * Check if a specific path has an explicit override for this agent.
 */
export function isAgentOverridden(
  config: VoiceConfigDocument | null,
  agentName: string,
  path: string
): boolean {
  if (!config) return false;
  const key = agentName.toLowerCase();
  const overridePath = `voice.profileOverrides.${key}.${path}`;
  const value = getPathValue(config, overridePath);
  return value !== undefined && value !== null;
}

// Re-export path helpers for use in settings pages
export { getPathValue, setPathValue };
