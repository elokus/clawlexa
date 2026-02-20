#!/usr/bin/env bun
/**
 * Provider Exploration Script
 *
 * Interactive tool for testing voice providers with recorded audio.
 * Supports single-turn and multi-turn conversations from test data.
 *
 * Usage:
 *   # Multi-turn conversation (sends all turns from data/test/turns.json)
 *   bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --multi-turn
 *
 *   # Single turn from test data
 *   bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --turn turn-1
 *
 *   # Single scenario from test-audio/
 *   bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --scenario 01-greeting
 *
 *   # Text input (no audio needed)
 *   bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --text "Hello"
 *
 *   # With tool calling enabled
 *   bun packages/voice-runtime/scratch/explore-provider.ts gemini-live --multi-turn --tools
 *
 * See PROVIDER_INTEGRATION_GUIDE.md for context.
 */

import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const RUNTIME_DIR = resolve(import.meta.dir, '..');
const AUDIO_DIR = resolve(RUNTIME_DIR, 'test-audio');
const DATA_DIR = resolve(RUNTIME_DIR, 'data', 'test');
const OUTPUT_DIR = '/tmp/voice-explore';
type VadMode = 'manual' | 'auto';

// --- Turn metadata ---
interface TurnExpects {
  agent_responds: boolean;
  language?: string;
  tool_call?: boolean;
  tool_name?: string;
  tool_args_contains?: string;
  context_from_turn?: string;
}

interface TurnMeta {
  id: string;
  file_wav: string;
  file_raw: string;
  transcript: string;
  translation: string;
  duration_sec: number;
  purpose: string;
  expects: TurnExpects;
}

interface TurnsManifest {
  description: string;
  language: string;
  turns: TurnMeta[];
}

// --- Args ---
const args = process.argv.slice(2);
const providerId = args[0];

if (!providerId) {
  console.log(`Usage: bun scratch/explore-provider.ts <provider-id> [options]

Options:
  --multi-turn          Run all turns from data/test/turns.json sequentially
  --turn <id>           Send a single turn by ID (e.g., turn-1)
  --scenario <name>     Send pre-recorded audio from test-audio/ (e.g., 01-greeting)
  --text <message>      Send text input instead of audio
  --vad <manual|auto>   Activity detection mode (default: manual)
  --chunk-ms <ms>       Audio chunk size in milliseconds (default: 20)
  --pace <x>            Send pacing multiplier (1.0 = realtime, default: 1.0)
  --audio-stream-end    Send audioStreamEnd after each audio turn in auto VAD
  --no-audio-stream-end Disable audioStreamEnd in auto VAD
  --model <id>          Gemini model ID (default: gemini-2.5-flash-native-audio-latest)
  --tools               Enable test tools (get_weather, toggle_light)
  --save-audio          Save received audio to /tmp/voice-explore/
  --timeout <ms>        Session timeout (default: 60000)
  --turn-wait <ms>      Wait time between multi-turn sends (default: auto-detect from turn_complete)
  --verbose             Log raw WebSocket messages

Provider IDs: openai-sdk, ultravox-ws, gemini-live, decomposed, pipecat-rtvi`);
  process.exit(0);
}

const multiTurn = args.includes('--multi-turn');
const turnId = getArg('--turn');
const scenarioName = getArg('--scenario');
const textMessage = getArg('--text');
const enableTools = args.includes('--tools');
const saveAudio = args.includes('--save-audio');
const verbose = args.includes('--verbose');
const timeout = parseInt(getArg('--timeout') || '60000');
const turnWaitMs = getArg('--turn-wait') ? parseInt(getArg('--turn-wait')!) : undefined;
const vadMode: VadMode = getArg('--vad') === 'auto' ? 'auto' : 'manual';
const chunkMs = Number.parseInt(getArg('--chunk-ms') || '20', 10);
const pace = Number.parseFloat(getArg('--pace') || '1.0');
const sendAudioStreamEnd = args.includes('--no-audio-stream-end')
  ? false
  : args.includes('--audio-stream-end')
    ? true
    : vadMode === 'auto';
const modelId = getArg('--model') || 'gemini-2.5-flash-native-audio-latest';

if (!Number.isFinite(chunkMs) || chunkMs < 10 || chunkMs > 1000) {
  throw new Error(`Invalid --chunk-ms: ${chunkMs} (expected 10..1000)`);
}
if (!Number.isFinite(pace) || pace <= 0 || pace > 4) {
  throw new Error(`Invalid --pace: ${pace} (expected >0 and <=4)`);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// --- Load turns manifest ---
function loadTurns(): TurnsManifest | null {
  const manifestPath = resolve(DATA_DIR, 'turns.json');
  if (!existsSync(manifestPath)) {
    console.error(`No turns manifest at ${manifestPath}`);
    return null;
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

// --- Test tool definitions ---
const TEST_TOOLS = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
      },
      required: ['city'],
    },
  },
  {
    name: 'toggle_light',
    description: 'Turn a light on or off',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Light name (e.g., Stehlampe, Deckenlampe)' },
        state: { type: 'string', enum: ['on', 'off'], description: 'Desired state' },
      },
      required: ['name', 'state'],
    },
  },
];

// Mock tool responses
function mockToolResult(name: string, toolArgs: Record<string, unknown>): string {
  switch (name) {
    case 'get_weather':
      return JSON.stringify({ temp: 22, condition: 'sunny', city: toolArgs.city || 'Unknown' });
    case 'toggle_light':
      return JSON.stringify({ success: true, light: toolArgs.name, state: toolArgs.state });
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
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

function mergeTranscript(previous: string, nextChunk: string): string {
  if (!previous) return nextChunk;
  if (nextChunk.startsWith(previous)) return nextChunk;
  if (previous.endsWith(nextChunk)) return previous;
  return `${previous}${nextChunk}`;
}

// --- Event Logger ---
interface EventLog {
  timestamp: number;
  type: string;
  turn?: string;
  data?: unknown;
}

const eventLog: EventLog[] = [];
const receivedAudio: Buffer[] = [];
const startTime = Date.now();
let currentTurnId: string | undefined;

function logEvent(type: string, data?: unknown) {
  const elapsed = Date.now() - startTime;
  eventLog.push({ timestamp: elapsed, type, turn: currentTurnId, data });
  const turnTag = currentTurnId ? ` [${currentTurnId}]` : '';
  const preview = data ? ` ${JSON.stringify(data).slice(0, 200)}` : '';
  console.log(`[${elapsed.toString().padStart(6)}ms]${turnTag} ${type}${preview}`);
}

// --- Audio sender ---
function sendAudioChunks(
  ws: import('ws').WebSocket,
  audioBuffer: Buffer,
  provider: string,
  options: {
    chunkMs: number;
    pace: number;
    vadMode: VadMode;
    sendAudioStreamEnd: boolean;
  },
): Promise<void> {
  return new Promise(async (resolve) => {
    const CHUNK_MS = options.chunkMs;
    const SAMPLE_RATE = 16000;
    const BYTES_PER_SAMPLE = 2;
    const CHUNK_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_MS) / 1000;

    if (provider === 'gemini' && options.vadMode === 'manual') {
      ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
      logEvent('activity_start_sent');
    }

    for (let i = 0; i < audioBuffer.length; i += CHUNK_BYTES) {
      const chunk = audioBuffer.subarray(i, Math.min(i + CHUNK_BYTES, audioBuffer.length));

      if (provider === 'gemini') {
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              data: chunk.toString('base64'),
              mimeType: 'audio/pcm;rate=16000',
            },
          },
        }));
      }

      await Bun.sleep(CHUNK_MS * options.pace);
    }

    if (provider === 'gemini') {
      if (options.vadMode === 'manual') {
        ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
        logEvent('activity_end_sent');
      } else if (options.sendAudioStreamEnd) {
        ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        logEvent('audio_stream_end_sent');
      }
    }

    resolve();
  });
}

// --- Multi-turn orchestrator ---
async function runMultiTurn(
  ws: import('ws').WebSocket,
  provider: string,
  turns: TurnMeta[],
  waitForTurnComplete: () => Promise<void>,
  audioOptions: {
    chunkMs: number;
    pace: number;
    vadMode: VadMode;
    sendAudioStreamEnd: boolean;
  },
) {
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    currentTurnId = turn.id;

    logEvent('turn_start', {
      transcript: turn.transcript,
      purpose: turn.purpose,
      expects: turn.expects,
    });

    // Load audio
    const rawPath = resolve(DATA_DIR, turn.file_raw);
    if (!existsSync(rawPath)) {
      logEvent('turn_audio_missing', { path: rawPath });
      // Fall back to text
      if (provider === 'gemini') {
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: turn.transcript }] }],
            turnComplete: true,
          },
        }));
        logEvent('turn_text_fallback', { text: turn.transcript });
      }
    } else {
      const audio = readFileSync(rawPath);
      logEvent('turn_audio_sending', {
        bytes: audio.length,
        durationSec: turn.duration_sec,
      });
      await sendAudioChunks(ws, audio, provider, audioOptions);
      logEvent('turn_audio_sent');
    }

    // Wait for agent to respond before sending next turn
    if (i < turns.length - 1) {
      if (turnWaitMs !== undefined) {
        logEvent('turn_waiting_fixed', { ms: turnWaitMs });
        await Bun.sleep(turnWaitMs);
      } else {
        logEvent('turn_waiting_for_complete');
        await waitForTurnComplete();
        // Small gap between turns (natural pause)
        await Bun.sleep(500);
      }
    }
  }

  // Keep currentTurnId set to last turn for attribution of trailing responses
  logEvent('all_turns_sent');
}

// --- Provider: Gemini Live ---
async function connectGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Set GEMINI_API_KEY env var');

  const WebSocket = (await import('ws')).default;
  const endpoint = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const url = `${endpoint}?key=${apiKey}`;

  // Turn-complete signaling for multi-turn orchestration
  let turnCompleteResolve: (() => void) | null = null;
  function waitForTurnComplete(): Promise<void> {
    return new Promise((resolve) => { turnCompleteResolve = resolve; });
  }
  function signalTurnComplete() {
    if (turnCompleteResolve) {
      const r = turnCompleteResolve;
      turnCompleteResolve = null;
      r();
    }
  }

  // Track results per turn for verification
  const turnResults: Record<string, {
    inputTranscript: string;
    outputTranscript: string;
    toolCalls: Array<{ name: string; args: unknown }>;
    audioChunks: number;
    audioBytes: number;
    interruptions: number;
  }> = {};

  function ensureTurnResult(turnId: string) {
    if (!turnResults[turnId]) {
      turnResults[turnId] = {
        inputTranscript: '',
        outputTranscript: '',
        toolCalls: [],
        audioChunks: 0,
        audioBytes: 0,
        interruptions: 0,
      };
    }
    return turnResults[turnId]!;
  }

  logEvent('connecting', { provider: 'gemini-live', endpoint });
  const ws = new WebSocket(url);

  ws.on('open', () => {
    logEvent('ws_open');

    const manifest = loadTurns();
    const lang = manifest?.language || 'en';

    const setup: Record<string, unknown> = {
      setup: {
        model: modelId.startsWith('models/') ? modelId : `models/${modelId}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.8,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
            // Note: languageCode may not be supported on all models.
            // gemini-2.5-flash-native-audio-latest rejects non-English codes.
            // Omit and rely on system instruction for language instead.
          },
        },
        systemInstruction: {
          parts: [{
            text: lang === 'de'
              ? 'Du bist ein hilfreicher Assistent. Antworte kurz und auf Deutsch.'
              : 'You are a helpful assistant. Keep responses brief.',
          }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: vadMode === 'manual' },
          activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };

    if (enableTools) {
      (setup.setup as Record<string, unknown>).tools = [{
        functionDeclarations: TEST_TOOLS,
      }];
    }

    ws.send(JSON.stringify(setup));
    logEvent('setup_sent', {
      language: lang,
      tools: enableTools,
      vadMode,
      chunkMs,
      pace,
      sendAudioStreamEnd,
      modelId,
    });
  });

  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());

    if (msg.setupComplete) {
      logEvent('setup_complete');

      // Dispatch based on mode
      if (multiTurn) {
        const manifest = loadTurns();
        if (!manifest) { ws.close(); return; }
        logEvent('multi_turn_start', {
          description: manifest.description,
          turns: manifest.turns.length,
        });
        runMultiTurn(ws, 'gemini', manifest.turns, waitForTurnComplete, {
          chunkMs,
          pace,
          vadMode,
          sendAudioStreamEnd,
        }).then(() => {
          // Wait for last response then close
          logEvent('waiting_for_final_response');
          setTimeout(() => ws.close(), 10000);
        });
      } else if (turnId) {
        const manifest = loadTurns();
        const turn = manifest?.turns.find(t => t.id === turnId);
        if (!turn) {
          logEvent('turn_not_found', { turnId, available: manifest?.turns.map(t => t.id) });
          ws.close();
          return;
        }
        currentTurnId = turnId;
        runMultiTurn(ws, 'gemini', [turn], waitForTurnComplete, {
          chunkMs,
          pace,
          vadMode,
          sendAudioStreamEnd,
        }).then(() => {
          setTimeout(() => ws.close(), 10000);
        });
      } else if (textMessage) {
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: textMessage }] }],
            turnComplete: true,
          },
        }));
        logEvent('text_sent', { text: textMessage });
      } else if (scenarioName) {
        const audioPath = resolve(AUDIO_DIR, `${scenarioName}.raw`);
        if (!existsSync(audioPath)) {
          logEvent('scenario_not_found', { path: audioPath });
          ws.close();
          return;
        }
        const audio = readFileSync(audioPath);
        logEvent('scenario_sending', { name: scenarioName, bytes: audio.length });
        sendAudioChunks(ws, audio, 'gemini', {
          chunkMs,
          pace,
          vadMode,
          sendAudioStreamEnd,
        }).then(() => {
          logEvent('scenario_sent');
        });
      } else {
        // Default: send text greeting
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: 'Hello, can you hear me?' }] }],
            turnComplete: true,
          },
        }));
        logEvent('default_text_sent');
      }
      return;
    }

    if (msg.serverContent) {
      const sc = msg.serverContent;
      const tr = currentTurnId ? ensureTurnResult(currentTurnId) : null;

      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data) {
            const audioBytes = Buffer.from(part.inlineData.data, 'base64');
            receivedAudio.push(audioBytes);
            if (tr) { tr.audioChunks++; tr.audioBytes += audioBytes.length; }
            if (verbose) {
              logEvent('audio_chunk', { bytes: audioBytes.length, mimeType: part.inlineData.mimeType });
            }
          }
          if (part.text) {
            logEvent('text_delta', { text: part.text });
          }
        }
      }

      if (sc.inputTranscription?.text) {
        if (tr) tr.inputTranscript = mergeTranscript(tr.inputTranscript, sc.inputTranscription.text);
        logEvent('input_transcript', { text: sc.inputTranscription.text });
      }
      if (sc.outputTranscription?.text) {
        if (tr) tr.outputTranscript = mergeTranscript(tr.outputTranscript, sc.outputTranscription.text);
        logEvent('output_transcript', { text: sc.outputTranscription.text });
      }
      if (sc.turnComplete) {
        logEvent('turn_complete');
        signalTurnComplete();
      }
      if (sc.generationComplete) {
        logEvent('generation_complete');
        signalTurnComplete();
      }
      if (sc.interrupted) {
        if (tr) tr.interruptions += 1;
        logEvent('interrupted');
      }
    }

    if (msg.toolCall) {
      logEvent('tool_call', msg.toolCall);
      const tr = currentTurnId ? ensureTurnResult(currentTurnId) : null;
      const responses = (msg.toolCall.functionCalls || []).map((fc: { id: string; name: string; args?: Record<string, unknown> }) => {
        if (tr) tr.toolCalls.push({ name: fc.name, args: fc.args });
        const result = mockToolResult(fc.name, fc.args || {});
        return {
          id: fc.id,
          name: fc.name,
          response: { output: result },
        };
      });
      ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      logEvent('tool_response_sent', { count: responses.length });
    }

    if (msg.toolCallCancellation) {
      logEvent('tool_cancellation', msg.toolCallCancellation);
    }

    if (msg.sessionResumptionUpdate) {
      logEvent('session_resumption', msg.sessionResumptionUpdate);
    }

    if (msg.usageMetadata) {
      logEvent('usage', msg.usageMetadata);
    }

    if (msg.goAway) {
      logEvent('go_away', msg.goAway);
    }

    if (verbose) {
      const keys = Object.keys(msg).filter(k =>
        !['serverContent', 'setupComplete', 'toolCall', 'toolCallCancellation',
          'sessionResumptionUpdate', 'usageMetadata', 'goAway'].includes(k)
      );
      if (keys.length > 0) {
        logEvent('raw_keys', keys);
      }
    }
  });

  ws.on('close', (code, reason) => {
    logEvent('ws_close', { code, reason: reason.toString() });
    finish(turnResults);
  });

  ws.on('error', (err) => {
    logEvent('ws_error', { message: err.message });
  });

  setTimeout(() => {
    logEvent('session_timeout');
    ws.close();
  }, timeout);
}

// --- Finish & report ---
function finish(turnResults?: Record<string, {
  inputTranscript: string;
  outputTranscript: string;
  toolCalls: Array<{ name: string; args: unknown }>;
  audioChunks: number;
  audioBytes: number;
  interruptions: number;
}>) {
  const totalAudioBytes = receivedAudio.reduce((sum, b) => sum + b.length, 0);

  console.log('\n════════════════════════════════════════');
  console.log('  Session Summary');
  console.log('════════════════════════════════════════');
  console.log(`  Provider:       ${providerId}`);
  console.log(`  Duration:       ${Date.now() - startTime}ms`);
  console.log(`  Events:         ${eventLog.length}`);
  console.log(`  Audio received: ${totalAudioBytes} bytes (${(totalAudioBytes / (24000 * 2)).toFixed(1)}s at 24kHz)`);

  // Per-turn results
  if (turnResults && Object.keys(turnResults).length > 0) {
    const manifest = loadTurns();
    console.log('\n── Turn Results ──');

    for (const [turnId, result] of Object.entries(turnResults)) {
      const meta = manifest?.turns.find(t => t.id === turnId);
      console.log(`\n  ${turnId} (${meta?.purpose || 'unknown'}):`);
      console.log(`    Expected:  "${meta?.transcript}"`);
      console.log(`    Got input: "${result.inputTranscript || '(none)'}"`);
      console.log(`    Agent said: "${result.outputTranscript || '(none)'}"`);
      console.log(`    Audio: ${result.audioChunks} chunks, ${result.audioBytes} bytes`);
      console.log(`    Interruptions: ${result.interruptions}`);

      if (result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          console.log(`    Tool call: ${tc.name}(${JSON.stringify(tc.args)})`);
        }
      }

      // Verification
      if (meta?.expects) {
        const checks: string[] = [];
        if (meta.expects.agent_responds && result.audioBytes === 0 && !result.outputTranscript) {
          checks.push('FAIL: expected agent response, got nothing');
        }
        const transcriptRatio = result.inputTranscript
          ? tokenMatchRatio(meta.transcript, result.inputTranscript)
          : 0;
        if (transcriptRatio < 0.55) {
          checks.push(
            `FAIL: input transcript mismatch (${Math.round(transcriptRatio * 100)}% token match)`
          );
        }
        if (vadMode === 'auto' && result.interruptions > 0) {
          checks.push(
            `WARN: auto VAD produced ${result.interruptions} interruption event(s) in this turn`
          );
        }
        if (meta.expects.tool_call && result.toolCalls.length === 0) {
          checks.push(`FAIL: expected tool call (${meta.expects.tool_name}), got none`);
        }
        if (meta.expects.tool_call && meta.expects.tool_name && !result.toolCalls.some(tc => tc.name === meta.expects.tool_name)) {
          checks.push(`FAIL: expected tool ${meta.expects.tool_name}, got ${result.toolCalls.map(tc => tc.name).join(', ') || 'none'}`);
        }
        if (checks.length > 0) {
          for (const c of checks) console.log(`    ⚠ ${c}`);
        } else {
          console.log('    ✓ Checks passed');
        }
      }
    }
  }

  // Save audio
  mkdirSync(OUTPUT_DIR, { recursive: true });

  if (saveAudio && receivedAudio.length > 0) {
    const combined = Buffer.concat(receivedAudio);
    const outPath = resolve(OUTPUT_DIR, `${providerId}-${Date.now()}.raw`);
    writeFileSync(outPath, combined);
    console.log(`\n  Audio saved: ${outPath}`);
    console.log(`  Play: play -r 24000 -b 16 -c 1 -e signed-integer ${outPath}`);
  }

  // Save event log
  const logPath = resolve(OUTPUT_DIR, `${providerId}-events-${Date.now()}.json`);
  writeFileSync(logPath, JSON.stringify({ providerId, turnResults, events: eventLog }, null, 2));
  console.log(`  Event log: ${logPath}`);
  console.log('');
}

// --- Main ---
switch (providerId) {
  case 'gemini-live':
    connectGemini();
    break;
  default:
    console.log(`Provider '${providerId}' not yet implemented in explore script.`);
    console.log('Add a connect function following the pattern in this file.');
    console.log('See PROVIDER_INTEGRATION_GUIDE.md Appendix C for a template.');
    process.exit(1);
}
