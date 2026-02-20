import {
  DaemonSession,
  SessionStatus,
  CreateSessionRequest,
  SessionSummary,
  SessionOutput,
  WebhookPayload,
} from './types.js';
import { tmuxManager } from '../tmux/manager.js';

const STATUS_CHECK_INTERVAL = 2000; // 2 seconds
const OUTPUT_POLL_INTERVAL = 500; // 500ms

export interface SessionManagerConfig {
  piWebhookUrl?: string;
  demoMode?: boolean;
}

export class SessionManager {
  private sessions: Map<string, DaemonSession> = new Map();
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private config: SessionManagerConfig;

  constructor(config: SessionManagerConfig = {}) {
    this.config = config;
  }

  /**
   * Start the background status checker
   */
  start(): void {
    if (this.statusCheckInterval) return;

    this.statusCheckInterval = setInterval(
      () => this.checkAllSessionStatuses(),
      STATUS_CHECK_INTERVAL
    );

    console.log('[SessionManager] Started status monitoring');
  }

  /**
   * Stop the background status checker
   */
  stop(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    console.log('[SessionManager] Stopped status monitoring');
  }

  /**
   * Create a new session
   */
  async createSession(request: CreateSessionRequest): Promise<DaemonSession> {
    const { sessionId, goal, command = 'claude' } = request;

    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    // Create tmux session (skip command in demo mode)
    const tmuxSession = await tmuxManager.createSession(
      sessionId,
      command,
      this.config.demoMode ?? false
    );

    const now = new Date();
    const session: DaemonSession = {
      sessionId,
      tmuxSession,
      goal,
      status: 'running',
      outputBuffer: [],
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(sessionId, session);

    console.log(`[SessionManager] Created session ${sessionId}: ${goal}`);

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): DaemonSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values()).map((session) => ({
      sessionId: session.sessionId,
      goal: session.goal,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  }

  /**
   * Send input to a session
   */
  async sendInput(sessionId: string, input: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === 'finished' || session.status === 'error') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    await tmuxManager.sendInput(sessionId, input);

    session.status = 'running';
    session.updatedAt = new Date();

    console.log(`[SessionManager] Sent input to ${sessionId}`);

    return true;
  }

  /**
   * Read output from a session
   */
  async readOutput(sessionId: string): Promise<SessionOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Capture current output from tmux
    const output = await tmuxManager.captureOutput(sessionId);

    // Update buffer
    session.outputBuffer = output;
    session.updatedAt = new Date();

    return {
      sessionId,
      output,
      status: session.status,
    };
  }

  /**
   * Read terminal context with ANSI codes preserved.
   * Used for UI restoration when switching between terminal views.
   */
  async readContext(sessionId: string, lines: number = 100): Promise<string[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return tmuxManager.captureContext(sessionId, lines);
  }

  /**
   * Terminate a session
   */
  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await tmuxManager.killSession(sessionId);
    } catch (error) {
      // Session might already be dead
      console.warn(`[SessionManager] Could not kill tmux session: ${error}`);
    }

    this.sessions.delete(sessionId);

    console.log(`[SessionManager] Terminated session ${sessionId}`);
  }

  /**
   * Check status of all sessions and update
   */
  private async checkAllSessionStatuses(): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'finished' || session.status === 'error') {
        continue;
      }

      try {
        const previousStatus = session.status;
        const newStatus = await this.detectSessionStatus(sessionId);

        if (newStatus !== previousStatus) {
          session.status = newStatus;
          session.updatedAt = new Date();

          console.log(
            `[SessionManager] Session ${sessionId} status changed: ${previousStatus} -> ${newStatus}`
          );

          // Notify Pi via webhook if configured
          await this.notifyStatusChange(session);
        }
      } catch (error) {
        console.error(
          `[SessionManager] Error checking status for ${sessionId}:`,
          error
        );
      }
    }
  }

  /**
   * Detect the current status of a session based on tmux state
   */
  private async detectSessionStatus(sessionId: string): Promise<SessionStatus> {
    const exists = await tmuxManager.sessionExists(sessionId);
    if (!exists) {
      return 'finished';
    }

    const isRunning = await tmuxManager.isProcessRunning(sessionId);
    if (!isRunning) {
      return 'finished';
    }

    // Capture output to check for prompts
    const output = await tmuxManager.captureOutput(sessionId, 50);
    const lastLines = output.slice(-10).join('\n').toLowerCase();

    // Heuristics to detect waiting for input
    // Claude Code typically shows prompts like "> " or asks questions
    if (
      lastLines.includes('> ') ||
      lastLines.includes('? ') ||
      lastLines.includes('(y/n)') ||
      lastLines.includes('press enter') ||
      lastLines.match(/\[.*\]:?\s*$/)
    ) {
      return 'waiting_for_input';
    }

    return 'running';
  }

  /**
   * Send webhook notification to Pi
   */
  private async notifyStatusChange(session: DaemonSession): Promise<void> {
    if (!this.config.piWebhookUrl) return;

    const payload: WebhookPayload = {
      sessionId: session.sessionId,
      status: session.status,
      message: `Session ${session.status}`,
    };

    try {
      const response = await fetch(this.config.piWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(
          `[SessionManager] Webhook notification failed: ${response.status}`
        );
      }
    } catch (error) {
      console.warn(`[SessionManager] Webhook notification error:`, error);
    }
  }

  /**
   * Recover sessions from existing tmux sessions on startup
   */
  async recoverSessions(): Promise<number> {
    const existingSessionIds = await tmuxManager.listSessions();
    let recovered = 0;

    for (const sessionId of existingSessionIds) {
      if (this.sessions.has(sessionId)) continue;

      const tmuxSession = tmuxManager.getTmuxSessionName(sessionId);
      const status = await this.detectSessionStatus(sessionId);

      const session: DaemonSession = {
        sessionId,
        tmuxSession,
        goal: '[Recovered session]',
        status,
        outputBuffer: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.sessions.set(sessionId, session);
      recovered++;
    }

    if (recovered > 0) {
      console.log(`[SessionManager] Recovered ${recovered} existing sessions`);
    }

    return recovered;
  }
}
