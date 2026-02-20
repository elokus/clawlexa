#!/usr/bin/env bun
/**
 * Gemini setup preflight checks.
 *
 * Verifies that common setup payload variants are accepted by Gemini Live
 * before running full voice-agent end-to-end tests.
 *
 * Usage:
 *   bun packages/voice-runtime/scratch/gemini-setup-preflight.ts
 */

import { GeminiLiveAdapter } from '../src/adapters/gemini-live-adapter.js';
import type { SessionInput, ToolDefinition } from '../src/types.js';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error('Set GEMINI_API_KEY');

const MODEL = process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-latest';

interface Case {
  name: string;
  input: SessionInput;
}

const DIRTY_SCHEMA_TOOL: ToolDefinition = {
  name: 'toggle_light',
  description: 'Turn a light on or off',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    properties: {
      name: {
        type: ['string', 'null'],
      },
      state: {
        type: 'string',
        enum: ['on', 'off'],
      },
    },
    required: ['name', 'state'],
  },
};

const BASE_INPUT: SessionInput = {
  provider: 'gemini-live',
  model: MODEL,
  voice: 'Aoede',
  instructions: 'You are a concise assistant.',
  providerConfig: {
    apiKey: API_KEY,
    enableInputTranscription: true,
    enableOutputTranscription: true,
  },
};

const CASES: Case[] = [
  {
    name: 'manual-vad baseline',
    input: {
      ...BASE_INPUT,
      vad: { mode: 'manual' },
    },
  },
  {
    name: 'server-vad baseline',
    input: {
      ...BASE_INPUT,
      vad: { mode: 'server' },
    },
  },
  {
    name: 'dirty tool schema sanitization',
    input: {
      ...BASE_INPUT,
      vad: { mode: 'manual' },
      tools: [DIRTY_SCHEMA_TOOL],
    },
  },
  {
    name: 'provider flags compatibility',
    input: {
      ...BASE_INPUT,
      providerConfig: {
        ...(BASE_INPUT.providerConfig ?? {}),
        contextWindowCompressionTokens: 10_000,
        proactivity: true,
      },
      vad: { mode: 'manual' },
    },
  },
];

async function runCase(testCase: Case): Promise<{ ok: boolean; error?: string; durationMs: number }> {
  const startedAt = Date.now();
  const adapter = new GeminiLiveAdapter();

  try {
    await adapter.connect(testCase.input);
    await adapter.disconnect();
    return { ok: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function main() {
  console.log(`Running ${CASES.length} Gemini setup preflight case(s) with model=${MODEL}\n`);

  let failures = 0;

  for (const testCase of CASES) {
    process.stdout.write(`- ${testCase.name} ... `);
    const result = await runCase(testCase);

    if (result.ok) {
      console.log(`PASS (${result.durationMs}ms)`);
    } else {
      failures += 1;
      console.log(`FAIL (${result.durationMs}ms)`);
      console.log(`  ${result.error}`);
    }
  }

  console.log(`\nCompleted: ${CASES.length - failures} passed, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

void main();
