import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { ptyManager } from '../pty/index.js';
import { SessionManager } from '../sessions/manager.js';

interface WebSocketServerConfig {
  httpServer: HttpServer;
  sessionManager: SessionManager;
}

export function createWebSocketServer(config: WebSocketServerConfig): WebSocketServer {
  const { httpServer, sessionManager } = config;

  const wss = new WebSocketServer({
    noServer: true, // We'll handle upgrade manually for path routing
  });

  // Handle HTTP upgrade requests
  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const pathname = url.pathname;

    // Route: /sessions/:id/terminal
    const terminalMatch = pathname.match(/^\/sessions\/([^/]+)\/terminal$/);

    if (terminalMatch) {
      const sessionId = terminalMatch[1];
      console.log(`[WS] Upgrade request for session: ${sessionId}`);

      // Validate session exists
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        console.log(`[WS] Session ${sessionId} not found, rejecting upgrade`);
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      // Complete the WebSocket handshake
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, sessionId);
      });
    } else {
      // Unknown path, reject
      console.log(`[WS] Unknown upgrade path: ${pathname}`);
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  });

  // Handle new WebSocket connections
  wss.on('connection', (ws: WebSocket, _request: IncomingMessage, sessionId: string) => {
    console.log(`[WS] Client connected for session: ${sessionId}`);

    // Add CORS-like headers for the handshake are handled by the upgrade

    // Attach PTY to this WebSocket
    const result = ptyManager.attach(sessionId, ws);

    if (!result.success) {
      console.error(`[WS] Failed to attach PTY for ${sessionId}: ${result.error}`);
      ws.send(JSON.stringify({ type: 'error', message: result.error || 'Failed to attach to session' }));
      ws.close();
      return;
    }

    console.log(`[WS] PTY attached for session: ${sessionId}`);
  });

  // Cleanup on server close
  wss.on('close', () => {
    console.log('[WS] WebSocket server closing');
    ptyManager.closeAll();
  });

  console.log('[WS] WebSocket server initialized');

  return wss;
}
