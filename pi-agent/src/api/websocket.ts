/**
 * WebSocket Server - Real-time event broadcasting to web dashboard.
 *
 * Broadcasts:
 * - Agent state changes (idle, listening, thinking, speaking)
 * - Transcripts (user and assistant)
 * - Tool execution events
 * - Session lifecycle events
 * - Pending items (for delayed transcription handling)
 */

import { WebSocketServer, WebSocket } from 'ws';

const WS_PORT = parseInt(process.env.WS_PORT ?? '3001', 10);

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
  | 'subagent_activity';

interface WSMessage {
  type: WSMessageType;
  payload: unknown;
  timestamp: number;
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
// Track connections by IP to prevent duplicates
const clientsByIp = new Map<string, WebSocket>();

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

      // Close existing connection from same IP (prevent duplicates)
      const existingClient = clientsByIp.get(clientAddr);
      if (existingClient) {
        console.log(`[WS] Closing existing connection from ${clientAddr}`);
        existingClient.close(1000, 'New connection from same IP');
        clients.delete(existingClient);
      }

      console.log(`[WS] Client connected from ${clientAddr}`);
      clients.add(ws);
      clientsByIp.set(clientAddr, ws);

      // Send current state on connect
      ws.send(JSON.stringify({
        type: 'state_change',
        payload: { state: 'idle', profile: null },
        timestamp: Date.now(),
      }));

      ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${clientAddr}`);
        clients.delete(ws);
        // Only remove from IP map if it's still this connection
        if (clientsByIp.get(clientAddr) === ws) {
          clientsByIp.delete(clientAddr);
        }
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error: ${err.message}`);
        clients.delete(ws);
        if (clientsByIp.get(clientAddr) === ws) {
          clientsByIp.delete(clientAddr);
        }
      });

      // Handle incoming messages from dashboard
      ws.on('message', (data, isBinary) => {
        // Handle binary audio data
        if (isBinary || Buffer.isBuffer(data)) {
          if (binaryAudioHandler) {
            binaryAudioHandler(data as Buffer, ws);
          }
          return;
        }

        // Handle JSON messages
        try {
          const msg = JSON.parse(data.toString());
          handleClientMessage(ws, msg);
        } catch (err) {
          console.error('[WS] Invalid message:', err);
        }
      });
    });
  });
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
    clientsByIp.clear();

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
 * Broadcast binary data (audio) to all connected clients.
 * Used by WebSocketTransport to send audio back to browsers.
 */
export function broadcastBinary(data: Buffer | ArrayBuffer): void {
  if (clients.size === 0) return;

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(buffer);
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
  console.log(`[WS] Received: ${msg.type}`);

  switch (msg.type) {
    case 'ping':
      sendTo(ws, 'state_change', { state: 'idle', profile: null });
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
  stateChange: (state: string, profile: string | null) =>
    broadcast('state_change', { state, profile }),

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
  }) => broadcast('cli_session_created', session),

  cliSessionOutput: (sessionId: string, output: string) =>
    broadcast('cli_session_output', { sessionId, output }),

  // Unified subagent activity events (replaces workerActivity and cliAgent* events)
  subagentActivity: (payload: SubagentActivityPayload) =>
    broadcast('subagent_activity', payload),
};
