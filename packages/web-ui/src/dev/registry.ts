// ═══════════════════════════════════════════════════════════════════════════
// Demo Registry - Central registration for component demos
// ═══════════════════════════════════════════════════════════════════════════

import type { ComponentType } from 'react';
import type { WSMessageType } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// Stream Event Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A single event in a demo stream.
 * Uses the same format as WebSocket messages for consistency.
 */
export interface StreamEvent {
  type: WSMessageType;
  payload: unknown;
  /** Delay in ms before emitting this event (for realistic timing) */
  delay?: number;
}

/**
 * A complete stream scenario with metadata.
 */
export interface StreamScenario {
  id: string;
  name: string;
  description: string;
  events: StreamEvent[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Demo Configuration Types
// ═══════════════════════════════════════════════════════════════════════════

export type DemoCategory = 'subagent' | 'session' | 'conversation' | 'status';

/**
 * Props passed to demo wrapper components.
 */
export interface DemoProps {
  /** Events emitted so far in the stream */
  events: StreamEvent[];
  /** Whether the stream is currently playing */
  isPlaying: boolean;
  /** Reset the demo to initial state */
  onReset: () => void;
}

/**
 * Configuration for a single component demo.
 */
export interface DemoConfig {
  /** Unique identifier (kebab-case, e.g., 'activity-feed') */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Category for sidebar grouping */
  category: DemoCategory;
  /** Component that renders the demo */
  component: ComponentType<DemoProps>;
  /** Available stream scenarios */
  scenarios: StreamScenario[];
  /** Backend route for real streaming (optional) */
  backendRoute?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Demo Registry
// ═══════════════════════════════════════════════════════════════════════════

const registry = new Map<string, DemoConfig>();

/**
 * Register a component demo.
 */
export function registerDemo(config: DemoConfig): void {
  if (registry.has(config.id)) {
    console.warn(`[DemoRegistry] Overwriting existing demo: ${config.id}`);
  }
  registry.set(config.id, config);
}

/**
 * Get a demo by ID.
 */
export function getDemo(id: string): DemoConfig | undefined {
  return registry.get(id);
}

/**
 * Get all registered demos.
 */
export function getAllDemos(): DemoConfig[] {
  return Array.from(registry.values());
}

/**
 * Get demos grouped by category.
 */
export function getDemosByCategory(): Map<DemoCategory, DemoConfig[]> {
  const grouped = new Map<DemoCategory, DemoConfig[]>();

  for (const demo of registry.values()) {
    const list = grouped.get(demo.category) || [];
    list.push(demo);
    grouped.set(demo.category, list);
  }

  return grouped;
}

/**
 * Category display names and order.
 */
export const categoryMeta: Record<DemoCategory, { name: string; order: number }> = {
  subagent: { name: 'Subagent Components', order: 1 },
  session: { name: 'Session Components', order: 2 },
  conversation: { name: 'Conversation Components', order: 3 },
  status: { name: 'Status Components', order: 4 },
};
