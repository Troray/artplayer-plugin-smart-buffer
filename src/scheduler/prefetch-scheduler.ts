import { SmartBufferConfig, SegmentCacheItem } from '../types';
import { SegmentCache } from '../cache/segment-cache';
import { NetworkMonitor } from '../network/network-monitor';
import { ManifestObserver, FragmentInfo } from '../hls/manifest-observer';
import { RecoveryManager } from '../recovery/recovery-manager';
import { DynamicBufferManager } from '../buffer/buffer-manager';
import { PriorityTaskQueue, TaskPriority, ScheduledTask } from './priority-queue';

export class PrefetchScheduler {
  private config: SmartBufferConfig;
  private cache: SegmentCache;
  private networkMonitor: NetworkMonitor;
  private manifestObserver: ManifestObserver;
  private recoveryManager: RecoveryManager;
  private bufferManager: DynamicBufferManager;

  private queue: PriorityTaskQueue = new PriorityTaskQueue();
  private activeTasks: Map<string, { abortController: AbortController; priority: TaskPriority; promise: Promise<ArrayBuffer> }> = new Map();

  constructor(
    config: SmartBufferConfig,
    cache: SegmentCache,
    networkMonitor: NetworkMonitor,
    manifestObserver: ManifestObserver,
    recoveryManager: RecoveryManager,
    bufferManager: DynamicBufferManager
  ) {
    this.config = config;
    this.cache = cache;
    this.networkMonitor = networkMonitor;
    this.manifestObserver = manifestObserver;
    this.recoveryManager = recoveryManager;
    this.bufferManager = bufferManager;
  }

  public updateConfig(config: SmartBufferConfig): void {
    this.config = config;
  }

  public getActiveConcurrency(): number {
    return this.activeTasks.size;
  }

  public getActiveTask(
    key: string
  ): { abortController: AbortController; priority: TaskPriority; promise: Promise<ArrayBuffer> } | undefined {
    return this.activeTasks.get(key);
  }

  /**
   * Fetch a segment with specified priority.
   * If already cached, returns immediately.
   * If already downloading, promotes priority and returns existing promise.
   */
  public async loadSegment(
    frag: FragmentInfo,
    priority: TaskPriority = TaskPriority.NORMAL
  ): Promise<ArrayBuffer> {
    const key = this.cache.generateKey(frag.level, frag.sn, frag.url, frag.byteRange);

    // 1. Check cache
    const cached = this.cache.get(key);
    if (cached && cached.status === 'completed' && cached.data) {
      return cached.data;
    }

    // 2. Check if currently active
    const active = this.activeTasks.get(key);
    if (active) {
      if (priority < active.priority) {
        active.priority = priority;
      }
      return active.promise;
    }

    // 3. Initiate fetch task
    return this.executeDownload(frag, key, priority);
  }

  /**
   * Main scheduler tick called on playback progression
   */
  public tick(currentTime: number, videoPaused: boolean): void {
    if (!this.config.enabled) return;

    // Clean up old segments behind playback
    this.cache.pruneConsumed(currentTime, 10);

    const { targetBuffer, concurrency } = this.bufferManager.evaluate();
    const currentBuffer = this.networkMonitor.getBufferLength();

    // When paused, if user has plenty of buffer (>= targetBuffer or >= 15s), we rest;
    // but if buffer is empty or low, keep buffering so pause-to-buffer actually works!
    if (videoPaused && !this.config.backgroundPreload && currentBuffer >= 15) {
      return;
    }

    // The maximum buffer horizon to look ahead
    const maxHorizon = Math.max(targetBuffer, this.config.maxBufferLength);

    // If buffer length already reaches maxBufferLength, pause queueing
    if (currentBuffer >= maxHorizon) {
      return;
    }

    // Effective concurrency: use maxConcurrency directly when user desires, or dynamic concurrency
    const effectiveConcurrency = this.config.dynamicConcurrency ? concurrency : this.config.maxConcurrency;

    // How many more tasks can we launch?
    const availableSlots = effectiveConcurrency - this.activeTasks.size;
    if (availableSlots <= 0) {
      return;
    }

    const upcoming = this.manifestObserver.getUncachedCandidateFragments(
      currentTime,
      maxHorizon,
      Math.max(this.config.maxPreloadSegments, effectiveConcurrency),
      (frag) => {
        const fullKey = this.cache.generateKey(frag.level, frag.sn, frag.url, frag.byteRange);
        return !this.cache.has(fullKey) && !this.activeTasks.has(fullKey);
      }
    );

    for (let i = 0; i < upcoming.length; i++) {
      const frag = upcoming[i];
      const key = this.cache.generateKey(frag.level, frag.sn, frag.url, frag.byteRange);

      if (this.cache.has(key) || this.activeTasks.has(key)) {
        continue;
      }

      // Assign priority based on proximity to playback
      const priority = i === 0 ? TaskPriority.HIGH : TaskPriority.NORMAL;

      // Register into queue if not already
      const abortController = new AbortController();
      const task: ScheduledTask<ArrayBuffer> = {
        id: key,
        priority,
        sn: frag.sn,
        level: frag.level,
        startTime: frag.start,
        abortController,
        createdAt: Date.now(),
        execute: () => this.executeDownload(frag, key, priority, abortController),
      };

      this.queue.enqueue(task);
    }

    // Dispatch tasks up to effective concurrency
    this.drainQueue(effectiveConcurrency);
  }

  /**
   * Handle Seek: cancel active tasks that fall out of the new buffer window
   */
  public onSeek(newTime: number): void {
    const targetBuffer = this.bufferManager.getTargetBufferLength();
    const windowEnd = newTime + targetBuffer + 10;

    // 1. Clear out queued tasks
    this.queue.clear();

    // 2. Abort active tasks that are outside the new window
    for (const [key, active] of this.activeTasks.entries()) {
      const item = this.cache.get(key);
      if (item) {
        // Keep a 2-second grace threshold before newTime
        if (item.startTime + item.duration < newTime - 2 || item.startTime > windowEnd) {
          active.abortController.abort();
          this.activeTasks.delete(key);
          this.cache.remove(key);
        }
      }
    }

    // 3. Prune consumed
    this.cache.pruneConsumed(newTime, 5);
  }

  private drainQueue(maxConcurrency: number): void {
    while (this.activeTasks.size < maxConcurrency && this.queue.size() > 0) {
      const task = this.queue.dequeue();
      if (!task) break;

      // If already started or completed in the meantime
      if (this.activeTasks.has(task.id) || this.cache.has(task.id)) {
        continue;
      }

      task.execute().catch(() => {
        // Handled in executeDownload
      });
    }
  }

  private async executeDownload(
    frag: FragmentInfo,
    key: string,
    priority: TaskPriority,
    existingController?: AbortController
  ): Promise<ArrayBuffer> {
    const abortController = existingController || new AbortController();

    const cacheItem: SegmentCacheItem = {
      key,
      url: frag.url,
      sn: frag.sn,
      level: frag.level,
      startTime: frag.start,
      duration: frag.duration,
      quality: frag.level,
      size: 0,
      status: 'loading',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      byteRange: frag.byteRange,
      abortController,
    };
    this.cache.put(cacheItem);

    const downloadPromise = (async () => {
      let attempts = 0;
      const maxRetries = this.config.autoRecovery ? this.config.maxRetries : 1;

      while (attempts < maxRetries) {
        const startTime = performance.now();
        let tfirst = 0;

        try {
          const headers: Record<string, string> = {};
          if (frag.byteRange) {
            headers['Range'] = `bytes=${frag.byteRange.start}-${frag.byteRange.end}`;
          }

          const response = await fetch(frag.url, {
            headers,
            signal: abortController.signal,
          });

          tfirst = performance.now();

          if (!response.ok && response.status !== 206) {
            const isRecoverable = this.recoveryManager.isRecoverableError(response.status);
            if (!isRecoverable || attempts >= maxRetries - 1) {
              throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
            attempts++;
            const delay = this.recoveryManager.getBackoffDelay(attempts);
            await new Promise((res) => setTimeout(res, delay));
            continue;
          }

          const arrayBuffer = await response.arrayBuffer();
          const endTime = performance.now();
          const durationMs = Math.max(1, endTime - startTime);
          let rttMs = Math.max(1, tfirst - startTime);
          if (rttMs >= durationMs) {
            rttMs = Math.max(1, Math.round(durationMs * 0.35));
          }

          // Update cache
          this.cache.markCompleted(key, arrayBuffer);

          // Record network stats
          this.networkMonitor.recordDownload(arrayBuffer.byteLength, durationMs, rttMs);
          this.recoveryManager.recordSuccess();

          return arrayBuffer;
        } catch (error: any) {
          if (abortController.signal.aborted) {
            this.cache.remove(key);
            throw error;
          }

          attempts++;
          this.recoveryManager.recordFailure();
          this.networkMonitor.recordFailure();

          const isRecoverable = this.recoveryManager.isRecoverableError(error);
          if (!isRecoverable || attempts >= maxRetries) {
            this.cache.markFailed(key);
            throw error;
          }

          const delay = this.recoveryManager.getBackoffDelay(attempts);
          await new Promise((res) => setTimeout(res, delay));
        }
      }

      this.cache.markFailed(key);
      throw new Error(`Download failed after ${maxRetries} attempts: ${frag.url}`);
    })();

    cacheItem.promise = downloadPromise;
    this.activeTasks.set(key, {
      abortController,
      priority,
      promise: downloadPromise,
    });

    try {
      const buffer = await downloadPromise;
      return buffer;
    } finally {
      this.activeTasks.delete(key);
      // Immediately schedule next queued task to keep all concurrency slots filled
      const effectiveConcurrency = this.config.dynamicConcurrency
        ? this.bufferManager.getEffectiveConcurrency()
        : this.config.maxConcurrency;
      this.drainQueue(effectiveConcurrency);
    }
  }

  public clearAll(): void {
    this.queue.clear();
    for (const [key, active] of this.activeTasks.entries()) {
      active.abortController.abort();
      this.cache.remove(key);
    }
    this.activeTasks.clear();
  }
}
