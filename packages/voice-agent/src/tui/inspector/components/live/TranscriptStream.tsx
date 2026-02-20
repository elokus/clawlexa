/**
 * Transcript stream — user/assistant messages with streaming delta rendering.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useInspector } from '../../state.js';
import { truncate } from '../../util/format.js';

const MAX_VISIBLE = 20;

export function TranscriptStream() {
  const { state } = useInspector();
  const { transcripts } = state;

  // Show last N transcripts
  const visible = transcripts.slice(-MAX_VISIBLE);

  if (visible.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Transcript</Text>
        <Text dimColor>{'─'.repeat(60)}</Text>
        <Text dimColor>Waiting for conversation...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Transcript</Text>
      <Text dimColor>{'─'.repeat(60)}</Text>
      {visible.map((entry, i) => {
        const roleTag = entry.role === 'user' ? '[U]' : '[A]';
        const roleColor = entry.role === 'user' ? 'blue' : 'green';
        const cursor = entry.isStreaming ? '█' : '';

        return (
          <Box key={`${entry.id}-${i}`}>
            <Text color={roleColor} bold>{roleTag} </Text>
            <Text wrap="wrap">
              {truncate(entry.text, 200)}{cursor}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
