/**
 * Scrollable list of benchmark reports with PASS/FAIL indicators.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ReportListEntry } from '../../types.js';
import { truncate } from '../../util/format.js';

interface ReportListProps {
  reports: ReportListEntry[];
  selectedIndex: number;
  visibleCount?: number;
}

export function ReportList({ reports, selectedIndex, visibleCount = 15 }: ReportListProps) {
  if (reports.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No benchmark reports found.</Text>
        <Text dimColor>Run a voice session with VOICE_BENCHMARK_ENABLED=true</Text>
      </Box>
    );
  }

  // Window around selected index
  const half = Math.floor(visibleCount / 2);
  let start = Math.max(0, selectedIndex - half);
  const end = Math.min(reports.length, start + visibleCount);
  if (end - start < visibleCount) {
    start = Math.max(0, end - visibleCount);
  }

  const visible = reports.slice(start, end);

  return (
    <Box flexDirection="column">
      <Text bold>Reports ({reports.length})</Text>
      <Text dimColor>{'─'.repeat(44)}</Text>
      {visible.map((report, i) => {
        const idx = start + i;
        const isSelected = idx === selectedIndex;
        const statusIcon = report.pass ? '✓' : '✗';
        const statusColor = report.pass ? 'green' : 'red';
        const prefix = isSelected ? '▸ ' : '  ';

        return (
          <Box key={report.filename}>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {prefix}
            </Text>
            <Text color={statusColor}>{statusIcon} </Text>
            <Text color={isSelected ? 'cyan' : undefined}>
              {truncate(report.provider, 18)}
            </Text>
            <Text dimColor> {truncate(report.profile, 8)} </Text>
            <Text dimColor>{report.date.slice(0, 10)}</Text>
          </Box>
        );
      })}
      {reports.length > visibleCount && (
        <Text dimColor>
          [{start + 1}-{end} of {reports.length}] ↑↓ to navigate
        </Text>
      )}
    </Box>
  );
}
