/**
 * Audio metrics panel — chunk count, cadence, interruptions, RT factor.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useInspector } from '../../state.js';
import { fmtMs, p95 as calcP95, median as calcMedian } from '../../util/format.js';

export function AudioMetrics() {
  const { state } = useInspector();
  const { chunkCount, chunkGaps, interruptionCount } = state.audio;

  const cadenceP95 = calcP95(chunkGaps);
  const cadenceMedian = calcMedian(chunkGaps);
  const maxGap = chunkGaps.length > 0 ? Math.max(...chunkGaps) : null;

  return (
    <Box flexDirection="column">
      <Text bold>Audio</Text>
      <Text dimColor>{'─'.repeat(24)}</Text>
      <Box>
        <Text dimColor>{'Chunks:'.padEnd(16)}</Text>
        <Text>{chunkCount}</Text>
      </Box>
      <Box>
        <Text dimColor>{'Cadence P95:'.padEnd(16)}</Text>
        <Text>{fmtMs(cadenceP95)}</Text>
      </Box>
      <Box>
        <Text dimColor>{'Cadence Median:'.padEnd(16)}</Text>
        <Text>{fmtMs(cadenceMedian)}</Text>
      </Box>
      <Box>
        <Text dimColor>{'Max gap:'.padEnd(16)}</Text>
        <Text>{fmtMs(maxGap)}</Text>
      </Box>
      <Box>
        <Text dimColor>{'Interrupts:'.padEnd(16)}</Text>
        <Text color={interruptionCount > 0 ? 'yellow' : undefined}>{interruptionCount}</Text>
      </Box>
    </Box>
  );
}
