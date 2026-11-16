import { SmartBufferConfig, SegmentCacheItem } from '../types';
import { SegmentCache } from '../cache/segment-cache';
import { NetworkMonitor } from '../network/network-monitor';
import { ManifestObserver, FragmentInfo } from '../hls/manifest-observer';
import { RecoveryManager } from '../recovery/recovery-manager';
import { DynamicBufferManager } from '../buffer/buffer-manager';
import { PriorityTaskQueue, TaskPriority, ScheduledTask } from './priority-queue';
import { stripTsHeader } from '../hls/smart-loader';

export interface ActivePrefetchTask {
  abortController: AbortController;
  priority: TaskPriority;
  promise: Promise<ArrayBuffer>;
  level: number;
  sn: number | string;
  startTime: number;
  byteRange?: { start: number; end: number };
}

export class PrefetchScheduler {
  private config: SmartBufferConfig;
  private cache: SegmentCache;
  private networkMonitor: NetworkMonitor;
  private manifestObserver: ManifestObserver;
  private recoveryManager: RecoveryManager;
  private bufferManager: DynamicBufferManager;

  private queue: PriorityTaskQueue = new PriorityTaskQueue();
  private activeTasks: Map<string, ActivePrefetchTask> = new Map();

  // 自适应限流与 429 熔断降级状态
  private rateLimitConcurrencyCap: number | null = null;
  private consecutiveSuccesses = 0;

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

  public getActiveTask(key: string): ActivePrefetchTask | undefined {
    return this.activeTasks.get(key);
  }

  public getActiveTaskBySn(
    level: number,
    sn: number | string,
    byteRange?: { start: number; end: number }
  ): ActivePrefetchTask | undefined {
    for (const task of this.activeTasks.values()) {
      if (task.level === level && String(task.sn) === String(sn)) {
        if (!byteRange && !task.byteRange) return task;
        if (
          byteRange &&
          task.byteRange &&
          byteRange.start === task.byteRange.start &&
          byteRange.end === task.byteRange.end
        ) {
          return task;
        }
      }
    }
    return undefined;
  }

  public getEffectiveConcurrency(): number {
    let conc = this.config.dynamicConcurrency
      ? this.bufferManager.getEffectiveConcurrency()
      : this.config.maxConcurrency;

    if (this.rateLimitConcurrencyCap !== null) {
      conc = Math.min(conc, this.rateLimitConcurrencyCap);
    }
    return Math.max(1, conc);
  }

  public getRateLimitConcurrencyCap(): number | null {
    return this.rateLimitConcurrencyCap;
  }

  private onRateLimitEncountered(status: number): void {
    this.consecutiveSuccesses = 0;
    const currentCap = this.rateLimitConcurrencyCap || this.config.maxConcurrency;
    const reduced = Math.max(2, Math.floor(currentCap / 2));
    this.rateLimitConcurrencyCap = reduced;
    console.warn(
      `[SmartBuffer:Scheduler] 触发 CDN 限流 (HTTP ${status})，自适应熔断降级并发至 ${reduced} 线程`
    );
  }

  private onDownloadSuccess(): void {
    this.recoveryManager.recordSuccess();
    this.consecutiveSuccesses++;

    // 慢启动恢复 (AIMD)：连续稳定下载 8 个分片后保守尝试递增 1 个并发
    if (this.rateLimitConcurrencyCap !== null && this.consecutiveSuccesses >= 8) {
      this.consecutiveSuccesses = 0;
      this.rateLimitConcurrencyCap = Math.min(
        this.config.maxConcurrency,
        this.rateLimitConcurrencyCap + 1
      );
      console.log(
        `[SmartBuffer:Scheduler] 连续稳定下载，慢启动恢复并发至 ${this.rateLimitConcurrencyCap} 线程`
      );
      if (this.rateLimitConcurrencyCap >= this.config.maxConcurrency) {
        this.rateLimitConcurrencyCap = null;
        console.log('[SmartBuffer:Scheduler] 并发配额已完全恢复至用户设定值');
      }
    }
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

    // Effective concurrency: use maxConcurrency directly when user desires, or dynamic concurrency, constrained by rate limit
    const effectiveConcurrency = this.getEffectiveConcurrency();

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

      // 优先级判定：
      // LEVEL 1 (URGENT): 紧邻当前播放点 (<10s) 或第0个候选片，或者检测到断层空洞（即本分片未就绪但后续已有分片完成）
      const isNear = (frag.start - currentTime < 10) || i === 0;
      const isHole = this.cache.hasSegmentAfter(frag.level, frag.end);
      const priority = (isNear || isHole) ? TaskPriority.HIGH : TaskPriority.NORMAL;

      // 若为紧急任务且当前并发槽位已被占满，抢占/终止最远端的 LEVEL 2 (NORMAL/LOW) 任务以腾出槽位
      if (priority <= TaskPriority.HIGH && this.activeTasks.size >= effectiveConcurrency) {
        let furthestKey: string | null = null;
        let furthestStartTime = -Infinity;
        for (const [aKey, active] of this.activeTasks.entries()) {
          if (active.priority > TaskPriority.HIGH && active.startTime > currentTime + 15) {
            if (active.startTime > furthestStartTime) {
              furthestStartTime = active.startTime;
              furthestKey = aKey;
            }
          }
        }
        if (furthestKey) {
          const toAbort = this.activeTasks.get(furthestKey);
          if (toAbort) {
            toAbort.abortController.abort();
            this.activeTasks.delete(furthestKey);
            this.cache.remove(furthestKey);
          }
        }
      }

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
      // 调度逻辑：若队列中存在紧邻或空洞等紧急任务 (LEVEL 1)，暂停/阻塞所有常规预加载 (LEVEL 2)
      const nextTask = this.queue.peek();
      if (!nextTask) break;
      if (this.queue.hasUrgentTask() && nextTask.priority > TaskPriority.HIGH) {
        break;
      }

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

          let arrayBuffer: ArrayBuffer;

          if (typeof this.config.customFetcher === 'function') {
            const fetchInit: RequestInit = {
              headers,
              signal: abortController.signal,
              credentials: this.config.withCredentials ? 'include' : 'same-origin',
            };
            const result = await this.config.customFetcher(frag.url, fetchInit);
            tfirst = performance.now();

            if (result instanceof ArrayBuffer) {
              arrayBuffer = result;
            } else if (result && typeof (result as Response).arrayBuffer === 'function') {
              const res = result as Response;
              if (!res.ok && res.status !== 206) {
                if (res.status === 429 || res.status === 503) {
                  this.onRateLimitEncountered(res.status);
                }
                const isRecoverable = this.recoveryManager.isRecoverableError(res.status);
                if (!isRecoverable || attempts >= maxRetries - 1) {
                  throw new Error(`HTTP ${res.status} ${res.statusText}`);
                }
                attempts++;
                const delay =
                  res.status === 429 || res.status === 503
                    ? Math.min(5000, 1000 * Math.pow(2, attempts)) + Math.random() * 500
                    : this.recoveryManager.getBackoffDelay(attempts);
                await new Promise((r) => setTimeout(r, delay));
                continue;
              }
              arrayBuffer = await res.arrayBuffer();
            } else {
              throw new Error('customFetcher must return Promise<ArrayBuffer | Response>');
            }
          } else {
            const response = await fetch(frag.url, {
              headers,
              signal: abortController.signal,
              credentials: this.config.withCredentials ? 'include' : 'same-origin',
            });

            tfirst = performance.now();

            if (!response.ok && response.status !== 206) {
              if (response.status === 429 || response.status === 503) {
                this.onRateLimitEncountered(response.status);
              }
              const isRecoverable = this.recoveryManager.isRecoverableError(response.status);
              if (!isRecoverable || attempts >= maxRetries - 1) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
              }
              attempts++;
              const delay =
                response.status === 429 || response.status === 503
                  ? Math.min(5000, 1000 * Math.pow(2, attempts)) + Math.random() * 500
                  : this.recoveryManager.getBackoffDelay(attempts);
              await new Promise((res) => setTimeout(res, delay));
              continue;
            }

            arrayBuffer = await response.arrayBuffer();
          }

          const cleanBuffer = stripTsHeader(arrayBuffer);
          const endTime = performance.now();
          const durationMs = Math.max(1, endTime - startTime);
          let rttMs = Math.max(1, tfirst - startTime);
          if (rttMs >= durationMs) {
            rttMs = Math.max(1, Math.round(durationMs * 0.35));
          }

          // Update cache with stripped clean TS buffer
          this.cache.markCompleted(key, cleanBuffer);

          // Record network stats
          this.networkMonitor.recordDownload(cleanBuffer.byteLength, durationMs, rttMs);
          this.onDownloadSuccess();

          return cleanBuffer;
        } catch (error: any) {
          if (abortController.signal.aborted) {
            this.cache.remove(key);
            throw error;
          }

          attempts++;
          this.recoveryManager.recordFailure();
          this.networkMonitor.recordFailure();

          const errorMsg = error?.message || '';
          if (errorMsg.includes('429') || errorMsg.includes('503')) {
            this.onRateLimitEncountered(errorMsg.includes('429') ? 429 : 503);
          }

          const isRecoverable = this.recoveryManager.isRecoverableError(error);
          if (!isRecoverable || attempts >= maxRetries) {
            this.cache.markFailed(key);
            throw error;
          }

          const delay =
            errorMsg.includes('429') || errorMsg.includes('503')
              ? Math.min(5000, 1000 * Math.pow(2, attempts)) + Math.random() * 500
              : this.recoveryManager.getBackoffDelay(attempts);
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
      level: frag.level,
      sn: frag.sn,
      startTime: frag.start,
      byteRange: frag.byteRange,
    });

    try {
      const buffer = await downloadPromise;
      return buffer;
    } finally {
      this.activeTasks.delete(key);
      // Immediately schedule next queued task to keep all concurrency slots filled
      const effectiveConcurrency = this.getEffectiveConcurrency();
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
