/**
 * Prompts API Client
 *
 * API client for the prompt management system.
 */

const API_BASE = process.env.PUBLIC_API_URL || '';

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

export interface PromptInfo extends PromptConfig {
  id: string;
  versions: string[];
}

export interface PromptWithContent extends PromptInfo {
  content: string;
}

export interface PromptVersion {
  version: string;
  content: string;
  createdAt: number;
}

/**
 * Fetch all prompts with metadata
 */
export async function fetchPrompts(): Promise<PromptInfo[]> {
  const res = await fetch(`${API_BASE}/api/prompts`);
  if (!res.ok) {
    throw new Error(`Failed to fetch prompts: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch a single prompt with its active version content
 */
export async function fetchPrompt(id: string): Promise<PromptWithContent> {
  const res = await fetch(`${API_BASE}/api/prompts/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch prompt: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch all versions for a prompt
 */
export async function fetchVersions(id: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/prompts/${encodeURIComponent(id)}/versions`);
  if (!res.ok) {
    throw new Error(`Failed to fetch versions: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch a specific version's content
 */
export async function fetchVersion(id: string, version: string): Promise<PromptVersion> {
  const res = await fetch(
    `${API_BASE}/api/prompts/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch version: ${res.status}`);
  }
  return res.json();
}

/**
 * Create a new version of a prompt
 */
export async function saveNewVersion(id: string, content: string): Promise<{ version: string; promptId: string }> {
  const res = await fetch(`${API_BASE}/api/prompts/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save version: ${res.status}`);
  }
  return res.json();
}

/**
 * Set the active version for a prompt
 */
export async function setActiveVersion(
  id: string,
  version: string
): Promise<{ success: boolean; promptId: string; activeVersion: string }> {
  const res = await fetch(`${API_BASE}/api/prompts/${encodeURIComponent(id)}/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
  if (!res.ok) {
    throw new Error(`Failed to set active version: ${res.status}`);
  }
  return res.json();
}

/**
 * Create a new prompt
 */
export async function createPrompt(
  id: string,
  name: string,
  description: string,
  type: 'voice' | 'subagent',
  content: string,
  metadata?: PromptConfig['metadata']
): Promise<{ success: boolean; id: string }> {
  const res = await fetch(`${API_BASE}/api/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, description, type, content, metadata }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create prompt: ${res.status}`);
  }
  return res.json();
}
