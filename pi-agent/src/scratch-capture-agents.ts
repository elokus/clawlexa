/**
 * Scratch file to capture real agent streaming events.
 *
 * This runs the actual web search and CLI agents and captures
 * all the events they broadcast, saving them to JSON files
 * for use in the component dev environment.
 *
 * Usage:
 *   npx tsx src/scratch-capture-agents.ts
 *
 * Output:
 *   - captured/web-search-<timestamp>.json
 *   - captured/cli-agent-<timestamp>.json
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { runObservableAgent, type AgentEvent } from './lib/agent-runner.js';
import { loadAgentConfig } from './subagents/loader.js';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// Event Capture
// ═══════════════════════════════════════════════════════════════════════════

interface CapturedEvent {
  type: string;
  payload: {
    agent: string;
    type: string;
    payload: unknown;
  };
  delay: number;
  timestamp: number;
}

let capturedEvents: CapturedEvent[] = [];
let lastEventTime = 0;

function captureEvent(event: AgentEvent) {
  const now = Date.now();
  const delay = lastEventTime ? now - lastEventTime : 0;
  lastEventTime = now;

  capturedEvents.push({
    type: 'subagent_activity',
    payload: event,
    delay,
    timestamp: now,
  });

  // Log to console for visibility
  const preview = JSON.stringify(event.payload).slice(0, 80);
  console.log(`  [${event.type}] ${preview}${preview.length >= 80 ? '...' : ''}`);
}

function resetCapture() {
  capturedEvents = [];
  lastEventTime = 0;
}

function saveCapture(filename: string) {
  const dir = path.join(import.meta.dirname, 'captured');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(capturedEvents, null, 2));
  console.log(`\n✅ Saved ${capturedEvents.length} events to ${filepath}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Web Search Agent Capture
// ═══════════════════════════════════════════════════════════════════════════

async function captureWebSearch(query: string) {
  console.log('\n' + '='.repeat(60));
  console.log('CAPTURING WEB SEARCH AGENT');
  console.log('='.repeat(60));
  console.log(`Query: "${query}"\n`);

  resetCapture();

  const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    console.error('❌ OPEN_ROUTER_API_KEY not set');
    return;
  }

  try {
    const { config, prompt: systemPrompt } = await loadAgentConfig(
      path.join(import.meta.dirname, 'subagents/web-search')
    );

    console.log(`Model: ${config.model}`);
    console.log(`Agent: ${config.name}\n`);
    console.log('Events:');

    const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
    const model = openrouter.chat(config.model);

    const result = await runObservableAgent({
      name: config.name,
      model,
      system: systemPrompt,
      prompt: query,
      tools: {},
      maxSteps: config.maxSteps ?? 1,
      onEvent: captureEvent,
    });

    console.log('\n--- Agent Response ---');
    console.log(result.slice(0, 500) + (result.length > 500 ? '...' : ''));
    console.log('--- End Response ---');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    saveCapture(`web-search-${timestamp}.json`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI Agent Capture (reasoning only - no tool execution)
// ═══════════════════════════════════════════════════════════════════════════

async function captureCliAgent(request: string) {
  console.log('\n' + '='.repeat(60));
  console.log('CAPTURING CLI AGENT (reasoning only)');
  console.log('='.repeat(60));
  console.log(`Request: "${request}"\n`);

  resetCapture();

  const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    console.error('❌ OPEN_ROUTER_API_KEY not set');
    return;
  }

  try {
    const { config, prompt: systemPrompt } = await loadAgentConfig(
      path.join(import.meta.dirname, 'subagents/cli')
    );

    console.log(`Model: ${config.model}`);
    console.log(`Agent: ${config.name}\n`);
    console.log('Events:');

    const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
    const model = openrouter.chat(config.model);

    // Simplified prompt for reasoning capture (no actual tool execution)
    const userMessage = `
## Current Request
${request}

Analyze this request and explain your reasoning. What would you do?
Think through the steps carefully before responding.
`.trim();

    const result = await runObservableAgent({
      name: config.name,
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools: {}, // No tools - just reasoning
      maxSteps: 1,
      onEvent: captureEvent,
    });

    console.log('\n--- Agent Response ---');
    console.log(result.slice(0, 500) + (result.length > 500 ? '...' : ''));
    console.log('--- End Response ---');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    saveCapture(`cli-agent-${timestamp}.json`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('🎬 Agent Event Capture Tool');
  console.log('This will run real agents and capture their streaming events.\n');

  // Check for required env vars
  if (!process.env.OPEN_ROUTER_API_KEY) {
    console.error('❌ Please set OPEN_ROUTER_API_KEY environment variable');
    console.error('   export OPEN_ROUTER_API_KEY=your-key-here');
    process.exit(1);
  }

  // Capture web search
  await captureWebSearch('Wie wird das Wetter morgen in Bonn?');

  // Small delay between captures
  await new Promise(r => setTimeout(r, 2000));

  // Capture CLI agent reasoning
  await captureCliAgent('Review the authentication code in the Kireon backend project');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Capture complete!');
  console.log('Check pi-agent/src/captured/ for JSON files.');
  console.log('='.repeat(60));
}

main().catch(console.error);
