// 100 adjectives x 100 nouns = 10,000 unique combinations
const ADJECTIVES = ['swift', 'iron', 'amber', 'blue', 'quiet', 'bright', 'bold', 'calm', 'dark', 'deep',
  'eager', 'fair', 'gold', 'green', 'keen', 'light', 'lunar', 'noble', 'prime', 'rapid',
  'sharp', 'silver', 'solar', 'stark', 'steel', 'stone', 'warm', 'wild', 'wise', 'vivid',
  'arctic', 'astral', 'binary', 'blazing', 'carbon', 'chrome', 'cipher', 'cobalt', 'coral', 'cosmic',
  'crimson', 'crystal', 'cyber', 'delta', 'digital', 'drift', 'dusk', 'echo', 'ember', 'flux',
  'forge', 'frost', 'gamma', 'ghost', 'glass', 'granite', 'haze', 'helix', 'hollow', 'hyper',
  'jade', 'laser', 'lava', 'mist', 'neon', 'nova', 'onyx', 'orbit', 'oxide', 'pale',
  'phantom', 'plasma', 'polar', 'pulse', 'quartz', 'raven', 'ruby', 'rust', 'sable', 'sage',
  'scarlet', 'shadow', 'silent', 'slate', 'smoke', 'sonic', 'spark', 'spectrum', 'storm', 'terra',
  'thunder', 'titan', 'ultra', 'vapor', 'velvet', 'vertex', 'violet', 'volt', 'zero', 'zinc'];

const NOUNS = ['falcon', 'drone', 'spark', 'beacon', 'circuit', 'prism', 'matrix', 'forge', 'nexus', 'pulse',
  'arrow', 'atlas', 'blade', 'bolt', 'bridge', 'cache', 'claw', 'comet', 'core', 'crown',
  'cube', 'dagger', 'dawn', 'flame', 'flare', 'gate', 'glyph', 'grid', 'hawk', 'helix',
  'horn', 'lance', 'lens', 'link', 'lotus', 'lynx', 'mesa', 'mirror', 'node', 'orbit',
  'peak', 'pike', 'pixel', 'plume', 'probe', 'quasar', 'rail', 'ramp', 'reef', 'ridge',
  'ring', 'rover', 'rune', 'saber', 'scale', 'scope', 'shard', 'shell', 'shield', 'shore',
  'sigma', 'skull', 'slate', 'spear', 'sphere', 'spike', 'spine', 'stone', 'surge', 'sword',
  'thorn', 'tide', 'tower', 'trail', 'vault', 'veil', 'viper', 'wave', 'weave', 'wing',
  'anvil', 'badge', 'bison', 'cedar', 'chain', 'cliff', 'crane', 'drift', 'eagle', 'frost',
  'grove', 'hound', 'ivory', 'jewel', 'knot', 'latch', 'marsh', 'otter', 'pine', 'quill'];

export function generateSessionName(existingNames: Set<string>): string {
  // Try random combo, append -2, -3 on collision
  for (let attempt = 0; attempt < 100; attempt++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const name = `${adj}-${noun}`;
    if (!existingNames.has(name)) return name;
  }
  // Fallback: append number
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  let suffix = 2;
  while (existingNames.has(`${adj}-${noun}-${suffix}`)) suffix++;
  return `${adj}-${noun}-${suffix}`;
}

export function resolveSessionName(
  spoken: string,
  sessions: Array<{ name: string; id: string }>
): { id: string; name: string } | null {
  const normalized = spoken.toLowerCase().trim().replace(/\s+/g, '-');

  // 1. Exact match
  const exact = sessions.find(s => s.name === normalized);
  if (exact) return exact;

  // 2. Partial match (spoken is substring)
  const partial = sessions.filter(s => s.name.includes(normalized) || normalized.includes(s.name));
  if (partial.length === 1 && partial[0]) return partial[0];

  // 3. Word match (any word in name matches)
  const words = normalized.split('-');
  const wordMatch = sessions.filter(s => words.some(w => s.name.includes(w)));
  if (wordMatch.length === 1 && wordMatch[0]) return wordMatch[0];

  // 4. Fuzzy (Levenshtein distance <= 2)
  const fuzzy = sessions
    .map(s => ({ ...s, distance: levenshtein(normalized, s.name) }))
    .filter(s => s.distance <= 2)
    .sort((a, b) => a.distance - b.distance);
  const best = fuzzy[0];
  if (best) return { id: best.id, name: best.name };

  return null;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[a.length]![b.length]!;
}
