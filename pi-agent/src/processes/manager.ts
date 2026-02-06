import { EventEmitter } from 'events';

// Module-level singleton
let instance: ProcessManager | null = null;

/**
 * Get the singleton ProcessManager instance.
 * Created on first call, reused thereafter.
 */
export function getProcessManager(): ProcessManager {
  if (!instance) {
    instance = new ProcessManager();
  }
  return instance;
}

export interface ManagedProcess {
  id: string;
  name: string;              // Human-readable ("swift-falcon")
  sessionId: string;          // DB session ID
  type: 'headless' | 'interactive' | 'web_search' | 'deep_thinking';
  notifyVoiceOnCompletion: boolean;
  status: 'running' | 'finished' | 'error';
  startedAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
}

export interface SpawnConfig {
  name: string;
  sessionId: string;
  type: ManagedProcess['type'];
  notifyVoiceOnCompletion?: boolean;
  execute: () => Promise<string>;
}

export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();

  spawn(config: SpawnConfig): ManagedProcess {
    const process: ManagedProcess = {
      id: config.sessionId,
      name: config.name,
      sessionId: config.sessionId,
      type: config.type,
      notifyVoiceOnCompletion: config.notifyVoiceOnCompletion ?? false,
      status: 'running',
      startedAt: Date.now(),
    };

    this.processes.set(process.id, process);

    // Fire-and-forget: run in background
    config.execute()
      .then((result) => {
        process.status = 'finished';
        process.finishedAt = Date.now();
        process.result = result;
        this.emit('process:completed', process);
      })
      .catch((err) => {
        process.status = 'error';
        process.finishedAt = Date.now();
        process.error = err?.message || String(err);
        this.emit('process:error', process);
      });

    return process;
  }

  getRunning(): ManagedProcess[] {
    return [...this.processes.values()].filter(p => p.status === 'running');
  }

  getByName(name: string): ManagedProcess | undefined {
    return [...this.processes.values()].find(p => p.name === name);
  }

  getBySessionId(id: string): ManagedProcess | undefined {
    return this.processes.get(id);
  }

  cancel(nameOrId: string): boolean {
    const process = this.getByName(nameOrId) || this.processes.get(nameOrId);
    if (!process || process.status !== 'running') return false;
    process.status = 'error';
    process.finishedAt = Date.now();
    process.error = 'Cancelled by user';
    this.emit('process:error', process);
    return true;
  }

  getSummary(): string {
    const running = this.getRunning().length;
    const finished = [...this.processes.values()].filter(p => p.status === 'finished').length;
    const errors = [...this.processes.values()].filter(p => p.status === 'error').length;
    const parts: string[] = [];
    if (running > 0) parts.push(`${running} running`);
    if (finished > 0) parts.push(`${finished} completed`);
    if (errors > 0) parts.push(`${errors} failed`);
    return parts.join(', ') || 'No processes';
  }
}
