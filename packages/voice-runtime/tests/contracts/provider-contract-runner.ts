import { VoiceBenchmarkRecorder } from '../../src/benchmarks/voice-benchmark.js';
import { VoiceSessionImpl } from '../../src/runtime/voice-session.js';
import type { VoiceProviderId } from '../../src/types.js';
import { loadReplayFixture } from './fixture-loader.js';
import {
  ReplayFixtureAdapter,
  replayCapabilitiesForProvider,
} from './replay-fixture-adapter.js';
import type {
  ProviderContractCase,
  ProviderContractResult,
  ProviderContractTimelineEntry,
} from './contract-types.js';

function fixtureUrl(fileName: string): URL {
  return new URL(`./fixtures/${fileName}`, import.meta.url);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 5
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Contract case timeout after ${timeoutMs}ms`);
}

export async function runProviderContractCase(
  providerId: VoiceProviderId,
  contractCase: ProviderContractCase
): Promise<ProviderContractResult> {
  const capabilities = replayCapabilitiesForProvider(providerId);
  if (contractCase.requirements?.toolCalling && !capabilities.toolCalling) {
    return {
      providerId,
      skipped: true,
      skipReason: 'Provider does not support toolCalling',
      turnStarted: 0,
      turnComplete: 0,
      toolStarts: 0,
      toolEnds: 0,
      assistantFinals: [],
      timeline: [],
      benchmarkPass: true,
      benchmarkViolations: [],
    };
  }

  const fixture = loadReplayFixture(fixtureUrl(contractCase.fixtureFile));
  const adapter = new ReplayFixtureAdapter({
    providerId,
    fixture,
    capabilities,
  });
  const session = new VoiceSessionImpl(adapter, {
    provider: providerId,
    instructions: 'Contract replay test',
    voice: 'echo',
    model: 'contract-test-model',
  });

  const recorder = new VoiceBenchmarkRecorder();
  const timeline: ProviderContractTimelineEntry[] = [];
  let timelineIndex = 0;
  let turnStarted = 0;
  let turnComplete = 0;
  let toolStarts = 0;
  let toolEnds = 0;
  const assistantFinals: string[] = [];
  const assistantDeltaByItem = new Map<string, string>();
  const assistantItemOrder: string[] = [];

  session.on('turnStarted', () => {
    turnStarted += 1;
    recorder.markTurnStarted();
    timeline.push({
      index: timelineIndex++,
      kind: 'turn_started',
    });
  });

  session.on('turnComplete', () => {
    turnComplete += 1;
    timeline.push({
      index: timelineIndex++,
      kind: 'turn_complete',
    });
  });

  session.on('assistantItemCreated', (itemId) => {
    recorder.recordAssistantItem(itemId);
    if (!assistantItemOrder.includes(itemId)) {
      assistantItemOrder.push(itemId);
    }
    timeline.push({
      index: timelineIndex++,
      kind: 'assistant_item',
      itemId,
    });
  });

  session.on('userItemCreated', (itemId) => {
    timeline.push({
      index: timelineIndex++,
      kind: 'user_item',
      itemId,
    });
  });

  session.on('transcriptDelta', (delta, role, itemId) => {
    recorder.recordTranscript('delta', delta, role, itemId);
    if (role === 'assistant' && itemId) {
      const previous = assistantDeltaByItem.get(itemId) ?? '';
      assistantDeltaByItem.set(itemId, previous + delta);
    }
    timeline.push({
      index: timelineIndex++,
      kind: role === 'assistant' ? 'assistant_delta' : 'user_delta',
      itemId,
      text: delta,
    });
  });

  session.on('transcript', (text, role, itemId) => {
    recorder.recordTranscript('final', text, role, itemId);
    timeline.push({
      index: timelineIndex++,
      kind: role === 'assistant' ? 'assistant_final' : 'user_final',
      itemId,
      text,
    });
    if (role === 'assistant') {
      assistantFinals.push(text);
      if (itemId) {
        assistantDeltaByItem.set(itemId, text);
      }
    }
  });

  session.on('audio', (frame) => {
    recorder.recordAudio(frame);
  });

  session.on('toolStart', (_name, _args, callId) => {
    toolStarts += 1;
    timeline.push({
      index: timelineIndex++,
      kind: 'tool_start',
      callId,
    });
  });

  session.on('toolEnd', (_name, _result, callId) => {
    toolEnds += 1;
    timeline.push({
      index: timelineIndex++,
      kind: 'tool_end',
      callId,
    });
  });

  await session.connect();

  await waitFor(
    () =>
      turnComplete >= contractCase.expected.turnComplete &&
      toolEnds >= contractCase.expected.toolEnds,
    contractCase.timeoutMs ?? 800
  );

  const assistantOutputs = assistantFinals.length > 0
    ? assistantFinals
    : assistantItemOrder
        .map((itemId) => assistantDeltaByItem.get(itemId)?.trim())
        .filter((text): text is string => Boolean(text && text.length > 0));

  const benchmark = recorder.evaluate(contractCase.thresholds);
  await session.close();

  return {
    providerId,
    skipped: false,
    turnStarted,
    turnComplete,
    toolStarts,
    toolEnds,
    assistantFinals: assistantOutputs,
    timeline,
    benchmarkPass: benchmark.pass,
    benchmarkViolations: benchmark.violations,
  };
}
