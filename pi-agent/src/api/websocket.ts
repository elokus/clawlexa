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

const WS_PORT = parseInt(process.env.WS_PORT ?? '3001', 10);

// ═══════════════════════════════════════════════════════════════════════════
// Client State Management
// ═══════════════════════════════════════════════════════════════════════════

interface ClientState {
  id: string;
  isMaster: boolean;
  connectedAt: number;
}

// Track state per WebSocket client
const clientStates = new Map<WebSocket, ClientState>();

// Track current master client ID
let masterClientId: string | null = null;

// Track last agent state (to prevent master takeover during active turns)
let lastAgentState: string = 'idle';

// Binary audio handler for WebSocketTransport
let binaryAudioHandler: ((data: Buffer, ws: WebSocket) => void) | null = null;

// Client command handler
let clientCommandHandler: ((command: ClientCommand, ws: WebSocket) => void) | null = null;

export interface ClientCommand {
  command: 'start_session' | 'stop_session';
  profile?: string;
}

export type WSMessageType =
  | 'state_change'
  | 'transcript'
  | 'audio_start'
  | 'audio_end'
  | 'error'
  | 'session_started'
  | 'session_ended'
  | 'tool_start'
  | 'tool_end'
  | 'item_pending'
  | 'item_completed'
  | 'cli_session_update'
  | 'cli_session_created'   // New tmux session created
  | 'cli_session_output'    // Session output streaming
  // Unified subagent activity stream (replaces worker_activity and cli_agent_* events)
  | 'subagent_activity'
  // Multi-client master/replica coordination
  | 'welcome'               // Sent on connect with clientId and isMaster
  | 'master_changed';       // Broadcast when master changes

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
      clientStates.set(ws, { id: clientId, isMaster, connectedAt: Date.now() });
      clients.add(ws);

      // Send welcome message with client identity
      ws.send(JSON.stringify({
        type: 'welcome',
        payload: { clientId, isMaster },
        timestamp: Date.now(),
      }));

      // Also send current agent state
      ws.send(JSON.stringify({
        type: 'state_change',
        payload: { state: lastAgentState, profile: null },
        timestamp: Date.now(),
      }));

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
 */
export function broadcast(type: WSMessageType, payload: unknown): void {
  if (clients.size === 0) return;

  const message: WSMessage = {
    type,
    payload,
    timestamp: Date.now(),
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

// ═══════════════════════════════════════════════════════════════════════════
// Subagent Activity Types - Unified streaming events for all subagents
// ═══════════════════════════════════════════════════════════════════════════

export type SubagentEventType =
  | 'reasoning_start'   // Reasoning/thinking started
  | 'reasoning_delta'   // Streaming reasoning chunk
  | 'reasoning_end'     // Reasoning complete
  | 'tool_call'         // Tool invocation with args
  | 'tool_result'       // Tool execution result
  | 'response'          // Final text response
  | 'error'             // Error occurred
  | 'complete';         // Agent finished

export interface SubagentActivityPayload {
  /** Agent name for UI display (e.g., "Marvin", "Jarvis") */
  agent: string;
  /** Event type */
  type: SubagentEventType;
  /** Event-specific payload */
  payload: unknown;
}

// Convenience broadcast functions
export const wsBroadcast = {
  stateChange: (state: string, profile: string | null) => {
    lastAgentState = state; // Track state for master takeover logic
    broadcast('state_change', { state, profile });
  },

  transcript: (text: string, role: 'user' | 'assistant', itemId?: string, final = true) =>
    broadcast('transcript', { id: itemId, text, role, final }),

  itemPending: (itemId: string, role: 'user' | 'assistant') =>
    broadcast('item_pending', { itemId, role }),

  itemCompleted: (itemId: string, text: string, role: 'user' | 'assistant') =>
    broadcast('item_completed', { itemId, text, role }),

  toolStart: (name: string, args?: Record<string, unknown>) =>
    broadcast('tool_start', { name, args }),

  toolEnd: (name: string, result?: string) =>
    broadcast('tool_end', { name, result }),

  sessionStarted: (profile: string) =>
    broadcast('session_started', { profile }),

  sessionEnded: (profile: string | null) =>
    broadcast('session_ended', { profile }),

  error: (message: string) =>
    broadcast('error', { message }),

  cliSessionUpdate: (session: { id: string; status: string; goal: string }) =>
    broadcast('cli_session_update', session),

  cliSessionCreated: (session: {
    id: string;
    goal: string;
    mode: 'headless' | 'interactive';
    projectPath: string;
    command: string;
    parentId?: string;
  }) => broadcast('cli_session_created', session),

  cliSessionOutput: (sessionId: string, output: string) =>
    broadcast('cli_session_output', { sessionId, output }),

  // Unified subagent activity events (replaces workerActivity and cliAgent* events)
  subagentActivity: (payload: SubagentActivityPayload) =>
    broadcast('subagent_activity', payload),
};
