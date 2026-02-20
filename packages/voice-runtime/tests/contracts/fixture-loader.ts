import { readFileSync } from 'fs';
import type { ReplayFixtureEvent } from './contract-types.js';

export function loadReplayFixture(url: URL): ReplayFixtureEvent[] {
  const raw = readFileSync(url, 'utf8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const events = lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid JSON in fixture ${url.pathname} at line ${index + 1}: ${(error as Error).message}`
      );
    }
    return parsed as ReplayFixtureEvent;
  });

  for (const [index, event] of events.entries()) {
    if (!event || typeof event !== 'object') {
      throw new Error(`Fixture event must be an object at line ${index + 1}`);
    }
    if (typeof event.atMs !== 'number' || event.atMs < 0) {
      throw new Error(`Fixture event must include non-negative atMs at line ${index + 1}`);
    }
    if (typeof event.type !== 'string') {
      throw new Error(`Fixture event must include type at line ${index + 1}`);
    }
  }

  return [...events].sort((a, b) => a.atMs - b.atMs);
}
