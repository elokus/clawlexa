/**
 * Live mode layout container — wires hooks and combines all panels.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { useInspector } from '../../state.js';
import { useRuntime, type ConnectResult } from '../../hooks/use-runtime.js';
import { useAudio } from '../../hooks/use-audio.js';
import { useBenchmark } from '../../hooks/use-benchmark.js';
import { useKeyboard } from '../../hooks/use-keyboard.js';
import { StatusBar } from './StatusBar.js';
import { LatencyTable } from './LatencyTable.js';
import { AudioMetrics } from './AudioMetrics.js';
import { TranscriptStream } from './TranscriptStream.js';
import { ConfigSummary } from './ConfigSummary.js';
import { BenchmarkResult } from './BenchmarkResult.js';
import type { InspectorArgs } from '../../types.js';

interface LiveInspectorProps {
  args: InspectorArgs;
}

export function LiveInspector({ args }: LiveInspectorProps) {
  const { state, dispatch } = useInspector();
  const { exit } = useApp();
  const runtimeHandle = useRuntime(args.profile, args.provider);
  const audioHandle = useAudio();
  const benchmarkHandle = useBenchmark();
  const connectedOnce = useRef(false);

  /** Wire audio + benchmark after connect using the shared event mux. */
  const wireAfterConnect = useCallback(async (result: ConnectResult) => {
    const { runtime, mux } = result;
    await audioHandle.start(runtime, mux);
    benchmarkHandle.attach(mux, state.provider!, args.profile, `tui-${Date.now()}`);
  }, [audioHandle, benchmarkHandle, state.provider, args.profile]);

  // Auto-connect on mount
  useEffect(() => {
    if (connectedOnce.current) return;
    connectedOnce.current = true;

    (async () => {
      const result = await runtimeHandle.connect();
      if (result) await wireAfterConnect(result);
    })().catch((err) => {
      dispatch({ type: 'ERROR', message: `Startup failed: ${(err as Error).message}` });
    });
  }, []);

  const handleQuit = useCallback(() => {
    audioHandle.stop();
    benchmarkHandle.finalize('disconnected');
    runtimeHandle.disconnect();
    // Give a moment for benchmark result to render
    setTimeout(() => exit(), 100);
  }, [audioHandle, benchmarkHandle, runtimeHandle, exit]);

  const handleReconnect = useCallback(async () => {
    audioHandle.stop();
    benchmarkHandle.finalize('disconnected');
    runtimeHandle.disconnect();

    const result = await runtimeHandle.connect();
    if (result) await wireAfterConnect(result);
  }, [audioHandle, benchmarkHandle, runtimeHandle, wireAfterConnect]);

  const handleSwitchProfile = useCallback(() => {
    const profileNames = ['jarvis', 'marvin'];
    const currentIdx = profileNames.indexOf(args.profile.toLowerCase());
    const nextProfile = profileNames[(currentIdx + 1) % profileNames.length]!;
    dispatch({ type: 'ERROR', message: `Profile switch to "${nextProfile}" requires restart. Use: --profile=${nextProfile}` });
  }, [args.profile, dispatch]);

  const handleSendText = useCallback((text: string) => {
    runtimeHandle.sendMessage(text);
  }, [runtimeHandle]);

  const textBuffer = useKeyboard({
    onQuit: handleQuit,
    onToggleMute: audioHandle.toggleMute,
    onReconnect: () => { handleReconnect().catch(() => {}); },
    onSwitchProfile: handleSwitchProfile,
    onCycleInputDevice: audioHandle.cycleInputDevice,
    onCycleOutputDevice: audioHandle.cycleOutputDevice,
    onTextInput: () => dispatch({ type: 'SET_TEXT_INPUT', active: true }),
    onSendText: handleSendText,
    onDismiss: () => dispatch({ type: 'SET_TEXT_INPUT', active: false }),
    textInputActive: state.textInputActive,
  });

  // Show benchmark overlay if session ended with results
  if (state.showBenchmarkResult && state.benchmarkReport) {
    return <BenchmarkResult />;
  }

  return (
    <Box flexDirection="column">
      {/* Status Bar */}
      <StatusBar />

      <Text dimColor>{'─'.repeat(68)}</Text>

      {/* Metrics Row: Latency + Audio side by side */}
      <Box>
        <Box flexDirection="column" width="60%">
          <LatencyTable />
        </Box>
        <Box flexDirection="column" flexGrow={1} marginLeft={2}>
          <AudioMetrics />
        </Box>
      </Box>

      <Text dimColor>{'─'.repeat(68)}</Text>

      {/* Transcript Stream */}
      <TranscriptStream />

      <Text dimColor>{'─'.repeat(68)}</Text>

      {/* Config Summary */}
      <ConfigSummary />

      {/* Errors */}
      {state.errors.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red" bold>Errors:</Text>
          {state.errors.slice(-3).map((err, i) => (
            <Text key={i} color="red">  {err}</Text>
          ))}
        </Box>
      )}

      {/* Active Tools */}
      {state.activeTools.length > 0 && (
        <Box flexDirection="column">
          {state.activeTools.filter((t) => !t.finishedAt).map((tool) => (
            <Text key={tool.callId ?? tool.name} color="yellow">
              ⌘ {tool.name}({JSON.stringify(tool.args).slice(0, 40)})
            </Text>
          ))}
        </Box>
      )}

      {/* Text Input Mode */}
      {state.textInputActive && (
        <Box>
          <Text color="cyan">{'> '}</Text>
          <Text>{textBuffer}</Text>
          <Text color="gray">█</Text>
          {!textBuffer && <Text dimColor> Type message, Enter to send, Esc to cancel</Text>}
        </Box>
      )}

      {/* Help Bar */}
      <Box marginTop={1}>
        <Text dimColor>Space:mute  i:input  o:output  q:quit  r:reconnect  p:profile  Enter:text input</Text>
      </Box>
    </Box>
  );
}
