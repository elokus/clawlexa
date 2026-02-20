#!/usr/bin/env bun
/**
 * Gemini Audio Input Experiments
 *
 * Systematically tests different audio configurations to find what works.
 * Run experiments one at a time and compare results.
 *
 * Usage:
 *   bun packages/voice-runtime/scratch/gemini-audio-experiments.ts <experiment>
 *
 * Experiments:
 *   1  - Baseline: PCM16 16kHz, 100ms chunks, 2x speed (current behavior)
 *   2  - Smaller chunks: PCM16 16kHz, 20ms chunks, 1x speed (docs recommendation)
 *   3  - With audioStreamEnd signal after sending
 *   4  - Send WAV instead of raw PCM (audio/wav mime type)
 *   5  - Send m4a directly (audio/m4a mime type)
 *   6  - Send via clientContent (not realtimeInput) for ordered delivery
 *   7  - Try non-native model (gemini-2.0-flash-live-001 if available)
 */

import { resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const DATA_DIR = resolve(import.meta.dir, '..', 'data', 'test');
const OUTPUT_DIR = '/tmp/voice-explore';
mkdirSync(OUTPUT_DIR, { recursive: true });

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error('Set GEMINI_API_KEY');

const experimentNum = parseInt(process.argv[2] || '0');
if (!experimentNum || experimentNum < 1 || experimentNum > 7) {
  console.log(`Usage: bun gemini-audio-experiments.ts <1-7>

Experiments:
  1  Baseline: 100ms chunks, ~2x speed
  2  Small chunks: 20ms, 1x real-time (docs recommendation)
  3  With audioStreamEnd signal
  4  Send WAV (audio/wav)
  5  Send m4a directly (audio/m4a)
  6  Send via clientContent (ordered, not streaming)
  7  Non-native model (gemini-2.0-flash-live-001)`);
  process.exit(0);
}

// --- Shared types ---
interface EventEntry {
  t: number;
  type: string;
  data?: unknown;
}

const events: EventEntry[] = [];
const audioOut: Buffer[] = [];
const t0 = Date.now();

function log(type: string, data?: unknown) {
  const elapsed = Date.now() - t0;
  events.push({ t: elapsed, type, data });
  const d = data ? ` ${JSON.stringify(data).slice(0, 300)}` : '';
  console.log(`[${elapsed.toString().padStart(6)}ms] ${type}${d}`);
}

// --- Experiment configurations ---
interface ExperimentConfig {
  name: string;
  model: string;
  chunkMs: number;
  paceMultiplier: number; // 1.0 = real-time, 0.5 = 2x speed
  sendAudioStreamEnd: boolean;
  mimeType: string;
  useClientContent: boolean;
  audioFile: string; // which file to send
  description: string;
}

const EXPERIMENTS: Record<number, ExperimentConfig> = {
  1: {
    name: 'baseline',
    model: 'models/gemini-2.5-flash-native-audio-latest',
    chunkMs: 100,
    paceMultiplier: 0.5,
    sendAudioStreamEnd: false,
    mimeType: 'audio/pcm;rate=16000',
    useClientContent: false,
    audioFile: 'turn-1.raw',
    description: 'Baseline: 100ms chunks at 2x speed, no audioStreamEnd',
  },
  2: {
    name: 'small-chunks-realtime',
    model: 'models/gemini-2.5-flash-native-audio-latest',
    chunkMs: 20,
    paceMultiplier: 1.0,
    sendAudioStreamEnd: false,
    mimeType: 'audio/pcm;rate=16000',
    useClientContent: false,
    audioFile: 'turn-1.raw',
    description: 'Docs recommendation: 20ms chunks at 1x real-time speed',
  },
  3: {
    name: 'with-stream-end',
    model: 'models/gemini-2.5-flash-native-audio-latest',
    chunkMs: 20,
    paceMultiplier: 1.0,
    sendAudioStreamEnd: true,
    mimeType: 'audio/pcm;rate=16000',
    useClientContent: false,
    audioFile: 'turn-1.raw',
    description: '20ms chunks + audioStreamEnd signal after sending',
  },
  4: {
    name: 'wav-format',
    model: 'models/gemini-2.5-flash-native-audio-latest',
    chunkMs: 0, // send whole file at once
    paceMultiplier: 0,
    sendAudioStreamEnd: true,
    mimeType: 'audio/wav',
    useClientContent: false,
    audioFile: 'turn-1.wav',
    description: 'Send entire WAV file with audio/wav mime type',
  },
  5: {
    name: 'm4a-format',
    model: 'models/gemini-2.5-flash-native-audio-latest',
    chunkMs: 0,
    paceMultiplier: 0,
    sendAudioStreamEnd: true,
    mimeType: 'audio/m4a',
    useClientContent: false,
    audioFile: 'Hallo, wie geht es dir? Kannst du mich hören?.m4a',
    description: 'Send original m4a file directly',
  },
  6: {
    name: 'client-content-pcm',
    model: 'models/gemini-2.5-flash-native-audio-latest',
    chunkMs: 0,
    paceMultiplier: 0,
    sendAudioStreamEnd: false,
    mimeType: 'audio/pcm;rate=16000',
    useClientContent: true,
    audioFile: 'turn-1.raw',
    description: 'Send via clientContent (ordered) with raw PCM instead of realtimeInput',
  },
  7: {
    name: 'non-native-model',
    model: 'models/gemini-2.0-flash-live-001',
    chunkMs: 20,
    paceMultiplier: 1.0,
    sendAudioStreamEnd: true,
    mimeType: 'audio/pcm;rate=16000',
    useClientContent: false,
    audioFile: 'turn-1.raw',
    description: 'Non-native model to compare transcription quality',
  },
};

const config = EXPERIMENTS[experimentNum]!;

async function runExperiment() {
  const WebSocket = (await import('ws')).default;
  const endpoint = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

  console.log(`\n══ Experiment ${experimentNum}: ${config.name} ══`);
  console.log(`   ${config.description}`);
  console.log(`   Model: ${config.model}`);
  console.log(`   Audio: ${config.audioFile} (${config.mimeType})`);
  console.log(`   Chunks: ${config.chunkMs}ms, pace: ${config.paceMultiplier}x\n`);

  const ws = new WebSocket(`${endpoint}?key=${API_KEY}`);

  let turnCompleteResolve: (() => void) | null = null;

  ws.on('open', () => {
    log('ws_open');

    const setup: Record<string, unknown> = {
      setup: {
        model: config.model,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.8,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
          },
        },
        systemInstruction: {
          parts: [{ text: 'Du bist ein hilfreicher Assistent. Antworte kurz und auf Deutsch.' }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: false },
          activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };

    ws.send(JSON.stringify(setup));
    log('setup_sent');
  });

  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());

    if (msg.setupComplete) {
      log('setup_complete');
      sendAudio(ws);
      return;
    }

    if (msg.serverContent) {
      const sc = msg.serverContent;
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data) {
            const ab = Buffer.from(part.inlineData.data, 'base64');
            audioOut.push(ab);
          }
          if (part.text) log('text_delta', { text: part.text });
        }
      }
      if (sc.inputTranscription?.text) log('INPUT_TRANSCRIPT', { text: sc.inputTranscription.text });
      if (sc.outputTranscription?.text) log('output_transcript', { text: sc.outputTranscription.text });
      if (sc.turnComplete) {
        log('turn_complete');
        turnCompleteResolve?.();
      }
      if (sc.generationComplete) {
        log('generation_complete');
        turnCompleteResolve?.();
      }
      if (sc.interrupted) log('interrupted');
    }

    if (msg.toolCall) log('tool_call', msg.toolCall);
    if (msg.usageMetadata) log('usage', msg.usageMetadata);
    if (msg.goAway) log('go_away', msg.goAway);
    if (msg.sessionResumptionUpdate) log('session_resume', msg.sessionResumptionUpdate);
  });

  ws.on('close', (code, reason) => {
    log('ws_close', { code, reason: reason.toString() });
    printResults();
  });

  ws.on('error', (err) => log('ws_error', { message: err.message }));

  // Timeout
  setTimeout(() => { log('timeout'); ws.close(); }, 30000);

  async function sendAudio(ws: import('ws').WebSocket) {
    const filePath = resolve(DATA_DIR, config.audioFile);
    const fileData = readFileSync(filePath);

    if (config.useClientContent) {
      // Send via clientContent (ordered, not streaming)
      log('sending_client_content', { bytes: fileData.length });
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{
              inlineData: {
                data: fileData.toString('base64'),
                mimeType: config.mimeType,
              },
            }],
          }],
          turnComplete: true,
        },
      }));
      log('client_content_sent');
      return;
    }

    if (config.chunkMs === 0) {
      // Send whole file at once
      log('sending_whole_file', { bytes: fileData.length, mime: config.mimeType });
      ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: fileData.toString('base64'),
            mimeType: config.mimeType,
          },
        },
      }));
      log('whole_file_sent');
    } else {
      // Send in chunks
      const SAMPLE_RATE = 16000;
      const BYTES_PER_SAMPLE = 2;
      const CHUNK_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * config.chunkMs) / 1000;
      const totalChunks = Math.ceil(fileData.length / CHUNK_BYTES);
      const sleepMs = config.chunkMs * config.paceMultiplier;

      log('sending_chunks', { chunks: totalChunks, chunkMs: config.chunkMs, sleepMs });

      for (let i = 0; i < fileData.length; i += CHUNK_BYTES) {
        const chunk = fileData.subarray(i, Math.min(i + CHUNK_BYTES, fileData.length));
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              data: chunk.toString('base64'),
              mimeType: config.mimeType,
            },
          },
        }));
        if (sleepMs > 0) await Bun.sleep(sleepMs);
      }
      log('chunks_sent');
    }

    if (config.sendAudioStreamEnd) {
      await Bun.sleep(100);
      ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      log('audio_stream_end_sent');
    }
  }
}

function printResults() {
  const inputTranscripts = events.filter(e => e.type === 'INPUT_TRANSCRIPT');
  const outputTranscripts = events.filter(e => e.type === 'output_transcript');
  const totalAudio = audioOut.reduce((s, b) => s + b.length, 0);

  console.log(`\n══ Experiment ${experimentNum} Results: ${config.name} ══`);
  console.log(`Duration: ${Date.now() - t0}ms`);
  console.log(`Audio out: ${totalAudio} bytes (${(totalAudio / (24000 * 2)).toFixed(1)}s)`);
  console.log(`Input transcripts (${inputTranscripts.length}):`);
  for (const e of inputTranscripts) {
    console.log(`  [${e.t}ms] "${(e.data as { text: string }).text}"`);
  }
  console.log(`Output transcripts (${outputTranscripts.length}):`);
  for (const e of outputTranscripts) {
    console.log(`  [${e.t}ms] "${(e.data as { text: string }).text}"`);
  }

  // Check for non-Latin characters in input transcript (known bug indicator)
  const allInputText = inputTranscripts.map(e => (e.data as { text: string }).text).join(' ');
  const hasNonLatin = /[^\x00-\x7F\u00C0-\u024F\u1E00-\u1EFF\u00DF]/.test(allInputText);
  if (hasNonLatin) {
    console.log(`\n⚠ NON-LATIN CHARACTERS in input transcript (known native-audio bug)`);
  } else if (allInputText.trim()) {
    console.log(`\n✓ Input transcript appears to be Latin/German text`);
  } else {
    console.log(`\n⚠ No input transcription received`);
  }

  // Check if agent response makes sense
  const interrupted = events.filter(e => e.type === 'interrupted');
  console.log(`Interruptions: ${interrupted.length}`);

  // Save results
  const outPath = resolve(OUTPUT_DIR, `experiment-${experimentNum}-${config.name}.json`);
  writeFileSync(outPath, JSON.stringify({ experiment: experimentNum, config, events }, null, 2));
  console.log(`\nFull log: ${outPath}`);
}

runExperiment();
