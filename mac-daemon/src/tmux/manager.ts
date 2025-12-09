import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TMUX_PREFIX = 'dev-assistant';
const OUTPUT_BUFFER_LINES = 500;

export class TmuxManager {
  /**
   * Generate a tmux session name from session ID
   */
  private getSessionName(sessionId: string): string {
    return `${TMUX_PREFIX}-${sessionId}`;
  }

  /**
   * Check if tmux is available on the system
   */
  async checkTmuxAvailable(): Promise<boolean> {
    try {
      await execAsync('which tmux');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new tmux session with the given command
   */
  async createSession(
    sessionId: string,
    command: string = 'claude'
  ): Promise<string> {
    const sessionName = this.getSessionName(sessionId);

    // Check if session already exists
    const exists = await this.sessionExists(sessionId);
    if (exists) {
      throw new Error(`Session ${sessionName} already exists`);
    }

    // Create new detached tmux session with a shell first
    // Using remain-on-exit keeps session alive if command exits
    await execAsync(
      `tmux new-session -d -s "${sessionName}" -x 200 -y 50`
    );

    // Small delay to ensure shell is ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Export DEV_SESSION_ID so hooks can identify this session
    await this.sendInput(sessionId, `export DEV_SESSION_ID="${sessionId}"`);

    // Small delay before sending the actual command
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send the command to the session
    // This properly handles complex commands with &&, quotes, etc.
    await this.sendInput(sessionId, command);

    return sessionName;
  }

  /**
   * Check if a tmux session exists
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const sessionName = this.getSessionName(sessionId);
    try {
      await execAsync(`tmux has-session -t "${sessionName}" 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send input to a tmux session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    const sessionName = this.getSessionName(sessionId);

    const exists = await this.sessionExists(sessionId);
    if (!exists) {
      throw new Error(`Session ${sessionName} does not exist`);
    }

    // Use spawn with args array to avoid shell escaping issues
    // tmux send-keys -l sends literal string without interpretation
    return new Promise((resolve, reject) => {
      const proc = spawn('tmux', ['send-keys', '-t', sessionName, '-l', input]);

      proc.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`tmux send-keys failed with code ${code}`));
          return;
        }

        // Send Enter key separately
        try {
          await execAsync(`tmux send-keys -t "${sessionName}" Enter`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Send raw keys to a tmux session (for special keys like Ctrl+C)
   */
  async sendKeys(sessionId: string, keys: string): Promise<void> {
    const sessionName = this.getSessionName(sessionId);

    const exists = await this.sessionExists(sessionId);
    if (!exists) {
      throw new Error(`Session ${sessionName} does not exist`);
    }

    await execAsync(`tmux send-keys -t "${sessionName}" ${keys}`);
  }

  /**
   * Capture output from a tmux session pane
   */
  async captureOutput(
    sessionId: string,
    lines: number = OUTPUT_BUFFER_LINES
  ): Promise<string[]> {
    const sessionName = this.getSessionName(sessionId);

    const exists = await this.sessionExists(sessionId);
    if (!exists) {
      throw new Error(`Session ${sessionName} does not exist`);
    }

    try {
      // Capture pane content with history
      const { stdout } = await execAsync(
        `tmux capture-pane -t "${sessionName}" -p -S -${lines}`
      );

      return stdout.split('\n').filter((line) => line.length > 0);
    } catch (error) {
      console.error(`Failed to capture output for ${sessionName}:`, error);
      return [];
    }
  }

  /**
   * Get the current cursor position to detect if waiting for input
   */
  async getCursorInfo(
    sessionId: string
  ): Promise<{ x: number; y: number } | null> {
    const sessionName = this.getSessionName(sessionId);

    try {
      const { stdout } = await execAsync(
        `tmux display-message -t "${sessionName}" -p "#{cursor_x},#{cursor_y}"`
      );
      const [x, y] = stdout.trim().split(',').map(Number);
      return { x, y };
    } catch {
      return null;
    }
  }

  /**
   * Check if the session's process is still running
   */
  async isProcessRunning(sessionId: string): Promise<boolean> {
    const sessionName = this.getSessionName(sessionId);

    try {
      // Get the pane PID and check if it's running
      const { stdout } = await execAsync(
        `tmux list-panes -t "${sessionName}" -F "#{pane_pid}"`
      );
      const pid = stdout.trim();

      if (!pid) return false;

      // Check if process exists
      await execAsync(`kill -0 ${pid} 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill a tmux session
   */
  async killSession(sessionId: string): Promise<void> {
    const sessionName = this.getSessionName(sessionId);

    console.log(`[TmuxManager] Killing session: ${sessionName}`);

    const exists = await this.sessionExists(sessionId);
    if (!exists) {
      console.log(`[TmuxManager] Session ${sessionName} does not exist, skipping kill`);
      return; // Don't throw, just return - session might have exited naturally
    }

    try {
      await execAsync(`tmux kill-session -t "${sessionName}"`);
      console.log(`[TmuxManager] Successfully killed ${sessionName}`);
    } catch (error) {
      console.error(`[TmuxManager] Failed to kill ${sessionName}:`, error);
      throw error;
    }
  }

  /**
   * List all daemon-managed tmux sessions
   */
  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `tmux list-sessions -F "#{session_name}" 2>/dev/null || true`
      );

      return stdout
        .split('\n')
        .filter((name) => name.startsWith(TMUX_PREFIX))
        .map((name) => name.replace(`${TMUX_PREFIX}-`, ''));
    } catch {
      return [];
    }
  }

  /**
   * Get the tmux session name for external use
   */
  getTmuxSessionName(sessionId: string): string {
    return this.getSessionName(sessionId);
  }
}

export const tmuxManager = new TmuxManager();
