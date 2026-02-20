export abstract class BaseWebSocketAdapter {
  protected disconnecting = false;
  protected reconnectInProgress = false;
  protected consecutiveFailures = 0;

  protected readonly maxReconnectRetries: number;
  protected readonly reconnectBaseDelayMs: number;
  protected readonly reconnectMaxDelayMs: number;

  constructor(options?: {
    maxReconnectRetries?: number;
    reconnectBaseDelayMs?: number;
    reconnectMaxDelayMs?: number;
  }) {
    this.maxReconnectRetries = options?.maxReconnectRetries ?? 3;
    this.reconnectBaseDelayMs = options?.reconnectBaseDelayMs ?? 250;
    this.reconnectMaxDelayMs = options?.reconnectMaxDelayMs ?? 4000;
  }

  protected markDisconnecting(disconnecting: boolean): void {
    this.disconnecting = disconnecting;
  }

  protected resetFailureState(): void {
    this.consecutiveFailures = 0;
    this.reconnectInProgress = false;
  }

  protected markFailure(): void {
    this.consecutiveFailures += 1;
  }

  protected async tryReconnect(connectFn: () => Promise<void>): Promise<boolean> {
    if (this.disconnecting) return false;
    if (this.reconnectInProgress) return false;

    this.reconnectInProgress = true;
    try {
      for (let attempt = 0; attempt < this.maxReconnectRetries; attempt++) {
        if (this.disconnecting) return false;

        const delayMs = this.computeBackoffMs(attempt);
        await this.sleep(delayMs);

        try {
          await connectFn();
          this.resetFailureState();
          return true;
        } catch {
          this.markFailure();
        }
      }
      return false;
    } finally {
      this.reconnectInProgress = false;
    }
  }

  protected computeBackoffMs(attempt: number): number {
    const exponential = this.reconnectBaseDelayMs * Math.pow(2, attempt);
    return Math.min(exponential, this.reconnectMaxDelayMs);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
