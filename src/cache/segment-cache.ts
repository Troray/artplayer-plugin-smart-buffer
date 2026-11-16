import { SegmentCacheItem } from '../types';

export class SegmentCache {
  private cache: Map<string, SegmentCacheItem> = new Map();
  private maxCacheSizeBytes: number;
  private currentSizeBytes = 0;

  constructor(maxCacheSizeMB = 100) {
    this.maxCacheSizeBytes = maxCacheSizeMB * 1024 * 1024;
  }

  public setMaxCacheSizeMB(maxMB: number): void {
    this.maxCacheSizeBytes = Math.max(20, maxMB) * 1024 * 1024;
    this.enforceLimit();
  }

  public generateKey(level: number, sn: number | string, url: string, byteRange?: { start: number; end: number }): string {
    if (byteRange) {
      return `${level}_${sn}_${byteRange.start}-${byteRange.end}_${url}`;
    }
    return `${level}_${sn}_${url}`;
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public get(key: string): SegmentCacheItem | undefined {
    const item = this.cache.get(key);
    if (item) {
      item.lastAccessedAt = Date.now();
    }
    return item;
  }

  public getByLevelAndSn(
    level: number,
    sn: number | string,
    byteRange?: { start: number; end: number }
  ): SegmentCacheItem | undefined {
    for (const item of this.cache.values()) {
      if (item.level === level && String(item.sn) === String(sn)) {
        if (!byteRange && !item.byteRange) {
          item.lastAccessedAt = Date.now();
          return item;
        }
        if (
          byteRange &&
          item.byteRange &&
          byteRange.start === item.byteRange.start &&
          byteRange.end === item.byteRange.end
        ) {
          item.lastAccessedAt = Date.now();
          return item;
        }
      }
    }
    return undefined;
  }

  public put(item: SegmentCacheItem): void {
    const existing = this.cache.get(item.key);
    if (existing && existing.data) {
      this.currentSizeBytes -= existing.size;
    }

    item.lastAccessedAt = Date.now();
    this.cache.set(item.key, item);

    if (item.data && item.status === 'completed') {
      this.currentSizeBytes += item.size;
      this.enforceLimit();
    }
  }

  public markCompleted(key: string, data: ArrayBuffer): void {
    const item = this.cache.get(key);
    if (!item) return;

    item.status = 'completed';
    item.data = data;
    item.size = data.byteLength;
    item.lastAccessedAt = Date.now();
    this.currentSizeBytes += item.size;

    this.enforceLimit();
  }

  public markFailed(key: string): void {
    const item = this.cache.get(key);
    if (item) {
      item.status = 'failed';
    }
  }

  public remove(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    if (item.status === 'loading' && item.abortController) {
      item.abortController.abort();
    }

    if (item.data) {
      this.currentSizeBytes -= item.size;
    }

    return this.cache.delete(key);
  }

  /**
   * Evict segments older than currentTime - gracePeriodSec (default 10s)
   */
  public pruneConsumed(currentTime: number, gracePeriodSec = 10): void {
    const threshold = currentTime - gracePeriodSec;
    const toRemove: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (item.sn === 'initSegment') continue;
      if (typeof item.startTime !== 'number' || typeof item.duration !== 'number') continue;

      if (item.status === 'completed' && item.startTime + item.duration < threshold) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.remove(key);
    }
  }

  /**
   * Purge segments from other quality levels
   */
  public purgeOtherLevels(currentLevel: number): void {
    const toRemove: string[] = [];
    for (const [key, item] of this.cache.entries()) {
      if (item.level !== currentLevel && item.status === 'completed') {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.remove(key);
    }
  }

  public getCacheSizeMB(): number {
    return Math.round((this.currentSizeBytes / (1024 * 1024)) * 100) / 100;
  }

  public getMaxCachedTime(): number {
    let maxTime = 0;
    for (const item of this.cache.values()) {
      if (item.status === 'completed' && typeof item.startTime === 'number' && typeof item.duration === 'number') {
        maxTime = Math.max(maxTime, item.startTime + item.duration);
      }
    }
    return maxTime;
  }

  public getCompletedCount(): number {
    let count = 0;
    for (const item of this.cache.values()) {
      if (item.status === 'completed') count++;
    }
    return count;
  }

  public clear(): void {
    for (const item of this.cache.values()) {
      if (item.status === 'loading' && item.abortController) {
        item.abortController.abort();
      }
    }
    this.cache.clear();
    this.currentSizeBytes = 0;
  }

  private enforceLimit(): void {
    if (this.currentSizeBytes <= this.maxCacheSizeBytes) return;

    // Sort completed items by lastAccessedAt (LRU)
    const items = Array.from(this.cache.entries())
      .filter(([_, item]) => item.status === 'completed' && item.data)
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    for (const [key, item] of items) {
      if (this.currentSizeBytes <= this.maxCacheSizeBytes) break;
      this.remove(key);
    }
  }
}
