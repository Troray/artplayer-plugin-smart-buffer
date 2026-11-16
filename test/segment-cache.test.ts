import { describe, it, expect, beforeEach } from 'vitest';
import { SegmentCache } from '../src/cache/segment-cache';

describe('SegmentCache', () => {
  let cache: SegmentCache;

  beforeEach(() => {
    cache = new SegmentCache(20); // 20 MB max
  });

  it('should generate consistent cache keys', () => {
    const key1 = cache.generateKey(0, 10, 'http://test.com/seg10.ts');
    const key2 = cache.generateKey(0, 10, 'http://test.com/seg10.ts');
    const keyWithRange = cache.generateKey(0, 10, 'http://test.com/seg10.ts', { start: 0, end: 1000 });

    expect(key1).toBe('0_10_http://test.com/seg10.ts');
    expect(key1).toBe(key2);
    expect(keyWithRange).toBe('0_10_0-1000_http://test.com/seg10.ts');
  });

  it('should store and retrieve completed items', () => {
    const key = cache.generateKey(1, 5, 'seg5.ts');
    const dummyBuffer = new ArrayBuffer(1024 * 50); // 50 KB

    cache.put({
      key,
      url: 'seg5.ts',
      sn: 5,
      level: 1,
      startTime: 20,
      duration: 4,
      quality: 1,
      size: dummyBuffer.byteLength,
      data: dummyBuffer,
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    expect(cache.has(key)).toBe(true);
    const item = cache.get(key);
    expect(item).toBeDefined();
    expect(item?.size).toBe(1024 * 50);
    expect(item?.data).toBe(dummyBuffer);
    expect(cache.getCompletedCount()).toBe(1);
  });

  it('should prune consumed segments behind playback', () => {
    const k1 = cache.generateKey(0, 1, 'seg1.ts');
    const k2 = cache.generateKey(0, 5, 'seg5.ts');

    cache.put({
      key: k1,
      url: 'seg1.ts',
      sn: 1,
      level: 0,
      startTime: 0,
      duration: 4, // ends at 4s
      quality: 0,
      size: 1000,
      data: new ArrayBuffer(1000),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    cache.put({
      key: k2,
      url: 'seg5.ts',
      sn: 5,
      level: 0,
      startTime: 20,
      duration: 4, // ends at 24s
      quality: 0,
      size: 1000,
      data: new ArrayBuffer(1000),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    // Playback is at 25s, grace period is 10s (threshold = 15s)
    cache.pruneConsumed(25, 10);

    expect(cache.has(k1)).toBe(false); // 4 < 15, should be evicted
    expect(cache.has(k2)).toBe(true);  // 24 > 15, should be retained
  });

  it('should purge segments when quality level switches', () => {
    const kL0 = cache.generateKey(0, 2, 'seg2_l0.ts');
    const kL1 = cache.generateKey(1, 2, 'seg2_l1.ts');

    cache.put({
      key: kL0,
      url: 'seg2_l0.ts',
      sn: 2,
      level: 0,
      startTime: 8,
      duration: 4,
      quality: 0,
      size: 1000,
      data: new ArrayBuffer(1000),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    cache.put({
      key: kL1,
      url: 'seg2_l1.ts',
      sn: 2,
      level: 1,
      startTime: 8,
      duration: 4,
      quality: 1,
      size: 2000,
      data: new ArrayBuffer(2000),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    // Switched to level 1
    cache.purgeOtherLevels(1);

    expect(cache.has(kL0)).toBe(false);
    expect(cache.has(kL1)).toBe(true);
  });

  it('should find items by level and sequence number even when URL varies', () => {
    const key = cache.generateKey(0, 42, 'http://cdn1.com/video_42.ts?token=abc');
    cache.put({
      key,
      url: 'http://cdn1.com/video_42.ts?token=abc',
      sn: 42,
      level: 0,
      startTime: 168,
      duration: 4,
      quality: 0,
      size: 500,
      data: new ArrayBuffer(500),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    const found = cache.getByLevelAndSn(0, 42);
    expect(found).toBeDefined();
    expect(found?.key).toBe(key);

    const notFound = cache.getByLevelAndSn(0, 43);
    expect(notFound).toBeUndefined();
  });

  it('should detect if segments exist after a given timestamp (hole detection)', () => {
    cache.put({
      key: 'k1',
      url: 'seg1.ts',
      sn: 1,
      level: 0,
      startTime: 10,
      duration: 5,
      quality: 0,
      size: 500,
      data: new ArrayBuffer(500),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    expect(cache.hasSegmentAfter(0, 5)).toBe(true);  // startTime 10 >= 5
    expect(cache.hasSegmentAfter(0, 10)).toBe(true); // startTime 10 >= 10
    expect(cache.hasSegmentAfter(0, 15)).toBe(false); // no segment with startTime >= 15
    expect(cache.hasSegmentAfter(1, 5)).toBe(false); // different level
  });

  it('should calculate merged continuous time ranges and preserve discrete buffer holes', () => {
    expect(cache.getCachedTimeRanges()).toEqual([]);

    // Segment 1: 0s ~ 4s
    cache.put({
      key: 's1',
      url: 's1.ts',
      sn: 1,
      level: 0,
      startTime: 0,
      duration: 4,
      quality: 0,
      size: 500,
      data: new ArrayBuffer(500),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    // Segment 2: 4s ~ 8s (contiguous with segment 1)
    cache.put({
      key: 's2',
      url: 's2.ts',
      sn: 2,
      level: 0,
      startTime: 4,
      duration: 4,
      quality: 0,
      size: 500,
      data: new ArrayBuffer(500),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    // Segment 4: 12s ~ 16s (missing segment 3 at 8s ~ 12s -> gap!)
    cache.put({
      key: 's4',
      url: 's4.ts',
      sn: 4,
      level: 0,
      startTime: 12,
      duration: 4,
      quality: 0,
      size: 500,
      data: new ArrayBuffer(500),
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    const ranges = cache.getCachedTimeRanges();
    expect(ranges).toEqual([
      { start: 0, end: 8 },
      { start: 12, end: 16 },
    ]);
  });
});
