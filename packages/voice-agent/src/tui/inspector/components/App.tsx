/**
 * Root component — routes between live and report modes.
 */

import React, { useReducer } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { InspectorContext, inspectorReducer, createInitialState } from '../state.js';
import { LiveInspector } from './live/LiveInspector.js';
import { ReportBrowser } from './report/ReportBrowser.js';
import type { InspectorArgs } from '../types.js';

interface AppProps {
  args: InspectorArgs;
}

export function App({ args }: AppProps) {
  const [state, dispatch] = useReducer(inspectorReducer, createInitialState(args.mode, args.profile));
  const { exit } = useApp();

  // Global quit handler (report mode only — live mode handles its own quit for cleanup)
  useInput((input) => {
    if (input === 'q' && state.mode === 'report') {
      exit();
    }
  });

  return (
    <InspectorContext.Provider value={{ state, dispatch }}>
      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        {/* Header */}
        <Box>
          <Text bold color="cyan">Voice Runtime Inspector</Text>
          <Text color="gray"> | </Text>
          <Text color="gray">mode: {args.mode}</Text>
          <Text color="gray"> | </Text>
          <Text color="gray">profile: {args.profile}</Text>
          {args.provider && (
            <>
              <Text color="gray"> | </Text>
              <Text color="gray">provider: {args.provider}</Text>
            </>
          )}
        </Box>

        {/* Mode Content */}
        <Box marginTop={1} flexDirection="column">
          {state.mode === 'live' ? (
            <LiveInspector args={args} />
          ) : (
            <ReportBrowser />
          )}
        </Box>
      </Box>
    </InspectorContext.Provider>
  );
}
