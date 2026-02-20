/**
 * Quick test script for database functionality.
 * Run with: npx tsx src/test-db.ts
 */

import {
  getDatabase,
  closeDatabase,
  CliSessionsRepository,
  CliEventsRepository,
  TimersRepository,
  AgentRunsRepository,
} from './db/index.js';

async function main() {
  console.log('Testing database...\n');

  // Initialize database
  const db = getDatabase();
  console.log('Database initialized\n');

  // Test CLI Sessions
  console.log('=== CLI Sessions ===');
  const sessionsRepo = new CliSessionsRepository(db);
  const session = sessionsRepo.create({ goal: 'Test session for Phase 2' });
  console.log('Created session:', session);

  sessionsRepo.updateStatus(session.id, 'running');
  console.log('Updated status to running');

  const found = sessionsRepo.findById(session.id);
  console.log('Found session:', found);

  // Test CLI Events
  console.log('\n=== CLI Events ===');
  const eventsRepo = new CliEventsRepository(db);
  const event = eventsRepo.create({
    session_id: session.id,
    event_type: 'created',
    payload: { test: true },
  });
  console.log('Created event:', event);

  const events = eventsRepo.getBySession(session.id);
  console.log('Events for session:', events);

  // Test Timers
  console.log('\n=== Timers ===');
  const timersRepo = new TimersRepository(db);
  const timer = timersRepo.create({
    fire_at: new Date(Date.now() + 60000), // 1 minute from now
    message: 'Test reminder',
    mode: 'tts',
  });
  console.log('Created timer:', timer);

  const pending = timersRepo.getPending();
  console.log('Pending timers:', pending);

  // Test Agent Runs
  console.log('\n=== Agent Runs ===');
  const runsRepo = new AgentRunsRepository(db);
  const run = runsRepo.create({
    profile: 'jarvis',
    transcript: 'user: Hello\nassistant: Hi there!',
  });
  console.log('Created agent run:', run);

  const stats = runsRepo.getStats();
  console.log('Stats:', stats);

  // Cleanup test data
  console.log('\n=== Cleanup ===');
  sessionsRepo.delete(session.id); // Will cascade to events
  timersRepo.delete(timer.id);
  console.log('Cleaned up test data');

  // Close database
  closeDatabase();
  console.log('\nDatabase test complete!');
}

main().catch(console.error);
