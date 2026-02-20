/**
 * Voice Runtime Inspector TUI — Ink entrypoint.
 */

import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import type { InspectorArgs } from './types.js';

export function run(args: InspectorArgs) {
  const instance = render(<App args={args} />);

  // Graceful shutdown
  const cleanup = () => {
    instance.unmount();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return instance;
}
