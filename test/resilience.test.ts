import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SegmentCache } from '../src/cache/segment-cache';
import { NetworkMonitor } from '../src/network/network-monitor';
import { RecoveryManager } from '../src/recovery/recovery-manager';
import { DynamicBufferManager } from '../src/buffer/buffer-manager';
import { PrefetchScheduler } from '../src/scheduler/prefetch-scheduler';
import { HlsAdapter } from '../src/hls/hls-adapter';
import { SmartBufferConfig } from '../src/types';
import { TaskPriority } from '../src/scheduler/priority-queue';

describe('Network Resilience & Rate Limit & Buffer Hole Recovery', () => {
  let config: SmartBufferConfig;
  let cache: SegmentCache;
  let networkMonitor: NetworkMonitor;
  let recoveryManager: RecoveryManager;
  let bufferManager: DynamicBufferManager;
  let manifestObserverMock: any;
  let scheduler: PrefetchScheduler;

  beforeEach(() => {
    config = {
      enabled: true,
      maxConcurrency: 8,
      dynamicConcurrency: false,
      maxPreloadSegments: 12,
      targetBufferLength: 30,
      maxBufferLength: 60,
      maxCacheSizeMB: 100,
      autoRecovery: true,
      maxRetries: 3,
      backgroundPreload: true,
      withCredentials: false,
    };

    cache = new SegmentCache(100);
    networkMonitor = new NetworkMonitor();
    recoveryManager = new RecoveryManager();
    bufferManager = new DynamicBufferManager(config, networkMonitor);

    manifestObserverMock = {
      getUncachedCandidateFragments: vi.fn().mockReturnValue([]),
      attachHls: vi.fn(),
      detachHls: vi.fn(),
      isEmpty: vi.fn().mockReturnValue(false),
      syncLevels: vi.fn(),
    };

    scheduler = new PrefetchScheduler(
      config,
      cache,
      networkMonitor,
      manifestObserverMock,
      recoveryManager,
      bufferManager
    );
  });

  describe('Adaptive Concurrency (AIMD) & 429 Circuit Breaker', () => {
    it('should halve concurrency on HTTP 429 and apply circuit breaking', async () => {
      config.maxRetries = 1; // Avoid retry delay during testing
      expect(scheduler.getEffectiveConcurrency()).toBe(8);
      expect(scheduler.getRateLimitConcurrencyCap()).toBeNull();

      // Trigger a 429 error via customFetcher
      config.customFetcher = vi.fn().mockRejectedValue(new Error('HTTP 429 Too Many Requests'));
      scheduler.updateConfig(config);

      const frag = {
        url: 'http://cdn.test/seg0.ts',
        sn: 0,
        level: 0,
        start: 0,
        duration: 4,
      };

      await expect(scheduler.loadSegment(frag)).rejects.toThrow();

      // Effective concurrency must be halved: 8 / 2 = 4
      expect(scheduler.getEffectiveConcurrency()).toBe(4);
      expect(scheduler.getRateLimitConcurrencyCap()).toBe(4);

      // Another 429 cuts 4 in half to 2
      await expect(scheduler.loadSegment(frag)).rejects.toThrow();
      expect(scheduler.getEffectiveConcurrency()).toBe(2);
      expect(scheduler.getRateLimitConcurrencyCap()).toBe(2);

      // Floor limit is 2
      await expect(scheduler.loadSegment(frag)).rejects.toThrow();
      expect(scheduler.getEffectiveConcurrency()).toBe(2);
    });

    it('should slow-start restore concurrency after 8 consecutive successful downloads', async () => {
      // Simulate cap at 2
      (scheduler as any).onRateLimitEncountered(429);
      (scheduler as any).onRateLimitEncountered(429);
      expect(scheduler.getEffectiveConcurrency()).toBe(2);

      // 7 successful downloads: cap remains 2
      for (let i = 0; i < 7; i++) {
        (scheduler as any).onDownloadSuccess();
      }
      expect(scheduler.getEffectiveConcurrency()).toBe(2);

      // 8th successful download: cap increments by 1 to 3
      (scheduler as any).onDownloadSuccess();
      expect(scheduler.getEffectiveConcurrency()).toBe(3);

      // Another 8 successful downloads: cap increments to 4
      for (let i = 0; i < 8; i++) {
        (scheduler as any).onDownloadSuccess();
      }
      expect(scheduler.getEffectiveConcurrency()).toBe(4);
    });
  });

  describe('Hole-First & Urgent Priority Scheduling', () => {
    it('should assign TaskPriority.HIGH to missing fragments that form a hole', () => {
      // Segment 2 (start: 8, end: 12) is missing
      // Segment 3 (start: 12, end: 16) is already cached in level 0
      cache.put({
        key: '0_3_seg3.ts',
        url: 'seg3.ts',
        sn: 3,
        level: 0,
        startTime: 12,
        duration: 4,
        quality: 0,
        size: 1000,
        data: new ArrayBuffer(1000),
        status: 'completed',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      });

      // currentTime is 0. Candidate fragments:
      // frag0 (start: 0, duration: 4) -> near (<10s) -> HIGH
      // frag1 (start: 4, duration: 4) -> near (<10s) -> HIGH
      // frag2 (start: 8, duration: 4) -> not near (start - currentTime = 8 < 10)
      // Let currentTime = 0, check candidate with start = 10 (not < 10):
      // fragHole (start: 10, end: 12) -> not near, but hasSegmentAfter(0, 12) is true -> HIGH!
      manifestObserverMock.getUncachedCandidateFragments.mockReturnValue([
        { url: 'seg2.ts', sn: 2, level: 0, start: 10, duration: 2, end: 12 },
        { url: 'seg4.ts', sn: 4, level: 0, start: 16, duration: 4, end: 20 },
      ]);

      scheduler.tick(0, false);

      const activeTasks = (scheduler as any).activeTasks as Map<string, any>;
      expect(activeTasks.size).toBe(2);

      const task2 = Array.from(activeTasks.values()).find((t) => t.sn === 2);
      const task4 = Array.from(activeTasks.values()).find((t) => t.sn === 4);

      expect(task2).toBeDefined();
      expect(task2?.priority).toBe(TaskPriority.HIGH); // Hole -> HIGH

      expect(task4).toBeDefined();
      expect(task4?.priority).toBe(TaskPriority.NORMAL); // Distant -> NORMAL
    });

    it('should preempt the furthest prefetch task if slots are full and an urgent task arrives', () => {
      // Set concurrency to 2
      config.maxConcurrency = 2;
      scheduler.updateConfig(config);

      const abort1 = new AbortController();
      const abort2 = new AbortController();

      // Mock two active tasks: one at 12s, one far at 40s
      (scheduler as any).activeTasks.set('task_near', {
        id: 'task_near',
        abortController: abort1,
        priority: TaskPriority.NORMAL,
        promise: Promise.resolve(new ArrayBuffer(10)),
        level: 0,
        sn: 3,
        startTime: 12,
      });

      (scheduler as any).activeTasks.set('task_far', {
        id: 'task_far',
        abortController: abort2,
        priority: TaskPriority.NORMAL,
        promise: Promise.resolve(new ArrayBuffer(10)),
        level: 0,
        sn: 10,
        startTime: 40,
      });

      expect((scheduler as any).activeTasks.size).toBe(2);

      // An urgent hole segment appears at startTime = 0 (currentTime = 0)
      manifestObserverMock.getUncachedCandidateFragments.mockReturnValue([
        { url: 'seg0.ts', sn: 0, level: 0, start: 0, duration: 4, end: 4 },
      ]);

      scheduler.tick(0, false);

      // The furthest task (startTime = 40) must have been aborted and removed from activeTasks
      expect(abort2.signal.aborted).toBe(true);
      expect((scheduler as any).activeTasks.has('task_far')).toBe(false);

      // The near task (startTime = 12) was kept
      expect(abort1.signal.aborted).toBe(false);
      expect((scheduler as any).activeTasks.has('task_near')).toBe(true);
    });
  });

  describe('Buffer Hole Auto-Nudge in HlsAdapter', () => {
    it('should nudge video.currentTime when stalled at a micro gap (<= 2.0s)', () => {
      const adapter = new HlsAdapter(
        config,
        cache,
        networkMonitor,
        recoveryManager,
        bufferManager
      );

      // Mock video element
      const mockVideo: any = {
        currentTime: 10.0,
        duration: 100.0,
        paused: false,
        buffered: {
          length: 2,
          start: (i: number) => (i === 0 ? 0 : 10.6),
          end: (i: number) => (i === 0 ? 10.0 : 25.0),
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      (adapter as any).video = mockVideo;

      // currentTime = 10.0, next range starts at 10.6 (gap = 0.6s <= 2.0s)
      adapter.checkBufferHoleAndNudge();

      // Nudge target is 10.6 + 0.05 = 10.65
      expect(mockVideo.currentTime).toBeCloseTo(10.65, 2);
    });

    it('should NOT nudge if gap is larger than 2.0s', () => {
      const adapter = new HlsAdapter(
        config,
        cache,
        networkMonitor,
        recoveryManager,
        bufferManager
      );

      const mockVideo: any = {
        currentTime: 10.0,
        duration: 100.0,
        paused: false,
        buffered: {
          length: 2,
          start: (i: number) => (i === 0 ? 0 : 15.0),
          end: (i: number) => (i === 0 ? 10.0 : 25.0),
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      (adapter as any).video = mockVideo;

      // gap = 15.0 - 10.0 = 5.0s > 2.0s -> do not nudge
      adapter.checkBufferHoleAndNudge();
      expect(mockVideo.currentTime).toBe(10.0);
    });

    it('should NOT nudge if video is paused by the user', () => {
      const adapter = new HlsAdapter(
        config,
        cache,
        networkMonitor,
        recoveryManager,
        bufferManager
      );

      const mockVideo: any = {
        currentTime: 10.0,
        duration: 100.0,
        paused: true,
        buffered: {
          length: 2,
          start: (i: number) => (i === 0 ? 0 : 10.5),
          end: (i: number) => (i === 0 ? 10.0 : 25.0),
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      (adapter as any).video = mockVideo;

      adapter.checkBufferHoleAndNudge();
      expect(mockVideo.currentTime).toBe(10.0);
    });
  });
});
