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
}

const DefaultLoaderClass = (Hls.DefaultConfig?.loader || class {}) as any;

export class SmartFragmentLoader extends DefaultLoaderClass implements Loader<FragmentLoaderContext> {
  public stats: LoaderStats;
  public context: FragmentLoaderContext | null = null;
  private callbacks: LoaderCallbacks<FragmentLoaderContext> | null = null;

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
      if (this.callbacks && this.callbacks.onAbort) {
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

    // Check if smart buffer is active and has frag info
    if (!globalEngineContext.isEnabled() || !globalEngineContext.cache || !frag) {
      super.load(context, config, callbacks);
      return;
    }

    let byteRange: { start: number; end: number } | undefined;
    if (typeof frag.byteRangeStartOffset === 'number' && typeof frag.byteRangeEndOffset === 'number') {
      byteRange = {
        start: frag.byteRangeStartOffset,
        end: frag.byteRangeEndOffset - 1,
      };
    }

    const key = globalEngineContext.cache.generateKey(frag.level, frag.sn, url, byteRange);

    // 1. Instant Cache Hit (0ms!)
    const cached = globalEngineContext.cache.get(key);
    if (cached && cached.status === 'completed' && cached.data) {
      const now = performance.now();
      this.stats.loading.start = now;
      this.stats.loading.first = now;
      this.stats.loading.end = now;
      this.stats.loaded = cached.size;
      this.stats.total = cached.size;

      const response: LoaderResponse = {
        url,
        data: cached.data.slice(0), // ALWAYS clone so worker transfer does not neuter cached buffer!
      };

      queueMicrotask(() => {
        if (!this.stats.aborted && this.callbacks?.onSuccess) {
          this.callbacks.onSuccess(response, this.stats, context, null);
        }
      });
      return;
    }

    // 2. In-flight background prefetch download
    const active = globalEngineContext.scheduler?.getActiveTask(key);
    if (active) {
      this.stats.loading.start = performance.now();

      active.promise
        .then((arrayBuffer) => {
          if (this.stats.aborted) return;
          const now = performance.now();
          this.stats.loading.first = this.stats.loading.first || now;
          this.stats.loading.end = now;
          this.stats.loaded = arrayBuffer.byteLength;
          this.stats.total = arrayBuffer.byteLength;

          if (this.callbacks?.onSuccess) {
            this.callbacks.onSuccess(
              {
                url,
                data: arrayBuffer.slice(0),
              },
              this.stats,
              context,
              null
            );
          }
        })
        .catch(() => {
          if (this.stats.aborted) return;
          // Background prefetch failed, seamlessly fallback to native loader!
          super.load(context, config, callbacks);
        });
      return;
    }

    // 3. Cold miss: delegate to native loader (XhrLoader), and cache upon completion
    const wrappedCallbacks: LoaderCallbacks<FragmentLoaderContext> = {
      ...callbacks,
      onSuccess: (response, stats, ctx, networkDetails) => {
        if (response && response.data instanceof ArrayBuffer && globalEngineContext.cache && ctx.frag) {
          globalEngineContext.cache.put({
            key,
            url: ctx.url,
            sn: ctx.frag.sn,
            level: ctx.frag.level,
            startTime: ctx.frag.start,
            duration: ctx.frag.duration,
            quality: ctx.frag.level,
            size: response.data.byteLength,
            data: response.data.slice(0),
            status: 'completed',
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            byteRange,
          });

          if (globalEngineContext.networkMonitor) {
            const duration = Math.max(1, stats.loading.end - stats.loading.start);
            let rttMs = 0;

            if (stats.loading && stats.loading.first > stats.loading.start) {
              rttMs = Math.max(1, stats.loading.first - stats.loading.start);
            } else if ((stats as any).tfirst && (stats as any).trequest && (stats as any).tfirst > (stats as any).trequest) {
              rttMs = Math.max(1, (stats as any).tfirst - (stats as any).trequest);
            }

            if (rttMs <= 0 && typeof performance !== 'undefined' && performance.getEntriesByName) {
              const entries = performance.getEntriesByName(ctx.url);
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

            globalEngineContext.networkMonitor.recordDownload(response.data.byteLength, duration, rttMs);
          }
        }

        callbacks.onSuccess(response, stats, ctx, networkDetails);
      },
    };

    super.load(context, config, wrappedCallbacks);
  }
}
