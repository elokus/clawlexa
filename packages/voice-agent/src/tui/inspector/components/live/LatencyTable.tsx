/**
 * Latency breakdown table — per-stage current + P95 with threshold coloring.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useInspector } from '../../state.js';
import { fmtMs, p95 as calcP95 } from '../../util/format.js';
import type { LatencyStage } from '../../types.js';

const STAGES: LatencyStage[] = ['stt', 'llm', 'tts', 'turn', 'tool', 'connection'];

// Approximate thresholds for coloring (from PROVIDER_THRESHOLDS)
const WARN_THRESHOLDS: Partial<Record<LatencyStage, number>> = {
  stt: 500,
  llm: 1000,
  tts: 500,
  turn: 1500,
  connection: 2000,
};

function Row({ label, current, p95Val, count }: { label: string; current: number | null; p95Val: number | null; count: number }) {
  const threshold = WARN_THRESHOLDS[label as LatencyStage];
  const currentColor = current && threshold && current > threshold ? 'red' : 'green';
  const p95Color = p95Val && threshold && p95Val > threshold ? 'red' : 'green';

  return (
    <Box>
      <Text>{label.toUpperCase().padEnd(12)}</Text>
      <Text color={current != null ? currentColor : 'gray'}>
        {fmtMs(current).padEnd(10)}
      </Text>
      <Text color={p95Val != null ? p95Color : 'gray'}>
        {fmtMs(p95Val).padEnd(10)}
      </Text>
      <Text dimColor>{String(count).padStart(4)}</Text>
    </Box>
  );
}

export function LatencyTable() {
  const { state } = useInspector();

  return (
    <Box flexDirection="column">
      <Text bold>Latency</Text>
      <Box>
        <Text dimColor>{'Stage'.padEnd(12)}{'Current'.padEnd(10)}{'P95'.padEnd(10)}{'  Cnt'}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(38)}</Text>
      {STAGES.map((stage) => {
        const entry = state.latency.get(stage);
        return (
          <Row
            key={stage}
            label={stage}
            current={entry?.current ?? null}
            p95Val={entry ? calcP95(entry.samples) : null}
            count={entry?.samples.length ?? 0}
          />
        );
      })}
    </Box>
  );
}
