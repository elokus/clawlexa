import { readdir, readFile } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { getVoiceConfigPath } from '../voice/settings.js';
import { CORE_TOOL_CATALOG, type ToolCatalogEntry } from './index.js';

interface ToolManifest {
  name?: unknown;
  label?: unknown;
  displayName?: unknown;
  description?: unknown;
  enabled?: unknown;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToolName(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function normalizeManifestTool(folderName: string, manifest: ToolManifest): ToolCatalogEntry | null {
  if (manifest.enabled === false) {
    return null;
  }

  const name = asNonEmptyString(manifest.name) ?? folderName;
  const label =
    asNonEmptyString(manifest.label) ??
    asNonEmptyString(manifest.displayName) ??
    humanizeToolName(name);
  const description =
    asNonEmptyString(manifest.description) ??
    'Discovered from .voiceclaw/tools manifest (runtime wiring pending).';

  return {
    name,
    label,
    description,
    source: 'manifest',
    selectable: false,
  };
}

async function discoverManifestTools(): Promise<ToolCatalogEntry[]> {
  const configDir = path.dirname(getVoiceConfigPath());
  const toolsDir = path.join(configDir, 'tools');

  let entries: Dirent<string>[];
  try {
    entries = await readdir(toolsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    console.warn(`[Tools] Failed to read tools directory "${toolsDir}":`, error);
    return [];
  }

  const discovered: ToolCatalogEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(toolsDir, entry.name, 'manifest.json');

    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as ToolManifest;
      const normalized = normalizeManifestTool(entry.name, parsed);
      if (normalized) {
        discovered.push(normalized);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        continue;
      }
      console.warn(`[Tools] Failed to load manifest "${manifestPath}":`, error);
    }
  }

  return discovered;
}

export async function listToolCatalog(): Promise<ToolCatalogEntry[]> {
  const discovered = await discoverManifestTools();
  const byName = new Map<string, ToolCatalogEntry>();

  for (const entry of CORE_TOOL_CATALOG) {
    byName.set(entry.name, entry);
  }

  for (const entry of discovered) {
    if (byName.has(entry.name)) {
      continue;
    }
    byName.set(entry.name, entry);
  }

  return Array.from(byName.values()).sort((a, b) => {
    if (a.source !== b.source) {
      return a.source === 'core' ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
}
