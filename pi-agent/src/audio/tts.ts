/**
 * Text-to-Speech - Generate speech using OpenAI TTS API
 *
 * Streams PCM audio directly to PipeWire for playback.
 */

import OpenAI from 'openai';
import { spawn } from 'child_process';
import { config } from '../config.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

const TTS_SAMPLE_RATE = 24000; // OpenAI TTS outputs 24kHz

export interface TTSOptions {
  voice?: 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  speed?: number;
}

/**
 * Speak text using OpenAI TTS API, streaming PCM directly to PipeWire.
 */
export async function speak(text: string, options: TTSOptions = {}): Promise<void> {
  const voice = options.voice ?? 'echo';
  const speed = options.speed ?? 1.0;

  console.log(`[TTS] Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

  // Start pw-cat for PCM playback
  const player = spawn('pw-cat', [
    '--playback',
    '--raw',
    '--channels', '1',
    '--rate', String(TTS_SAMPLE_RATE),
    '--format', 's16',
    '-',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let playerError: Error | null = null;

  player.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('opening stream')) {
      console.error('[TTS] pw-cat:', msg);
    }
  });

  player.on('error', (err) => {
    playerError = err;
  });

  const playerDone = new Promise<void>((resolve, reject) => {
    player.on('exit', (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else if (playerError) {
        reject(playerError);
      } else {
        reject(new Error(`pw-cat exited with code ${code}`));
      }
    });
  });

  try {
    // Request PCM audio from OpenAI
    const response = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice,
      input: text,
      speed,
      response_format: 'pcm', // 24kHz 16-bit mono PCM
    });

    // Stream the audio data to pw-cat
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    player.stdin?.write(buffer);
    player.stdin?.end();

    // Wait for playback to complete
    await playerDone;
    console.log('[TTS] Done');
  } catch (error) {
    // Kill the player on error
    player.kill();
    console.error('[TTS] Error:', error);
    throw error;
  }
}
