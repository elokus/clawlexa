/**
 * One-line display of resolved runtime configuration.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useInspector } from '../../state.js';

export function ConfigSummary() {
  const { state } = useInspector();
  const { config } = state;

  if (!config) {
    return <Text dimColor>Config: not loaded</Text>;
  }

  const parts = [`model=${config.model}`, `voice=${config.voice}`, `lang=${config.language}`];

  if (config.mode === 'decomposed') {
    if (config.sttProvider) parts.push(`stt=${config.sttProvider}:${config.sttModel}`);
    if (config.llmProvider) parts.push(`llm=${config.llmProvider}:${config.llmModel}`);
    if (config.ttsProvider) parts.push(`tts=${config.ttsProvider}:${config.ttsModel}`);
  }

  return (
    <Box>
      <Text dimColor>{parts.join('  ')}</Text>
    </Box>
  );
}
