import { describe, it, expect, beforeEach } from 'vitest';
import { ThroughputDetector } from '../src/network/throughput';
import { RTTDetector } from '../src/network/rtt';

describe('ThroughputDetector & RTTDetector', () => {
  let detector: ThroughputDetector;

  beforeEach(() => {
    detector = new ThroughputDetector();
  });

  it('should calculate speed and EWMA bandwidth correctly', () => {
    // 1MB downloaded in 1000ms = 1 MB/s = 8 Mbps
    const oneMB = 1024 * 1024;
    const sample = detector.recordSample(oneMB, 1000);

    expect(sample.speedBytesPerSec).toBeCloseTo(oneMB, -1);
    expect(sample.speedMbps).toBeCloseTo(8.388, 1);
    expect(detector.getEstimatedBandwidthMbps()).toBeCloseTo(8.388, 1);

    // Record a second sample with 2MB in 1000ms (~16.78 Mbps)
    detector.recordSample(oneMB * 2, 1000);
    // EWMA should smooth: 0.25 * 16.78 + 0.75 * 8.39 = 10.49
    expect(detector.getEstimatedBandwidthMbps()).toBeGreaterThan(8.388);
    expect(detector.getEstimatedBandwidthMbps()).toBeLessThan(16.78);
  });

  it('should format speed to human readable strings', () => {
    expect(ThroughputDetector.formatSpeed(0)).toBe('0 KB/s');
    expect(ThroughputDetector.formatSpeed(512 * 1024)).toBe('512 KB/s');
    expect(ThroughputDetector.formatSpeed(2.5 * 1024 * 1024)).toBe('2.50 MB/s');
  });

  it('should format Mbps correctly', () => {
    expect(ThroughputDetector.formatMbps(0)).toBe('0 Mbps');
    expect(ThroughputDetector.formatMbps(12.345)).toBe('12.35 Mbps');
  });

  it('should calculate and smooth RTT', () => {
    const rtt = new RTTDetector();
    rtt.recordRTT(100);
    expect(rtt.getRTT()).toBe(100);

    rtt.recordRTT(50);
    expect(rtt.getRTT()).toBe(85); // 0.3 * 50 + 0.7 * 100 = 85
    expect(RTTDetector.formatRTT(rtt.getRTT())).toBe('85 ms');
  });
});
