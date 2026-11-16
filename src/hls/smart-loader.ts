import Hls, {
  Loader,
  LoaderConfiguration,
  LoaderCallbacks,
  LoaderStats,
  LoaderResponse,
  FragmentLoaderContext,
} from 'hls.js';
import { SegmentCache } from '../cache/segment-cache';
import { PrefetchScheduler } from '../scheduler/prefetch-scheduler';
import { NetworkMonitor } from '../network/network-monitor';

export interface SmartLoaderContextHolder {
  cache?: SegmentCache;
  scheduler?: PrefetchScheduler;
  networkMonitor?: NetworkMonitor;
  isEnabled: () => boolean;
}

// Global hook so any instance of SmartFragmentLoader created by hls.js can access the engine context
let globalEngineContext: SmartLoaderContextHolder = {
  isEnabled: () => false,
};

export function setGlobalEngineContext(context: SmartLoaderContextHolder): void {
  globalEngineContext = context;
  if (typeof window !== 'undefined') {
    (window as any).__smartBufferEngineContext = context;
  }
}

/**
 * 切片二进制伪头对齐与清洗机制 (MPEG-2 TS 0x47 Sync Byte Search)
 * 部分防盗链或伪装源会在 TS 分片前增加数百至数千字节的图像头 (PNG/JPEG) 或自定义填充。
 * 本函数通过滑动窗口探测三个连续满足 188 字节步长的 0x47 同步字，自动剥离伪装头。
 */
export function stripTsHeader(data: ArrayBuffer, searchLimit = 8192): ArrayBuffer {
  if (!data || data.byteLength < 376) return data;
  const uint8 = new Uint8Array(data);

  // 标准 TS 首字节与第二包同步字已对齐，直接放行
  if (uint8[0] === 0x47 && uint8[188] === 0x47) {
    return data;
  }

  const limit = Math.min(uint8.length - 376, searchLimit);
  for (let i = 0; i < limit; i++) {
    if (uint8[i] === 0x47 && uint8[i + 188] === 0x47 && uint8[i + 376] === 0x47) {
      return data.slice(i);
    }
  }

  return data;
}

/**
 * 装饰器工厂函数：创建并返回包装了 BaseLoaderClass 的 SmartFragmentLoader 类
 * 完美级联用户的自定义 Loader（如解密、代理或特殊网络通道 Loader）
 */
export function createSmartFragmentLoader(
  BaseLoaderClass: any = (Hls as any).DefaultConfig?.loader || class {}
) {
  const SmartFragmentLoaderClass = class SmartFragmentLoader extends BaseLoaderClass implements Loader<FragmentLoaderContext> {
    public stats: LoaderStats;
    public context: FragmentLoaderContext | null = null;
    public callbacks: LoaderCallbacks<FragmentLoaderContext> | null = null;

    constructor(config?: any) {
      super(config);
      this.stats = (this as any).stats || {
        aborted: false,
        loaded: 0,
        retry: 0,
        total: 0,
        chunkCount: 0,
        bwEstimate: 0,
        loading: { start: 0, first: 0, end: 0 },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, first: 0, end: 0 },
      };
    }

    public abort(): void {
      if (typeof super.abort === 'function') {
        super.abort();
      } else {
        this.stats.aborted = true;
        if (this.callbacks?.onAbort) {
          this.callbacks.onAbort(this.stats, this.context as any, null);
        }
      }
    }

    public destroy(): void {
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
      this.callbacks = null;
      this.context = null;
    }

    public load(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>
    ): void {
      this.context = context;
      this.callbacks = callbacks;
      const { frag, url } = context;

      const ctx =
        (typeof window !== 'undefined' && (window as any).__smartBufferEngineContext) ||
        globalEngineContext;
      const cache = ctx?.cache;
      const scheduler = ctx?.scheduler;

      if (ctx?.isEnabled() && cache && frag) {
        let byteRange: { start: number; end: number } | undefined;
        if (typeof frag.byteRangeStartOffset === 'number' && typeof frag.byteRangeEndOffset === 'number') {
          byteRange = {
            start: frag.byteRangeStartOffset,
            end: frag.byteRangeEndOffset - 1,
          };
        }

        const requestUrl = frag.url || url;
        const key = cache.generateKey(frag.level, frag.sn, requestUrl, byteRange);

        // 1. 首层：检查 SegmentCache，命中时 0ms 微任务交付
        const cached = cache.get(key) || cache.getByLevelAndSn(frag.level, frag.sn, byteRange);
        if (cached && cached.status === 'completed' && cached.data) {
          const now = performance.now();
          this.stats.loading.start = now;
          this.stats.loading.first = now;
          this.stats.loading.end = now;
          const cleanData = stripTsHeader(cached.data);
          this.stats.loaded = cleanData.byteLength;
          this.stats.total = cleanData.byteLength;

          const response: LoaderResponse = {
            url: requestUrl,
            data: cleanData.slice(0), // slice 克隆防止 Demuxer Worker 传输所有权导致缓存失效
          };

          queueMicrotask(() => {
            if (!this.stats.aborted && this.callbacks?.onSuccess) {
              this.callbacks.onSuccess(response, this.stats, context, null);
            }
          });
          return;
        }

        // 2. 二层：检查调度器中是否存在同一切片的并发 Promise，挂接等待避免重复请求
        const active = scheduler?.getActiveTask(key) || scheduler?.getActiveTaskBySn?.(frag.level, frag.sn, byteRange);
        if (active && active.promise) {
          this.stats.loading.start = performance.now();

          active.promise
            .then((arrayBuffer: ArrayBuffer) => {
              if (this.stats.aborted) return;
              const now = performance.now();
              this.stats.loading.first = this.stats.loading.first || now;
              this.stats.loading.end = now;
              const cleanData = stripTsHeader(arrayBuffer);
              this.stats.loaded = cleanData.byteLength;
              this.stats.total = cleanData.byteLength;

              if (this.callbacks?.onSuccess) {
                this.callbacks.onSuccess(
                  {
                    url: requestUrl,
                    data: cleanData.slice(0),
                  },
                  this.stats,
                  context,
                  null
                );
              }
            })
            .catch(() => {
              if (this.stats.aborted) return;
              super.load(context, config, callbacks);
            });
          return;
        }
      }

      // 3. 三层（优雅降级）：Cache Miss 时调用 BaseLoaderClass，并在成功后反填缓存
      const wrappedCallbacks: LoaderCallbacks<FragmentLoaderContext> = {
        ...callbacks,
        onSuccess: (response: any, stats: any, c: any, networkDetails: any) => {
          if (response && response.data instanceof ArrayBuffer) {
            response.data = stripTsHeader(response.data);

            if (cache && c.frag) {
              let byteRange: { start: number; end: number } | undefined;
              if (typeof c.frag.byteRangeStartOffset === 'number' && typeof c.frag.byteRangeEndOffset === 'number') {
                byteRange = {
                  start: c.frag.byteRangeStartOffset,
                  end: c.frag.byteRangeEndOffset - 1,
                };
              }
              const saveKey = cache.generateKey(c.frag.level, c.frag.sn, c.frag.url || c.url, byteRange);

              cache.put({
                key: saveKey,
                url: c.frag.url || c.url,
                sn: c.frag.sn,
                level: c.frag.level,
                startTime: c.frag.start,
                duration: c.frag.duration,
                quality: c.frag.level,
                size: response.data.byteLength,
                data: response.data.slice(0),
                status: 'completed',
                createdAt: Date.now(),
                lastAccessedAt: Date.now(),
                byteRange,
              });

              if (ctx?.networkMonitor) {
                const duration = Math.max(1, stats.loading.end - stats.loading.start);
                let rttMs = 0;

                if (stats.loading && stats.loading.first > stats.loading.start) {
                  rttMs = Math.max(1, stats.loading.first - stats.loading.start);
                } else if ((stats as any).tfirst && (stats as any).trequest && (stats as any).tfirst > (stats as any).trequest) {
                  rttMs = Math.max(1, (stats as any).tfirst - (stats as any).trequest);
                }

                if (rttMs <= 0 && typeof performance !== 'undefined' && performance.getEntriesByName) {
                  const entries = performance.getEntriesByName(c.url);
                  if (entries.length > 0) {
                    const entry = entries[entries.length - 1] as PerformanceResourceTiming;
                    if (entry.responseStart > entry.requestStart && entry.requestStart > 0) {
                      rttMs = Math.round(entry.responseStart - entry.requestStart);
                    }
                  }
                }

                if (rttMs <= 0 && duration > 0) {
                  rttMs = Math.max(1, Math.round(duration * 0.35));
                }

                ctx.networkMonitor.recordDownload(response.data.byteLength, duration, rttMs);
              }
            }
          }

          callbacks.onSuccess(response, stats, c, networkDetails);
        },
      };

      super.load(context, config, wrappedCallbacks);
    }
  };

  (SmartFragmentLoaderClass as any).__isSmartLoader = true;
  return SmartFragmentLoaderClass;
}

export const SmartFragmentLoader = createSmartFragmentLoader();
