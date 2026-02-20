#!/usr/bin/env bun
/**
 * Record test audio snippets for provider integration testing.
 *
 * Usage:
 *   bun packages/voice-runtime/test-audio/record.ts <scenario-name>
 *   bun packages/voice-runtime/test-audio/record.ts 01-greeting
 *   bun packages/voice-runtime/test-audio/record.ts all    # Record all scenarios in sequence
 *
 * Requires: sox (brew install sox)
 * Output: PCM16 mono 16kHz .raw files
 */

import { resolve, dirname } from 'path';
import { existsSync } from 'fs';

const AUDIO_DIR = dirname(new URL(import.meta.url).pathname);
const SAMPLE_RATE = 16000;

const SCENARIOS: Record<string, { prompt: string; duration?: string }> = {
  '01-greeting': {
    prompt: 'Say: "Hello, can you hear me?"',
  },
  '02a-my-name': {
    prompt: 'Say: "My name is Alex."',
  },
  '02b-what-is-my-name': {
    prompt: 'Say: "What is my name?"',
  },
  '03a-long-story': {
    prompt: 'Say: "Tell me a long story about a dragon."',
  },
  '03b-interrupt-stop': {
    prompt: 'Say: "Stop. What color was the dragon?"',
  },
  '04-weather-berlin': {
    prompt: 'Say: "What\'s the weather in Berlin?"',
  },
  '05a-count': {
    prompt: 'Say: "Count to three."',
  },
  '05b-backwards': {
    prompt: 'Say: "Now count backwards."',
  },
  '05c-middle': {
    prompt: 'Say: "What number is in the middle?"',
  },
  '06-silence-pause': {
    prompt: 'Say: "Let me think for a moment..." then pause 5 seconds, then say "...okay, what is two plus two?"',
    duration: '12',
  },
  '07-explain-thermo': {
    prompt: 'Say: "Explain the three laws of thermodynamics in simple terms."',
  },
  '08a-german-hello': {
    prompt: 'Say: "Hallo, wie geht es dir?"',
  },
  '08b-german-joke': {
    prompt: 'Say: "Kannst du mir einen Witz erzählen?"',
  },
};

async function checkSox(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', 'sox'], { stdout: 'pipe', stderr: 'pipe' });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function recordScenario(name: string): Promise<void> {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`Unknown scenario: ${name}`);
    console.error(`Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  const outputPath = resolve(AUDIO_DIR, `${name}.raw`);

  if (existsSync(outputPath)) {
    console.log(`\n⚠ File already exists: ${name}.raw`);
    console.log('  Press Enter to overwrite, Ctrl+C to skip');
    for await (const line of console) {
      break; // Wait for one line of input
    }
  }

  console.log(`\n🎙  Recording: ${name}`);
  console.log(`   ${scenario.prompt}`);
  console.log(`   Output: ${outputPath}`);
  console.log('   Press Ctrl+C when done speaking.\n');

  const args = [
    'sox',
    '-d', // default input device
    '-r', String(SAMPLE_RATE),
    '-c', '1',
    '-b', '16',
    '-e', 'signed-integer',
    outputPath,
  ];

  if (scenario.duration) {
    args.push('trim', '0', scenario.duration);
  }

  const proc = Bun.spawn(args, {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  await proc.exited;

  if (existsSync(outputPath)) {
    const stat = Bun.file(outputPath);
    const size = stat.size;
    const durationSec = size / (SAMPLE_RATE * 2);
    console.log(`✓ Saved: ${name}.raw (${durationSec.toFixed(1)}s, ${size} bytes)`);
  }
}

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage: bun test-audio/record.ts <scenario-name|all>');
    console.log('\nAvailable scenarios:');
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      console.log(`  ${name.padEnd(25)} ${scenario.prompt}`);
    }
    process.exit(0);
  }

  if (!(await checkSox())) {
    console.error('Error: sox not found. Install with: brew install sox');
    process.exit(1);
  }

  if (arg === 'all') {
    for (const name of Object.keys(SCENARIOS)) {
      await recordScenario(name);
      console.log('');
    }
    console.log('\n✓ All scenarios recorded.');
  } else {
    await recordScenario(arg);
  }
}

main();
