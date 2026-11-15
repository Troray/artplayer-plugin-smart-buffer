import type Artplayer from 'artplayer';
import type Hls from 'hls.js';
import { SmartBufferConfig, EngineStatus, PluginOptions } from './types';
import { ConfigManager } from './config/config-manager';
import { NetworkMonitor } from './network/network-monitor';
import { SegmentCache } from './cache/segment-cache';
import { RecoveryManager } from './recovery/recovery-manager';
import { DynamicBufferManager } from './buffer/buffer-manager';
import { HlsAdapter } from './hls/hls-adapter';
import { Mp4RangeEngine } from './mp4/mp4-engine';
import { ThroughputDetector } from './network/throughput';
import { RTTDetector } from './network/rtt';
import { ProgressBarTracker } from './ui/progress-bar-tracker';

export class SmartBufferEngine {
  public configManager: ConfigManager;
  public networkMonitor: NetworkMonitor;
  public segmentCache: SegmentCache;
  public recoveryManager: RecoveryManager;
  public bufferManager: DynamicBufferManager;
  public hlsAdapter: HlsAdapter;
  public mp4Engine: Mp4RangeEngine;
  public progressBarTracker?: ProgressBarTracker;

  private art?: Artplayer;
  private isDestroyed = false;

  constructor(options?: PluginOptions) {
    this.configManager = new ConfigManager(options);
    const initialConfig = this.configManager.getConfig();

    this.segmentCache = new SegmentCache(initialConfig.maxCacheSizeMB);
    this.networkMonitor = new NetworkMonitor();
    this.recoveryManager = new RecoveryManager();
    this.bufferManager = new DynamicBufferManager(initialConfig, this.networkMonitor);

    this.hlsAdapter = new HlsAdapter(
      initialConfig,
      this.segmentCache,
      this.networkMonitor,
      this.recoveryManager,
      this.bufferManager
    );

    this.mp4Engine = new Mp4RangeEngine(initialConfig, this.networkMonitor, this.recoveryManager);

    // Subscribe to config changes
    this.configManager.subscribe((newConfig) => {
      this.onConfigChanged(newConfig);
    });
  }

  public attachPlayer(art: Artplayer): void {
    this.art = art;
    (art as any).smartBufferEngine = this;

    // Attach video element to network monitor
    if (art.video) {
      this.networkMonitor.attachVideo(art.video);
    }

    // Intercept art.hls so whenever an Hls instance is assigned, we immediately attach
    let currentHls = (art as any).hls;
    if (currentHls && art.video) {
      this.hlsAdapter.attach(currentHls, art.video);
    }

    try {
      Object.defineProperty(art, 'hls', {
        configurable: true,
        enumerable: true,
        get: () => currentHls,
        set: (newHls: any) => {
          currentHls = newHls;
          if (newHls && art.video) {
            this.hlsAdapter.attach(newHls, art.video);
          }
        },
      });
    } catch (e) {
      // Fallback if property is already non-configurable
    }

    // Listen to video reload / customType events
    art.on('video:loadedmetadata', () => {
      if ((art as any).hls && art.video) {
        this.hlsAdapter.attach((art as any).hls, art.video);
      }
    });

    art.on('ready', () => {
      if ((art as any).hls && art.video) {
        this.hlsAdapter.attach((art as any).hls, art.video);
      }
    });

    // Attach progress bar tracker to show light green preloaded buffer
    this.progressBarTracker = new ProgressBarTracker(art, this);
    this.progressBarTracker.attach();

    art.on('destroy', () => {
      this.destroy();
    });
  }

  public attachHls(hls: Hls, video: HTMLVideoElement): void {
    this.hlsAdapter.attach(hls, video);
  }

  public updateConfig(patch: Partial<SmartBufferConfig>): SmartBufferConfig {
    return this.configManager.updateConfig(patch);
  }

  public resetConfig(): SmartBufferConfig {
    return this.configManager.resetConfig();
  }

  public getConfig(): Readonly<SmartBufferConfig> {
    return this.configManager.getConfig();
  }

  public getStatus(): EngineStatus {
    const config = this.configManager.getConfig();
    const stats = this.networkMonitor.getStats();
    const activeConcurrency = this.hlsAdapter.getScheduler().getActiveConcurrency();
    const currentQuality = this.hlsAdapter.getQualityController().getCurrentQualityName();

    return {
      enabled: config.enabled,
      mode: config.mode,
      networkQuality: stats.networkQualityLabel,
      downloadSpeedFormatted: ThroughputDetector.formatSpeed(stats.smoothSpeedBytesPerSec),
      bandwidthFormatted: ThroughputDetector.formatMbps(stats.bandwidthEstimateMbps),
      rttFormatted: RTTDetector.formatRTT(stats.rtt),
      bufferLengthFormatted: `${stats.bufferLength.toFixed(1)} s`,
      preloadedSegmentsCount: this.segmentCache.getCompletedCount(),
      activeConcurrency,
      maxConcurrency: this.bufferManager.getEffectiveConcurrency(),
      currentQuality,
      rebufferCount: stats.rebufferCount,
      rebufferDurationFormatted: `${stats.rebufferDuration.toFixed(1)} s`,
      cacheSizeMB: `${this.segmentCache.getCacheSizeMB()} MB`,
    };
  }

  private onConfigChanged(newConfig: SmartBufferConfig): void {
    this.hlsAdapter.updateConfig(newConfig);
    this.mp4Engine.updateConfig(newConfig);
    this.segmentCache.setMaxCacheSizeMB(newConfig.maxCacheSizeMB);

    if (!newConfig.enabled) {
      // Clear preloads and caches when disabled
      this.segmentCache.clear();
      this.hlsAdapter.getScheduler().clearAll();
    }
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.progressBarTracker?.destroy();
    this.hlsAdapter.detach();
    this.mp4Engine.detach();
    this.networkMonitor.destroy();
    this.recoveryManager.destroy();
    this.segmentCache.clear();
    this.art = undefined;
  }
}
