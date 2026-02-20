/**
 * Convert a real recorded voice session (.voiceclaw/.sessions/*.jsonl) into a provider-contract fixture.
 *
 * Usage:
 * - bun run src/scratch-contract-fixture.ts <session-id>
 * - bun run src/scratch-contract-fixture.ts <session-id> <output-fixture.jsonl>
 * - bun run src/scratch-contract-fixture.ts <session-id> --case-id=<contract_case_id>
 * - bun run src/scratch-contract-fixture.ts .voiceclaw/.sessions/<file>.jsonl --case-id=live_multiturn_ultravox
 */

import fs from 'fs';
import path from 'path';

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface SessionLogEntry {
  type?: string;
  timestamp?: string;
  [key: string]: unknown;
}

type ReplayFixtureEvent =
  | {
      atMs: number;
      type: 'state';
      state: VoiceState;
    }
  | {
      atMs: number;
      type: 'turn_started' | 'turn_complete' | 'audio_interrupted';
    }
  | {
      atMs: number;
      type: 'assistant_item' | 'user_item';
      itemId: string;
      previousItemId?: string;
    }
  | {
      atMs: number;
      type: 'transcript_delta' | 'transcript_final';
      role: 'user' | 'assistant';
      text: string;
      itemId?: string;
    }
  | {
      atMs: number;
      type: 'tool_start';
      name: string;
      callId: string;
      args?: Record<string, unknown>;
    }
  | {
      atMs: number;
      type: 'tool_end';
      name: string;
      callId: string;
      result: string;
    };

interface ParsedArgs {
  input: string;
  outPath?: string;
  caseId?: string;
}

const VALID_STATES = new Set<VoiceState>(['idle', 'listening', 'thinking', 'speaking']);

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let caseId: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--case-id=')) {
      caseId = arg.slice('--case-id='.length).trim() || undefined;
      continue;
    }
    positional.push(arg);
  }

  const input = positional[0]?.trim();
  if (!input) {
    throw new Error(
      'Missing input. Usage: bun run src/scratch-contract-fixture.ts <session-id|log-file> [output-file] [--case-id=<id>]'
    );
  }

  const outPath = positional[1]?.trim() || undefined;
  return { input, outPath, caseId };
}

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  return path.basename(cwd) === 'voice-agent' ? path.resolve(cwd, '..', '..') : cwd;
}

function parseJsonl(filePath: string): SessionLogEntry[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as SessionLogEntry;
      } catch (error) {
        throw new Error(`Invalid JSON at ${filePath}:${index + 1}: ${(error as Error).message}`);
      }
    });
}

function findSessionLogById(sessionId: string, sessionsDir: string): string {
  if (!fs.existsSync(sessionsDir)) {
    throw new Error(`Sessions directory not found: ${sessionsDir}`);
  }

  const candidates = fs
    .readdirSync(sessionsDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(sessionsDir, name));

  for (const filePath of candidates) {
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    let first: SessionLogEntry;
    try {
      first = JSON.parse(lines[0] ?? '{}') as SessionLogEntry;
    } catch {
      continue;
    }

    if (first.type === 'session' && first.id === sessionId) {
      return filePath;
    }
  }

  const shortPrefix = sessionId.slice(0, 12);
  const byPrefix = candidates.find((filePath) =>
    path.basename(filePath).startsWith(shortPrefix)
  );
  if (byPrefix) {
    return byPrefix;
  }

  throw new Error(`Could not find .voiceclaw/.sessions log for session id: ${sessionId}`);
}

function resolveInputLogPath(input: string, repoRoot: string): string {
  const direct = path.resolve(process.cwd(), input);
  if (fs.existsSync(direct)) return direct;

  const sessionsDir = path.join(repoRoot, '.voiceclaw', '.sessions');
  return findSessionLogById(input, sessionsDir);
}

function toAtMs(isoTimestamp: string, baseMs: number): number {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed - baseMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toResultText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildFixture(entries: SessionLogEntry[]): ReplayFixtureEvent[] {
  const timedEntries = entries.filter(
    (entry) => typeof entry.timestamp === 'string' && entry.type !== 'session'
  );
  if (timedEntries.length === 0) {
    throw new Error('No timestamped stream events found in session log');
  }

  const baseMs = Date.parse((timedEntries[0]?.timestamp as string) ?? '');
  if (!Number.isFinite(baseMs)) {
    throw new Error('Unable to parse first event timestamp');
  }

  const fixture: ReplayFixtureEvent[] = [];
  const assistantOrder: string[] = [];
  const assistantTextByItem = new Map<string, string>();
  const finalizedAssistantItems = new Set<string>();

  const ensureAssistantItem = (itemId: string): void => {
    if (!assistantTextByItem.has(itemId)) {
      assistantTextByItem.set(itemId, '');
      assistantOrder.push(itemId);
    }
  };

  const appendAssistantText = (itemId: string, delta: string): void => {
    ensureAssistantItem(itemId);
    assistantTextByItem.set(itemId, (assistantTextByItem.get(itemId) ?? '') + delta);
  };

  const emitPendingAssistantFinals = (atMs: number): void => {
    for (const itemId of assistantOrder) {
      if (finalizedAssistantItems.has(itemId)) continue;
      const text = (assistantTextByItem.get(itemId) ?? '').trim();
      if (!text) continue;
      fixture.push({
        atMs,
        type: 'transcript_final',
        role: 'assistant',
        text,
        itemId,
      });
      finalizedAssistantItems.add(itemId);
    }
  };

  for (const entry of timedEntries) {
    const eventType = typeof entry.type === 'string' ? entry.type : '';
    const timestamp = entry.timestamp as string;
    const atMs = toAtMs(timestamp, baseMs);

    switch (eventType) {
      case 'state-change': {
        const state = entry.state;
        if (typeof state === 'string' && VALID_STATES.has(state as VoiceState)) {
          fixture.push({
            atMs,
            type: 'state',
            state: state as VoiceState,
          });
        }
        break;
      }
      case 'start-step': {
        fixture.push({ atMs, type: 'turn_started' });
        break;
      }
      case 'finish': {
        emitPendingAssistantFinals(atMs);
        fixture.push({ atMs, type: 'turn_complete' });
        break;
      }
      case 'audio_interrupted': {
        fixture.push({ atMs, type: 'audio_interrupted' });
        break;
      }
      case 'assistant-placeholder': {
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : undefined;
        if (!itemId) break;
        const previousItemId =
          typeof entry.previousItemId === 'string' ? entry.previousItemId : undefined;
        ensureAssistantItem(itemId);
        fixture.push({
          atMs,
          type: 'assistant_item',
          itemId,
          ...(previousItemId ? { previousItemId } : {}),
        });
        break;
      }
      case 'user-placeholder': {
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : undefined;
        if (!itemId) break;
        const previousItemId =
          typeof entry.previousItemId === 'string' ? entry.previousItemId : undefined;
        fixture.push({
          atMs,
          type: 'user_item',
          itemId,
          ...(previousItemId ? { previousItemId } : {}),
        });
        break;
      }
      case 'text-delta': {
        const text = typeof entry.textDelta === 'string' ? entry.textDelta : '';
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : undefined;
        const role = entry.role === 'user' ? 'user' : 'assistant';
        fixture.push({
          atMs,
          type: 'transcript_delta',
          role,
          text,
          ...(itemId ? { itemId } : {}),
        });
        if (role === 'assistant' && itemId) {
          appendAssistantText(itemId, text);
        }
        break;
      }
      case 'user-transcript': {
        const text = typeof entry.text === 'string' ? entry.text : '';
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : undefined;
        fixture.push({
          atMs,
          type: 'transcript_final',
          role: 'user',
          text,
          ...(itemId ? { itemId } : {}),
        });
        break;
      }
      case 'transcript': {
        const text = typeof entry.text === 'string' ? entry.text : '';
        const role = entry.role === 'user' ? 'user' : 'assistant';
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : undefined;
        fixture.push({
          atMs,
          type: 'transcript_final',
          role,
          text,
          ...(itemId ? { itemId } : {}),
        });
        if (role === 'assistant' && itemId) {
          ensureAssistantItem(itemId);
          assistantTextByItem.set(itemId, text);
          finalizedAssistantItems.add(itemId);
        }
        break;
      }
      case 'tool-call': {
        const name = typeof entry.toolName === 'string' ? entry.toolName : 'tool';
        const callId = typeof entry.toolCallId === 'string' ? entry.toolCallId : `tool-${atMs}`;
        const args = isRecord(entry.input) ? entry.input : undefined;
        fixture.push({
          atMs,
          type: 'tool_start',
          name,
          callId,
          ...(args ? { args } : {}),
        });
        break;
      }
      case 'tool-result': {
        const name = typeof entry.toolName === 'string' ? entry.toolName : 'tool';
        const callId = typeof entry.toolCallId === 'string' ? entry.toolCallId : `tool-${atMs}`;
        const result = toResultText(entry.output);
        fixture.push({
          atMs,
          type: 'tool_end',
          name,
          callId,
          result,
        });
        break;
      }
      default:
        break;
    }
  }

  if (fixture.length === 0) {
    throw new Error('No fixture events could be generated from session log');
  }

  // Ensure no assistant text is dropped if the session ended without a finish event.
  const lastAtMs = fixture[fixture.length - 1]?.atMs ?? 0;
  emitPendingAssistantFinals(lastAtMs);

  return fixture.sort((a, b) => a.atMs - b.atMs);
}

function defaultOutputPath(repoRoot: string, inputLogPath: string): string {
  const baseName = path.basename(inputLogPath, '.jsonl');
  return path.join(
    repoRoot,
    'packages',
    'voice-runtime',
    'tests',
    'contracts',
    'fixtures',
    `${baseName}-live-multiturn.jsonl`
  );
}

function summarizeFixture(events: ReplayFixtureEvent[]): {
  turnStarted: number;
  turnComplete: number;
  toolStarts: number;
  toolEnds: number;
  assistantFinals: string[];
} {
  const assistantFinals: string[] = [];
  let turnStarted = 0;
  let turnComplete = 0;
  let toolStarts = 0;
  let toolEnds = 0;

  for (const event of events) {
    if (event.type === 'turn_started') turnStarted += 1;
    if (event.type === 'turn_complete') turnComplete += 1;
    if (event.type === 'tool_start') toolStarts += 1;
    if (event.type === 'tool_end') toolEnds += 1;
    if (event.type === 'transcript_final' && event.role === 'assistant') {
      assistantFinals.push(event.text);
    }
  }

  return { turnStarted, turnComplete, toolStarts, toolEnds, assistantFinals };
}

function writeFixture(outPath: string, events: ReplayFixtureEvent[]): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = events.map((event) => JSON.stringify(event));
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
}

function printCaseStub(caseId: string, fixtureFileName: string, summary: ReturnType<typeof summarizeFixture>): void {
  const assistantFinalsJson = JSON.stringify(summary.assistantFinals, null, 2)
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  console.log('\nCase stub:');
  console.log('{');
  console.log(`  id: '${caseId}',`);
  console.log(`  fixtureFile: '${fixtureFileName}',`);
  console.log('  expected: {');
  console.log(`    turnStarted: ${summary.turnStarted},`);
  console.log(`    turnComplete: ${summary.turnComplete},`);
  console.log(`    toolStarts: ${summary.toolStarts},`);
  console.log(`    toolEnds: ${summary.toolEnds},`);
  console.log('    assistantFinals:');
  console.log(assistantFinalsJson);
  console.log('  },');
  console.log('  thresholds: RELAXED_BENCH_THRESHOLDS,');
  console.log('  timeoutMs: 2_000,');
  console.log('},');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const inputLogPath = resolveInputLogPath(args.input, repoRoot);
  const events = buildFixture(parseJsonl(inputLogPath));

  const outputPath = args.outPath
    ? path.resolve(process.cwd(), args.outPath)
    : defaultOutputPath(repoRoot, inputLogPath);
  writeFixture(outputPath, events);

  const summary = summarizeFixture(events);
  console.log(`[contract-fixture] input=${inputLogPath}`);
  console.log(`[contract-fixture] output=${outputPath}`);
  console.log(
    `[contract-fixture] events=${events.length} turns=${summary.turnStarted}/${summary.turnComplete} tools=${summary.toolStarts}/${summary.toolEnds}`
  );

  if (args.caseId) {
    printCaseStub(args.caseId, path.basename(outputPath), summary);
  }
}

main().catch((error) => {
  console.error('[contract-fixture] failed:', error);
  process.exit(1);
});
