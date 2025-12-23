// ═══════════════════════════════════════════════════════════════════════════
// Activity Utilities - Shared helpers for activity block rendering
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract the last sentence from text for preview display.
 * Truncates to specified max length.
 */
export function getLastSentence(text: string, maxLength = 60): string {
  const sentences = text.split(/[.!?]\s+/);
  const last = sentences[sentences.length - 1] || '';
  return last.slice(0, maxLength) + (last.length > maxLength ? '...' : '');
}

/**
 * Format duration in milliseconds to seconds with one decimal.
 */
export function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/**
 * Check if reasoning content is meaningful (not empty or placeholder).
 * Filters out known placeholder patterns from models that hide reasoning.
 */
export function hasUsefulReasoning(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const placeholders = [
    '[REDACTED]',
    '[redacted]',
    'Redacted',
    '[Web search in progress...]',
  ];

  return !placeholders.some(
    (p) => trimmed === p || trimmed.startsWith(p)
  );
}

/**
 * Truncate text to specified length with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Activity block color mapping for consistent styling.
 */
export const ACTIVITY_COLORS = {
  reasoning: 'var(--color-violet)',
  tool: 'var(--color-cyan)',
  content: 'var(--color-emerald)',
  error: 'var(--color-rose)',
} as const;

/**
 * Activity block icons for consistent display.
 */
export const ACTIVITY_ICONS = {
  reasoning: '◇',
  tool: '▣',
  content: '◈',
  error: '⚠',
} as const;

/**
 * Activity block type labels.
 */
export const ACTIVITY_LABELS = {
  reasoning: 'Reasoning',
  tool: 'Tool',
  content: 'Response',
  error: 'Error',
} as const;
