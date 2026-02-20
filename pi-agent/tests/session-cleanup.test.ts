import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../src/db/schema.js';
import { CliSessionsRepository } from '../src/db/repositories/cli-sessions.js';
import { HandoffsRepository } from '../src/db/repositories/handoffs.js';
import type { HandoffPacket } from '../src/context/handoff.js';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

function buildPacket(sourceSessionId: string, request = 'test handoff'): HandoffPacket {
  return {
    id: `handoff-${Math.random().toString(16).slice(2, 10)}`,
    timestamp: Date.now(),
    request,
    voiceContext: [],
    activeProcesses: [],
    source: {
      sessionId: sourceSessionId,
      profile: 'marvin',
    },
  };
}

describe('session cleanup with handoffs', () => {
  test('delete(sessionId) removes handoff references automatically', () => {
    const db = createTestDb();
    const sessionsRepo = new CliSessionsRepository(db);
    const handoffsRepo = new HandoffsRepository(db);

    const voice = sessionsRepo.createVoice({
      id: 'voice-1',
      profile: 'marvin',
      goal: 'Voice root',
    });
    const subagent = sessionsRepo.createSubagent({
      id: 'subagent-1',
      goal: 'Do task',
      agent_name: 'cli',
      model: 'gpt-4o-mini',
      parent_id: voice.id,
    });

    handoffsRepo.save(buildPacket(voice.id), subagent.id);

    expect(sessionsRepo.delete(voice.id)).toBe(true);
    expect(handoffsRepo.findBySourceSession(voice.id)).toHaveLength(0);

    db.close();
  });

  test('deleteAll() removes sessions and handoff packets in one call', () => {
    const db = createTestDb();
    const sessionsRepo = new CliSessionsRepository(db);
    const handoffsRepo = new HandoffsRepository(db);

    const voice = sessionsRepo.createVoice({
      id: 'voice-2',
      profile: 'jarvis',
      goal: 'Voice root',
    });
    const subagent = sessionsRepo.createSubagent({
      id: 'subagent-2',
      goal: 'Do task',
      agent_name: 'cli',
      model: 'gpt-4o-mini',
      parent_id: voice.id,
    });

    handoffsRepo.save(buildPacket(voice.id), subagent.id);

    expect(sessionsRepo.deleteAll()).toBe(2);
    expect(handoffsRepo.deleteAll()).toBe(0);
    expect(sessionsRepo.list()).toHaveLength(0);

    db.close();
  });

  test('deleteTree() removes root and descendants only', () => {
    const db = createTestDb();
    const sessionsRepo = new CliSessionsRepository(db);

    const voiceA = sessionsRepo.createVoice({
      id: 'voice-a',
      profile: 'marvin',
      goal: 'Tree A',
    });
    const subagentA = sessionsRepo.createSubagent({
      id: 'subagent-a',
      goal: 'Task A',
      agent_name: 'cli',
      model: 'gpt-4o-mini',
      parent_id: voiceA.id,
    });
    const terminalA = sessionsRepo.createTerminal({
      id: 'terminal-a',
      goal: 'Terminal A',
      parent_id: subagentA.id,
    });

    const voiceB = sessionsRepo.createVoice({
      id: 'voice-b',
      profile: 'jarvis',
      goal: 'Tree B',
    });

    expect(sessionsRepo.getTreeSessionIds(voiceA.id)).toEqual([
      voiceA.id,
      subagentA.id,
      terminalA.id,
    ]);

    const deletedIds = sessionsRepo.deleteTree(voiceA.id);
    expect(new Set(deletedIds)).toEqual(new Set([voiceA.id, subagentA.id, terminalA.id]));
    expect(sessionsRepo.findById(voiceA.id)).toBeNull();
    expect(sessionsRepo.findById(subagentA.id)).toBeNull();
    expect(sessionsRepo.findById(terminalA.id)).toBeNull();
    expect(sessionsRepo.findById(voiceB.id)).not.toBeNull();

    db.close();
  });
});
