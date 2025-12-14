import { validateConfig } from './config.js';
import { VoiceAgent } from './agent/voice-agent.js';
import { WakewordDetector } from './wakeword/index.js';
import { speak } from './audio/index.js';
import { closeDatabase } from './db/index.js';
import { Scheduler } from './scheduler/index.js';
import { startWebhookServer, stopWebhookServer, onWebhookEvent } from './api/webhooks.js';
import {
  startWebSocketServer,
  stopWebSocketServer,
  wsBroadcast,
  onBinaryMessage,
  getClients,
  onClientCommand,
} from './api/websocket.js';
import { startStaticServer, stopStaticServer } from './api/static.js';
import { LocalTransport, WebSocketTransport, type IAudioTransport } from './transport/index.js';

// Transport mode: 'local' (hardware audio) or 'web' (browser audio via WebSocket)
const TRANSPORT_MODE = process.env.TRANSPORT_MODE ?? 'local';

async function main() {
  console.log('Starting Pi Voice Agent (TypeScript)...');
  console.log(`[Transport] Mode: ${TRANSPORT_MODE}`);

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', error);
    process.exit(1);
  }

  // Start WebSocket server first (needed for both dashboard and web transport mode)
  try {
    await startWebSocketServer();
    console.log('WebSocket server started');
  } catch (error) {
    console.error('Failed to start WebSocket server:', error);
    if (TRANSPORT_MODE === 'web') {
      // WebSocket is required for web transport mode
      process.exit(1);
    }
  }

  // Create transport based on mode
  let transport: IAudioTransport;

  if (TRANSPORT_MODE === 'web') {
    const wsTransport = new WebSocketTransport(getClients());
    transport = wsTransport;

    // Wire up binary message handler to route browser audio to transport
    onBinaryMessage((data) => {
      wsTransport.handleClientAudio(data);
    });

    console.log('[Transport] Using WebSocketTransport (browser audio)');
  } else {
    transport = new LocalTransport();
    console.log('[Transport] Using LocalTransport (hardware audio)');
  }

  // Initialize components
  const agent = new VoiceAgent(transport);
  const wakeword = TRANSPORT_MODE === 'local' ? new WakewordDetector(['jarvis', 'computer']) : null;
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

    // Broadcast to WebSocket clients
    wsBroadcast.stateChange(state, profile);

    // Resume wakeword detection when idle (only in local mode with wakeword)
    if (state === 'idle' && wakeword && !wakeword.isListening()) {
      wakeword.start().catch((err) => {
        console.error('[Wakeword] Failed to restart:', err);
      });
    }
  });

  agent.on('transcript', (text, role) => {
    console.log(`[${role}] ${text}`);
    // Broadcast transcript to WebSocket clients
    wsBroadcast.transcript(text, role);
  });

  agent.on('audio', () => {
    // Audio is now handled internally by the transport
    // This event is still emitted for logging/debugging if needed
  });

  agent.on('error', (error) => {
    console.error('[Error]', error.message);
    wsBroadcast.error(error.message);
  });

  agent.on('toolStart', (name, args) => {
    wsBroadcast.toolStart(name, args);
  });

  agent.on('toolEnd', (name, result) => {
    wsBroadcast.toolEnd(name, result);
  });

  // Set up wakeword detection (only in local mode)
  if (wakeword) {
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
  }

  // Register client command handler (for web mode activation via dashboard)
  onClientCommand(async (command) => {
    console.log(`[WS] Client command: ${command.command}`, command.profile ? `(profile: ${command.profile})` : '');

    switch (command.command) {
      case 'start_session': {
        if (agent.isActive()) {
          console.log('[WS] Session already active, ignoring start_session');
          return;
        }

        // Stop wakeword detection if active (local mode)
        if (wakeword && wakeword.isListening()) {
          wakeword.stop();
        }

        const profile = command.profile || 'jarvis';
        const success = await agent.activate(profile);
        if (success) {
          console.log(`[WS] Session activated for ${profile}`);
          wsBroadcast.sessionStarted(profile);
        } else {
          console.error('[WS] Failed to activate session');
          wsBroadcast.error('Failed to activate session');
          // Restart wakeword if in local mode
          if (wakeword) {
            wakeword.start().catch((err) => {
              console.error('[Wakeword] Failed to restart:', err);
            });
          }
        }
        break;
      }

      case 'stop_session': {
        if (agent.isActive()) {
          const profile = agent.getCurrentProfile()?.name || null;
          agent.deactivate();
          console.log('[WS] Session stopped');
          wsBroadcast.sessionEnded(profile);
        }
        break;
      }
    }
  });

  // Start the timer scheduler
  scheduler.start();
  console.log('Timer scheduler started');

  // Start static file server for web dashboard
  try {
    await startStaticServer();
    console.log('Static dashboard server started');
  } catch (error) {
    console.warn('Failed to start static server:', error);
  }

  // Start webhook server for Mac daemon callbacks
  try {
    await startWebhookServer();

    // Handle webhook events (session status changes)
    onWebhookEvent(async (payload) => {
      console.log(`[Webhook] Session ${payload.sessionId} status: ${payload.status}`);

      // If agent is active and session finished, notify via TTS
      if (payload.status === 'finished' || payload.status === 'error') {
        const statusText =
          payload.status === 'finished'
            ? 'Die Coding-Session ist fertig.'
            : 'Die Coding-Session hat einen Fehler.';

        if (agent.isActive()) {
          agent.sendMessage(`[SESSION UPDATE] ${statusText}`);
        } else {
          await speak(statusText);
        }
      }
    });
  } catch (error) {
    console.warn('Failed to start webhook server:', error);
    // Continue without webhooks - not critical
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    scheduler.stop();
    await stopStaticServer();
    await stopWebSocketServer();
    await stopWebhookServer();
    agent.deactivate();
    if (wakeword) {
      wakeword.stop();
    }
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Ready message based on transport mode
  if (TRANSPORT_MODE === 'local') {
    console.log('Agent ready. Say "Jarvis" (general assistant) or "Computer" (developer assistant) to activate...');
  } else {
    console.log('Agent ready. Connect a browser client to activate via the web dashboard...');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
