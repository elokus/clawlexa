/**
 * OpenRouter Models API Client
 */

const API_BASE = process.env.PUBLIC_API_URL || '';

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
}

/**
 * Fetch available models from OpenRouter (via backend proxy)
 */
export async function fetchModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(`${API_BASE}/api/models`);
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status}`);
  }
  return res.json();
}
