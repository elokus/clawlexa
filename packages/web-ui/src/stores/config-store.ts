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
    'voice-pipeline': false,
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

// Re-export path helpers for use in settings pages
export { getPathValue, setPathValue };
