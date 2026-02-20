/**
 * Detailed view of a single benchmark report with threshold comparison.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { BenchmarkReportFile } from '../../types.js';
import { fmtMs, exceedsThreshold } from '../../util/format.js';

interface ReportDetailProps {
  report: BenchmarkReportFile | null;
}

function MetricRow({ label, value, threshold }: { label: string; value: number | undefined | null; threshold?: number }) {
  const formatted = fmtMs(value ?? null);
  const exceeded = exceedsThreshold(value ?? null, threshold);
  return (
    <Box>
      <Text dimColor>{label.padEnd(26)}</Text>
      <Text color={exceeded ? 'red' : 'green'}>{formatted.padEnd(10)}</Text>
      {threshold != null && (
        <Text dimColor>{'< ' + fmtMs(threshold)}</Text>
      )}
    </Box>
  );
}

export function ReportDetail({ report }: ReportDetailProps) {
  if (!report) {
    return <Text dimColor>Select a report to view details</Text>;
  }

  const { meta, thresholds, report: metrics } = report;
  const pass = metrics.pass;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color={pass ? 'green' : 'red'}>
          {pass ? '✓ PASS' : '✗ FAIL'}
        </Text>
        <Text> — </Text>
        <Text bold>{meta.provider}</Text>
        <Text dimColor> ({meta.profile})</Text>
      </Box>

      {/* Meta */}
      <Text dimColor>{'─'.repeat(50)}</Text>
      <Text dimColor>Session: {meta.sessionId}</Text>
      <Text dimColor>Reason: {meta.reason}</Text>
      <Text dimColor>Started: {meta.startedAt}</Text>
      <Text dimColor>Finished: {meta.finishedAt}</Text>

      {/* Metrics */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Metrics</Text>
        <Text dimColor>{'─'.repeat(50)}</Text>
        <MetricRow
          label="First Audio Latency"
          value={metrics.firstAudioLatencyMs}
          threshold={thresholds.maxFirstAudioLatencyMs}
        />
        <MetricRow
          label="Chunk Cadence P95"
          value={metrics.chunkCadence.p95GapMs}
          threshold={thresholds.maxP95ChunkGapMs}
        />
        <MetricRow
          label="Chunk Cadence Max"
          value={metrics.chunkCadence.maxGapMs}
          threshold={thresholds.maxChunkGapMs}
        />
        <MetricRow
          label="Chunk Cadence Median"
          value={metrics.chunkCadence.medianGapMs}
        />
        <MetricRow
          label="Chunk Jitter P95"
          value={metrics.chunkCadence.p95JitterMs}
        />
        <MetricRow
          label="Realtime Factor"
          value={metrics.realtimeFactor}
          threshold={thresholds.maxRealtimeFactor}
        />
        <MetricRow
          label="Interruption P95"
          value={metrics.interruption.p95Ms}
          threshold={thresholds.maxInterruptionP95Ms}
        />
        <MetricRow
          label="Interruption Max"
          value={metrics.interruption.maxMs}
        />
        <MetricRow
          label="Interruption Count"
          value={metrics.interruption.count}
        />
      </Box>

      {/* Transcript Ordering */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Transcript Ordering</Text>
        <Text dimColor>{'─'.repeat(50)}</Text>
        <Box>
          <Text dimColor>{'Duplicate Finals'.padEnd(26)}</Text>
          <Text color={metrics.transcriptOrdering.duplicateAssistantFinals > 0 ? 'red' : 'green'}>
            {metrics.transcriptOrdering.duplicateAssistantFinals}
          </Text>
        </Box>
        <Box>
          <Text dimColor>{'Out-of-Order Items'.padEnd(26)}</Text>
          <Text color={metrics.transcriptOrdering.outOfOrderAssistantItems > 0 ? 'red' : 'green'}>
            {metrics.transcriptOrdering.outOfOrderAssistantItems}
          </Text>
        </Box>
      </Box>

      {/* Violations */}
      {metrics.violations.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="red">Violations ({metrics.violations.length})</Text>
          <Text dimColor>{'─'.repeat(50)}</Text>
          {metrics.violations.map((v, i) => (
            <Text key={i} color="red">• {v}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
