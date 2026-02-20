#!/usr/bin/env bun
/**
 * Voice Runtime Inspector TUI — Entrypoint.
 *
 * Prerequisites (macOS):
 *   brew install sox
 *
 * Usage:
 *   bun run tui:inspect                           # Live mode, default profile
 *   bun run tui:inspect --profile=marvin           # Live mode, marvin profile
 *   bun run tui:inspect --provider=decomposed      # Force provider
 *   bun run tui:inspect --mode=report              # Browse benchmark reports
 *   bun run tui:inspect --check                    # Check audio setup
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { execSync } from 'child_process';
import type { InspectorArgs } from './tui/inspector/types.js';

// Load .env from project root
loadEnv({ path: resolve(import.meta.dirname, '../.env') });

// ── Audio Prerequisites Check ────────────────────────────────

function checkAudioSetup(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  if (isMac) {
    // Check sox
    try {
      execSync('which rec', { stdio: 'pipe' });
    } catch {
      issues.push('sox is not installed. Install with: brew install sox');
    }
    try {
      execSync('which play', { stdio: 'pipe' });
    } catch {
      if (!issues.some((i) => i.includes('sox'))) {
        issues.push('sox play command not found. Install with: brew install sox');
      }
    }
  } else if (isLinux) {
    try {
      execSync('which pw-cat', { stdio: 'pipe' });
    } catch {
      issues.push('pw-cat not found. Install PipeWire: sudo apt install pipewire pipewire-audio-client-libraries');
    }
  } else {
    issues.push(`Unsupported platform: ${process.platform}. Supported: macOS, Linux`);
  }

  return { ok: issues.length === 0, issues };
}

function printAudioDevices(): void {
  const isMac = process.platform === 'darwin';
  if (isMac) {
    console.log('\n  Audio Devices (macOS):');
    try {
      const output = execSync('system_profiler SPAudioDataType 2>/dev/null', { encoding: 'utf8' });
      const lines = output.split('\n');
      let currentDevice = '';
      let isDefault = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.endsWith(':') && !trimmed.startsWith('Devices') && !trimmed.startsWith('Audio')) {
          currentDevice = trimmed.replace(':', '');
        } else if (trimmed.startsWith('Default Input Device: Yes')) {
          console.log(`    [INPUT]  ${currentDevice} (default)`);
          isDefault = true;
        } else if (trimmed.startsWith('Default Output Device: Yes')) {
          console.log(`    [OUTPUT] ${currentDevice} (default)`);
          isDefault = true;
        } else if (trimmed.startsWith('Input Channels') && !isDefault) {
          console.log(`    [INPUT]  ${currentDevice}`);
        } else if (trimmed.startsWith('Output Channels') && !isDefault) {
          console.log(`    [OUTPUT] ${currentDevice}`);
        }
        if (trimmed === '') isDefault = false;
      }
    } catch {
      console.log('    (unable to list devices)');
    }
    console.log('\n  In live mode, press i/o to cycle input/output devices in the TUI.');
    console.log('  Device names match System Settings > Sound.');
  }
}

// ── CLI Arg Parsing ──────────────────────────────────────────

function parseArgs(): InspectorArgs & { check?: boolean } {
  const args = process.argv.slice(2);
  let mode: 'live' | 'report' = 'live';
  let profile = 'jarvis';
  let provider: string | undefined;
  let check = false;

  for (const arg of args) {
    if (arg === '--check') {
      check = true;
    } else if (arg === '--mode=report' || arg === '-r' || arg === 'report') {
      mode = 'report';
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length) as 'live' | 'report';
    } else if (arg.startsWith('--profile=') || arg.startsWith('-p=')) {
      profile = arg.split('=')[1]!;
    } else if (arg.startsWith('--provider=')) {
      provider = arg.split('=')[1]!;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Voice Runtime Inspector TUI

Prerequisites (macOS):
  brew install sox

Usage:
  bun run tui:inspect [options]

Options:
  --mode=live|report   Inspector mode (default: live)
  --profile=NAME       Agent profile: jarvis, marvin (default: jarvis)
  --provider=NAME      Force voice provider (default: from config)
  --check              Check audio prerequisites and list devices
  -r, report           Shorthand for --mode=report
  -h, --help           Show this help

Audio:
  The inspector detects available input/output devices.
  In live mode, press i/o to cycle them.
  Device labels come from your OS audio settings.

Keyboard (live mode):
  Space    Toggle mic mute
  i        Cycle input device
  o        Cycle output device
  q        Quit (shows benchmark result)
  r        Reconnect to provider
  p        Switch profile
  Enter    Text input mode
      `);
      process.exit(0);
    }
  }

  return { mode, profile, provider, check };
}

// ── Main ─────────────────────────────────────────────────────

const args = parseArgs();

// Handle --check
if (args.check) {
  console.log('\nVoice Runtime Inspector — Audio Setup Check\n');
  const { ok, issues } = checkAudioSetup();
  if (ok) {
    console.log('  ✓ Audio tools installed');
  } else {
    for (const issue of issues) {
      console.log(`  ✗ ${issue}`);
    }
  }
  printAudioDevices();

  // Check .env
  console.log('\n  API Keys:');
  const keys = ['OPENAI_API_KEY', 'OPEN_ROUTER_API_KEY', 'DEEPGRAM_API_KEY', 'ULTRAVOX_API_KEY'];
  for (const key of keys) {
    const val = process.env[key];
    console.log(`    ${key}: ${val ? '✓ set' : '✗ missing'}`);
  }

  console.log('');
  process.exit(ok ? 0 : 1);
}

// Pre-flight check for live mode
if (args.mode === 'live') {
  const { ok, issues } = checkAudioSetup();
  if (!ok) {
    console.error('\nAudio setup issues found:');
    for (const issue of issues) {
      console.error(`  ✗ ${issue}`);
    }
    console.error('\nRun with --check for full diagnostics.\n');
    process.exit(1);
  }
}

// Dynamic import to avoid loading React/Ink if --help/--check was shown
const { run } = await import('./tui/inspector/index.js');
run(args);
