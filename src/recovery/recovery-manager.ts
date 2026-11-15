export interface RetryOptions {
  maxRetries: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export class RecoveryManager {
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private onlineListeners: Array<() => void> = [];
  private activeFailuresCount = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  private handleOnline = () => {
    this.isOnline = true;
    for (const cb of this.onlineListeners) {
      try {
        cb();
      } catch (e) {
        console.error('[SmartBuffer:RecoveryManager] Error in online listener:', e);
      }
    }
  };

  private handleOffline = () => {
    this.isOnline = false;
  };

  public onNetworkRestored(callback: () => void): () => void {
    this.onlineListeners.push(callback);
    return () => {
      const idx = this.onlineListeners.indexOf(callback);
      if (idx !== -1) this.onlineListeners.splice(idx, 1);
    };
  }

  public getIsOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Determine if an error is recoverable by retrying
   */
  public isRecoverableError(statusOrError: number | Error | any): boolean {
    if (typeof statusOrError === 'number') {
      // 401, 403, 404, 410 are permanent / auth errors, not recoverable by naive retry
      if (statusOrError === 401 || statusOrError === 403 || statusOrError === 404 || statusOrError === 410) {
        return false;
      }
      // 408 (timeout), 429 (rate limit), 5xx are recoverable
      return statusOrError === 408 || statusOrError === 429 || statusOrError >= 500;
    }

    if (statusOrError instanceof Error) {
      // Network disconnect, abort, fetch error
      const msg = statusOrError.message.toLowerCase();
      if (msg.includes('abort')) return false; // Intentionally aborted
      return true;
    }

    return true;
  }

  /**
   * Calculate backoff delay in ms with jitter
   */
  public getBackoffDelay(attempt: number, initialDelayMs = 1000, maxDelayMs = 16000): number {
    const exponential = initialDelayMs * Math.pow(2, attempt);
    const delayWithJitter = exponential * (0.8 + Math.random() * 0.4);
    return Math.min(maxDelayMs, Math.round(delayWithJitter));
  }

  public recordFailure(): void {
    this.activeFailuresCount++;
  }

  public recordSuccess(): void {
    if (this.activeFailuresCount > 0) {
      this.activeFailuresCount--;
    }
  }

  public hasFailures(): boolean {
    return this.activeFailuresCount > 0;
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.onlineListeners = [];
    this.activeFailuresCount = 0;
  }
}
