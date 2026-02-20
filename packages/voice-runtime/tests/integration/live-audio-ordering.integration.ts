import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'bun:test';
import { GeminiLiveAdapter } from '../../src/adapters/gemini-live-adapter.js';
import { OpenAISdkAdapter } from '../../src/adapters/openai-sdk-adapter.js';
import { UltravoxWsAdapter } from '../../src/adapters/ultravox-ws-adapter.js';
import { parseProviderConfig } from '../../src/provider-config.js';
import { VoiceSessionImpl } from '../../src/runtime/voice-session.js';
import type {
  AudioFrame,
  ProviderAdapter,
  SessionInput,
  ToolCallHandler,
  ToolCallResult,
  ToolDefinition,
} from '../../src/types.js';

type LiveProviderId = 'openai-sdk' | 'gemini-live' | 'ultravox-ws';

type TimelineKind =
  | 'turn_started'
  | 'turn_complete'
  | 'assistant_delta'
  | 'user_item'
  | 'user_final'
  | 'assistant_final'
  | 'tool_start'
  | 'tool_end'
  | 'error';

interface TimelineEvent {
  index: number;
  kind: TimelineKind;
  role?: 'user' | 'assistant';
  text?: string;
  itemId?: string;
  order?: number;
  name?: string;
  callId?: string;
  args?: Record<string, unknown>;
}

interface TurnExpectations {
  tool_call: boolean;
  tool_name?: string;
  tool_args_contains?: string;
}

interface TurnManifestEntry {
  id: string;
  file_raw: string;
  transcript: string;
  expects: TurnExpectations;
}

interface TurnManifest {
  turns: TurnManifestEntry[];
}

interface ToolEvent {
  index: number;
  name: string;
  callId: string;
  args?: Record<string, unknown>;
  result?: string;
}

interface LiveRunResult {
  timeline: TimelineEvent[];
  userFinals: string[];
  assistantFinals: string[];
  assistantTexts: string[];
  toolStarts: ToolEvent[];
  toolEnds: ToolEvent[];
  errors: string[];
}

const LIVE_TEST_ENABLED = process.env.VOICE_RUNTIME_LIVE_ORDERING === 'true';
const REPEATS = parsePositiveInt(process.env.VOICE_RUNTIME_LIVE_REPEATS, 2);
const CHUNK_MS = parsePositiveInt(process.env.VOICE_RUNTIME_LIVE_CHUNK_MS, 40);
const TURN_TIMEOUT_MS = parsePositiveInt(process.env.VOICE_RUNTIME_LIVE_TURN_TIMEOUT_MS, 40_000);
const TEST_TIMEOUT_MS = parsePositiveInt(process.env.VOICE_RUNTIME_LIVE_TEST_TIMEOUT_MS, 240_000);
const USER_TRANSCRIPT_MATCH_MIN = parseFloatOrDefault(
  process.env.VOICE_RUNTIME_LIVE_USER_MATCH_MIN,
  0.45
);

const DATA_DIR = resolve(import.meta.dir, '../../data/test');
const TURNS_MANIFEST_PATH = resolve(DATA_DIR, 'turns.json');

const DEFAULT_PROVIDERS: LiveProviderId[] = ['openai-sdk', 'gemini-live', 'ultravox-ws'];
const REQUESTED_PROVIDERS = parseProviderList(process.env.VOICE_RUNTIME_LIVE_PROVIDERS);
const LIVE_PROVIDERS = REQUESTED_PROVIDERS.length > 0 ? REQUESTED_PROVIDERS : DEFAULT_PROVIDERS;

const LIVE_INSTRUCTIONS = [
  'Du bist ein deutschsprachiger Sprachassistent.',
  'Antworte nur auf Deutsch.',
  'Wenn der Nutzer um Stehlampe einschalten bittet, rufe toggle_light auf.',
  'Nach dem Tool-Ergebnis bestätige kurz, dass die Stehlampe eingeschaltet wurde.',
].join(' ');

const TEST_TOOLS: ToolDefinition[] = [
  {
    name: 'toggle_light',
    description: 'Turn a named light on or off.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Light name, e.g. Stehlampe' },
        state: { type: 'string', enum: ['on', 'off'], description: 'Desired target state' },
      },
      required: ['name', 'state'],
    },
  },
];

const describeLive = LIVE_TEST_ENABLED ? describe : describe.skip;

describeLive('live audio ordering integration (major iteration)', () => {
  const turns = loadTurnManifest();
  const runnableProviders = LIVE_PROVIDERS.filter((providerId) => providerPreflight(providerId).ready);

  test('provider preflight has at least one runnable provider', () => {
    if (runnableProviders.length > 0) return;
    const details = LIVE_PROVIDERS
      .map((providerId) => `${providerId}: ${providerPreflight(providerId).reason ?? 'unknown'}`)
      .join('; ');
    throw new Error(
      `No runnable live provider configured. Set provider env vars. Preflight: ${details}`
    );
  });

  for (const providerId of LIVE_PROVIDERS) {
    const preflight = providerPreflight(providerId);
    const testName = `${providerId} streams data/test audio and preserves semantic ordering`;

    if (!preflight.ready) {
      test.skip(`${testName} (skipped: ${preflight.reason})`, () => {});
      continue;
    }

    test(
      testName,
      async () => {
        const runPatterns: string[] = [];

        for (let iteration = 0; iteration < REPEATS; iteration += 1) {
          const run = await runLiveConversation(providerId, turns);
          assertLiveRun(providerId, turns, run);
          runPatterns.push(extractSemanticOrderingPattern(turns, run));
        }

        const baseline = runPatterns[0];
        for (const pattern of runPatterns.slice(1)) {
          expect(pattern).toBe(baseline);
        }
      },
      TEST_TIMEOUT_MS
    );
  }
});

function providerPreflight(providerId: LiveProviderId): { ready: boolean; reason?: string } {
  if (providerId === 'openai-sdk') {
    if (!process.env.OPENAI_API_KEY) {
      return { ready: false, reason: 'OPENAI_API_KEY missing' };
    }
    return { ready: true };
  }

  if (providerId === 'gemini-live') {
    if (!resolveGeminiApiKey()) {
      return { ready: false, reason: 'GEMINI_API_KEY or GOOGLE_API_KEY missing' };
    }
    return { ready: true };
  }

  if (providerId === 'ultravox-ws') {
    if (!process.env.ULTRAVOX_API_KEY) {
      return { ready: false, reason: 'ULTRAVOX_API_KEY missing' };
    }
    return { ready: true };
  }

  return { ready: false, reason: `Unsupported provider: ${providerId}` };
}

async function runLiveConversation(
  providerId: LiveProviderId,
  turns: TurnManifestEntry[]
): Promise<LiveRunResult> {
  const timeline: TimelineEvent[] = [];
  const userFinals: string[] = [];
  const assistantFinals: string[] = [];
  const toolStarts: ToolEvent[] = [];
  const toolEnds: ToolEvent[] = [];
  const errors: string[] = [];
  const assistantDeltaByItem = new Map<string, string>();
  const assistantDeltaItemOrder: string[] = [];
  let unscopedAssistantDelta = '';
  let assistantSignalCount = 0;
  let timelineIndex = 0;

  const toolHandler: ToolCallHandler = async (name, args, context) => {
    if (name !== 'toggle_light') {
      const unsupported: ToolCallResult = {
        invocationId: context.invocationId,
        result: JSON.stringify({ error: true, message: `Unsupported tool ${name}` }),
        isError: true,
      };
      return unsupported;
    }

    const desiredState = inferLightState(args);
    const lightName = inferLightName(args) ?? 'Stehlampe';
    return {
      invocationId: context.invocationId,
      result: JSON.stringify({
        success: true,
        name: lightName,
        state: desiredState,
      }),
    };
  };

  const setup = buildProviderSession(providerId, toolHandler);
  const session = new VoiceSessionImpl(setup.adapter, setup.input);

  const push = (event: Omit<TimelineEvent, 'index'>) => {
    timeline.push({ ...event, index: timelineIndex++ });
  };

  session.on('turnStarted', () => {
    push({ kind: 'turn_started' });
  });

  session.on('turnComplete', () => {
    push({ kind: 'turn_complete' });
  });

  session.on('userItemCreated', (itemId, order) => {
    push({ kind: 'user_item', role: 'user', itemId, order });
  });

  session.on('transcript', (text, role, itemId, order) => {
    if (role === 'user') {
      userFinals.push(text);
      push({ kind: 'user_final', role, text, itemId, order });
      return;
    }
    assistantSignalCount += 1;
    assistantFinals.push(text);
    push({ kind: 'assistant_final', role, text, itemId, order });
  });

  session.on('transcriptDelta', (delta, role, itemId, order) => {
    if (role !== 'assistant') return;
    assistantSignalCount += 1;
    push({ kind: 'assistant_delta', role, text: delta, itemId, order });
    if (itemId) {
      if (!assistantDeltaItemOrder.includes(itemId)) {
        assistantDeltaItemOrder.push(itemId);
      }
      const previous = assistantDeltaByItem.get(itemId) ?? '';
      assistantDeltaByItem.set(itemId, previous + delta);
      return;
    }
    unscopedAssistantDelta += delta;
  });

  session.on('toolStart', (name, args, callId) => {
    const event: ToolEvent = {
      index: timelineIndex,
      name,
      callId,
      args,
    };
    toolStarts.push(event);
    push({ kind: 'tool_start', name, callId, args });
  });

  session.on('toolEnd', (name, result, callId) => {
    const event: ToolEvent = {
      index: timelineIndex,
      name,
      callId,
      result,
    };
    toolEnds.push(event);
    push({ kind: 'tool_end', name, callId, text: result });
  });

  session.on('error', (error) => {
    const message = error.message || String(error);
    errors.push(message);
    push({ kind: 'error', text: message });
  });

  await session.connect();
  try {
    for (const [turnIndex, turn] of turns.entries()) {
      const beforeUserFinals = userFinals.length;
      const beforeAssistantSignals = assistantSignalCount;
      const beforeToolStarts = toolStarts.length;
      const beforeToolEnds = toolEnds.length;

      const audio = loadTurnAudio(turn.file_raw);
      await sendAudioRealtime(session, audio, 16_000, CHUNK_MS);
      await sendSilence(session, 16_000, 700, CHUNK_MS);

      await waitFor(
        `user transcript for ${turn.id}`,
        () => userFinals.length >= beforeUserFinals + 1,
        TURN_TIMEOUT_MS
      );

      if (turn.expects.tool_call) {
        await waitFor(
          `tool lifecycle for ${turn.id}`,
          () => toolStarts.length >= beforeToolStarts + 1 && toolEnds.length >= beforeToolEnds + 1,
          TURN_TIMEOUT_MS
        );

        const latestToolEndIndex = findIndex(
          timeline,
          (entry) => entry.kind === 'tool_end',
          0
        );
        await waitFor(
          `assistant response after tool completion for ${turn.id}`,
          () =>
            findIndex(
              timeline,
              (entry) => entry.kind === 'assistant_final' || entry.kind === 'assistant_delta',
              latestToolEndIndex + 1
            ) >= 0,
          TURN_TIMEOUT_MS
        );
      } else {
        await waitFor(
          `assistant response for ${turn.id}`,
          () => assistantSignalCount >= beforeAssistantSignals + 1,
          TURN_TIMEOUT_MS
        );
      }

      const adaptivePauseMs = turnIndex < turns.length - 1 ? 800 : 0;
      if (adaptivePauseMs > 0) {
        await Bun.sleep(adaptivePauseMs);
      }
    }
  } finally {
    await session.close();
  }

  const assistantTexts = assistantFinals.length > 0
    ? [...assistantFinals]
    : [
        ...assistantDeltaItemOrder
          .map((itemId) => assistantDeltaByItem.get(itemId)?.trim() ?? '')
          .filter((text) => text.length > 0),
        ...(unscopedAssistantDelta.trim() ? [unscopedAssistantDelta.trim()] : []),
      ];

  return {
    timeline,
    userFinals,
    assistantFinals,
    assistantTexts,
    toolStarts,
    toolEnds,
    errors,
  };
}

function assertLiveRun(providerId: LiveProviderId, turns: TurnManifestEntry[], run: LiveRunResult): void {
  expect(run.errors).toHaveLength(0);
  expect(run.userFinals.length).toBeGreaterThanOrEqual(turns.length);
  expect(run.assistantTexts.length).toBeGreaterThan(0);

  assertUserTranscriptsMatchInOrder(turns, run.userFinals, USER_TRANSCRIPT_MATCH_MIN);

  const thirdTurn = turns[2];
  if (!thirdTurn) {
    throw new Error('turns.json must include at least three turns');
  }
  if (!thirdTurn.expects.tool_call) {
    throw new Error('turn-3 expects.tool_call must be true');
  }

  const expectedToolName = thirdTurn.expects.tool_name ?? 'toggle_light';
  expect(run.userFinals.some((text) => containsLampSemantic(text))).toBe(true);

  const startsForTool = run.toolStarts.filter((entry) => entry.name === expectedToolName);
  const endsForTool = run.toolEnds.filter((entry) => entry.name === expectedToolName);
  expect(startsForTool).toHaveLength(1);
  expect(endsForTool).toHaveLength(1);

  const toolArgsBlob = JSON.stringify(startsForTool[0]?.args ?? {}).toLowerCase();
  const expectedToolArg = (thirdTurn.expects.tool_args_contains ?? 'stehlampe').toLowerCase();
  expect(toolArgsBlob.includes(expectedToolArg) || containsLampSemantic(toolArgsBlob)).toBe(true);

  const userLampIndex = findIndex(
    run.timeline,
    (entry) => entry.kind === 'user_final' && containsLampSemantic(entry.text ?? '')
  );
  expect(userLampIndex).toBeGreaterThanOrEqual(0);

  const toolStart = startsForTool[0]!;
  const toolStartIndex = findIndex(
    run.timeline,
    (entry) =>
      entry.kind === 'tool_start' &&
      entry.name === expectedToolName &&
      entry.callId === toolStart.callId
  );
  expect(toolStartIndex).toBeGreaterThanOrEqual(0);

  const toolEndIndex = findIndex(
    run.timeline,
    (entry) =>
      entry.kind === 'tool_end' &&
      entry.name === expectedToolName &&
      entry.callId === toolStart.callId,
    toolStartIndex + 1
  );
  expect(toolEndIndex).toBeGreaterThan(toolStartIndex);

  const assistantLampIndex = findIndex(
    run.timeline,
    (entry) => entry.kind === 'assistant_final' || entry.kind === 'assistant_delta',
    toolEndIndex + 1
  );
  expect(assistantLampIndex).toBeGreaterThan(toolEndIndex);

  const orderingPattern = extractSemanticOrderingPattern(turns, run);
  expect(orderingPattern).toBe('user_stehlampe>tool_start_toggle_light>tool_end_toggle_light>assistant_response');

  // Keep provider in failure output so major-iteration reports are actionable.
  expect(providerId.length).toBeGreaterThan(0);
}

function assertUserTranscriptsMatchInOrder(
  turns: TurnManifestEntry[],
  userFinals: string[],
  minimumRatio: number
): void {
  let cursor = 0;
  for (const turn of turns) {
    let matchedIndex = -1;
    let matchedRatio = 0;

    for (let index = cursor; index < userFinals.length; index += 1) {
      const candidate = userFinals[index] ?? '';
      const ratio = tokenMatchRatio(turn.transcript, candidate);
      if (ratio >= minimumRatio) {
        matchedIndex = index;
        matchedRatio = ratio;
        break;
      }
      if (ratio > matchedRatio) {
        matchedRatio = ratio;
      }
    }

    if (matchedIndex < 0) {
      throw new Error(
        `Could not match expected user transcript for ${turn.id}. ` +
          `bestRatio=${matchedRatio.toFixed(2)} min=${minimumRatio.toFixed(2)} ` +
          `expected="${turn.transcript}" userFinals=${JSON.stringify(userFinals)}`
      );
    }

    cursor = matchedIndex + 1;
  }
}

function extractSemanticOrderingPattern(
  turns: TurnManifestEntry[],
  run: LiveRunResult
): string {
  const thirdTurn = turns[2];
  if (!thirdTurn) return '';
  const expectedToolName = thirdTurn.expects.tool_name ?? 'toggle_light';

  const userLampIndex = findIndex(
    run.timeline,
    (entry) => entry.kind === 'user_final' && containsLampSemantic(entry.text ?? '')
  );
  if (userLampIndex < 0) return '';

  const toolStart = run.toolStarts.find((entry) => entry.name === expectedToolName);
  if (!toolStart) return '';

  const toolStartIndex = findIndex(
    run.timeline,
    (entry) =>
      entry.kind === 'tool_start' &&
      entry.name === expectedToolName &&
      entry.callId === toolStart.callId
  );
  if (toolStartIndex < 0) return '';

  const toolEndIndex = findIndex(
    run.timeline,
    (entry) =>
      entry.kind === 'tool_end' &&
      entry.name === expectedToolName &&
      entry.callId === toolStart.callId,
    toolStartIndex + 1
  );
  if (toolEndIndex < 0) return '';

  const assistantLampIndex = findIndex(
    run.timeline,
    (entry) => entry.kind === 'assistant_final' || entry.kind === 'assistant_delta',
    toolEndIndex + 1
  );
  if (assistantLampIndex < 0) return '';

  return 'user_stehlampe>tool_start_toggle_light>tool_end_toggle_light>assistant_response';
}

function loadTurnManifest(): TurnManifestEntry[] {
  if (!existsSync(TURNS_MANIFEST_PATH)) {
    throw new Error(`Missing turns manifest: ${TURNS_MANIFEST_PATH}`);
  }
  const raw = readFileSync(TURNS_MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw) as TurnManifest;
  if (!Array.isArray(parsed.turns) || parsed.turns.length < 3) {
    throw new Error('turns.json must include at least three turns');
  }
  return parsed.turns;
}

function loadTurnAudio(fileRaw: string): Buffer {
  const filePath = resolve(DATA_DIR, fileRaw);
  if (!existsSync(filePath)) {
    throw new Error(`Missing turn audio: ${filePath}`);
  }
  return readFileSync(filePath);
}

function buildProviderSession(
  providerId: LiveProviderId,
  toolHandler: ToolCallHandler
): {
  adapter: ProviderAdapter;
  input: SessionInput;
} {
  if (providerId === 'openai-sdk') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY missing');
    }

    return {
      adapter: new OpenAISdkAdapter(),
      input: {
        provider: 'openai-sdk',
        instructions: LIVE_INSTRUCTIONS,
        voice: process.env.OPENAI_VOICE ?? 'echo',
        model: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-mini-realtime-preview',
        language: 'de',
        tools: TEST_TOOLS,
        toolHandler,
        vad: {
          mode: 'semantic',
        },
        providerConfig: parseProviderConfig('openai-sdk', {
          apiKey,
          turnDetection: 'semantic_vad',
          transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
          language: 'de',
        }),
      },
    };
  }

  if (providerId === 'gemini-live') {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY missing');
    }

    return {
      adapter: new GeminiLiveAdapter(),
      input: {
        provider: 'gemini-live',
        instructions: LIVE_INSTRUCTIONS,
        voice: process.env.GEMINI_VOICE ?? 'Puck',
        model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-native-audio-latest',
        language: 'de',
        tools: TEST_TOOLS,
        toolHandler,
        vad: {
          mode: 'manual',
          silenceDurationMs: 450,
          threshold: 0.002,
        },
        providerConfig: parseProviderConfig('gemini-live', {
          apiKey,
          apiVersion: process.env.GEMINI_API_VERSION ?? 'v1beta',
          enableInputTranscription: true,
          enableOutputTranscription: true,
          vadMode: 'manual',
          noInterruption: false,
        }),
      },
    };
  }

  if (providerId === 'ultravox-ws') {
    const apiKey = process.env.ULTRAVOX_API_KEY;
    if (!apiKey) {
      throw new Error('ULTRAVOX_API_KEY missing');
    }

    return {
      adapter: new UltravoxWsAdapter(),
      input: {
        provider: 'ultravox-ws',
        instructions: LIVE_INSTRUCTIONS,
        voice: process.env.ULTRAVOX_VOICE ?? 'Mark',
        model: process.env.ULTRAVOX_MODEL ?? 'fixie-ai/ultravox-70B',
        language: 'de',
        tools: TEST_TOOLS,
        toolHandler,
        providerConfig: parseProviderConfig('ultravox-ws', {
          apiKey,
          model: process.env.ULTRAVOX_MODEL ?? 'fixie-ai/ultravox-70B',
          voice: process.env.ULTRAVOX_VOICE ?? 'Mark',
        }),
      },
    };
  }

  throw new Error(`Unsupported provider: ${providerId}`);
}

async function sendAudioRealtime(
  session: VoiceSessionImpl,
  rawAudio: Buffer,
  sampleRate: number,
  chunkMs: number
): Promise<void> {
  const bytesPerChunk = Math.max(1, Math.round((sampleRate * 2 * chunkMs) / 1000));
  for (let offset = 0; offset < rawAudio.length; offset += bytesPerChunk) {
    const chunk = rawAudio.subarray(offset, Math.min(offset + bytesPerChunk, rawAudio.length));
    const frame: AudioFrame = {
      data: chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      ) as ArrayBuffer,
      sampleRate,
      format: 'pcm16',
    };
    session.sendAudio(frame);
    await Bun.sleep(chunkMs);
  }
}

async function sendSilence(
  session: VoiceSessionImpl,
  sampleRate: number,
  durationMs: number,
  chunkMs: number
): Promise<void> {
  const bytesPerChunk = Math.max(1, Math.round((sampleRate * 2 * chunkMs) / 1000));
  const totalBytes = Math.max(2, Math.round((sampleRate * 2 * durationMs) / 1000));
  const silence = Buffer.alloc(totalBytes);
  for (let offset = 0; offset < silence.length; offset += bytesPerChunk) {
    const chunk = silence.subarray(offset, Math.min(offset + bytesPerChunk, silence.length));
    const frame: AudioFrame = {
      data: chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      ) as ArrayBuffer,
      sampleRate,
      format: 'pcm16',
    };
    session.sendAudio(frame);
    await Bun.sleep(chunkMs);
  }
}

async function waitFor(
  label: string,
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(80);
  }
  throw new Error(`Timeout waiting for ${label} (${timeoutMs}ms)`);
}

function findIndex(
  entries: TimelineEvent[],
  predicate: (entry: TimelineEvent) => boolean,
  fromIndex = 0
): number {
  for (let index = Math.max(0, fromIndex); index < entries.length; index += 1) {
    if (predicate(entries[index]!)) return index;
  }
  return -1;
}

function parseProviderList(raw: string | undefined): LiveProviderId[] {
  if (!raw) return [];
  const values = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const allowed = new Set<LiveProviderId>(DEFAULT_PROVIDERS);
  const providers: LiveProviderId[] = [];
  for (const value of values) {
    if (!allowed.has(value as LiveProviderId)) {
      throw new Error(
        `Unsupported provider in VOICE_RUNTIME_LIVE_PROVIDERS: ${value}. ` +
          `Allowed: ${[...allowed].join(', ')}`
      );
    }
    providers.push(value as LiveProviderId);
  }
  return providers;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseFloatOrDefault(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function tokenMatchRatio(expected: string, actual: string): number {
  const expectedTokens = normalizeTokens(expected);
  const actualSet = new Set(normalizeTokens(actual));
  if (expectedTokens.length === 0) return 1;
  let hits = 0;
  for (const token of expectedTokens) {
    if (actualSet.has(token)) hits += 1;
  }
  return hits / expectedTokens.length;
}

function containsLampSemantic(text: string): boolean {
  const value = text.toLowerCase();
  return (
    value.includes('stehlampe') ||
    value.includes('lampe') ||
    value.includes('floor lamp') ||
    value.includes('floor-lamp')
  );
}

function inferLightState(args: Record<string, unknown>): 'on' | 'off' {
  const flattened = JSON.stringify(args).toLowerCase();
  if (flattened.includes('off') || flattened.includes('aus')) return 'off';
  return 'on';
}

function inferLightName(args: Record<string, unknown>): string | null {
  const candidates = [
    args.name,
    args.device_name,
    args.device,
    args.light,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function resolveGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}
