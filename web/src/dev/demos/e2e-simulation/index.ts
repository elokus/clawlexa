/**
 * E2E Simulation Demo - Registration
 *
 * Loads captured scenarios from the captured/ folder and registers
 * them as playable demos in the dev environment.
 */

import { registerDemo, type StreamScenario, type StreamEvent } from '../../registry';
import { E2ESimulationDemo } from './component';

// Import captured scenario
import marvinCLISession from '../captured/marvin-cli-session-headless.json';
import marvine2einteractivecoding from '../captured/e2e-interactive-coding-session.json';

// Convert captured scenario format to StreamScenario
function convertCapturedScenario(
  captured: {
    id: string;
    name: string;
    description: string;
    capturedAt: string;
    events: Array<{
      type: string;
      payload: unknown;
      timestamp: number;
      delay: number;
    }>;
  }
): StreamScenario {
  return {
    id: captured.id,
    name: captured.name,
    description: `${captured.description} (captured ${new Date(captured.capturedAt).toLocaleDateString()})`,
    events: captured.events.map((e) => ({
      type: e.type as StreamEvent['type'],
      payload: e.payload,
      delay: e.delay,
    })),
  };
}

// Register the e2e simulation demo
registerDemo({
  id: 'e2e-simulation',
  name: 'E2E Simulation',
  description: 'Full app layout with real stores - main panel + ThreadRail',
  category: 'session',
  component: E2ESimulationDemo,
  scenarios: [
    convertCapturedScenario(marvinCLISession),
    convertCapturedScenario(marvine2einteractivecoding),
  ],
});
