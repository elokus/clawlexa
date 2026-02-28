import { describe, expect, test } from 'bun:test';
import {
  DeepgramTtsConnectionManager,
  toDeepgramLiveError,
} from '../src/adapters/tts/deepgram-streaming.js';

describe('DeepgramTtsConnectionManager', () => {
  test('enqueueRequest serializes work in FIFO order', async () => {
    const manager = new DeepgramTtsConnectionManager();
    const order: string[] = [];

    const first = manager.enqueueRequest(async () => {
      order.push('first:start');
      await Bun.sleep(20);
      order.push('first:end');
      return 'first';
    });

    const second = manager.enqueueRequest(async () => {
      order.push('second:start');
      order.push('second:end');
      return 'second';
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe('first');
    expect(secondResult).toBe('second');
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  test('resetQueue allows new requests to bypass a blocked queue chain', async () => {
    const manager = new DeepgramTtsConnectionManager();
    let releaseBlocked: (() => void) | null = null;

    const blocked = manager.enqueueRequest(
      () =>
        new Promise<string>((resolve) => {
          releaseBlocked = () => resolve('blocked');
        })
    );

    manager.resetQueue();
    const fast = manager.enqueueRequest(async () => 'fast');
    const fastResult = await fast;
    expect(fastResult).toBe('fast');

    expect(releaseBlocked).not.toBeNull();
    releaseBlocked?.();
    expect(await blocked).toBe('blocked');
  });
});

describe('toDeepgramLiveError', () => {
  test('extracts message and code when available', () => {
    const error = toDeepgramLiveError(
      { message: 'no credits', code: '402' },
      'fallback message'
    );
    expect(error.message).toContain('no credits');
    expect(error.message).toContain('402');
  });

  test('returns fallback when payload is unknown', () => {
    const error = toDeepgramLiveError(42, 'fallback message');
    expect(error.message).toBe('fallback message');
  });
});
