/**
 * Centralized Prompt Management Service
 *
 * Manages prompts stored in ./prompts/<name>/ directories with:
 * - Version tracking (v1.md, v2.md, ...)
 * - Active version selection via config.json
 * - Variable interpolation with {{variable}} syntax
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import path from 'path';
import { interpolatePrompt, type InterpolationContext } from './interpolate.js';

export { interpolatePrompt, type InterpolationContext } from './interpolate.js';

// Prompts directory inside the voice-agent package
const PROMPTS_DIR = path.join(process.cwd(), 'prompts');

/**
 * Prompt configuration stored in config.json
 */
export interface PromptConfig {
  name: string;
  description: string;
  type: 'voice' | 'subagent';
  activeVersion: string;
  metadata?: {
    voice?: string;
    wakeWord?: string;
    tools?: string[];
    model?: string;
    maxSteps?: number;
  };
}

/**
 * Prompt info returned by list operations
 */
export interface PromptInfo extends PromptConfig {
  /** Directory name (e.g., "jarvis", "cli-orchestrator") */
  id: string;
  /** Available versions (e.g., ["v1", "v2", "v3"]) */
  versions: string[];
}

/**
 * Version content with metadata
 */
export interface PromptVersion {
  version: string;
  content: string;
  createdAt: number;
}

/**
 * Get the prompts directory path
 */
export function getPromptsDir(): string {
  return PROMPTS_DIR;
}

/**
 * Check if the prompts directory exists
 */
export async function promptsDirExists(): Promise<boolean> {
  try {
    const stats = await stat(PROMPTS_DIR);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * List all available prompts with their metadata
 */
export async function listPrompts(): Promise<PromptInfo[]> {
  const exists = await promptsDirExists();
  if (!exists) {
    return [];
  }

  const entries = await readdir(PROMPTS_DIR, { withFileTypes: true });
  const prompts: PromptInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const promptDir = path.join(PROMPTS_DIR, entry.name);
      const configPath = path.join(promptDir, 'config.json');

      const configStr = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configStr) as PromptConfig;

      const versions = await listVersions(entry.name);

      prompts.push({
        id: entry.name,
        ...config,
        versions,
      });
    } catch (error) {
      // Skip directories without valid config.json
      console.warn(`[Prompts] Skipping ${entry.name}: ${error}`);
    }
  }

  // Sort by type (voice first) then by name
  return prompts.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'voice' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get prompt configuration by ID (directory name)
 */
export async function getPromptConfig(id: string): Promise<PromptConfig | null> {
  try {
    const configPath = path.join(PROMPTS_DIR, id, 'config.json');
    const configStr = await readFile(configPath, 'utf-8');
    return JSON.parse(configStr) as PromptConfig;
  } catch {
    return null;
  }
}

/**
 * Get prompt info with versions
 */
export async function getPromptInfo(id: string): Promise<PromptInfo | null> {
  const config = await getPromptConfig(id);
  if (!config) return null;

  const versions = await listVersions(id);

  return {
    id,
    ...config,
    versions,
  };
}

/**
 * List all versions for a prompt (e.g., ["v1", "v2", "v3"])
 */
export async function listVersions(id: string): Promise<string[]> {
  try {
    const promptDir = path.join(PROMPTS_DIR, id);
    const entries = await readdir(promptDir);

    const versions = entries
      .filter((f) => /^v\d+\.md$/.test(f))
      .map((f) => f.replace('.md', ''))
      .sort((a, b) => {
        const numA = parseInt(a.slice(1), 10);
        const numB = parseInt(b.slice(1), 10);
        return numA - numB;
      });

    return versions;
  } catch {
    return [];
  }
}

/**
 * Get the next version number for a prompt
 */
async function getNextVersion(id: string): Promise<string> {
  const versions = await listVersions(id);

  if (versions.length === 0) {
    return 'v1';
  }

  const lastVersion = versions[versions.length - 1]!;
  const lastNum = parseInt(lastVersion.slice(1), 10);
  return `v${lastNum + 1}`;
}

/**
 * Get a specific version's content (raw, without interpolation)
 */
export async function getPromptVersion(
  id: string,
  version: string
): Promise<PromptVersion | null> {
  try {
    const versionPath = path.join(PROMPTS_DIR, id, `${version}.md`);
    const stats = await stat(versionPath);
    const content = await readFile(versionPath, 'utf-8');

    return {
      version,
      content,
      createdAt: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * Get the active prompt content with variable interpolation
 *
 * This is the main function used by agents to load their prompts.
 *
 * @param id - Prompt directory name (e.g., "jarvis", "cli-orchestrator")
 * @param context - Variables to interpolate (agent_name, session_id, etc.)
 * @returns Interpolated prompt content, or null if not found
 *
 * @example
 * ```typescript
 * const prompt = await getActivePrompt('jarvis', {
 *   agent_name: 'Jarvis',
 *   session_id: 'sess_abc123'
 * });
 * ```
 */
export async function getActivePrompt(
  id: string,
  context: InterpolationContext = {}
): Promise<string | null> {
  const config = await getPromptConfig(id);
  if (!config) return null;

  const version = await getPromptVersion(id, config.activeVersion);
  if (!version) return null;

  return interpolatePrompt(version.content, context);
}

/**
 * Get the active prompt content without interpolation (raw)
 */
export async function getActivePromptRaw(id: string): Promise<string | null> {
  const config = await getPromptConfig(id);
  if (!config) return null;

  const version = await getPromptVersion(id, config.activeVersion);
  return version?.content ?? null;
}

/**
 * Create a new version of a prompt
 *
 * @param id - Prompt directory name
 * @param content - New prompt content
 * @returns The new version name (e.g., "v2")
 */
export async function createPromptVersion(
  id: string,
  content: string
): Promise<string> {
  const promptDir = path.join(PROMPTS_DIR, id);

  // Ensure directory exists
  await mkdir(promptDir, { recursive: true });

  const version = await getNextVersion(id);
  const versionPath = path.join(promptDir, `${version}.md`);

  await writeFile(versionPath, content, 'utf-8');

  return version;
}

/**
 * Set the active version for a prompt
 *
 * @param id - Prompt directory name
 * @param version - Version to activate (e.g., "v2")
 */
export async function setActiveVersion(
  id: string,
  version: string
): Promise<void> {
  const config = await getPromptConfig(id);
  if (!config) {
    throw new Error(`Prompt not found: ${id}`);
  }

  // Verify version exists
  const versionData = await getPromptVersion(id, version);
  if (!versionData) {
    throw new Error(`Version not found: ${version}`);
  }

  // Update config
  const configPath = path.join(PROMPTS_DIR, id, 'config.json');
  const updatedConfig = { ...config, activeVersion: version };
  await writeFile(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Create a new prompt with initial content
 *
 * @param id - Directory name (e.g., "my-agent")
 * @param config - Prompt configuration (without activeVersion)
 * @param content - Initial prompt content
 */
export async function createPrompt(
  id: string,
  config: Omit<PromptConfig, 'activeVersion'>,
  content: string
): Promise<void> {
  const promptDir = path.join(PROMPTS_DIR, id);

  // Create directory
  await mkdir(promptDir, { recursive: true });

  // Write initial version
  await writeFile(path.join(promptDir, 'v1.md'), content, 'utf-8');

  // Write config
  const fullConfig: PromptConfig = { ...config, activeVersion: 'v1' };
  await writeFile(
    path.join(promptDir, 'config.json'),
    JSON.stringify(fullConfig, null, 2),
    'utf-8'
  );
}

/**
 * Update prompt configuration (metadata only, not content)
 */
export async function updatePromptConfig(
  id: string,
  updates: Partial<Omit<PromptConfig, 'activeVersion'>>
): Promise<void> {
  const config = await getPromptConfig(id);
  if (!config) {
    throw new Error(`Prompt not found: ${id}`);
  }

  const configPath = path.join(PROMPTS_DIR, id, 'config.json');
  const updatedConfig = { ...config, ...updates };
  await writeFile(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Mapping from subagent directory names to prompt IDs
 *
 * This allows subagent loaders to find their prompts in the centralized directory.
 */
export const SUBAGENT_PROMPT_MAPPING: Record<string, string> = {
  cli: 'cli-orchestrator',
  'web-search': 'web-search',
};

/**
 * Get prompt ID for a subagent directory
 */
export function getPromptIdForSubagent(dirName: string): string {
  return SUBAGENT_PROMPT_MAPPING[dirName] ?? dirName;
}
