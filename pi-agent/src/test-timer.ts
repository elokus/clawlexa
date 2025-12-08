/**
 * Test script for timer functionality.
 * Run with: npm run test:timer
 */

import { TimersRepository } from './db/index.js';
import { Scheduler, parseTimeExpression, formatTimerResponse } from './scheduler/index.js';
import { speak } from './audio/tts.js';

async function testTimeParser() {
  console.log('\n=== Testing Time Parser ===\n');

  const testCases = [
    'in 5 minutes',
    'in einer Stunde',
    'in 30 Sekunden',
    'at 3pm',
    'um 15 Uhr',
    'um 9:30 Uhr',
    'tomorrow at 9am',
    'morgen um 8 Uhr',
  ];

  for (const expr of testCases) {
    const result = parseTimeExpression(expr);
    if (result) {
      console.log(`"${expr}" → ${result.date.toISOString()} (${result.description})`);
    } else {
      console.log(`"${expr}" → COULD NOT PARSE`);
    }
  }
}

async function testScheduler() {
  console.log('\n=== Testing Scheduler ===\n');

  const timersRepo = new TimersRepository();
  const scheduler = new Scheduler(500); // Check every 500ms for testing

  // Clean up any existing test timers
  const pending = timersRepo.getPending();
  for (const t of pending) {
    if (t.message.startsWith('Test:')) {
      timersRepo.delete(t.id);
    }
  }

  // Create a test timer that fires in 3 seconds
  const timer = timersRepo.create({
    fire_at: new Date(Date.now() + 3000),
    message: 'Test: Drei Sekunden sind vergangen!',
    mode: 'tts',
  });
  console.log(`Created timer #${timer.id}: fires in 3 seconds`);

  // Set up event handler
  scheduler.on('timerFired', async (firedTimer) => {
    console.log(`\n>>> Timer #${firedTimer.id} FIRED: "${firedTimer.message}"`);

    // Speak the message
    try {
      console.log('Speaking message via TTS...');
      await speak(firedTimer.message);
      console.log('TTS complete!');
    } catch (error) {
      console.error('TTS error:', error);
    }

    // Clean up and exit
    scheduler.stop();
    console.log('\nTest complete!');
    process.exit(0);
  });

  // Start scheduler
  scheduler.start();
  console.log('Scheduler started, waiting for timer to fire...\n');

  // Timeout after 10 seconds
  setTimeout(() => {
    console.error('Test timed out!');
    scheduler.stop();
    process.exit(1);
  }, 10000);
}

async function testTimerResponse() {
  console.log('\n=== Testing Timer Response Format ===\n');

  const testCases = [
    { message: 'Pizza aus dem Ofen', minutes: 5 },
    { message: 'Meeting', minutes: 60 },
    { message: 'Wäsche aufhängen', minutes: 90 },
  ];

  for (const { message, minutes } of testCases) {
    const fireAt = new Date(Date.now() + minutes * 60 * 1000);
    const response = formatTimerResponse(message, fireAt);
    console.log(`${minutes}min: "${response}"`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--parser')) {
    await testTimeParser();
  } else if (args.includes('--scheduler')) {
    await testScheduler();
  } else if (args.includes('--response')) {
    await testTimerResponse();
  } else {
    // Run all tests
    await testTimeParser();
    await testTimerResponse();
    console.log('\nTo test scheduler with TTS, run: npm run test:timer -- --scheduler');
  }
}

main().catch(console.error);
