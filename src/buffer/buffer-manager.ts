import { SmartBufferConfig, NetworkQuality } from '../types';
import { NetworkMonitor } from '../network/network-monitor';

export class DynamicBufferManager {
  private config: SmartBufferConfig;
  private networkMonitor: NetworkMonitor;
  private dynamicTargetBuffer: number;
  private dynamicConcurrency: number;

  constructor(config: SmartBufferConfig, networkMonitor: NetworkMonitor) {
    this.config = config;
    this.networkMonitor = networkMonitor;
    this.dynamicTargetBuffer = config.targetBufferLength;
    this.dynamicConcurrency = config.maxConcurrency;
  }

  public updateConfig(config: SmartBufferConfig): void {
    this.config = config;
    if (!config.dynamicConcurrency) {
      this.dynamicConcurrency = config.maxConcurrency;
    }
  }

  /**
   * Re-evaluate dynamic buffer targets and concurrency based on real-time network conditions
   */
  public evaluate(): { targetBuffer: number; concurrency: number; isBufferLow: boolean } {
    const stats = this.networkMonitor.getStats();
    const currentBuffer = stats.bufferLength;
    const quality = stats.networkQuality;

    const isBufferLow = currentBuffer < 3;

    if (!this.config.dynamicConcurrency || this.config.mode === 'weak-network') {
      this.dynamicTargetBuffer = Math.max(this.config.targetBufferLength, 60);
      this.dynamicConcurrency = this.config.maxConcurrency;
      return {
        targetBuffer: this.dynamicTargetBuffer,
        concurrency: this.dynamicConcurrency,
        isBufferLow,
      };
    }

    // Adapt concurrency and buffer based on network quality
    switch (quality) {
      case 'extreme-poor':
      case 'poor':
        // In poor networks, maximize concurrency (IDM style) to grab bandwidth and deepen buffer
        this.dynamicConcurrency = this.config.maxConcurrency;
        this.dynamicTargetBuffer = Math.max(this.config.targetBufferLength, 60);
        break;

      case 'fair':
      case 'good':
      case 'excellent':
        this.dynamicConcurrency = this.config.maxConcurrency;
        this.dynamicTargetBuffer = this.config.targetBufferLength;
        break;
    }

    // Only throttle if buffer is completely empty (< 1s) and we have critical fetch
    if (currentBuffer < 1 && this.dynamicConcurrency > 2) {
      this.dynamicConcurrency = 2;
    }

    return {
      targetBuffer: this.dynamicTargetBuffer,
      concurrency: this.dynamicConcurrency,
      isBufferLow,
    };
  }

  public getTargetBufferLength(): number {
    return this.dynamicTargetBuffer;
  }

  public getEffectiveConcurrency(): number {
    return this.dynamicConcurrency;
  }
}
