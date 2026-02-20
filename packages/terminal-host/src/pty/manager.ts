import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { WebSocket } from 'ws';

interface PtyConnection {
  pty: IPty;
  viewers: Set<WebSocket>; // Multiple WebSockets can view same PTY
  sessionId: string;
  idleTimeout: NodeJS.Timeout | null;
  lastActivity: number;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class PtyManager {
  private connections: Map<string, PtyConnection> = new Map();

  /**
   * Attach a WebSocket to a tmux session via PTY
   * Multiple WebSockets can view the same PTY (multiplexing)
   */
  attach(sessionId: string, ws: WebSocket): { success: boolean; error?: string } {
    const tmuxSessionName = `dev-assistant-${sessionId}`;

    // Check if PTY already exists for this session
    const existing = this.connections.get(sessionId);
    if (existing) {
      // Add this WebSocket as an additional viewer
      console.log(`[PTY] Session ${sessionId} already has PTY, adding viewer (total: ${existing.viewers.size + 1})`);
      existing.viewers.add(ws);

      // Wire this WebSocket's input to the existing PTY
      this.wireWebSocketInput(ws, existing.pty, sessionId);

      // Handle this WebSocket's close/error
      ws.on('close', () => {
        console.log(`[PTY] Viewer disconnected from ${sessionId}`);
        this.removeViewer(sessionId, ws);
      });

      ws.on('error', (err) => {
        console.error(`[PTY] Viewer error for ${sessionId}:`, err.message);
        this.removeViewer(sessionId, ws);
      });

      this.resetIdleTimeout(sessionId);
      return { success: true };
    }

    try {
      // Spawn tmux attach-session (only once per session)
      const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', tmuxSessionName], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
      });

      console.log(`[PTY] Attached to tmux session: ${tmuxSessionName} (pid: ${ptyProcess.pid})`);

      const viewers = new Set<WebSocket>([ws]);
      const connection: PtyConnection = {
        pty: ptyProcess,
        viewers,
        sessionId,
        idleTimeout: null,
        lastActivity: Date.now(),
      };

      // Wire PTY output → ALL WebSocket viewers
      ptyProcess.onData((data: string) => {
        for (const viewer of connection.viewers) {
          if (viewer.readyState === viewer.OPEN) {
            viewer.send(data);
          }
        }
        this.resetIdleTimeout(sessionId);
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[PTY] Session ${sessionId} exited with code ${exitCode}`);
        // Notify all viewers
        for (const viewer of connection.viewers) {
          if (viewer.readyState === viewer.OPEN) {
            viewer.send(JSON.stringify({ type: 'exit', code: exitCode }));
            viewer.close();
          }
        }
        this.cleanup(sessionId);
      });

      // Wire this WebSocket's input to PTY
      this.wireWebSocketInput(ws, ptyProcess, sessionId);

      // Handle WebSocket close
      ws.on('close', () => {
        console.log(`[PTY] Viewer disconnected from ${sessionId}`);
        this.removeViewer(sessionId, ws);
      });

      ws.on('error', (err) => {
        console.error(`[PTY] Viewer error for ${sessionId}:`, err.message);
        this.removeViewer(sessionId, ws);
      });

      this.connections.set(sessionId, connection);
      this.resetIdleTimeout(sessionId);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[PTY] Failed to attach to ${tmuxSessionName}:`, message);
      return { success: false, error: message };
    }
  }

  /**
   * Wire WebSocket input to PTY (shared logic for new and existing connections)
   */
  private wireWebSocketInput(ws: WebSocket, ptyProcess: IPty, sessionId: string): void {
    ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      this.resetIdleTimeout(sessionId);

      // Check for JSON control messages
      if (!isBinary) {
        const str = data.toString();
        if (str.startsWith('{')) {
          try {
            const msg = JSON.parse(str);
            if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
              ptyProcess.resize(msg.cols, msg.rows);
              console.log(`[PTY] Resized ${sessionId} to ${msg.cols}x${msg.rows}`);
              return;
            }
          } catch {
            // Not JSON, treat as terminal input
          }
        }
      }

      // Send to PTY as terminal input
      ptyProcess.write(data.toString());
    });
  }

  /**
   * Remove a viewer WebSocket from a session
   * Cleans up the PTY if no viewers remain
   */
  private removeViewer(sessionId: string, ws: WebSocket): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;

    connection.viewers.delete(ws);
    console.log(`[PTY] Removed viewer from ${sessionId}, remaining: ${connection.viewers.size}`);

    // If no viewers left, clean up the PTY after a grace period
    if (connection.viewers.size === 0) {
      console.log(`[PTY] No viewers left for ${sessionId}, cleaning up PTY`);
      this.cleanup(sessionId);
    }
  }

  /**
   * Reset idle timeout for a session
   */
  private resetIdleTimeout(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;

    connection.lastActivity = Date.now();

    if (connection.idleTimeout) {
      clearTimeout(connection.idleTimeout);
    }

    connection.idleTimeout = setTimeout(() => {
      console.log(`[PTY] Session ${sessionId} idle timeout, closing`);
      this.cleanup(sessionId);
    }, IDLE_TIMEOUT_MS);
  }

  /**
   * Clean up a PTY connection and all its viewers
   */
  private cleanup(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;

    if (connection.idleTimeout) {
      clearTimeout(connection.idleTimeout);
    }

    try {
      connection.pty.kill();
    } catch {
      // PTY might already be dead
    }

    // Close all viewer WebSockets
    for (const viewer of connection.viewers) {
      try {
        if (viewer.readyState === viewer.OPEN) {
          viewer.close();
        }
      } catch {
        // WebSocket might already be closed
      }
    }
    connection.viewers.clear();

    this.connections.delete(sessionId);
    console.log(`[PTY] Cleaned up session ${sessionId}`);
  }

  /**
   * Check if a session has an active PTY connection
   */
  hasConnection(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Get number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all connections (for shutdown)
   */
  closeAll(): void {
    console.log(`[PTY] Closing all ${this.connections.size} connections`);
    for (const sessionId of this.connections.keys()) {
      this.cleanup(sessionId);
    }
  }
}

// Singleton instance
export const ptyManager = new PtyManager();
