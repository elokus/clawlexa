import { config, validateConfig } from './config.js';
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
  onSessionInput,
  setServiceState,
} from './api/websocket.js';
import { handleDirectInput } from './subagents/direct-input.js';
import { startStaticServer, stopStaticServer } from './api/static.js';
import { LocalTransport, WebSocketTransport } from './transport/index.js';
import { getProcessManager, type ManagedProcess } from './processes/manager.js';
import { CliSessionsRepository } from './db/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// Service State Machine
// ═══════════════════════════════════════════════════════════════════════════
//
// States:
// - DORMANT: Service is off. No audio capture, no wakeword, no agent sessions.
// - RUNNING: Service is active. Audio/wakeword based on audioMode.
//
// Audio Modes:
// - 'web': Browser handles audio I/O via WebSocket
// - 'local': Device handles audio via hardware (PipeWire/sox)
//

let isServiceActive = false;
let audioMode: 'web' | 'local' = 'web';

// Components initialized at startup
let agent: VoiceAgent;
let wakeword: WakewordDetector | null = null;
let scheduler: Scheduler;
let localTransport: LocalTransport;
let wsTransport: WebSocketTransport;
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '8000', 10);
let lastLocalRoutingDiagnosticsKey = '';

function logLocalRoutingDiagnostics(): void {
  const diagnostics = localTransport.getRoutingDiagnostics();
  const key = [
    diagnostics.inputDevice,
    diagnostics.outputDevice,
    diagnostics.echoCancelSourceSelected ? 'echo' : 'raw',
    diagnostics.samePhysicalDeviceLikely ? 'shared' : 'separate',
  ].join('|');

  if (key === lastLocalRoutingDiagnosticsKey) {
    return;
  }
  lastLocalRoutingDiagnosticsKey = key;

  console.log(
    `[LocalAudio] Routing input=${diagnostics.inputDevice} output=${diagnostics.outputDevice} echoCancel=${diagnostics.echoCancelSourceSelected ? 'on' : 'off'}`
  );

  if (
    process.platform === 'linux' &&
    !diagnostics.echoCancelSourceSelected &&
    diagnostics.samePhysicalDeviceLikely
  ) {
    console.warn(
      '[LocalAudio] Echo-risk routing detected: input/output appear to be the same device and no echo-cancel source is selected. Configure PipeWire echo-cancel or set LOCAL_AUDIO_INPUT_DEVICE / LOCAL_PREFER_ECHO_CANCEL_SOURCE.'
    );
  }
}

/**
 * Update service state and coordinate all components.
 * This is the central state machine that controls wakeword, transport, and agent.
 */
async function updateServiceState(): Promise<void> {
  console.log(`[Service] State update: active=${isServiceActive}, mode=${audioMode}`);

  if (!isServiceActive) {
    // === DORMANT STATE ===
    // Stop everything

    // Stop wakeword detection
    if (wakeword?.isListening()) {
      wakeword.stop();
      console.log('[Service] Wakeword stopped (dormant)');
    }

    // Deactivate agent if active
    if (agent.isActive()) {
      agent.deactivate();
      console.log('[Service] Agent deactivated (dormant)');
    }

    // Stop both transports
    localTransport.stop();
    wsTransport.stop();

  } else {
    // === RUNNING STATE ===
    // Activate based on audio mode

    // Select and configure transport based on mode
    const selectedTransport = audioMode === 'local' ? localTransport : wsTransport;
    agent.setTransport(selectedTransport);
    console.log(`[Service] Transport set to ${audioMode}`);

    if (audioMode === 'local') {
      // LOCAL MODE: Use wakeword detection when agent is idle
      wsTransport.stop(); // Ensure web transport is stopped
      logLocalRoutingDiagnostics();

      if (!agent.isActive() && wakeword && !wakeword.isListening()) {
        try {
          await wakeword.start();
          console.log('[Service] Wakeword started (local mode)');
        } catch (err) {
          console.error('[Service] Failed to start wakeword:', err);
        }
      }
    } else {
      // WEB MODE: Stop wakeword, browser handles activation
      if (wakeword?.isListening()) {
        wakeword.stop();
        console.log('[Service] Wakeword stopped (web mode)');
      }
      localTransport.stop(); // Ensure local transport is stopped
    }
  }

  // Broadcast state to all connected clients
  setServiceState(isServiceActive, audioMode);
}

async function main() {
  console.log('Starting Pi Voice Agent (TypeScript)...');

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', error);
    process.exit(1);
  }

  // Start WebSocket server first (needed for dashboard)
  try {
    await startWebSocketServer();
    console.log('WebSocket server started');
  } catch (error) {
    console.error('Failed to start WebSocket server:', error);
    process.exit(1);
  }

  // Initialize both transports (but don't start them yet)
  localTransport = new LocalTransport({
    inputDevice: config.localAudio.inputDevice,
    outputDevice: config.localAudio.outputDevice,
    preferEchoCancelSource: config.localAudio.preferEchoCancelSource,
  });
  wsTransport = new WebSocketTransport(getClients());

  // Wire up binary message handler to route browser audio to WebSocket transport
  onBinaryMessage((data) => {
    wsTransport.handleClientAudio(data);
  });

  console.log('[Transport] Initialized LocalTransport and WebSocketTransport');

  // Initialize agent WITHOUT a transport (will be set via updateServiceState)
  agent = new VoiceAgent();

  // Initialize ProcessManager for background task tracking
  const processManager = getProcessManager();

  processManager.on('process:completed', (process: ManagedProcess) => {
    console.log(`[ProcessManager] Process "${process.name}" completed`);

    const sessionsRepo = new CliSessionsRepository();
    const session = sessionsRepo.findById(process.sessionId);
    if (!session) {
      // Detached process without DB session linkage (e.g. developer_session fire-and-forget).
      return;
    }
    const voiceSessionId = session.type === 'voice' ? session.id : session.parent_id ?? session.id;

    wsBroadcast.streamChunk(voiceSessionId, {
      type: 'process-status',
      processName: process.name,
      sessionId: process.sessionId,
      status: 'completed',
      summary: process.result?.substring(0, 200),
    });

    if (!process.notifyVoiceOnCompletion) {
      return;
    }

    // Notify voice agent or queue for next session
    if (agent.isActive()) {
      agent.sendMessage(
        `[Background task "${process.name}" completed] ${process.result?.substring(0, 500) || 'Task finished.'}`
      );
    } else {
      agent.addPendingNotification(process);
    }
  });

  processManager.on('process:error', (process: ManagedProcess) => {
    console.error(`[ProcessManager] Process "${process.name}" failed: ${process.error}`);

    const sessionsRepo = new CliSessionsRepository();
    const session = sessionsRepo.findById(process.sessionId);
    if (!session) {
      // Detached process without DB session linkage (e.g. developer_session fire-and-forget).
      return;
    }
    const voiceSessionId = session.type === 'voice' ? session.id : session.parent_id ?? session.id;

    wsBroadcast.streamChunk(voiceSessionId, {
      type: 'process-status',
      processName: process.name,
      sessionId: process.sessionId,
      status: 'error',
      summary: process.error,
    });

    if (!process.notifyVoiceOnCompletion) {
      return;
    }

    if (agent.isActive()) {
      agent.sendMessage(
        `[Background task "${process.name}" failed] ${process.error || 'Unknown error'}`
      );
    } else {
      agent.addPendingNotification(process);
    }
  });

  // Initialize wakeword detector (but don't start yet)
  try {
    wakeword = new WakewordDetector(['jarvis', 'computer']);
    console.log('[Wakeword] Detector initialized');
  } catch (error) {
    console.warn('[Wakeword] Failed to initialize (may not be available on this platform):', error);
    wakeword = null;
  }

  // Initialize scheduler
  scheduler = new Scheduler(1000);

  // Set up scheduler event handlers
  scheduler.on('timerFired', async (timer) => {
    console.log(`[Timer] Fired #${timer.id}: ${timer.message}`);

    if (agent.isActive()) {
      agent.sendMessage(`[TIMER ERINNERUNG] Sag dem Nutzer: "${timer.message}"`);
    } else {
      if (timer.mode === 'tts') {
        try {
          await speak(timer.message);
        } catch (error) {
          console.error('[Timer] TTS error:', error);
        }
      } else if (timer.mode === 'agent') {
        const success = await agent.activate('jarvis');
        if (success) {
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
  agent.on('stateChange', async (state, profile) => {
    console.log(`[State] ${state}${profile ? ` (${profile})` : ''}`);
    wsBroadcast.stateChange(state, profile);

    // Resume wakeword detection when idle (only in local mode with service active)
    if (state === 'idle' && isServiceActive && audioMode === 'local') {
      if (wakeword && !wakeword.isListening()) {
        try {
          await wakeword.start();
          console.log('[Service] Wakeword resumed after idle');
        } catch (err) {
          console.error('[Wakeword] Failed to restart:', err);
        }
      }
    }

    // Stop wakeword during active agent states
    if ((state === 'listening' || state === 'thinking' || state === 'speaking') && wakeword?.isListening()) {
      wakeword.stop();
    }
  });

  agent.on('error', (error) => {
    console.error('[Error]', error.message);
  });

  // Set up wakeword detection handlers (if available)
  if (wakeword) {
    wakeword.onWakeword(async (keyword, confidence) => {
      console.log(`[Wakeword] Detected: ${keyword} (confidence: ${confidence})`);

      if (!agent.isActive()) {
        wakeword!.stop();

        const success = await agent.activateWithWakeword(keyword);
        if (success) {
          console.log('[Agent] Session activated, listening...');
        } else {
          // Restart wakeword if activation failed and service is still active
          if (isServiceActive && audioMode === 'local') {
            wakeword!.start().catch((err) => {
              console.error('[Wakeword] Failed to restart:', err);
            });
          }
        }
      } else {
        console.log('[Agent] Already active, ignoring wakeword');
      }
    });
  }

  // Register client command handler
  onClientCommand(async (command) => {
    console.log(`[WS] Client command: ${command.command}`, command.profile ? `(profile: ${command.profile})` : '', command.mode ? `(mode: ${command.mode})` : '');

    switch (command.command) {
      case 'start_service': {
        if (!isServiceActive) {
          isServiceActive = true;
          await updateServiceState();
          console.log('[Service] Started');
        }
        break;
      }

      case 'stop_service': {
        if (isServiceActive) {
          isServiceActive = false;
          await updateServiceState();
          console.log('[Service] Stopped');
        }
        break;
      }

      case 'set_audio_mode': {
        const newMode = command.mode;
        if (newMode && (newMode === 'web' || newMode === 'local') && newMode !== audioMode) {
          audioMode = newMode;
          await updateServiceState();
          console.log(`[Service] Audio mode changed to ${audioMode}`);
        }
        break;
      }

      case 'start_session': {
        if (!isServiceActive) {
          console.log('[WS] Cannot start session - service is dormant');
          wsBroadcast.error('Service is not active');
          return;
        }

        if (agent.isActive()) {
          console.log('[WS] Session already active, ignoring start_session');
          return;
        }

        // Stop wakeword detection if active (local mode)
        if (wakeword?.isListening()) {
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
          // Restart wakeword if in local mode and service is active
          if (isServiceActive && audioMode === 'local' && wakeword) {
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

  // Register session input handler for direct text input to subagents
  onSessionInput(handleDirectInput);

  // Start the timer scheduler
  scheduler.start();
  console.log('Timer scheduler started');

  // Start static file server for web dashboard (skip in dev when using Vite)
  if (process.env.SKIP_STATIC_SERVER !== 'true') {
    try {
      await startStaticServer();
      console.log('Static dashboard server started');
    } catch (error) {
      console.warn('Failed to start static server:', error);
    }
  } else {
    console.log('[Static] Skipped (SKIP_STATIC_SERVER=true, use Vite dev server instead)');
  }

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (signal: NodeJS.Signals | 'startup_failure'): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      console.log(`\nShutting down... (${signal})`);

      const forceExitTimer = setTimeout(() => {
        console.error(`[Shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExitTimer.unref?.();

      try {
        scheduler.stop();
      } catch (error) {
        console.warn('[Shutdown] Failed to stop scheduler:', error);
      }

      await Promise.allSettled([
        stopStaticServer(),
        stopWebSocketServer(),
        stopWebhookServer(),
      ]);

      try {
        agent.deactivate();
      } catch (error) {
        console.warn('[Shutdown] Failed to deactivate agent:', error);
      }

      if (wakeword) {
        try {
          wakeword.stop();
        } catch (error) {
          console.warn('[Shutdown] Failed to stop wakeword:', error);
        }
      }

      closeDatabase();
      clearTimeout(forceExitTimer);
      process.exit(signal === 'startup_failure' ? 1 : 0);
    })();

    return shutdownPromise;
  };

  // Start webhook server for Mac daemon callbacks
  try {
    await startWebhookServer();

    onWebhookEvent(async (payload) => {
      console.log(`[Webhook] Session ${payload.sessionId} status: ${payload.status}`);

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
    console.error('Failed to start webhook server:', error);
    await shutdown('startup_failure');
    return;
  }

  process.on('SIGINT', () => {
    if (shutdownPromise) {
      console.log('[Shutdown] SIGINT received while shutdown is already in progress');
      return;
    }
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    if (shutdownPromise) {
      console.log('[Shutdown] SIGTERM received while shutdown is already in progress');
      return;
    }
    void shutdown('SIGTERM');
  });

  // Broadcast initial service state (dormant by default)
  setServiceState(isServiceActive, audioMode);

  console.log('Agent ready. Service is DORMANT - use dashboard to activate.');
  console.log('Connect a browser client and click the power button to start...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
