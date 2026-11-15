export interface ThroughputSample {
  bytes: number;
  durationMs: number;
  timestamp: number;
  speedBytesPerSec: number;
  speedMbps: number;
}

export class ThroughputDetector {
  private samples: ThroughputSample[] = [];
  private maxSamples = 20;
  private ewmaEstimateMbps = 0;
  private ewmaAlpha = 0.25; // Weight for latest sample

  /**
   * Record a downloaded chunk/segment sample
   * @param bytes Number of bytes received
   * @param durationMs Duration of transfer in milliseconds
   */
  public recordSample(bytes: number, durationMs: number): ThroughputSample {
    const validDuration = Math.max(durationMs, 10); // Minimum 10ms to avoid division by zero or inflated spikes
    const speedBytesPerSec = (bytes / validDuration) * 1000;
    const speedMbps = (bytes * 8) / (validDuration / 1000) / 1_000_000;

    const sample: ThroughputSample = {
      bytes,
      durationMs: validDuration,
      timestamp: Date.now(),
      speedBytesPerSec,
      speedMbps,
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Update EWMA bandwidth estimate
    if (this.ewmaEstimateMbps === 0) {
      this.ewmaEstimateMbps = speedMbps;
    } else {
      this.ewmaEstimateMbps = this.ewmaAlpha * speedMbps + (1 - this.ewmaAlpha) * this.ewmaEstimateMbps;
    }

    return sample;
  }

  /**
   * Get the most recent single download speed in Bytes/s
   */
  public getInstantSpeedBytesPerSec(): number {
    if (this.samples.length === 0) return 0;
    return this.samples[this.samples.length - 1].speedBytesPerSec;
  }

  /**
   * Get recent average speed in Bytes/s over a time window (default 5000ms)
   */
  public getRecentAverageSpeedBytesPerSec(windowMs = 5000): number {
    const now = Date.now();
    const recent = this.samples.filter((s) => now - s.timestamp <= windowMs);
    if (recent.length === 0) {
      return this.getInstantSpeedBytesPerSec();
    }

    let totalBytes = 0;
    let totalDurationMs = 0;
    for (const s of recent) {
      totalBytes += s.bytes;
      totalDurationMs += s.durationMs;
    }

    if (totalDurationMs <= 0) return 0;
    return (totalBytes / totalDurationMs) * 1000;
  }

  /**
   * Get EWMA smoothed bandwidth estimate in Mbps
   */
  public getEstimatedBandwidthMbps(): number {
    return this.ewmaEstimateMbps;
  }

  /**
   * Clear recorded samples
   */
  public reset(): void {
    this.samples = [];
    this.ewmaEstimateMbps = 0;
  }

  /**
   * Format speed to human readable string (e.g., 3.52 MB/s, 450 KB/s)
   */
  public static formatSpeed(bytesPerSec: number): string {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
    if (bytesPerSec >= 1024 * 1024) {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
    }
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  }

  /**
   * Format bandwidth to Mbps
   */
  public static formatMbps(mbps: number): string {
    if (!mbps || mbps <= 0) return '0 Mbps';
    return `${mbps.toFixed(2)} Mbps`;
  }
}
