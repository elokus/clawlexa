import { getMacDaemonTerminalUrl } from '../config';

// Type for ghostty-web Terminal (loaded dynamically)
interface GhosttyTerminal {
  open(container: HTMLElement): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(callback: (data: string) => void): void;
  dispose(): void;
}

export type TerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface TerminalClientOptions {
  fontSize?: number;
  onStatusChange?: (status: TerminalStatus, error?: string) => void;
  onExit?: (code: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton Management - Prevent duplicate connections per session
// ═══════════════════════════════════════════════════════════════════════════
interface SessionConnection {
  client: TerminalClient;
  refCount: number;
}

const activeConnections = new Map<string, SessionConnection>();

/**
 * Get or create a TerminalClient for a session (singleton per sessionId)
 */
export function getTerminalClient(
  sessionId: string,
  options: TerminalClientOptions = {}
): TerminalClient {
  const existing = activeConnections.get(sessionId);
  if (existing) {
    existing.refCount++;
    console.log(`[TerminalClient] Reusing connection for ${sessionId} (refCount: ${existing.refCount})`);
    // Update callbacks to latest
    existing.client.updateCallbacks(options);
    return existing.client;
  }

  const client = new TerminalClient(options);
  activeConnections.set(sessionId, { client, refCount: 1 });
  console.log(`[TerminalClient] Created new connection for ${sessionId}`);
  return client;
}

/**
 * Release a reference to a TerminalClient
 */
export function releaseTerminalClient(sessionId: string): void {
  const existing = activeConnections.get(sessionId);
  if (!existing) return;

  existing.refCount--;
  console.log(`[TerminalClient] Released ${sessionId} (refCount: ${existing.refCount})`);

  if (existing.refCount <= 0) {
    // Delay cleanup to handle React StrictMode double-mount
    setTimeout(() => {
      const current = activeConnections.get(sessionId);
      if (current && current.refCount <= 0) {
        console.log(`[TerminalClient] Cleaning up ${sessionId} after delay`);
        current.client.disconnect();
        activeConnections.delete(sessionId);
      }
    }, 500);
  }
}

export class TerminalClient {
  private ws: WebSocket | null = null;
  private terminal: GhosttyTerminal | null = null;
  private container: HTMLElement | null = null;
  private sessionId: string | null = null;
  private options: TerminalClientOptions;
  private status: TerminalStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;

  constructor(options: TerminalClientOptions = {}) {
    this.options = {
      fontSize: 13,
      ...options,
    };
  }

  /**
   * Update callbacks (used when reusing singleton)
   */
  updateCallbacks(options: TerminalClientOptions): void {
    if (options.onStatusChange) {
      this.options.onStatusChange = options.onStatusChange;
      // Notify of current status
      options.onStatusChange(this.status);
    }
    if (options.onExit) {
      this.options.onExit = options.onExit;
    }
  }

  /**
   * Connect to a session's PTY via WebSocket
   */
  async connect(sessionId: string, container: HTMLElement): Promise<void> {
    // Prevent duplicate connection attempts
    if (this.isConnecting) {
      console.log(`[TerminalClient] Already connecting to ${sessionId}, skipping`);
      return;
    }

    // If already connected to this session, just update container
    if (this.ws?.readyState === WebSocket.OPEN && this.sessionId === sessionId) {
      console.log(`[TerminalClient] Already connected to ${sessionId}`);
      if (this.terminal && container !== this.container) {
        // Re-open terminal in new container if needed
        this.container = container;
        this.terminal.open(container);
      }
      return;
    }

    this.sessionId = sessionId;
    this.container = container;
    this.isConnecting = true;

    this.setStatus('connecting');

    try {
      // Dynamically import ghostty-web to load WASM
      const ghostty = await import('ghostty-web');
      await ghostty.init();

      // Create terminal instance
      this.terminal = new ghostty.Terminal({
        fontSize: this.options.fontSize,
        theme: {
          background: '#05050a',
          foreground: '#e0e0e0',
          cursor: '#38bdf8',
          cursorAccent: '#05050a',
          black: '#1a1a2e',
          red: '#f43f5e',
          green: '#34d399',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#8b5cf6',
          cyan: '#38bdf8',
          white: '#e0e0e0',
          brightBlack: '#4a4a6a',
          brightRed: '#fb7185',
          brightGreen: '#6ee7b7',
          brightYellow: '#fbbf24',
          brightBlue: '#60a5fa',
          brightMagenta: '#a78bfa',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        },
      });

      this.terminal.open(container);

      // Connect WebSocket to Mac daemon
      const wsUrl = getMacDaemonTerminalUrl(sessionId);
      console.log(`[TerminalClient] Connecting to ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[TerminalClient] Connected to ${sessionId}`);
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.setStatus('connected');
      };

      this.ws.onmessage = (event) => {
        const data = event.data;

        // Check for JSON control messages
        if (typeof data === 'string' && data.startsWith('{')) {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'exit') {
              console.log(`[TerminalClient] Session exited with code ${msg.code}`);
              this.options.onExit?.(msg.code);
              this.setStatus('disconnected');
              return;
            }
            if (msg.type === 'error') {
              console.error(`[TerminalClient] Error: ${msg.message}`);
              this.setStatus('error', msg.message);
              return;
            }
          } catch {
            // Not JSON, treat as terminal output
          }
        }

        // Write to terminal
        this.terminal?.write(data);
      };

      this.ws.onclose = (event) => {
        console.log(`[TerminalClient] Disconnected from ${sessionId}`, event.code, event.reason);

        if (this.status === 'connected' && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };

      this.ws.onerror = (error) => {
        console.error(`[TerminalClient] WebSocket error:`, error);
        this.isConnecting = false;
        this.setStatus('error', 'Connection error');
      };

      // Wire terminal input to WebSocket
      this.terminal.onData((data: string) => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(data);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[TerminalClient] Failed to connect:`, message);
      this.isConnecting = false;
      this.setStatus('error', message);
      throw error;
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    this.terminal?.resize(cols, rows);

    // Send resize command to server
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  /**
   * Disconnect from the session
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

    this.setStatus('disconnected');
    console.log(`[TerminalClient] Disconnected`);
  }

  /**
   * Get current connection status
   */
  getStatus(): TerminalStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  private setStatus(status: TerminalStatus, error?: string): void {
    this.status = status;
    this.options.onStatusChange?.(status, error);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

    console.log(`[TerminalClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.setStatus('connecting');

    this.reconnectTimeout = setTimeout(() => {
      if (this.sessionId && this.container) {
        // Dispose old terminal first
        if (this.terminal) {
          this.terminal.dispose();
          this.terminal = null;
        }

        this.connect(this.sessionId, this.container).catch((error) => {
          console.error(`[TerminalClient] Reconnect failed:`, error);
        });
      }
    }, delay);
  }
}
