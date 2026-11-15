import { NetworkQuality, NetworkStats } from '../types';
import { ThroughputDetector } from './throughput';
import { RTTDetector } from './rtt';

export class NetworkMonitor {
  private throughput: ThroughputDetector = new ThroughputDetector();
  private rttDetector: RTTDetector = new RTTDetector();

  private totalRequests = 0;
  private failedRequests = 0;

  private rebufferCount = 0;
  private rebufferDuration = 0;
  private lastRebufferStart = 0;
  private isRebuffering = false;

  private videoElement?: HTMLVideoElement;
  private eventListeners: Array<{ target: EventTarget; type: string; listener: EventListener }> = [];

  constructor(video?: HTMLVideoElement) {
    if (video) {
      this.attachVideo(video);
    }
  }

  public attachVideo(video: HTMLVideoElement): void {
    this.detachVideo();
    this.videoElement = video;

    const onWaiting = () => {
      if (!this.isRebuffering && !video.paused && !video.ended) {
        this.isRebuffering = true;
        this.lastRebufferStart = performance.now();
        this.rebufferCount++;
      }
    };

    const onPlaying = () => {
      if (this.isRebuffering) {
        this.isRebuffering = false;
        if (this.lastRebufferStart > 0) {
          this.rebufferDuration += (performance.now() - this.lastRebufferStart) / 1000;
          this.lastRebufferStart = 0;
        }
      }
    };

    const onPause = () => {
      if (this.isRebuffering) {
        this.isRebuffering = false;
        if (this.lastRebufferStart > 0) {
          this.rebufferDuration += (performance.now() - this.lastRebufferStart) / 1000;
          this.lastRebufferStart = 0;
        }
      }
    };

    this.addListener(video, 'waiting', onWaiting);
    this.addListener(video, 'playing', onPlaying);
    this.addListener(video, 'pause', onPause);
  }

  public detachVideo(): void {
    for (const { target, type, listener } of this.eventListeners) {
      target.removeEventListener(type, listener);
    }
    this.eventListeners = [];
    this.videoElement = undefined;
  }

  private addListener(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.eventListeners.push({ target, type, listener });
  }

  /**
   * Record a completed transfer
   */
  public recordDownload(bytes: number, durationMs: number, rttMs?: number): void {
    this.totalRequests++;
    this.throughput.recordSample(bytes, durationMs);
    if (typeof rttMs === 'number' && rttMs > 0) {
      this.rttDetector.recordRTT(rttMs);
    }
  }

  /**
   * Record an observed RTT (Round Trip Time) sample directly
   */
  public recordRTT(rttMs: number): void {
    if (typeof rttMs === 'number' && rttMs > 0) {
      this.rttDetector.recordRTT(rttMs);
    }
  }

  /**
   * Record a failed request
   */
  public recordFailure(): void {
    this.totalRequests++;
    this.failedRequests++;
  }

  /**
   * Calculate available playable buffer ahead of currentTime (in seconds)
   * Accurately finds the TimeRange encompassing currentTime.
   */
  public getBufferLength(): number {
    if (!this.videoElement) return 0;
    const { currentTime, buffered } = this.videoElement;
    if (!buffered || buffered.length === 0) return 0;

    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      // Small epsilon 0.5s tolerance before start
      if (currentTime >= start - 0.5 && currentTime <= end) {
        return Math.max(0, end - currentTime);
      }
    }

    return 0;
  }

  /**
   * Get failure rate (0 - 1)
   */
  public getFailureRate(): number {
    if (this.totalRequests === 0) return 0;
    return this.failedRequests / this.totalRequests;
  }

  /**
   * Categorize network quality
   */
  public getNetworkQuality(): { quality: NetworkQuality; label: string } {
    const bwMbps = this.throughput.getEstimatedBandwidthMbps();
    const buffer = this.getBufferLength();
    const failureRate = this.getFailureRate();

    // Default if no bandwidth samples yet
    if (bwMbps === 0) {
      return { quality: 'good', label: '检测中 (Detecting)' };
    }

    let quality: NetworkQuality = 'fair';
    let label = '一般 (Fair)';

    if (bwMbps < 0.8) {
      quality = 'extreme-poor';
      label = '极差 (Very Poor)';
    } else if (bwMbps < 2) {
      quality = 'poor';
      label = '较差 (Poor)';
    } else if (bwMbps < 5) {
      quality = 'fair';
      label = '一般 (Fair)';
    } else if (bwMbps < 10) {
      quality = 'good';
      label = '良好 (Good)';
    } else {
      quality = 'excellent';
      label = '优秀 (Excellent)';
    }

    // Downgrade if failure rate is very high or buffer is empty and stalling
    if ((failureRate > 0.3 || (this.isRebuffering && buffer < 1)) && quality !== 'extreme-poor') {
      if (quality === 'excellent') {
        quality = 'good';
        label = '良好 (波动)';
      } else if (quality === 'good') {
        quality = 'fair';
        label = '一般 (波动)';
      } else if (quality === 'fair') {
        quality = 'poor';
        label = '较差 (不稳定)';
      } else if (quality === 'poor') {
        quality = 'extreme-poor';
        label = '极差 (中断)';
      }
    }

    return { quality, label };
  }

  public getStats(): NetworkStats {
    const instantBytes = this.throughput.getInstantSpeedBytesPerSec();
    const smoothBytes = this.throughput.getRecentAverageSpeedBytesPerSec();
    const bwMbps = this.throughput.getEstimatedBandwidthMbps();
    const rtt = this.rttDetector.getRTT();
    const bufferLength = this.getBufferLength();
    const failureRate = this.getFailureRate();
    const { quality, label } = this.getNetworkQuality();

    let currentRebufferDuration = this.rebufferDuration;
    if (this.isRebuffering && this.lastRebufferStart > 0) {
      currentRebufferDuration += (performance.now() - this.lastRebufferStart) / 1000;
    }

    return {
      instantSpeedBytesPerSec: instantBytes,
      smoothSpeedBytesPerSec: smoothBytes,
      instantSpeedMbps: (instantBytes * 8) / 1_000_000,
      smoothSpeedMbps: (smoothBytes * 8) / 1_000_000,
      bandwidthEstimateMbps: bwMbps,
      rtt,
      failureRate,
      bufferLength,
      rebufferCount: this.rebufferCount,
      rebufferDuration: Math.round(currentRebufferDuration * 10) / 10,
      networkQuality: quality,
      networkQualityLabel: label,
    };
  }

  public reset(): void {
    this.throughput.reset();
    this.rttDetector.reset();
    this.totalRequests = 0;
    this.failedRequests = 0;
    this.rebufferCount = 0;
    this.rebufferDuration = 0;
    this.lastRebufferStart = 0;
    this.isRebuffering = false;
  }

  public destroy(): void {
    this.detachVideo();
    this.reset();
  }
}
