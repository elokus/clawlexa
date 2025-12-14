/**
 * Subagent Loader - Utility to load agent configuration and prompts from disk.
 *
 * Each subagent lives in a directory with:
 * - config.json: Agent settings (model, name, maxSteps, etc.)
 * - PROMPT.md: System instructions
 *
 * This enables future dynamic updates via Web UI.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

export interface SubagentConfig {
  name: string;
  model: string;
  description?: string;
  maxSteps?: number;
}

export interface LoadedSubagent {
  config: SubagentConfig;
  prompt: string;
}

/**
 * Load agent configuration and prompt from a subagent directory.
 *
 * @param dirPath - Absolute path to the subagent directory (use import.meta.dirname)
 * @returns The loaded config and prompt
 */
export async function loadAgentConfig(dirPath: string): Promise<LoadedSubagent> {
  const configPath = join(dirPath, 'config.json');
  const promptPath = join(dirPath, 'PROMPT.md');

  const [configStr, prompt] = await Promise.all([
    readFile(configPath, 'utf-8'),
    readFile(promptPath, 'utf-8'),
  ]);

  return {
    config: JSON.parse(configStr) as SubagentConfig,
    prompt: prompt.trim(),
  };
}

/**
 * Synchronously load agent config (for use in module initialization).
 * Prefer async loadAgentConfig when possible.
 */
export function loadAgentConfigSync(dirPath: string): LoadedSubagent {
  const { readFileSync } = require('fs');
  const configPath = join(dirPath, 'config.json');
  const promptPath = join(dirPath, 'PROMPT.md');

  const configStr = readFileSync(configPath, 'utf-8');
  const prompt = readFileSync(promptPath, 'utf-8');

  return {
    config: JSON.parse(configStr) as SubagentConfig,
    prompt: prompt.trim(),
  };
}
