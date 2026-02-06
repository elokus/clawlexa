import { describe, test, expect } from 'bun:test';
import { generateSessionName, resolveSessionName } from '../src/utils/session-names';

describe('generateSessionName', () => {
  test('generates adjective-noun format', () => {
    const name = generateSessionName(new Set());
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  test('avoids collisions', () => {
    const existing = new Set(['swift-falcon']);
    const name = generateSessionName(existing);
    expect(name).not.toBe('swift-falcon');
  });

  test('generates unique names', () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(generateSessionName(names));
    }
    expect(names.size).toBe(100);
  });
});

describe('resolveSessionName', () => {
  const sessions = [
    { name: 'swift-falcon', id: '1' },
    { name: 'iron-prism', id: '2' },
    { name: 'amber-beacon', id: '3' },
  ];

  test('exact match', () => {
    expect(resolveSessionName('swift-falcon', sessions)).toEqual({ name: 'swift-falcon', id: '1' });
  });

  test('normalized match (spaces to dashes)', () => {
    expect(resolveSessionName('Swift Falcon', sessions)).toEqual({ name: 'swift-falcon', id: '1' });
  });

  test('partial match (single word)', () => {
    expect(resolveSessionName('falcon', sessions)).toEqual({ name: 'swift-falcon', id: '1' });
  });

  test('fuzzy match', () => {
    expect(resolveSessionName('swift-falkon', sessions)).toEqual({ name: 'swift-falcon', id: '1' });
  });

  test('returns null for no match', () => {
    expect(resolveSessionName('unknown-thing', sessions)).toBeNull();
  });
});
