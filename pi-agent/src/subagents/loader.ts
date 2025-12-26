/**
 * Subagent Loader - Utility to load agent configuration and prompts from disk.
 *
 * Each subagent lives in a directory with:
 * - config.json: Agent settings (model, name, maxSteps, etc.)
 * - PROMPT.md: System instructions (fallback)
 *
 * Prompts are now primarily loaded from the centralized ./prompts/ directory
 * with version support and variable interpolation.
 */

import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import {
  getActivePrompt,
  getPromptIdForSubagent,
  type InterpolationContext,
} from '../prompts/index.js';

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
 * Prompts are loaded from the centralized ./prompts/ directory first,
 * with fallback to local PROMPT.md if not found.
 *
 * @param dirPath - Absolute path to the subagent directory (use import.meta.dirname)
 * @param context - Optional interpolation context for variables
 * @returns The loaded config and prompt
 */
export async function loadAgentConfig(
  dirPath: string,
  context: InterpolationContext = {}
): Promise<LoadedSubagent> {
  const configPath = join(dirPath, 'config.json');

  // Load config from local directory
  const configStr = await readFile(configPath, 'utf-8');
  const config = JSON.parse(configStr) as SubagentConfig;

  // Determine prompt ID from directory name
  const dirName = basename(dirPath);
  const promptId = getPromptIdForSubagent(dirName);

  // Add agent_name to context if not provided
  const fullContext: InterpolationContext = {
    agent_name: config.name,
    ...context,
  };

  // Try centralized prompts first, fall back to local PROMPT.md
  let prompt = await getActivePrompt(promptId, fullContext);

  if (!prompt) {
    // Fallback to local file
    const promptPath = join(dirPath, 'PROMPT.md');
    try {
      prompt = (await readFile(promptPath, 'utf-8')).trim();
    } catch {
      throw new Error(`No prompt found for ${dirName} (checked prompts/${promptId} and ${promptPath})`);
    }
  }

  return { config, prompt };
}

/**
 * Synchronously load agent config (for use in module initialization).
 * Prefer async loadAgentConfig when possible.
 *
 * Note: This does NOT use the centralized prompts system (sync I/O limitation).
 * Use only for initialization where async is not possible.
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
