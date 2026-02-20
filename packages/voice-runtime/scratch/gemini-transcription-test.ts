#!/usr/bin/env bun
/**
 * Gemini Transcription / VAD test harness.
 *
 * Runs single-turn or multi-turn recorded audio tests and compares
 * transcript quality between auto and manual VAD modes.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';

type VadMode = 'auto' | 'manual';

interface TurnMeta {
  id: string;
  file_raw: string;
  transcript: string;
  purpose: string;
}

interface TurnsManifest {
  description: string;
  language: string;
  turns: TurnMeta[];
}

interface TestConfig {
  description: string;
  inputTranscription: boolean;
  outputTranscription: boolean;
  responseModalities: string[];
  vadMode: VadMode;
  multiTurn: boolean;
  sendAudioStreamEnd: boolean;
}

interface TurnResult {
  expectedTranscript: string;
  inputTranscript: string;
  outputTranscript: string;
  interruptions: number;
  turnCompleteCount: number;
  generationCompleteCount: number;
}

const DATA_DIR = resolve(import.meta.dir, '..', 'data', 'test');
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error('Set GEMINI_API_KEY');

const test = process.argv[2] || 'multi-manual';
const modelArg = getArg('--model') || 'gemini-2.5-flash-native-audio-latest';
const chunkMs = Number.parseInt(getArg('--chunk-ms') || '20', 10);
const pace = Number.parseFloat(getArg('--pace') || '1.0');

if (!Number.isFinite(chunkMs) || chunkMs < 10 || chunkMs > 1000) {
  throw new Error(`Invalid --chunk-ms: ${chunkMs} (expected 10..1000)`);
}
if (!Number.isFinite(pace) || pace <= 0 || pace > 4) {
  throw new Error(`Invalid --pace: ${pace} (expected >0 and <=4)`);
}

const TESTS: Record<string, TestConfig> = {
  'with-transcription': {
    description: 'Single turn, auto VAD, input/output transcription enabled',
    inputTranscription: true,
    outputTranscription: true,
    responseModalities: ['AUDIO'],
    vadMode: 'auto',
    multiTurn: false,
    sendAudioStreamEnd: true,
  },
  'manual-vad': {
    description: 'Single turn, manual VAD, input/output transcription enabled',
    inputTranscription: true,
    outputTranscription: true,
    responseModalities: ['AUDIO'],
    vadMode: 'manual',
    multiTurn: false,
    sendAudioStreamEnd: false,
  },
  'no-transcription': {
    description: 'Single turn, auto VAD, transcription disabled',
    inputTranscription: false,
    outputTranscription: false,
    responseModalities: ['AUDIO'],
    vadMode: 'auto',
    multiTurn: false,
    sendAudioStreamEnd: true,
  },
  'text-response': {
    description: 'Single turn, text modality request (known to fail on native-audio models)',
    inputTranscription: true,
    outputTranscription: false,
    responseModalities: ['TEXT'],
    vadMode: 'auto',
    multiTurn: false,
    sendAudioStreamEnd: true,
  },
  'multi-auto': {
    description: 'Multi-turn (turn-1..3), auto VAD, input/output transcription enabled',
    inputTranscription: true,
    outputTranscription: true,
    responseModalities: ['AUDIO'],
    vadMode: 'auto',
    multiTurn: true,
    sendAudioStreamEnd: true,
  },
  'multi-manual': {
    description: 'Multi-turn (turn-1..3), manual VAD, input/output transcription enabled',
    inputTranscription: true,
    outputTranscription: true,
    responseModalities: ['AUDIO'],
    vadMode: 'manual',
    multiTurn: true,
    sendAudioStreamEnd: false,
  },
};

const config = TESTS[test];
if (!config) {
  console.log(`Usage: bun gemini-transcription-test.ts <test> [options]

Tests: ${Object.keys(TESTS).join(', ')}

Options:
  --model <id>      Model ID (default: gemini-2.5-flash-native-audio-latest)
  --chunk-ms <ms>   Chunk size in ms (default: 20)
  --pace <x>        Pacing multiplier (1.0 = realtime, default: 1.0)

${Object.entries(TESTS).map(([k, v]) => `  ${k.padEnd(20)} ${v.description}`).join('\n')}`);
  process.exit(0);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

function loadManifest(): TurnsManifest {
  const path = resolve(DATA_DIR, 'turns.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as TurnsManifest;
}

function mergeTranscript(previous: string, nextChunk: string): string {
  if (!previous) return nextChunk;
  if (nextChunk.startsWith(previous)) return nextChunk;
  if (previous.endsWith(nextChunk)) return previous;
  return `${previous}${nextChunk}`;
}

function normalizeForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function tokenMatchRatio(expected: string, actual: string): number {
  const expectedTokens = normalizeForMatch(expected);
  const actualTokenSet = new Set(normalizeForMatch(actual));
  if (expectedTokens.length === 0) return 1;
  let hits = 0;
  for (const token of expectedTokens) {
    if (actualTokenSet.has(token)) hits += 1;
  }
  return hits / expectedTokens.length;
}

async function run() {
  const WebSocket = (await import('ws')).default;
  const endpoint =
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const ws = new WebSocket(`${endpoint}?key=${API_KEY}`);
  const t0 = Date.now();
  const el = () => `[${(Date.now() - t0).toString().padStart(6)}ms]`;

  const manifest = loadManifest();
  const turns = config.multiTurn ? manifest.turns : [manifest.turns[0]!];
  let currentTurnIndex = -1;

  const turnResults = new Map<string, TurnResult>(
    turns.map((turn) => [
      turn.id,
      {
        expectedTranscript: turn.transcript,
        inputTranscript: '',
        outputTranscript: '',
        interruptions: 0,
        turnCompleteCount: 0,
        generationCompleteCount: 0,
      },
    ])
  );

  let resolveTurnCompletion: (() => void) | null = null;
  let turnCompletionSettled = false;

  function waitForTurnCompletion(): Promise<void> {
    return new Promise((resolve) => {
      turnCompletionSettled = false;
      resolveTurnCompletion = () => {
        if (turnCompletionSettled) return;
        turnCompletionSettled = true;
        resolve();
      };
    });
  }

  function settleTurnCompletion() {
    if (!resolveTurnCompletion) return;
    const resolve = resolveTurnCompletion;
    resolveTurnCompletion = null;
    resolve();
  }

  console.log(`\n══ Test: ${test} ══`);
  console.log(`   ${config.description}`);
  console.log(`   model=${modelArg} vad=${config.vadMode} chunkMs=${chunkMs} pace=${pace} turns=${turns.length}\n`);

  ws.on('open', () => {
    console.log(`${el()} Connected`);

    const setupObj: Record<string, unknown> = {
      model: modelArg.startsWith('models/') ? modelArg : `models/${modelArg}`,
      generationConfig: {
        responseModalities: config.responseModalities,
        temperature: 0.8,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
        },
      },
      systemInstruction: {
        parts: [
          {
            text:
              manifest.language === 'de'
                ? 'Du bist ein hilfreicher Assistent. Antworte kurz und auf Deutsch.'
                : 'You are a helpful assistant. Keep responses brief.',
          },
        ],
      },
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: config.vadMode === 'manual' },
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
      },
    };

    if (config.inputTranscription) setupObj.inputAudioTranscription = {};
    if (config.outputTranscription) setupObj.outputAudioTranscription = {};

    ws.send(JSON.stringify({ setup: setupObj }));
    console.log(`${el()} Setup sent`);
  });

  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());

    if (msg.setupComplete) {
      console.log(`${el()} Setup complete`);
      void (async () => {
        for (let i = 0; i < turns.length; i += 1) {
          const turn = turns[i]!;
          currentTurnIndex = i;

          console.log(`${el()} [${turn.id}] Sending ${turn.file_raw}`);
          const audio = readFileSync(resolve(DATA_DIR, turn.file_raw));
          const CHUNK_BYTES = (16000 * 2 * chunkMs) / 1000;

          if (config.vadMode === 'manual') {
            ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
            console.log(`${el()} [${turn.id}] activityStart`);
          }

          for (let j = 0; j < audio.length; j += CHUNK_BYTES) {
            const chunk = audio.subarray(j, Math.min(j + CHUNK_BYTES, audio.length));
            ws.send(
              JSON.stringify({
                realtimeInput: {
                  audio: {
                    data: chunk.toString('base64'),
                    mimeType: 'audio/pcm;rate=16000',
                  },
                },
              })
            );
            await Bun.sleep(chunkMs * pace);
          }

          if (config.vadMode === 'manual') {
            ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
            console.log(`${el()} [${turn.id}] activityEnd`);
          } else if (config.sendAudioStreamEnd) {
            ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
            console.log(`${el()} [${turn.id}] audioStreamEnd`);
          }

          await waitForTurnCompletion();
          console.log(`${el()} [${turn.id}] turn settled`);
          await Bun.sleep(300);
        }

        await Bun.sleep(1500);
        ws.close();
      })();
      return;
    }

    if (msg.serverContent) {
      const turn = turns[Math.max(0, currentTurnIndex)]!;
      const result = turnResults.get(turn.id);
      const sc = msg.serverContent;

      if (result && sc.inputTranscription?.text) {
        result.inputTranscript = mergeTranscript(result.inputTranscript, sc.inputTranscription.text);
      }
      if (result && sc.outputTranscription?.text) {
        result.outputTranscript = mergeTranscript(result.outputTranscript, sc.outputTranscription.text);
      }

      if (sc.inputTranscription?.text) {
        console.log(`${el()} [${turn.id}] INPUT: "${sc.inputTranscription.text}"`);
      }
      if (sc.outputTranscription?.text) {
        console.log(`${el()} [${turn.id}] OUTPUT: "${sc.outputTranscription.text}"`);
      }
      if (sc.interrupted) {
        if (result) result.interruptions += 1;
        console.log(`${el()} [${turn.id}] ⚡ INTERRUPTED`);
      }
      if (sc.turnComplete) {
        if (result) result.turnCompleteCount += 1;
        console.log(`${el()} [${turn.id}] turnComplete`);
        settleTurnCompletion();
      }
      if (sc.generationComplete) {
        if (result) result.generationCompleteCount += 1;
        console.log(`${el()} [${turn.id}] generationComplete`);
        settleTurnCompletion();
      }
    }

    if (msg.usageMetadata) {
      console.log(
        `${el()} Usage: prompt=${msg.usageMetadata.promptTokenCount} response=${msg.usageMetadata.responseTokenCount} total=${msg.usageMetadata.totalTokenCount}`
      );
    }

    if (msg.error) {
      console.log(`${el()} API ERROR: ${JSON.stringify(msg.error)}`);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`${el()} Closed: ${code} ${reason}`);

    console.log('\n══ Summary ══');
    for (const turn of turns) {
      const result = turnResults.get(turn.id)!;
      const ratio = result.inputTranscript
        ? Math.round(tokenMatchRatio(result.expectedTranscript, result.inputTranscript) * 100)
        : 0;

      console.log(`\n[${turn.id}] ${turn.purpose}`);
      console.log(`  Expected input: ${result.expectedTranscript}`);
      console.log(`  Got input:      ${result.inputTranscript || '(none)'}`);
      console.log(`  Input match:    ${ratio}%`);
      console.log(`  Agent output:   ${result.outputTranscript || '(none)'}`);
      console.log(`  Interruptions:  ${result.interruptions}`);
      console.log(
        `  Completes:      turnComplete=${result.turnCompleteCount}, generationComplete=${result.generationCompleteCount}`
      );
    }
  });

  ws.on('error', (err) => {
    console.log(`${el()} Error: ${err.message}`);
  });

  setTimeout(() => {
    console.log(`${el()} Timeout — closing`);
    ws.close();
  }, 90000);
}

run();
