import { SmartBufferConfig } from '../types';
import { NetworkMonitor } from '../network/network-monitor';
import { RecoveryManager } from '../recovery/recovery-manager';

export interface Mp4Chunk {
  index: number;
  start: number;
  end: number;
  size: number;
  data?: ArrayBuffer;
  status: 'idle' | 'downloading' | 'completed' | 'failed';
  abortController?: AbortController;
}

export class Mp4RangeEngine {
  private config: SmartBufferConfig;
  private networkMonitor: NetworkMonitor;
  private recoveryManager: RecoveryManager;

  private video?: HTMLVideoElement;
  private url?: string;
  private totalSize = 0;
  private supportsRange = false;

  private chunkSize = 2 * 1024 * 1024; // 2MB chunk default
  private chunks: Mp4Chunk[] = [];
  private activeDownloads: Map<number, AbortController> = new Map();
  private pollTimer: any = null;

  constructor(config: SmartBufferConfig, networkMonitor: NetworkMonitor, recoveryManager: RecoveryManager) {
    this.config = config;
    this.networkMonitor = networkMonitor;
    this.recoveryManager = recoveryManager;
  }

  public updateConfig(config: SmartBufferConfig): void {
    this.config = config;
  }

  /**
   * Probe whether the MP4 URL supports HTTP Range
   */
  public async probeRangeSupport(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
      });
      const acceptRanges = res.headers.get('accept-ranges');
      const contentLength = res.headers.get('content-length');

      if (contentLength) {
        this.totalSize = parseInt(contentLength, 10) || 0;
      }

      if (acceptRanges === 'bytes' || this.totalSize > 0) {
        this.supportsRange = true;
        return true;
      }

      // Test with a 0-1 byte range probe
      const rangeTest = await fetch(url, {
        headers: { Range: 'bytes=0-1' },
      });
      this.supportsRange = rangeTest.status === 206;
      return this.supportsRange;
    } catch (e) {
      this.supportsRange = false;
      return false;
    }
  }

  /**
   * Initialize MP4 Range engine on a video element
   */
  public async attach(video: HTMLVideoElement, url: string): Promise<boolean> {
    this.detach();
    this.video = video;
    this.url = url;

    const isSupported = await this.probeRangeSupport(url);
    if (!isSupported || !this.config.enabled) {
      // Fallback to native video src
      video.src = url;
      return false;
    }

    this.initChunks();
    this.startWorker();
    return true;
  }

  public detach(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const controller of this.activeDownloads.values()) {
      controller.abort();
    }
    this.activeDownloads.clear();
    this.chunks = [];
    this.video = undefined;
    this.url = undefined;
  }

  private initChunks(): void {
    this.chunks = [];
    if (this.totalSize <= 0) return;

    let offset = 0;
    let index = 0;

    while (offset < this.totalSize) {
      const end = Math.min(offset + this.chunkSize - 1, this.totalSize - 1);
      this.chunks.push({
        index,
        start: offset,
        end,
        size: end - offset + 1,
        status: 'idle',
      });
      offset = end + 1;
      index++;
    }
  }

  private startWorker(): void {
    this.pollTimer = setInterval(() => {
      this.scheduleNextChunks();
    }, 800);
  }

  private scheduleNextChunks(): void {
    if (!this.config.enabled || !this.video || !this.url) return;

    const maxConcurrency = this.config.maxConcurrency;
    if (this.activeDownloads.size >= maxConcurrency) return;

    // Find next idle chunk to download
    const idleChunks = this.chunks.filter((c) => c.status === 'idle');
    for (const chunk of idleChunks) {
      if (this.activeDownloads.size >= maxConcurrency) break;
      this.downloadChunk(chunk);
    }
  }

  private async downloadChunk(chunk: Mp4Chunk): Promise<void> {
    if (!this.url) return;

    chunk.status = 'downloading';
    const controller = new AbortController();
    chunk.abortController = controller;
    this.activeDownloads.set(chunk.index, controller);

    const startTime = performance.now();
    try {
      const startTime = performance.now();
      const res = await fetch(this.url, {
        headers: {
          Range: `bytes=${chunk.start}-${chunk.end}`,
        },
        signal: controller.signal,
      });

      const tfirst = performance.now();
      const rttMs = Math.max(1, tfirst - startTime);

      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }

      const buffer = await res.arrayBuffer();
      const durationMs = Math.max(1, performance.now() - startTime);

      chunk.data = buffer;
      chunk.status = 'completed';

      this.networkMonitor.recordDownload(buffer.byteLength, durationMs, rttMs);
      this.recoveryManager.recordSuccess();
    } catch (e: any) {
      if (controller.signal.aborted) {
        chunk.status = 'idle';
      } else {
        chunk.status = 'failed';
        this.networkMonitor.recordFailure();
        this.recoveryManager.recordFailure();
      }
    } finally {
      this.activeDownloads.delete(chunk.index);
    }
  }

  public getChunksCount(): { total: number; completed: number; active: number } {
    const total = this.chunks.length;
    const completed = this.chunks.filter((c) => c.status === 'completed').length;
    const active = this.activeDownloads.size;
    return { total, completed, active };
  }
}
