import { describe, expect, test } from 'bun:test';
import type { VoiceProviderId } from '../src/types.js';
import { PROVIDER_CONTRACT_CASES } from './contracts/contract-cases.js';
import { runProviderContractCase } from './contracts/provider-contract-runner.js';
import type { ProviderContractResult } from './contracts/contract-types.js';

const PROVIDERS: VoiceProviderId[] = [
  'openai-sdk',
  'ultravox-ws',
  'gemini-live',
  'pipecat-rtvi',
  'decomposed',
];

function assertAssistantOrdering(result: ProviderContractResult): void {
  const assistantCreatedIndex = new Map<string, number>();
  for (const event of result.timeline) {
    if (event.kind === 'assistant_item' && event.itemId) {
      assistantCreatedIndex.set(event.itemId, event.index);
      continue;
    }

    if (
      (event.kind === 'assistant_delta' || event.kind === 'assistant_final') &&
      event.itemId
    ) {
      expect(assistantCreatedIndex.has(event.itemId)).toBe(true);
      const createdIndex = assistantCreatedIndex.get(event.itemId);
      expect(typeof createdIndex).toBe('number');
      if (typeof createdIndex === 'number') {
        expect(event.index).toBeGreaterThan(createdIndex);
      }
    }
  }
}

function assertToolOrdering(result: ProviderContractResult): void {
  const startIndexByCallId = new Map<string, number>();
  for (const event of result.timeline) {
    if (event.kind === 'tool_start' && event.callId) {
      startIndexByCallId.set(event.callId, event.index);
      continue;
    }

    if (event.kind === 'tool_end' && event.callId) {
      expect(startIndexByCallId.has(event.callId)).toBe(true);
      const startIndex = startIndexByCallId.get(event.callId);
      expect(typeof startIndex).toBe('number');
      if (typeof startIndex === 'number') {
        expect(event.index).toBeGreaterThan(startIndex);
      }
    }
  }
}

for (const providerId of PROVIDERS) {
  describe(`provider contract replay (${providerId})`, () => {
    for (const contractCase of PROVIDER_CONTRACT_CASES) {
      test(contractCase.id, async () => {
        const result = await runProviderContractCase(providerId, contractCase);
        if (result.skipped) {
          expect(result.skipReason).toBeDefined();
          return;
        }

        expect(result.turnStarted).toBe(contractCase.expected.turnStarted);
        expect(result.turnComplete).toBe(contractCase.expected.turnComplete);
        expect(result.turnComplete).toBeLessThanOrEqual(result.turnStarted);

        expect(result.toolStarts).toBe(contractCase.expected.toolStarts);
        expect(result.toolEnds).toBe(contractCase.expected.toolEnds);

        expect(result.assistantFinals).toEqual(contractCase.expected.assistantFinals);

        assertAssistantOrdering(result);
        assertToolOrdering(result);

        expect(result.benchmarkPass).toBe(true);
        expect(result.benchmarkViolations).toHaveLength(0);
      });
    }
  });
}
