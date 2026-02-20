import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { config } from '../src/config.js';

describe('smoke tests', () => {
  test('config loads with correct structure', () => {
    expect(config).toHaveProperty('openai');
    expect(config).toHaveProperty('audio');
    expect(config).toHaveProperty('agent');
    expect(config.audio.sampleRate).toBe(24000);
    expect(config.agent.conversationTimeout).toBe(60_000);
  });

  test('bun:sqlite works', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    db.query('INSERT INTO test (value) VALUES (?)').run('hello');
    const row = db.query('SELECT value FROM test WHERE id = 1').get() as any;
    expect(row.value).toBe('hello');
    db.close();
  });
});
