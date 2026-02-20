/**
 * Tests for inspector TUI formatting utilities.
 */

import { describe, it, expect } from 'bun:test';
import { fmtMs, fmtDuration, p95, median, truncate, stateColor, exceedsThreshold } from '../../src/tui/inspector/util/format.js';

describe('fmtMs', () => {
  it('formats milliseconds', () => {
    expect(fmtMs(142)).toBe('142ms');
    expect(fmtMs(0)).toBe('0ms');
    expect(fmtMs(999)).toBe('999ms');
  });

  it('formats seconds for values >= 1000', () => {
    expect(fmtMs(1000)).toBe('1.0s');
    expect(fmtMs(1500)).toBe('1.5s');
    expect(fmtMs(12345)).toBe('12.3s');
  });

  it('returns n/a for null/undefined', () => {
    expect(fmtMs(null)).toBe('n/a');
    expect(fmtMs(undefined)).toBe('n/a');
  });
});

describe('fmtDuration', () => {
  it('returns 00:00 for null', () => {
    expect(fmtDuration(null)).toBe('00:00');
  });

  it('formats elapsed time as MM:SS', () => {
    const now = Date.now();
    const twoMinutesAgo = now - 125_000; // 2m 5s
    const result = fmtDuration(twoMinutesAgo);
    // Allow 1s tolerance
    expect(result).toMatch(/^02:0[45]$/);
  });
});

describe('p95', () => {
  it('returns null for empty array', () => {
    expect(p95([])).toBeNull();
  });

  it('computes P95 from samples', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(samples)).toBe(95);
  });

  it('handles single sample', () => {
    expect(p95([42])).toBe(42);
  });
});

describe('median', () => {
  it('returns null for empty array', () => {
    expect(median([])).toBeNull();
  });

  it('computes median for odd-length array', () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it('computes median for even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello w\u2026');
  });
});

describe('stateColor', () => {
  it('maps states to colors', () => {
    expect(stateColor('idle')).toBe('gray');
    expect(stateColor('listening')).toBe('green');
    expect(stateColor('thinking')).toBe('yellow');
    expect(stateColor('speaking')).toBe('cyan');
    expect(stateColor('unknown')).toBe('white');
  });
});

describe('exceedsThreshold', () => {
  it('returns false for null values', () => {
    expect(exceedsThreshold(null, 100)).toBe(false);
  });

  it('returns false for undefined threshold', () => {
    expect(exceedsThreshold(50, undefined)).toBe(false);
  });

  it('detects exceeded thresholds', () => {
    expect(exceedsThreshold(150, 100)).toBe(true);
    expect(exceedsThreshold(50, 100)).toBe(false);
    expect(exceedsThreshold(100, 100)).toBe(false); // equal is not exceeded
  });
});
