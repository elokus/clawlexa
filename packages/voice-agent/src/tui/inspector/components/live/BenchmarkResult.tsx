/**
 * Benchmark result overlay — shown when session disconnects.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useInspector } from '../../state.js';
import { fmtMs } from '../../util/format.js';

export function BenchmarkResult() {
  const { state } = useInspector();
  const { benchmarkReport, benchmarkOutputPath } = state;

  if (!benchmarkReport) return null;

  const pass = benchmarkReport.pass;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={pass ? 'green' : 'red'} paddingX={1}>
      <Text bold color={pass ? 'green' : 'red'}>
        Benchmark: {pass ? 'PASS' : 'FAIL'}
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>

      <Box>
        <Text dimColor>{'First Audio:'.padEnd(20)}</Text>
        <Text>{fmtMs(benchmarkReport.firstAudioLatencyMs)}</Text>
      </Box>
      <Box>
        <Text dimColor>{'Chunk P95:'.padEnd(20)}</Text>
        <Text>{fmtMs(benchmarkReport.chunkCadence.p95GapMs)}</Text>
      </Box>
      <Box>
        <Text dimColor>{'Interruption P95:'.padEnd(20)}</Text>
        <Text>{fmtMs(benchmarkReport.interruption.p95Ms)}</Text>
      </Box>
      <Box>
        <Text dimColor>{'RT Factor:'.padEnd(20)}</Text>
        <Text>{benchmarkReport.realtimeFactor?.toFixed(2) ?? 'n/a'}</Text>
      </Box>

      {benchmarkReport.violations.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Violations:</Text>
          {benchmarkReport.violations.map((v, i) => (
            <Text key={i} color="red">  • {v}</Text>
          ))}
        </Box>
      )}

      {benchmarkOutputPath && (
        <Box marginTop={1}>
          <Text dimColor>Report: {benchmarkOutputPath}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press any key to continue, q to quit</Text>
      </Box>
    </Box>
  );
}
