import Hls from 'hls.js';
import { SmartBufferConfig } from '../types';
import { SegmentCache } from '../cache/segment-cache';
import { NetworkMonitor } from '../network/network-monitor';
import { ManifestObserver } from './manifest-observer';
import { PrefetchScheduler } from '../scheduler/prefetch-scheduler';
import { AdaptiveQualityController } from '../abr/quality-controller';
import { DynamicBufferManager } from '../buffer/buffer-manager';
import { RecoveryManager } from '../recovery/recovery-manager';
import { SmartFragmentLoader, setGlobalEngineContext } from './smart-loader';

export class HlsAdapter {
  private hls?: Hls;
  private video?: HTMLVideoElement;
  private config: SmartBufferConfig;

  private cache: SegmentCache;
  private networkMonitor: NetworkMonitor;
  private manifestObserver: ManifestObserver;
  private scheduler: PrefetchScheduler;
  private qualityController: AdaptiveQualityController;
  private bufferManager: DynamicBufferManager;
  private recoveryManager: RecoveryManager;

  private pollTimer: any = null;
  private videoListeners: Array<{ type: string; handler: EventListener }> = [];

  constructor(
    config: SmartBufferConfig,
    cache: SegmentCache,
    networkMonitor: NetworkMonitor,
    recoveryManager: RecoveryManager,
    bufferManager: DynamicBufferManager
  ) {
    this.config = config;
    this.cache = cache;
    this.networkMonitor = networkMonitor;
    this.recoveryManager = recoveryManager;
    this.bufferManager = bufferManager;

    this.manifestObserver = new ManifestObserver();
    this.scheduler = new PrefetchScheduler(
      config,
      cache,
      networkMonitor,
      this.manifestObserver,
      recoveryManager,
      bufferManager
    );
    this.qualityController = new AdaptiveQualityController(config, networkMonitor);

    // Register engine context for SmartFragmentLoader
    setGlobalEngineContext({
      cache: this.cache,
      scheduler: this.scheduler,
      networkMonitor: this.networkMonitor,
      isEnabled: () => this.config.enabled,
    });
  }

  public updateConfig(config: SmartBufferConfig): void {
    this.config = config;
    this.scheduler.updateConfig(config);
    this.qualityController.updateConfig(config);
    this.bufferManager.updateConfig(config);
    this.cache.setMaxCacheSizeMB(config.maxCacheSizeMB);
  }

  public attach(hls: Hls, video: HTMLVideoElement): void {
    if (this.hls === hls && this.video === video) {
      this.onTick();
      return;
    }
    this.detach();

    this.hls = hls;
    this.video = video;

    this.manifestObserver.attachHls(hls);
    this.qualityController.attachHls(hls);
    this.networkMonitor.attachVideo(video);

    const events = (hls.constructor as typeof Hls).Events || Hls.Events;

    // Bind HLS events
    hls.on(events.ERROR as any, this.onHlsError);
    hls.on(events.LEVEL_SWITCHED as any, this.onLevelSwitched);
    hls.on(events.FRAG_LOADED as any, this.onFragLoaded);

    // Bind Video events
    const onTimeUpdate = () => {
      this.onTick();
    };

    const onSeeking = () => {
      if (this.video) {
        this.scheduler.onSeek(this.video.currentTime);
      }
    };

    const onSeeked = () => {
      this.onTick();
    };

    const onPlay = () => {
      this.onTick();
    };

    this.addVideoListener('timeupdate', onTimeUpdate);
    this.addVideoListener('seeking', onSeeking);
    this.addVideoListener('seeked', onSeeked);
    this.addVideoListener('play', onPlay);

    // Start background polling loop (every 600ms)
    this.pollTimer = setInterval(() => {
      this.onTick();
    }, 600);
  }

  public detach(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.video) {
      for (const { type, handler } of this.videoListeners) {
        this.video.removeEventListener(type, handler);
      }
      this.videoListeners = [];
    }

    if (this.hls) {
      try {
        const events = (this.hls.constructor as typeof Hls).Events || Hls.Events;
        this.hls.off(events.ERROR as any, this.onHlsError);
        this.hls.off(events.LEVEL_SWITCHED as any, this.onLevelSwitched);
        this.hls.off(events.FRAG_LOADED as any, this.onFragLoaded);
      } catch (e) {
        // Ignore
      }
    }

    this.manifestObserver.detachHls();
    this.qualityController.detachHls();
    this.networkMonitor.detachVideo();
    this.scheduler.clearAll();

    this.hls = undefined;
    this.video = undefined;
  }

  private addVideoListener(type: string, handler: EventListener): void {
    if (this.video) {
      this.video.addEventListener(type, handler);
      this.videoListeners.push({ type, handler });
    }
  }

  private onTick(): void {
    if (!this.config.enabled || !this.video) return;

    if (this.manifestObserver.isEmpty() && this.hls) {
      this.manifestObserver.syncLevels(this.hls);
    }

    const currentTime = this.video.currentTime;
    const isPaused = this.video.paused;

    // Run scheduler prefetch check
    this.scheduler.tick(currentTime, isPaused);

    // Run adaptive quality check
    this.qualityController.evaluate();
  }

  private onLevelSwitched = (event: string, data: { level: number }) => {
    // When quality level switches, clean up old segments from other levels
    if (typeof data.level === 'number') {
      this.cache.purgeOtherLevels(data.level);
    }
  };

  private onFragLoaded = (event: string, data: any) => {
    if (!data || !data.stats) return;
    const stats = data.stats;
    let rtt = 0;

    if (stats.loading && stats.loading.first > stats.loading.start) {
      rtt = Math.max(1, stats.loading.first - stats.loading.start);
    } else if (stats.tfirst && stats.trequest && stats.tfirst > stats.trequest) {
      rtt = Math.max(1, stats.tfirst - stats.trequest);
    }

    if (rtt <= 0 && data.frag && data.frag.url && typeof performance !== 'undefined' && performance.getEntriesByName) {
      const entries = performance.getEntriesByName(data.frag.url);
      if (entries.length > 0) {
        const entry = entries[entries.length - 1] as PerformanceResourceTiming;
        if (entry.responseStart > entry.requestStart && entry.requestStart > 0) {
          rtt = Math.round(entry.responseStart - entry.requestStart);
        }
      }
    }

    if (rtt <= 0 && stats.loading && stats.loading.end > stats.loading.start) {
      rtt = Math.max(1, Math.round((stats.loading.end - stats.loading.start) * 0.35));
    }

    if (rtt > 0) {
      this.networkMonitor.recordRTT(rtt);
    }
  };

  private onHlsError = (event: string, data: any) => {
    if (!data) return;

    if (data.fatal) {
      switch (data.type) {
        case 'networkError':
          this.networkMonitor.recordFailure();
          if (this.config.autoRecovery && this.hls) {
            console.warn('[SmartBuffer:HlsAdapter] Fatal network error encountered, attempting recovery...');
            this.hls.startLoad();
          }
          break;
        case 'mediaError':
          if (this.config.autoRecovery && this.hls) {
            console.warn('[SmartBuffer:HlsAdapter] Fatal media error encountered, recovering media...');
            this.hls.recoverMediaError();
          }
          break;
        default:
          console.error('[SmartBuffer:HlsAdapter] Unrecoverable fatal error:', data);
          break;
      }
    }
  };

  public getQualityController(): AdaptiveQualityController {
    return this.qualityController;
  }

  public getScheduler(): PrefetchScheduler {
    return this.scheduler;
  }
}
