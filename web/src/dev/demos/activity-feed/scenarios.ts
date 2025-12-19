// ═══════════════════════════════════════════════════════════════════════════
// Activity Feed Demo Scenarios
// These are simplified mock scenarios for development.
// For real captured data, use the backend streaming endpoint.
// ═══════════════════════════════════════════════════════════════════════════

import type { StreamScenario, StreamEvent } from '../../registry';

// Helper to create subagent activity events
function activity(
  agent: string,
  type: string,
  payload: unknown,
  delay: number = 50
): StreamEvent {
  return {
    type: 'subagent_activity',
    payload: { agent, type, payload },
    delay,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI Agent - Code Review Scenario (simplified mock)
// Real captured data has token-by-token streaming with 0-20ms delays
// ═══════════════════════════════════════════════════════════════════════════

export const cliCodeReviewScenario: StreamScenario = {
  id: 'cli-code-review',
  name: 'CLI Code Review (Marvin)',
  description: 'Simplified mock - use Backend mode for real streaming',
  events: [
    // Reasoning phase - tokens arrive very fast
    activity('Marvin', 'reasoning_start', {}, 100),
    activity('Marvin', 'reasoning_delta', { delta: 'First' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ',' }, 20),
    activity('Marvin', 'reasoning_delta', { delta: ' identify' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' the' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' project' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ':' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' The' }, 21),
    activity('Marvin', 'reasoning_delta', { delta: ' user' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' says' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' "Kireon' }, 22),
    activity('Marvin', 'reasoning_delta', { delta: ' backend' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' project".' }, 20),
    activity('Marvin', 'reasoning_delta', { delta: ' From' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' the' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' project' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' locations,' }, 21),
    activity('Marvin', 'reasoning_delta', { delta: ' there\'s' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' ~/Code/Work/kireon/kireon-backend/.' }, 22),
    activity('Marvin', 'reasoning_delta', { delta: '\n\nThis' }, 20),
    activity('Marvin', 'reasoning_delta', { delta: ' is' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' a' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' review' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' task' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' -' }, 21),
    activity('Marvin', 'reasoning_delta', { delta: ' use' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' headless' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' mode' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' with' }, 1),
    activity('Marvin', 'reasoning_delta', { delta: ' claude' }, 20),
    activity('Marvin', 'reasoning_delta', { delta: ' -p.' }, 1),
    activity('Marvin', 'reasoning_end', {
      text: 'First, identify the project: The user says "Kireon backend project". From the project locations, there\'s ~/Code/Work/kireon/kireon-backend/.\n\nThis is a review task - use headless mode with claude -p.',
      durationMs: 1850
    }, 50),

    // Tool call
    activity('Marvin', 'tool_call', {
      toolName: 'start_headless_session',
      toolCallId: 'call_abc123',
      args: {
        project_path: '~/Code/Work/kireon/kireon-backend',
        prompt: 'Review the authentication implementation and identify any security concerns.',
      },
    }, 100),

    // Tool result (simulated - in real use this takes longer)
    activity('Marvin', 'tool_result', {
      toolName: 'start_headless_session',
      toolCallId: 'call_abc123',
      result: 'Code review completed. Found 3 issues: 1) Missing rate limiting, 2) Hardcoded JWT secret, 3) Weak password validation.',
    }, 2000),

    // Final response
    activity('Marvin', 'response', {
      text: 'I\'ve reviewed the authentication code in the Kireon backend. Found a few issues:\n\n1. **Rate Limiting**: Missing on login endpoint\n2. **JWT Secret**: Should be in environment variable\n3. **Password Validation**: Could be stricter\n\nWant me to create fixes?',
    }, 100),

    activity('Marvin', 'complete', { success: true }, 50),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Web Search Scenario (simplified - real has [REDACTED] reasoning)
// The :online model doesn't expose detailed reasoning
// ═══════════════════════════════════════════════════════════════════════════

export const webSearchScenario: StreamScenario = {
  id: 'web-search',
  name: 'Web Search (Jarvis)',
  description: 'Weather query - reasoning is minimal with :online models',
  events: [
    activity('Jarvis', 'reasoning_start', {}, 100),
    // Online models show [REDACTED] for reasoning
    activity('Jarvis', 'reasoning_delta', { delta: '[Web search in progress...]' }, 0),
    activity('Jarvis', 'reasoning_end', {
      text: '[Web search in progress...]',
      durationMs: 52000
    }, 52000),

    activity('Jarvis', 'response', {
      text: 'Morgen, den 20. Dezember 2025, wird es in Bonn bewölkt und regnerisch, mit Temperaturen von 6 bis 12 °C und möglichen Böen bis 50 km/h. Quellen wie wetter.com und wetter.de prognostizieren anhaltende Regenfälle tagsüber.',
    }, 500),

    activity('Jarvis', 'complete', { success: true }, 50),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Error Handling Scenario
// ═══════════════════════════════════════════════════════════════════════════

export const errorScenario: StreamScenario = {
  id: 'error-handling',
  name: 'Error Handling',
  description: 'Connection failure example',
  events: [
    activity('Marvin', 'reasoning_start', {}, 100),
    activity('Marvin', 'reasoning_delta', { delta: 'Attempting' }, 0),
    activity('Marvin', 'reasoning_delta', { delta: ' to' }, 20),
    activity('Marvin', 'reasoning_delta', { delta: ' connect...' }, 1),
    activity('Marvin', 'reasoning_end', { text: 'Attempting to connect...', durationMs: 450 }, 400),

    activity('Marvin', 'tool_call', {
      toolName: 'start_interactive_session',
      toolCallId: 'call_err456',
      args: {
        project_path: '~/Code/Private/kalm-monorepo',
        prompt: 'Add user authentication',
      },
    }, 100),

    activity('Marvin', 'error', {
      message: 'Connection refused: Mac daemon not running at http://MacBook-Pro-von-Lukasz.local:3100',
    }, 1500),

    activity('Marvin', 'complete', { success: false, error: 'Connection refused' }, 50),
  ],
};
