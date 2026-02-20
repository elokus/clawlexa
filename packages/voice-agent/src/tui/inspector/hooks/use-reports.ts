/**
 * Hook for loading and managing benchmark report files.
 */

import { useEffect, useCallback } from 'react';
import fs from 'fs';
import path from 'path';
import { useInspector } from '../state.js';
import type { ReportListEntry, BenchmarkReportFile } from '../types.js';

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

function loadReportList(directory: string): ReportListEntry[] {
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a)) // newest first
    .map((filename) => {
      const filePath = path.join(directory, filename);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw) as BenchmarkReportFile;
        return {
          filename,
          path: filePath,
          provider: data.meta?.provider ?? 'unknown',
          profile: data.meta?.profile ?? 'unknown',
          pass: data.report?.pass ?? false,
          date: data.meta?.startedAt ?? filename,
        };
      } catch {
        return {
          filename,
          path: filePath,
          provider: 'unknown',
          profile: 'unknown',
          pass: false,
          date: filename,
        };
      }
    });
}

export function useReports() {
  const { state, dispatch } = useInspector();
  const dir = resolveBenchmarkDir();

  // Load report list on mount
  useEffect(() => {
    const reports = loadReportList(dir);
    dispatch({ type: 'REPORTS_LOADED', reports });
  }, [dir, dispatch]);

  // Load selected report detail
  useEffect(() => {
    const entry = state.reportFiles[state.selectedReportIndex];
    if (!entry) return;
    // Skip if already loaded
    if (state.selectedReport && state.selectedReport.meta?.provider === entry.provider) return;

    try {
      const raw = fs.readFileSync(entry.path, 'utf8');
      const detail = JSON.parse(raw) as BenchmarkReportFile;
      dispatch({ type: 'REPORT_DETAIL_LOADED', detail });
    } catch {
      dispatch({ type: 'ERROR', message: `Failed to load report: ${entry.filename}` });
    }
  }, [state.selectedReportIndex, state.reportFiles, dispatch]);

  const selectNext = useCallback(() => {
    const next = Math.min(state.selectedReportIndex + 1, state.reportFiles.length - 1);
    dispatch({ type: 'SELECT_REPORT', index: next });
  }, [state.selectedReportIndex, state.reportFiles.length, dispatch]);

  const selectPrev = useCallback(() => {
    const prev = Math.max(state.selectedReportIndex - 1, 0);
    dispatch({ type: 'SELECT_REPORT', index: prev });
  }, [state.selectedReportIndex, dispatch]);

  return {
    reports: state.reportFiles,
    selectedIndex: state.selectedReportIndex,
    selectedReport: state.selectedReport,
    benchmarkDir: dir,
    selectNext,
    selectPrev,
  };
}
