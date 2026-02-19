/**
 * Formatting and calculation utilities for the inspector TUI.
 */

/** Format milliseconds as human-readable string. */
export function fmtMs(ms: number | undefined | null): string {
  if (ms == null) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format duration in seconds as MM:SS. */
export function fmtDuration(startedAt: number | null): string {
  if (!startedAt) return '00:00';
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Calculate P95 from a sorted array of samples. */
export function p95(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

/** Calculate median from samples. */
export function median(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Truncate string to max length with ellipsis. */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '\u2026';
}

/** Color name for agent state. */
export function stateColor(state: string): string {
  switch (state) {
    case 'idle': return 'gray';
    case 'listening': return 'green';
    case 'thinking': return 'yellow';
    case 'speaking': return 'cyan';
    default: return 'white';
  }
}

/** Whether a metric value exceeds a threshold. */
export function exceedsThreshold(value: number | null, threshold: number | undefined): boolean {
  if (value == null || threshold == null) return false;
  return value > threshold;
}
