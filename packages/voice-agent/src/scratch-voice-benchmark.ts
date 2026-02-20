/**
 * Voice benchmark report inspector.
 *
 * Usage:
 * - bun run src/scratch-voice-benchmark.ts list
 * - bun run src/scratch-voice-benchmark.ts latest
 * - bun run src/scratch-voice-benchmark.ts /absolute/or/relative/report.json
 */

import fs from 'fs';
import path from 'path';

interface BenchmarkReportFile {
  meta?: {
    sessionId?: string;
    profile?: string;
    provider?: string;
    startedAt?: string;
    finishedAt?: string;
    reason?: string;
  };
  report?: {
    pass?: boolean;
    violations?: string[];
    firstAudioLatencyMs?: number;
    chunkCadence?: {
      p95GapMs?: number;
      maxGapMs?: number;
    };
    interruption?: {
      p95Ms?: number;
    };
    transcriptOrdering?: {
      duplicateAssistantFinals?: number;
      outOfOrderAssistantItems?: number;
    };
  };
}

function resolveBenchmarkDir(): string {
  if (process.env.VOICE_BENCH_OUTPUT_DIR) {
    return path.resolve(process.cwd(), process.env.VOICE_BENCH_OUTPUT_DIR);
  }

  const cwdBase = path.basename(process.cwd());
  if (cwdBase === 'voice-agent') {
    return path.resolve(process.cwd(), '..', '..', '.benchmarks', 'voice');
  }
  return path.resolve(process.cwd(), '.benchmarks', 'voice');
}

function listReports(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));
}

function loadReport(filePath: string): BenchmarkReportFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as BenchmarkReportFile;
}

function printReport(filePath: string, report: BenchmarkReportFile): void {
  const meta = report.meta ?? {};
  const metrics = report.report ?? {};
  const status = metrics.pass ? 'PASS' : 'FAIL';
  console.log(`\n[voice-benchmark] ${status}`);
  console.log(`file=${filePath}`);
  console.log(`provider=${meta.provider ?? '(unknown)'} profile=${meta.profile ?? '(unknown)'}`);
  console.log(`session=${meta.sessionId ?? '(unknown)'} reason=${meta.reason ?? '(unknown)'}`);
  console.log(`firstAudioMs=${metrics.firstAudioLatencyMs ?? '(n/a)'}`);
  console.log(
    `chunkP95Ms=${metrics.chunkCadence?.p95GapMs ?? '(n/a)'} chunkMaxMs=${metrics.chunkCadence?.maxGapMs ?? '(n/a)'}`
  );
  console.log(`interruptP95Ms=${metrics.interruption?.p95Ms ?? '(n/a)'}`);
  console.log(
    `duplicates=${metrics.transcriptOrdering?.duplicateAssistantFinals ?? '(n/a)'} outOfOrder=${metrics.transcriptOrdering?.outOfOrderAssistantItems ?? '(n/a)'}`
  );
  const violations = metrics.violations ?? [];
  if (violations.length > 0) {
    console.log('violations:');
    for (const violation of violations) {
      console.log(`- ${violation}`);
    }
  }
}

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? 'latest').trim();
  const directory = resolveBenchmarkDir();

  if (arg === 'list') {
    const files = listReports(directory);
    if (files.length === 0) {
      console.log(`[voice-benchmark] no reports at ${directory}`);
      return;
    }
    console.log(`[voice-benchmark] reports at ${directory}`);
    for (const name of files) {
      console.log(`- ${name}`);
    }
    return;
  }

  let targetPath: string;
  if (arg === 'latest') {
    const files = listReports(directory);
    if (files.length === 0) {
      console.log(`[voice-benchmark] no reports at ${directory}`);
      return;
    }
    const latest = files[files.length - 1];
    if (!latest) {
      console.log(`[voice-benchmark] no reports at ${directory}`);
      return;
    }
    targetPath = path.join(directory, latest);
  } else {
    targetPath = path.resolve(process.cwd(), arg);
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Report not found: ${targetPath}`);
  }

  const report = loadReport(targetPath);
  printReport(targetPath, report);
}

main().catch((error) => {
  console.error('[voice-benchmark] failed:', error);
  process.exit(1);
});
