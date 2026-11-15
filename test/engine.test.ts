import { describe, it, expect, beforeEach } from 'vitest';
import { SmartBufferEngine } from '../src/engine';

describe('SmartBufferEngine', () => {
  let engine: SmartBufferEngine;

  beforeEach(() => {
    engine = new SmartBufferEngine();
  });

  it('should initialize all subsystems properly', () => {
    expect(engine.configManager).toBeDefined();
    expect(engine.networkMonitor).toBeDefined();
    expect(engine.segmentCache).toBeDefined();
    expect(engine.recoveryManager).toBeDefined();
    expect(engine.bufferManager).toBeDefined();
    expect(engine.hlsAdapter).toBeDefined();
    expect(engine.mp4Engine).toBeDefined();
  });

  it('should report comprehensive status', () => {
    const status = engine.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.mode).toBe('default');
    expect(typeof status.downloadSpeedFormatted).toBe('string');
    expect(typeof status.bandwidthFormatted).toBe('string');
    expect(typeof status.bufferLengthFormatted).toBe('string');
    expect(status.preloadedSegmentsCount).toBe(0);
    expect(status.activeConcurrency).toBe(0);
  });

  it('should update and propagate configuration changes', () => {
    engine.updateConfig({
      maxConcurrency: 5,
      targetBufferLength: 45,
    });

    const cfg = engine.getConfig();
    expect(cfg.maxConcurrency).toBe(5);
    expect(cfg.targetBufferLength).toBe(45);
    expect(cfg.mode).toBe('custom');
  });

  it('should clear caches when disabled', () => {
    // Put a dummy item in cache
    engine.segmentCache.put({
      key: 'test_key',
      url: 'test.ts',
      sn: 1,
      level: 0,
      startTime: 0,
      duration: 4,
      quality: 0,
      size: 100,
      data: new ArrayBuffer(100),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    expect(engine.segmentCache.getCompletedCount()).toBe(1);

    // Disable engine
    engine.updateConfig({ enabled: false });

    // Cache should be pruned
    expect(engine.segmentCache.getCompletedCount()).toBe(0);
  });

  it('should cleanly destroy resources', () => {
    engine.destroy();
    expect(engine.segmentCache.getCompletedCount()).toBe(0);
  });
});
