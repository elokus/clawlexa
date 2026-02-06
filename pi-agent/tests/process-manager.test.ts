import { describe, expect, test, beforeEach } from 'bun:test';
import { ProcessManager, type ManagedProcess } from '../src/processes/manager.js';

describe('ProcessManager', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager();
  });

  test('spawn returns ManagedProcess immediately', () => {
    const proc = pm.spawn({
      name: 'swift-falcon',
      sessionId: 'sess-1',
      type: 'headless',
      execute: () => new Promise((resolve) => setTimeout(() => resolve('done'), 100)),
    });

    expect(proc.id).toBe('sess-1');
    expect(proc.name).toBe('swift-falcon');
    expect(proc.status).toBe('running');
    expect(proc.startedAt).toBeGreaterThan(0);
  });

  test('emits process:completed on success', async () => {
    const completed = new Promise<ManagedProcess>((resolve) => {
      pm.on('process:completed', resolve);
    });

    pm.spawn({
      name: 'iron-spark',
      sessionId: 'sess-2',
      type: 'headless',
      execute: async () => 'all good',
    });

    const result = await completed;
    expect(result.status).toBe('finished');
    expect(result.result).toBe('all good');
    expect(result.finishedAt).toBeGreaterThan(0);
  });

  test('emits process:error on failure', async () => {
    const errored = new Promise<ManagedProcess>((resolve) => {
      pm.on('process:error', resolve);
    });

    pm.spawn({
      name: 'amber-drone',
      sessionId: 'sess-3',
      type: 'interactive',
      execute: async () => {
        throw new Error('boom');
      },
    });

    const result = await errored;
    expect(result.status).toBe('error');
    expect(result.error).toBe('boom');
    expect(result.finishedAt).toBeGreaterThan(0);
  });

  test('getRunning filters correctly', async () => {
    const completed = new Promise<void>((resolve) => {
      pm.on('process:completed', resolve);
    });

    // One that resolves quickly
    pm.spawn({
      name: 'fast-one',
      sessionId: 'sess-fast',
      type: 'headless',
      execute: async () => 'fast',
    });

    // One that takes longer
    pm.spawn({
      name: 'slow-one',
      sessionId: 'sess-slow',
      type: 'headless',
      execute: () => new Promise((resolve) => setTimeout(() => resolve('slow'), 200)),
    });

    // Wait for the fast one to complete
    await completed;

    const running = pm.getRunning();
    expect(running.length).toBe(1);
    expect(running[0].name).toBe('slow-one');
  });

  test('getSummary returns formatted string', async () => {
    const completed = new Promise<void>((resolve) => {
      pm.on('process:completed', resolve);
    });

    pm.spawn({
      name: 'task-a',
      sessionId: 'sess-a',
      type: 'headless',
      execute: async () => 'ok',
    });

    pm.spawn({
      name: 'task-b',
      sessionId: 'sess-b',
      type: 'headless',
      execute: () => new Promise((resolve) => setTimeout(() => resolve('ok'), 200)),
    });

    // Wait for task-a to complete
    await completed;

    const summary = pm.getSummary();
    expect(summary).toContain('1 running');
    expect(summary).toContain('1 completed');
  });

  test('getByName finds process', () => {
    pm.spawn({
      name: 'unique-name',
      sessionId: 'sess-u',
      type: 'headless',
      execute: () => new Promise((resolve) => setTimeout(() => resolve('ok'), 500)),
    });

    const found = pm.getByName('unique-name');
    expect(found).toBeDefined();
    expect(found!.sessionId).toBe('sess-u');

    const notFound = pm.getByName('nonexistent');
    expect(notFound).toBeUndefined();
  });

  test('getBySessionId finds process', () => {
    pm.spawn({
      name: 'by-id-test',
      sessionId: 'sess-id-1',
      type: 'web_search',
      execute: () => new Promise((resolve) => setTimeout(() => resolve('ok'), 500)),
    });

    const found = pm.getBySessionId('sess-id-1');
    expect(found).toBeDefined();
    expect(found!.name).toBe('by-id-test');
  });

  test('cancel marks process as error', () => {
    pm.spawn({
      name: 'cancel-me',
      sessionId: 'sess-cancel',
      type: 'headless',
      execute: () => new Promise((resolve) => setTimeout(() => resolve('ok'), 5000)),
    });

    const cancelled = pm.cancel('cancel-me');
    expect(cancelled).toBe(true);

    const proc = pm.getByName('cancel-me');
    expect(proc!.status).toBe('error');
    expect(proc!.error).toBe('Cancelled by user');

    // Cancelling again returns false
    expect(pm.cancel('cancel-me')).toBe(false);
  });
});
