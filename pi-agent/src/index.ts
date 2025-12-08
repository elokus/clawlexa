import { validateConfig } from './config.js';
import { VoiceAgent } from './agent/voice-agent.js';
import { WakewordDetector } from './wakeword/index.js';
import { AudioCapture, AudioPlayback, speak } from './audio/index.js';
import { closeDatabase } from './db/index.js';
import { Scheduler } from './scheduler/index.js';

async function main() {
  console.log('Starting Pi Voice Agent (TypeScript)...');

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', error);
    process.exit(1);
  }

  // Initialize components
  const agent = new VoiceAgent();
  const wakeword = new WakewordDetector(['hey_jarvis', 'hey_marvin']);
  const audioCapture = new AudioCapture();  // Captures at 16kHz, resamples to 24kHz
  const audioPlayback = new AudioPlayback(); // Receives 24kHz, resamples to 16kHz
  const scheduler = new Scheduler(1000); // Check every second

  // Set up scheduler event handlers
  scheduler.on('timerFired', async (timer) => {
    console.log(`[Timer] Fired #${timer.id}: ${timer.message}`);

    if (agent.isActive()) {
      // Agent is active - inject message into the conversation
      // The agent will speak the reminder naturally
      agent.sendMessage(`[TIMER ERINNERUNG] Sag dem Nutzer: "${timer.message}"`);
    } else {
      // No active session - use TTS directly
      if (timer.mode === 'tts') {
        try {
          await speak(timer.message);
        } catch (error) {
          console.error('[Timer] TTS error:', error);
        }
      } else if (timer.mode === 'agent') {
        // Start a new agent session for the reminder
        const success = await agent.activate('jarvis');
        if (success) {
          // Wait for connection, then send message
          setTimeout(() => {
            agent.sendMessage(`[TIMER ERINNERUNG] Sag dem Nutzer: "${timer.message}"`);
          }, 500);
        }
      }
    }
  });

  scheduler.on('error', (error) => {
    console.error('[Scheduler] Error:', error);
  });

  // Set up agent event handlers
  agent.on('stateChange', (state, profile) => {
    console.log(`[State] ${state}${profile ? ` (${profile})` : ''}`);

    // Manage audio based on state
    if (state === 'listening') {
      // Start capturing mic audio when listening
      if (!audioCapture.isCapturing()) {
        audioCapture.start();
      }
    } else if (state === 'idle') {
      // Stop everything when idle
      audioCapture.stop();
      audioPlayback.stop();
      // Resume wakeword detection
      if (!wakeword.isListening()) {
        wakeword.start().catch((err) => {
          console.error('[Wakeword] Failed to restart:', err);
        });
      }
    }
  });

  agent.on('transcript', (text, role) => {
    console.log(`[${role}] ${text}`);
  });

  agent.on('audio', (audio) => {
    // Play audio from the Realtime API (no logging - too noisy)
    if (audio.data) {
      audioPlayback.play(audio.data);
    }
  });

  agent.on('error', (error) => {
    console.error('[Error]', error.message);
  });

  // Send captured audio to the agent
  audioCapture.on('audio', (data: ArrayBuffer) => {
    if (agent.isActive()) {
      agent.sendAudio(data);
    }
  });

  // Set up wakeword detection
  wakeword.onWakeword(async (keyword, confidence) => {
    console.log(`[Wakeword] Detected: ${keyword} (confidence: ${confidence})`);

    if (!agent.isActive()) {
      // Stop wakeword detection during conversation
      wakeword.stop();

      const success = await agent.activateWithWakeword(keyword);
      if (success) {
        console.log('[Agent] Session activated, listening...');
      } else {
        // Restart wakeword if activation failed
        wakeword.start().catch((err) => {
          console.error('[Wakeword] Failed to restart:', err);
        });
      }
    } else {
      console.log('[Agent] Already active, ignoring wakeword');
    }
  });

  // Start wakeword detection
  try {
    await wakeword.start();
    console.log('Wakeword detection started');
  } catch (error) {
    console.error('Failed to start wakeword detection:', error);
    process.exit(1);
  }

  // Start the timer scheduler
  scheduler.start();
  console.log('Timer scheduler started');

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    scheduler.stop();
    agent.deactivate();
    audioCapture.stop();
    audioPlayback.stop();
    wakeword.stop();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('Agent ready. Say "Jarvis" or "Computer" to activate...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
