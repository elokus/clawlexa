import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

interface Violation {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

const ROOT = process.cwd();

const TARGETS = [
  'packages/voice-agent/src/config.ts',
  'packages/voice-agent/src/voice',
  'packages/voice-agent/src/realtime',
  'packages/voice-agent/src/api/webhooks.ts',
  'packages/voice-agent/src/tui/inspector/state.ts',
  'packages/web-ui/src/lib/voice-config-api.ts',
  'packages/web-ui/src/components/VoiceRuntimePanel.tsx',
  'packages/web-ui/src/stores/message-handler.ts',
  'packages/web-ui/src/stores/unified-sessions.ts',
];

const ALLOWLIST_PATH_PARTS = [
  '/tests/',
  '/test/',
  '/scratch',
  '/docs/',
];

function normalizeForMatch(input: string): string {
  return input.replaceAll(path.sep, '/');
}

const BLOCKED_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: 'openai-realtime', regex: /\bopenai-realtime\b/ },
  { id: 'gemini-live', regex: /\bgemini-live\b/ },
  { id: 'ultravox-realtime', regex: /\bultravox-realtime\b/ },
  { id: 'pipecat-rtvi', regex: /\bpipecat-rtvi\b/ },
  { id: 'openai-sdk', regex: /\bopenai-sdk\b/ },
  { id: 'ultravox-ws', regex: /\bultravox-ws\b/ },
  { id: 'gpt-realtime', regex: /\bgpt-realtime(?:-[a-z0-9._-]+)?\b/i },
  { id: 'gpt-4o-mini-transcribe', regex: /\bgpt-4o-mini-transcribe\b/ },
  { id: 'gpt-4o-transcribe', regex: /\bgpt-4o-transcribe\b/ },
  { id: 'gemini-2.5*', regex: /\bgemini-2\.5[a-z0-9._-]*\b/i },
  { id: 'ultravox-v*', regex: /\bultravox-v[a-z0-9._-]*\b/i },
  { id: 'nova-3', regex: /\bnova-3\b/ },
  { id: 'aura-2-*', regex: /\baura-2-[a-z0-9._-]+\b/i },
];

function shouldSkipFile(filePath: string): boolean {
  const normalized = normalizeForMatch(path.normalize(filePath));
  return ALLOWLIST_PATH_PARTS.some((part) => normalized.includes(part));
}

function collectFiles(targetPath: string, out: string[]): void {
  const absolute = path.resolve(ROOT, targetPath);
  if (!existsSync(absolute)) return;

  const stats = statSync(absolute);
  if (stats.isFile()) {
    out.push(path.relative(ROOT, absolute));
    return;
  }

  const entries = readdirSync(absolute);
  for (const entry of entries) {
    const next = path.join(absolute, entry);
    const nextStats = statSync(next);
    if (nextStats.isDirectory()) {
      collectFiles(path.relative(ROOT, next), out);
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    out.push(path.relative(ROOT, next));
  }
}

function findViolations(filePath: string): Violation[] {
  const absolute = path.resolve(ROOT, filePath);
  const content = readFileSync(absolute, 'utf8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  lines.forEach((line, index) => {
    for (const pattern of BLOCKED_PATTERNS) {
      if (!pattern.regex.test(line)) continue;
      violations.push({
        file: filePath,
        line: index + 1,
        pattern: pattern.id,
        snippet: line.trim(),
      });
    }
  });

  return violations;
}

function main(): void {
  const files: string[] = [];
  for (const target of TARGETS) {
    collectFiles(target, files);
  }

  const uniqueFiles = [...new Set(files)];
  const violations: Violation[] = [];
  for (const file of uniqueFiles) {
    if (shouldSkipFile(file)) continue;
    violations.push(...findViolations(file));
  }

  if (violations.length === 0) {
    console.log('[boundary-check] OK: no blocked provider/model literals in guarded surfaces.');
    return;
  }

  console.error('[boundary-check] FAILED: provider/model literals detected outside voice-runtime:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.pattern}]`);
    console.error(`  ${violation.snippet}`);
  }
  process.exit(1);
}

main();
