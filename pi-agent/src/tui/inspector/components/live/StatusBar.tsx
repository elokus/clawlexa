/**
 * Status bar — provider, mode, connection state, agent state, mic, duration.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useInspector } from '../../state.js';
import { stateColor, fmtDuration } from '../../util/format.js';

export function StatusBar() {
  const { state } = useInspector();
  const [, forceUpdate] = useState(0);

  // Tick every second for duration timer
  useEffect(() => {
    if (state.connectionStatus !== 'connected') return;
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [state.connectionStatus]);

  const connectionColor =
    state.connectionStatus === 'connected' ? 'green' :
    state.connectionStatus === 'connecting' ? 'yellow' : 'red';

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>Provider: </Text>
        <Text color="cyan">{state.provider ?? 'none'}</Text>
        <Text>  </Text>
        <Text bold>State: </Text>
        <Text color={stateColor(state.agentState)}>
          {'● ' + state.agentState.toUpperCase()}
        </Text>
        <Text>  </Text>
        <Text bold>Mic: </Text>
        <Text color={state.muted ? 'red' : 'green'}>
          {state.muted ? 'MUTED' : 'LIVE'}
        </Text>
      </Box>
      <Box>
        <Text bold>Mode: </Text>
        <Text>{state.voiceMode ?? 'n/a'}</Text>
        <Text>  </Text>
        <Text bold>Status: </Text>
        <Text color={connectionColor}>{state.connectionStatus}</Text>
        <Text>  </Text>
        <Text bold>Duration: </Text>
        <Text>{fmtDuration(state.sessionStartedAt)}</Text>
      </Box>
      <Box>
        <Text bold>Input: </Text>
        <Text color="cyan">{state.audioDevices.inputDevice}</Text>
        <Text>  </Text>
        <Text bold>Output: </Text>
        <Text color="cyan">{state.audioDevices.outputDevice}</Text>
      </Box>
    </Box>
  );
}
