/**
 * WebSocket Server - Real-time event broadcasting to web dashboard.
 *
 * Broadcasts:
 * - Agent state changes (idle, listening, thinking, speaking)
 * - Transcripts (user and assistant)
 * - Tool execution events
 * - Session lifecycle events
 * - Pending items (for delayed transcription handling)
 *
 * Master/Replica Pattern:
 * - Multiple clients can connect (no IP restriction)
 * - Only the "Master" client handles audio I/O (mic/speaker)
 * - All clients receive state and transcript updates
 * - Clients can request master control when agent is idle
 */

import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { CliSessionsRepository } from '../db/index.js';
import { eventRecorder } from './event-recorder.js';

const WS_PORT = parseInt(process.env.WS_PORT ?? '3001', 10);

// ═══════════════════════════════════════════════════════════════════════════
// Client State Management
// ═══════════════════════════════════════════════════════════════════════════

interface ClientState {
  id: string;
  isMaster: boolean;
  connectedAt: number;
  focusedSessionId: string | null;
}

// Track state per WebSocket client
const clientStates = new Map<WebSocket, ClientState>();

// Track current master client ID
let masterClientId: string | null = null;

// Track last agent state (to prevent master takeover during active turns)
let lastAgentState: string = 'idle';

// Track service state (for welcome message and soft power control)
let serviceActive: boolean = false;
let audioMode: 'web' | 'local' = 'web';

// Binary audio handler for WebSocketTransport
let binaryAudioHandler: ((data: Buffer, ws: WebSocket) => void) | null = null;

// Client command handler
let clientCommandHandler: ((command: ClientCommand, ws: WebSocket) => void) | null = null;

// Session input handler for direct text input to subagents
let sessionInputHandler: ((sessionId: string, text: string) => Promise<void>) | null = null;

export interface ClientCommand {
  command: 'start_session' | 'stop_session' | 'start_service' | 'stop_service' | 'set_audio_mode';
  profile?: string;
  mode?: 'web' | 'local';
}

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Message Types (Phase 5: Simplified Protocol)
// ═══════════════════════════════════════════════════════════════════════════
//
// Core Types (6):
// - welcome            : Client identity + service state on connect
// - stream_chunk       : All agent message events (AI SDK format)
// - session_tree_update: Session hierarchy changes
// - state_change       : Voice UI state (listening/thinking/speaking)
// - master_changed     : Multi-client coordination
// - service_state_changed: Service active/dormant + audio mode
//
// Lifecycle Types (3):
// - session_started/ended: Voice session lifecycle
// - cli_session_deleted  : Terminal session cleanup
// - error                : Error messages
//
export type WSMessageType =
  // Core unified protocol
  | 'welcome'               // Client identity on connect
  | 'stream_chunk'          // All agent events (AI SDK format: text-delta, tool-call, etc.)
  | 'session_tree_update'   // Session hierarchy for ThreadRail
  | 'state_change'          // Voice UI state (listening/thinking/speaking/idle)
  | 'master_changed'        // Multi-client master coordination
  | 'service_state_changed' // Service active/dormant + audio mode
  // Lifecycle events
  | 'session_started'       // Voice session activated
  | 'session_ended'         // Voice session deactivated
  | 'cli_session_deleted'   // Terminal session removed
  | 'error';                // Error messages

interface WSMessage {
  type: WSMessageType;
  payload: unknown;
  timestamp: number;
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

/**
 * Start the WebSocket server for real-time dashboard updates.
 */
export function startWebSocketServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (wss) {
      console.log('[WS] Server already running');
      resolve();
      return;
    }

    wss = new WebSocketServer({ port: WS_PORT, host: '0.0.0.0' });

    wss.on('listening', () => {
      console.log(`[WS] Server listening on port ${WS_PORT}`);
      resolve();
    });

    wss.on('error', (err) => {
      console.error('[WS] Server error:', err);
      reject(err);
    });

    wss.on('connection', (ws, req) => {
      const clientAddr = req.socket.remoteAddress ?? 'unknown';
      const clientId = randomUUID();

      // First client becomes master
      const isMaster = masterClientId === null;
      if (isMaster) {
        masterClientId = clientId;
        console.log(`[WS] Client ${clientId.slice(0, 8)} assigned as Master (from ${clientAddr})`);
      } else {
        console.log(`[WS] Client ${clientId.slice(0, 8)} connected as Replica (from ${clientAddr})`);
      }

      // Store client state
      clientStates.set(ws, { id: clientId, isMaster, connectedAt: Date.now(), focusedSessionId: null });
      clients.add(ws);

      // Send welcome message with client identity and service state
      ws.send(JSON.stringify({
        type: 'welcome',
        payload: { clientId, isMaster, serviceActive, audioMode },
        timestamp: Date.now(),
      }));

      // Also send current agent state
      ws.send(JSON.stringify({
        type: 'state_change',
        payload: { state: lastAgentState, profile: null },
        timestamp: Date.now(),
      }));

      // Send active session trees (so clients can navigate to running sessions)
      const sessionsRepo = new CliSessionsRepository();
      const activeTrees = sessionsRepo.getActiveTrees();
      if (activeTrees.length > 0) {
        ws.send(JSON.stringify({
          type: 'session_tree_update',
          payload: { trees: activeTrees },
          timestamp: Date.now(),
        }));
        console.log(`[WS] Sent ${activeTrees.length} active session trees to ${clientId.slice(0, 8)}`);
      }

      // Handle disconnection
      ws.on('close', () => {
        const state = clientStates.get(ws);
        const shortId = state?.id.slice(0, 8) ?? 'unknown';
        console.log(`[WS] Client ${shortId} disconnected`);

        clients.delete(ws);
        clientStates.delete(ws);

        // If master disconnected, promote a new one
        if (state?.isMaster) {
          masterClientId = null;
          promoteNewMaster();
        }
      });

      ws.on('error', (err) => {
        const state = clientStates.get(ws);
        const shortId = state?.id.slice(0, 8) ?? 'unknown';
        console.error(`[WS] Client ${shortId} error: ${err.message}`);

        clients.delete(ws);
        clientStates.delete(ws);

        if (state?.isMaster) {
          masterClientId = null;
          promoteNewMaster();
        }
      });

      // Handle incoming messages from dashboard
      ws.on('message', (data, isBinary) => {
        const clientState = clientStates.get(ws);
        const shortId = clientState?.id.slice(0, 8) ?? 'unknown';

        // Handle binary audio data - only accept from Master
        // IMPORTANT: Only check isBinary flag, not Buffer.isBuffer(data)
        // because text messages in Node.js ws library also come as Buffers
        if (isBinary) {
          if (clientState?.isMaster && binaryAudioHandler) {
            binaryAudioHandler(data as Buffer, ws);
          } else if (!clientState?.isMaster) {
            // Log occasionally to help debug
            if (Math.random() < 0.01) {
              console.log(`[WS] Ignoring audio from non-master ${shortId}`);
            }
          }
          return;
        }

        // Handle JSON text messages
        try {
          const text = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(text);
          console.log(`[WS] Message from ${shortId}:`, msg.type, msg.payload ? JSON.stringify(msg.payload).slice(0, 100) : '');
          handleClientMessage(ws, msg);
        } catch (err) {
          console.error('[WS] Invalid message:', err, 'data:', typeof data);
        }
      });
    });
  });
}

/**
 * Promote the oldest connected client to Master.
 */
function promoteNewMaster(): void {
  let newMasterWs: WebSocket | null = null;
  let oldestTime = Infinity;

  // Find the oldest remaining client
  for (const [candidateWs, candidateState] of clientStates.entries()) {
    if (candidateState.connectedAt < oldestTime && candidateWs.readyState === WebSocket.OPEN) {
      oldestTime = candidateState.connectedAt;
      newMasterWs = candidateWs;
    }
  }

  if (newMasterWs) {
    const newMasterState = clientStates.get(newMasterWs)!;
    newMasterState.isMaster = true;
    masterClientId = newMasterState.id;

    // Broadcast master change to all clients
    broadcast('master_changed', { masterId: newMasterState.id });
    console.log(`[WS] Promoted ${newMasterState.id.slice(0, 8)} to Master`);
  } else {
    console.log('[WS] No clients remaining to promote');
  }
}

/**
 * Stop the WebSocket server.
 */
export function stopWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }

    // Close all client connections
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    clientStates.clear();
    masterClientId = null;

    wss.close(() => {
      console.log('[WS] Server stopped');
      wss = null;
      resolve();
    });
  });
}

/**
 * Broadcast a message to all connected clients.
 * Also records the event if recording is active.
 */
export function broadcast(type: WSMessageType, payload: unknown): void {
  const timestamp = Date.now();

  // Record event if recording is active
  eventRecorder.record(type, payload, timestamp);

  if (clients.size === 0) return;

  const message: WSMessage = {
    type,
    payload,
    timestamp,
  };

  const data = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/**
 * Broadcast binary data (audio) to Master client only.
 * Used by WebSocketTransport to send audio back to the browser handling I/O.
 */
export function broadcastBinary(data: Buffer | ArrayBuffer): void {
  if (clients.size === 0) return;

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // Only send audio to Master client
  for (const [client, state] of clientStates.entries()) {
    if (state.isMaster && client.readyState === WebSocket.OPEN) {
      client.send(buffer);
      break; // Only one master
    }
  }
}

/**
 * Send a message to a specific client.
 */
export function sendTo(ws: WebSocket, type: WSMessageType, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const message: WSMessage = {
    type,
    payload,
    timestamp: Date.now(),
  };

  ws.send(JSON.stringify(message));
}

/**
 * Handle messages from dashboard clients.
 */
function handleClientMessage(ws: WebSocket, msg: { type: string; payload?: unknown }): void {
  const clientState = clientStates.get(ws);
  const shortId = clientState?.id.slice(0, 8) ?? 'unknown';
  console.log(`[WS] Received from ${shortId}: ${msg.type}`);

  switch (msg.type) {
    case 'ping':
      sendTo(ws, 'state_change', { state: lastAgentState, profile: null });
      break;

    case 'client_command': {
      const command = msg.payload as ClientCommand;
      if (clientCommandHandler) {
        clientCommandHandler(command, ws);
      } else {
        console.warn('[WS] No command handler registered for client_command');
      }
      break;
    }

    case 'request_master': {
      if (!clientState) return;

      // Prevent takeover if agent is speaking/thinking to avoid audio glitches
      if (lastAgentState === 'thinking' || lastAgentState === 'speaking') {
        sendTo(ws, 'error', { message: 'Cannot take control while agent is active' });
        console.log(`[WS] ${shortId} request_master denied - agent is ${lastAgentState}`);
        return;
      }

      // Already master?
      if (clientState.isMaster) {
        console.log(`[WS] ${shortId} already master`);
        return;
      }

      // Demote current master
      for (const state of clientStates.values()) {
        state.isMaster = false;
      }

      // Promote requester
      clientState.isMaster = true;
      masterClientId = clientState.id;

      // Broadcast to all clients
      broadcast('master_changed', { masterId: clientState.id });
      console.log(`[WS] Control taken by ${shortId}`);
      break;
    }

    case 'focus_session': {
      // Track which session this client is focused on
      const { sessionId } = msg.payload as { sessionId: string | null };
      if (clientState) {
        clientState.focusedSessionId = sessionId;
        console.log(`[WS] ${shortId} focused on session: ${sessionId?.slice(0, 8) ?? 'none'}`);
      }
      break;
    }

    case 'session_input': {
      // Route text input to focused session
      const { text } = msg.payload as { text: string };
      const sessionId = clientState?.focusedSessionId;

      if (!sessionId) {
        sendTo(ws, 'error', { message: 'No session focused' });
        return;
      }

      if (!text?.trim()) {
        sendTo(ws, 'error', { message: 'Empty input' });
        return;
      }

      console.log(`[WS] ${shortId} input to session ${sessionId.slice(0, 8)}: "${text.slice(0, 50)}..."`);

      // Call the session input handler (async, don't await)
      if (sessionInputHandler) {
        sessionInputHandler(sessionId, text).catch((err) => {
          console.error(`[WS] Session input error:`, err);
          sendTo(ws, 'error', { message: `Input error: ${err.message}` });
        });
      } else {
        sendTo(ws, 'error', { message: 'Session input handler not registered' });
      }
      break;
    }

    default:
      console.log(`[WS] Unknown message type: ${msg.type}`);
  }
}

/**
 * Get number of connected clients.
 */
export function getClientCount(): number {
  return clients.size;
}

/**
 * Register a handler for incoming binary (audio) messages.
 * Used by WebSocketTransport to receive audio from browser clients.
 */
export function onBinaryMessage(handler: (data: Buffer, ws: WebSocket) => void): void {
  binaryAudioHandler = handler;
}

/**
 * Get reference to connected clients set.
 * Used by WebSocketTransport to send audio to browser clients.
 */
export function getClients(): Set<WebSocket> {
  return clients;
}

/**
 * Register a handler for client commands (start_session, stop_session).
 * Used by index.ts to wire up agent activation in web mode.
 */
export function onClientCommand(handler: (command: ClientCommand, ws: WebSocket) => void): void {
  clientCommandHandler = handler;
}

/**
 * Register a handler for session input messages.
 * Called when a client sends text input to their focused session.
 */
export function onSessionInput(handler: (sessionId: string, text: string) => Promise<void>): void {
  sessionInputHandler = handler;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stream Chunk Types - AI SDK format events for all agents
// ═══════════════════════════════════════════════════════════════════════════

// Re-export types from stream-types.ts for convenience
export type { AISDKStreamEvent, StreamChunkMessage } from './stream-types.js';
import type { AISDKStreamEvent } from './stream-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Broadcast Helpers (Phase 5: Simplified)
// ═══════════════════════════════════════════════════════════════════════════
//
// Core broadcasts:
// - streamChunk        : All agent message content (voice + CLI + web-search)
// - sessionTreeUpdate  : Session hierarchy changes
// - stateChange        : Voice UI state
//
// Lifecycle broadcasts:
// - sessionStarted/Ended: Voice session lifecycle
// - cliSessionDeleted   : Terminal cleanup
// - error               : Error messages
//
export const wsBroadcast = {
  // Voice UI state (listening/thinking/speaking/idle)
  stateChange: (state: string, profile: string | null) => {
    lastAgentState = state; // Track state for master takeover logic
    broadcast('state_change', { state, profile });
  },

  // Service state (active/dormant + audio mode)
  serviceState: (active: boolean, mode: 'web' | 'local') =>
    broadcast('service_state_changed', { active, mode }),

  // Voice session lifecycle
  sessionStarted: (profile: string) =>
    broadcast('session_started', { profile }),

  sessionEnded: (profile: string | null) =>
    broadcast('session_ended', { profile }),

  // Error messages
  error: (message: string) =>
    broadcast('error', { message }),

  // Terminal session cleanup
  cliSessionDeleted: (sessionId: string) =>
    broadcast('cli_session_deleted', { sessionId }),

  cliAllSessionsDeleted: () =>
    broadcast('cli_session_deleted', { all: true }),

  // Unified stream chunk events (AI SDK format for all agents)
  streamChunk: (sessionId: string, event: AISDKStreamEvent) =>
    broadcast('stream_chunk', { sessionId, event }),

  // Session hierarchy tree update (for ThreadRail)
  sessionTreeUpdate: (rootId: string) => {
    const sessionsRepo = new CliSessionsRepository();
    const tree = sessionsRepo.getTree(rootId);
    if (tree) {
      broadcast('session_tree_update', { rootId, tree });
    }
  },

  // Broadcast all active trees (for initial load)
  allActiveTreesUpdate: () => {
    const sessionsRepo = new CliSessionsRepository();
    const trees = sessionsRepo.getActiveTrees();
    broadcast('session_tree_update', { trees });
  },
};

/**
 * Update the tracked service state and broadcast to all clients.
 * Called by index.ts when service state changes.
 */
export function setServiceState(active: boolean, mode: 'web' | 'local'): void {
  serviceActive = active;
  audioMode = mode;
  wsBroadcast.serviceState(active, mode);
}

/**
 * Get current service state.
 */
export function getServiceState(): { active: boolean; mode: 'web' | 'local' } {
  return { active: serviceActive, mode: audioMode };
}
