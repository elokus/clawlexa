/**
 * Test script for text-based interaction with the voice agent.
 * This allows testing the agent without audio hardware.
 *
 * Usage: npx tsx src/test-text.ts
 */

import * as readline from 'readline';
import { validateConfig } from './config.js';
import { VoiceAgent } from './agent/voice-agent.js';

async function main() {
  console.log('Voice Agent Text Test');
  console.log('======================');
  console.log('This test uses text input/output to verify the agent works.');
  console.log('');

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', error);
    process.exit(1);
  }

  const agent = new VoiceAgent();

  // Set up event handlers
  agent.on('stateChange', (state, profile) => {
    console.log(`\n[State] ${state}${profile ? ` (${profile})` : ''}`);
  });

  agent.on('transcript', (text, role) => {
    if (role === 'assistant') {
      console.log(`\n[Assistant] ${text}`);
    } else {
      console.log(`\n[User] ${text}`);
    }
  });

  agent.on('audio', (audio) => {
    if (audio.data) {
      console.log(`[Audio] Received ${audio.data.byteLength} bytes (not playing in text mode)`);
    }
  });

  agent.on('error', (error) => {
    console.error('\n[Error]', error.message);
  });

  // Activate with default profile
  console.log('Connecting to Jarvis profile...');
  const success = await agent.activate('jarvis');

  if (!success) {
    console.error('Failed to activate agent');
    process.exit(1);
  }

  console.log('\nAgent activated! Type your messages below.');
  console.log('Commands: /quit to exit, /interrupt to interrupt the agent\n');

  // Set up readline for text input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('You: ', (input) => {
      const trimmed = input.trim();

      if (trimmed === '/quit') {
        console.log('Disconnecting...');
        agent.deactivate();
        rl.close();
        process.exit(0);
      }

      if (trimmed === '/interrupt') {
        agent.interrupt();
        prompt();
        return;
      }

      if (trimmed) {
        agent.sendMessage(trimmed);
      }

      // Give some time for response before prompting again
      setTimeout(prompt, 100);
    });
  };

  prompt();

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nDisconnecting...');
    agent.deactivate();
    rl.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
