import { describe, test, expect } from 'bun:test';
import {
  buildHandoffPacket,
  formatVoiceContext,
  formatActiveProcesses,
  type VoiceContextEntry,
  type HandoffPacket,
} from '../src/context/handoff.js';
import type { ManagedProcess } from '../src/processes/manager.js';

describe('buildHandoffPacket', () => {
  test('creates packet with correct structure', () => {
    const context: VoiceContextEntry[] = [
      { role: 'user', content: 'Fix the auth bug', timestamp: 1000 },
      { role: 'assistant', content: 'I will look into it', timestamp: 2000 },
    ];

    const packet = buildHandoffPacket({
      request: 'Fix the auth endpoint',
      voiceContext: context,
      activeProcesses: [],
      sessionId: 'voice-123',
      profile: 'marvin',
    });

    expect(packet.id).toBeTruthy();
    expect(packet.timestamp).toBeGreaterThan(0);
    expect(packet.request).toBe('Fix the auth endpoint');
    expect(packet.voiceContext).toHaveLength(2);
    expect(packet.activeProcesses).toHaveLength(0);
    expect(packet.source.sessionId).toBe('voice-123');
    expect(packet.source.profile).toBe('marvin');
  });

  test('caps voice context at 20 entries', () => {
    const context: VoiceContextEntry[] = Array.from({ length: 30 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}`,
      timestamp: i * 1000,
    }));

    const packet = buildHandoffPacket({
      request: 'test',
      voiceContext: context,
      activeProcesses: [],
      sessionId: 'voice-123',
      profile: 'marvin',
    });

    expect(packet.voiceContext).toHaveLength(20);
    // Should keep the last 20 (indices 10-29)
    expect(packet.voiceContext[0]!.content).toBe('Message 10');
    expect(packet.voiceContext[19]!.content).toBe('Message 29');
  });

  test('maps active processes to summaries', () => {
    const processes: ManagedProcess[] = [
      {
        name: 'swift-fox',
        sessionId: 'sess-1',
        type: 'headless',
        status: 'running',
        startedAt: Date.now(),
      },
      {
        name: 'calm-owl',
        sessionId: 'sess-2',
        type: 'headless',
        status: 'finished',
        startedAt: Date.now() - 60000,
        result: 'Done reviewing code',
      },
    ];

    const packet = buildHandoffPacket({
      request: 'test',
      voiceContext: [],
      activeProcesses: processes,
      sessionId: 'voice-123',
      profile: 'marvin',
    });

    expect(packet.activeProcesses).toHaveLength(2);
    expect(packet.activeProcesses[0]!.name).toBe('swift-fox');
    expect(packet.activeProcesses[0]!.status).toBe('running');
    expect(packet.activeProcesses[1]!.name).toBe('calm-owl');
    expect(packet.activeProcesses[1]!.status).toBe('finished');
    expect(packet.activeProcesses[1]!.result).toBe('Done reviewing code');
  });
});

describe('formatVoiceContext', () => {
  test('returns placeholder for empty context', () => {
    const packet: HandoffPacket = {
      id: 'hp-1',
      timestamp: Date.now(),
      request: 'test',
      voiceContext: [],
      activeProcesses: [],
      source: { sessionId: 'v-1', profile: 'marvin' },
    };

    expect(formatVoiceContext(packet)).toBe('(direct request, no voice context)');
  });

  test('formats user and assistant entries', () => {
    const packet: HandoffPacket = {
      id: 'hp-1',
      timestamp: Date.now(),
      request: 'test',
      voiceContext: [
        { role: 'user', content: 'Fix the auth bug in kireon', timestamp: 1000 },
        { role: 'assistant', content: 'I will start a session for that', timestamp: 2000 },
      ],
      activeProcesses: [],
      source: { sessionId: 'v-1', profile: 'marvin' },
    };

    const result = formatVoiceContext(packet);
    expect(result).toBe(
      '[user] Fix the auth bug in kireon\n[assistant] I will start a session for that'
    );
  });

  test('formats tool entries with tool info', () => {
    const packet: HandoffPacket = {
      id: 'hp-1',
      timestamp: Date.now(),
      request: 'test',
      voiceContext: [
        {
          role: 'system',
          content: 'developer_session called',
          timestamp: 1000,
          toolInfo: { name: 'developer_session', result: 'Started session swift-fox' },
        },
      ],
      activeProcesses: [],
      source: { sessionId: 'v-1', profile: 'marvin' },
    };

    const result = formatVoiceContext(packet);
    expect(result).toBe('[tool:developer_session] Started session swift-fox');
  });
});

describe('formatActiveProcesses', () => {
  test('returns None for empty processes', () => {
    const packet: HandoffPacket = {
      id: 'hp-1',
      timestamp: Date.now(),
      request: 'test',
      voiceContext: [],
      activeProcesses: [],
      source: { sessionId: 'v-1', profile: 'marvin' },
    };

    expect(formatActiveProcesses(packet)).toBe('None');
  });

  test('formats running and finished processes', () => {
    const packet: HandoffPacket = {
      id: 'hp-1',
      timestamp: Date.now(),
      request: 'test',
      voiceContext: [],
      activeProcesses: [
        { name: 'swift-fox', status: 'running', goal: 'swift-fox', startedAt: Date.now() },
        { name: 'calm-owl', status: 'finished', goal: 'calm-owl', startedAt: Date.now(), result: 'Code reviewed OK' },
      ],
      source: { sessionId: 'v-1', profile: 'marvin' },
    };

    const result = formatActiveProcesses(packet);
    expect(result).toContain('swift-fox (running)');
    expect(result).toContain('calm-owl (finished)');
    expect(result).toContain('Code reviewed OK');
  });
});
