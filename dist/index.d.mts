import Artplayer from 'artplayer';
import Hls, { Fragment, Loader, FragmentLoaderContext, LoaderStats, LoaderConfiguration, LoaderCallbacks } from 'hls.js';

type PresetMode = 'default' | 'weak-network' | 'high-speed' | 'stable' | 'custom';
type NetworkQuality = 'extreme-poor' | 'poor' | 'fair' | 'good' | 'excellent';
interface SmartBufferConfig {
    /** 插件总开关 */
    enabled: boolean;
    /** 预置模式或自定义模式 */
    mode: PresetMode;
    /** 最小并发下载数 (1-4) */
    minConcurrency: number;
    /** 最大并发下载数 (1-8) */
    maxConcurrency: number;
    /** 目标缓冲时间 (秒) */
    targetBufferLength: number;
    /** 最大缓冲时间 (秒) */
    maxBufferLength: number;
    /** 最大预加载分片数 (1-10) */
    maxPreloadSegments: number;
    /** 最大缓存容量 (MB) */
    maxCacheSizeMB: number;
    /** 是否开启自动画质选择 */
    autoQuality: boolean;
    /** 画质选择安全系数 (0.5 - 0.9) */
    qualitySafetyFactor: number;
    /** 异常时是否自动恢复 */
    autoRecovery: boolean;
    /** 下载失败重试次数 */
    maxRetries: number;
    /** 是否根据网络质量动态调整并发数 */
    dynamicConcurrency: boolean;
    /** 播放器暂停时是否在后台继续预加载 */
    backgroundPreload: boolean;
    /** 是否显示实时网络监控面板/信息 */
    showNetworkStatus: boolean;
}
interface SegmentCacheItem {
    key: string;
    url: string;
    sn: number | string;
    level: number;
    startTime: number;
    duration: number;
    quality: number;
    size: number;
    data?: ArrayBuffer;
    status: 'loading' | 'completed' | 'failed';
    createdAt: number;
    lastAccessedAt: number;
    byteRange?: {
        start: number;
        end: number;
    };
    abortController?: AbortController;
    promise?: Promise<ArrayBuffer>;
}
interface NetworkStats {
    /** 瞬时下载速率 (Bytes/s) */
    instantSpeedBytesPerSec: number;
    /** 平滑下载速率 (Bytes/s) */
    smoothSpeedBytesPerSec: number;
    /** 瞬时下载速率 (Mbps) */
    instantSpeedMbps: number;
    /** 平滑下载速率 (Mbps) */
    smoothSpeedMbps: number;
    /** 预估可用带宽 (Mbps, EWMA) */
    bandwidthEstimateMbps: number;
    /** 往返延迟 / 响应首字节延迟 (ms) */
    rtt: number;
    /** 请求失败率 (0 - 1) */
    failureRate: number;
    /** 当前缓冲区有效播放时长 (秒) */
    bufferLength: number;
    /** 播放期间卡顿/重新缓冲次数 */
    rebufferCount: number;
    /** 卡顿等待总时长 (秒) */
    rebufferDuration: number;
    /** 网络状态等级 */
    networkQuality: NetworkQuality;
    /** 网络状态文本标签 */
    networkQualityLabel: string;
}
interface EngineStatus {
    enabled: boolean;
    mode: PresetMode;
    networkQuality: string;
    downloadSpeedFormatted: string;
    bandwidthFormatted: string;
    rttFormatted: string;
    bufferLengthFormatted: string;
    preloadedSegmentsCount: number;
    activeConcurrency: number;
    maxConcurrency: number;
    currentQuality: string;
    rebufferCount: number;
    rebufferDurationFormatted: string;
    cacheSizeMB: string;
}
interface PluginOptions extends Partial<SmartBufferConfig> {
    /** 自定义存储 key */
    storageKey?: string;
    /** 是否在控制台打印调试日志 */
    debug?: boolean;
}
interface SmartBufferPluginInstance {
    name: string;
    version: string;
    config: SmartBufferConfig;
    engine: any;
    updateConfig: (patch: Partial<SmartBufferConfig>) => void;
    resetConfig: () => void;
    getStatus: () => EngineStatus;
    destroy: () => void;
}

type ConfigChangeListener = (config: SmartBufferConfig, changedKeys: Array<keyof SmartBufferConfig>) => void;
declare class ConfigManager {
    private config;
    private storageKey;
    private listeners;
    constructor(options?: PluginOptions);
    getConfig(): Readonly<SmartBufferConfig>;
    updateConfig(patch: Partial<SmartBufferConfig>, save?: boolean): SmartBufferConfig;
    resetConfig(): SmartBufferConfig;
    subscribe(listener: ConfigChangeListener): () => void;
    private notifyListeners;
    private validateAndSanitize;
    private loadConfig;
    private saveConfig;
}

declare class NetworkMonitor {
    private throughput;
    private rttDetector;
    private totalRequests;
    private failedRequests;
    private rebufferCount;
    private rebufferDuration;
    private lastRebufferStart;
    private isRebuffering;
    private videoElement?;
    private eventListeners;
    constructor(video?: HTMLVideoElement);
    attachVideo(video: HTMLVideoElement): void;
    detachVideo(): void;
    private addListener;
    /**
     * Record a completed transfer
     */
    recordDownload(bytes: number, durationMs: number, rttMs?: number): void;
    /**
     * Record an observed RTT (Round Trip Time) sample directly
     */
    recordRTT(rttMs: number): void;
    /**
     * Record a failed request
     */
    recordFailure(): void;
    /**
     * Calculate available playable buffer ahead of currentTime (in seconds)
     * Accurately finds the TimeRange encompassing currentTime.
     */
    getBufferLength(): number;
    /**
     * Get failure rate (0 - 1)
     */
    getFailureRate(): number;
    /**
     * Categorize network quality
     */
    getNetworkQuality(): {
        quality: NetworkQuality;
        label: string;
    };
    getStats(): NetworkStats;
    reset(): void;
    destroy(): void;
}

declare class SegmentCache {
    private cache;
    private maxCacheSizeBytes;
    private currentSizeBytes;
    constructor(maxCacheSizeMB?: number);
    setMaxCacheSizeMB(maxMB: number): void;
    generateKey(level: number, sn: number | string, url: string, byteRange?: {
        start: number;
        end: number;
    }): string;
    has(key: string): boolean;
    get(key: string): SegmentCacheItem | undefined;
    put(item: SegmentCacheItem): void;
    markCompleted(key: string, data: ArrayBuffer): void;
    markFailed(key: string): void;
    remove(key: string): boolean;
    /**
     * Evict segments older than currentTime - gracePeriodSec (default 10s)
     */
    pruneConsumed(currentTime: number, gracePeriodSec?: number): void;
    /**
     * Purge segments from other quality levels
     */
    purgeOtherLevels(currentLevel: number): void;
    getCacheSizeMB(): number;
    getMaxCachedTime(): number;
    getCompletedCount(): number;
    clear(): void;
    private enforceLimit;
}

interface RetryOptions {
    maxRetries: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
}
declare class RecoveryManager {
    private isOnline;
    private onlineListeners;
    private activeFailuresCount;
    constructor();
    private handleOnline;
    private handleOffline;
    onNetworkRestored(callback: () => void): () => void;
    getIsOnline(): boolean;
    /**
     * Determine if an error is recoverable by retrying
     */
    isRecoverableError(statusOrError: number | Error | any): boolean;
    /**
     * Calculate backoff delay in ms with jitter
     */
    getBackoffDelay(attempt: number, initialDelayMs?: number, maxDelayMs?: number): number;
    recordFailure(): void;
    recordSuccess(): void;
    hasFailures(): boolean;
    destroy(): void;
}

declare class DynamicBufferManager {
    private config;
    private networkMonitor;
    private dynamicTargetBuffer;
    private dynamicConcurrency;
    constructor(config: SmartBufferConfig, networkMonitor: NetworkMonitor);
    updateConfig(config: SmartBufferConfig): void;
    /**
     * Re-evaluate dynamic buffer targets and concurrency based on real-time network conditions
     */
    evaluate(): {
        targetBuffer: number;
        concurrency: number;
        isBufferLow: boolean;
    };
    getTargetBufferLength(): number;
    getEffectiveConcurrency(): number;
}

interface FragmentInfo {
    sn: number | string;
    level: number;
    url: string;
    start: number;
    duration: number;
    end: number;
    byteRange?: {
        start: number;
        end: number;
    };
    rawFragment: Fragment;
}
declare class ManifestObserver {
    private hls?;
    private currentLevelIndex;
    private isLive;
    private levelFragments;
    private lastLoadingSn;
    constructor(hls?: Hls);
    attachHls(hls: Hls): void;
    syncLevels(hls?: Hls): void;
    isEmpty(): boolean;
    detachHls(): void;
    private onManifestParsed;
    private onLevelSwitched;
    private onLevelLoaded;
    private onFragLoading;
    getCurrentLevelIndex(): number;
    getIsLive(): boolean;
    getLastLoadingSn(): number | string;
    /**
     * Find candidate upcoming fragments ahead of currentTime within the buffer window
     */
    getUpcomingFragments(currentTime: number, targetWindowSec: number, maxCount: number, levelOverride?: number): FragmentInfo[];
    /**
     * Find candidate upcoming fragments ahead of currentTime that need preloading,
     * skipping already cached/active ones so we can fill all available concurrency slots.
     */
    getUncachedCandidateFragments(currentTime: number, lookaheadSec: number, maxCount: number, isUncached: (frag: FragmentInfo) => boolean): FragmentInfo[];
    /**
     * Find fragment info matching a sequence number
     */
    getFragmentBySn(level: number, sn: number | string): FragmentInfo | undefined;
    clear(): void;
}

declare enum TaskPriority {
    CRITICAL = 0,// Current playing fragment requested by hls.js
    HIGH = 1,// Next fragment immediately needed
    NORMAL = 2,// Preload within target buffer
    LOW = 3
}
interface ScheduledTask<T = any> {
    id: string;
    priority: TaskPriority;
    execute: () => Promise<T>;
    abortController: AbortController;
    createdAt: number;
    sn: number | string;
    level: number;
    startTime: number;
}
declare class PriorityTaskQueue {
    private queue;
    enqueue(task: ScheduledTask): void;
    dequeue(): ScheduledTask | undefined;
    peek(): ScheduledTask | undefined;
    remove(id: string): ScheduledTask | undefined;
    updatePriority(id: string, newPriority: TaskPriority): boolean;
    clear(): void;
    size(): number;
    getAll(): ScheduledTask[];
}

declare class PrefetchScheduler {
    private config;
    private cache;
    private networkMonitor;
    private manifestObserver;
    private recoveryManager;
    private bufferManager;
    private queue;
    private activeTasks;
    constructor(config: SmartBufferConfig, cache: SegmentCache, networkMonitor: NetworkMonitor, manifestObserver: ManifestObserver, recoveryManager: RecoveryManager, bufferManager: DynamicBufferManager);
    updateConfig(config: SmartBufferConfig): void;
    getActiveConcurrency(): number;
    getActiveTask(key: string): {
        abortController: AbortController;
        priority: TaskPriority;
        promise: Promise<ArrayBuffer>;
    } | undefined;
    /**
     * Fetch a segment with specified priority.
     * If already cached, returns immediately.
     * If already downloading, promotes priority and returns existing promise.
     */
    loadSegment(frag: FragmentInfo, priority?: TaskPriority): Promise<ArrayBuffer>;
    /**
     * Main scheduler tick called on playback progression
     */
    tick(currentTime: number, videoPaused: boolean): void;
    /**
     * Handle Seek: cancel active tasks that fall out of the new buffer window
     */
    onSeek(newTime: number): void;
    private drainQueue;
    private executeDownload;
    clearAll(): void;
}

declare class AdaptiveQualityController {
    private hls?;
    private config;
    private networkMonitor;
    private userManualLevel;
    private lastSwitchTime;
    private switchCooldownMs;
    constructor(config: SmartBufferConfig, networkMonitor: NetworkMonitor, hls?: Hls);
    attachHls(hls: Hls): void;
    detachHls(): void;
    updateConfig(config: SmartBufferConfig): void;
    setUserManualLevel(levelIndex: number): void;
    isManual(): boolean;
    /**
     * Evaluate network conditions and adjust quality level if needed
     */
    evaluate(): void;
    getCurrentQualityName(): string;
}

declare class HlsAdapter {
    private hls?;
    private video?;
    private config;
    private cache;
    private networkMonitor;
    private manifestObserver;
    private scheduler;
    private qualityController;
    private bufferManager;
    private recoveryManager;
    private pollTimer;
    private videoListeners;
    constructor(config: SmartBufferConfig, cache: SegmentCache, networkMonitor: NetworkMonitor, recoveryManager: RecoveryManager, bufferManager: DynamicBufferManager);
    updateConfig(config: SmartBufferConfig): void;
    attach(hls: Hls, video: HTMLVideoElement): void;
    detach(): void;
    private addVideoListener;
    private onTick;
    private onLevelSwitched;
    private onFragLoaded;
    private onHlsError;
    getQualityController(): AdaptiveQualityController;
    getScheduler(): PrefetchScheduler;
}

interface Mp4Chunk {
    index: number;
    start: number;
    end: number;
    size: number;
    data?: ArrayBuffer;
    status: 'idle' | 'downloading' | 'completed' | 'failed';
    abortController?: AbortController;
}
declare class Mp4RangeEngine {
    private config;
    private networkMonitor;
    private recoveryManager;
    private video?;
    private url?;
    private totalSize;
    private supportsRange;
    private chunkSize;
    private chunks;
    private activeDownloads;
    private pollTimer;
    constructor(config: SmartBufferConfig, networkMonitor: NetworkMonitor, recoveryManager: RecoveryManager);
    updateConfig(config: SmartBufferConfig): void;
    /**
     * Probe whether the MP4 URL supports HTTP Range
     */
    probeRangeSupport(url: string): Promise<boolean>;
    /**
     * Initialize MP4 Range engine on a video element
     */
    attach(video: HTMLVideoElement, url: string): Promise<boolean>;
    detach(): void;
    private initChunks;
    private startWorker;
    private scheduleNextChunks;
    private downloadChunk;
    getChunksCount(): {
        total: number;
        completed: number;
        active: number;
    };
}

declare class ProgressBarTracker {
    private art;
    private engine;
    private preloadBar?;
    private timer;
    constructor(art: Artplayer, engine: SmartBufferEngine);
    attach(): void;
    update(): void;
    destroy(): void;
}

declare class SmartBufferEngine {
    configManager: ConfigManager;
    networkMonitor: NetworkMonitor;
    segmentCache: SegmentCache;
    recoveryManager: RecoveryManager;
    bufferManager: DynamicBufferManager;
    hlsAdapter: HlsAdapter;
    mp4Engine: Mp4RangeEngine;
    progressBarTracker?: ProgressBarTracker;
    private art?;
    private isDestroyed;
    constructor(options?: PluginOptions);
    attachPlayer(art: Artplayer): void;
    attachHls(hls: Hls, video: HTMLVideoElement): void;
    updateConfig(patch: Partial<SmartBufferConfig>): SmartBufferConfig;
    resetConfig(): SmartBufferConfig;
    getConfig(): Readonly<SmartBufferConfig>;
    getStatus(): EngineStatus;
    private onConfigChanged;
    destroy(): void;
}

declare const DEFAULT_CONFIG: SmartBufferConfig;
declare const PRESET_CONFIGS: Record<Exclude<PresetMode, 'custom'>, Partial<SmartBufferConfig>>;

interface ThroughputSample {
    bytes: number;
    durationMs: number;
    timestamp: number;
    speedBytesPerSec: number;
    speedMbps: number;
}
declare class ThroughputDetector {
    private samples;
    private maxSamples;
    private ewmaEstimateMbps;
    private ewmaAlpha;
    /**
     * Record a downloaded chunk/segment sample
     * @param bytes Number of bytes received
     * @param durationMs Duration of transfer in milliseconds
     */
    recordSample(bytes: number, durationMs: number): ThroughputSample;
    /**
     * Get the most recent single download speed in Bytes/s
     */
    getInstantSpeedBytesPerSec(): number;
    /**
     * Get recent average speed in Bytes/s over a time window (default 5000ms)
     */
    getRecentAverageSpeedBytesPerSec(windowMs?: number): number;
    /**
     * Get EWMA smoothed bandwidth estimate in Mbps
     */
    getEstimatedBandwidthMbps(): number;
    /**
     * Clear recorded samples
     */
    reset(): void;
    /**
     * Format speed to human readable string (e.g., 3.52 MB/s, 450 KB/s)
     */
    static formatSpeed(bytesPerSec: number): string;
    /**
     * Format bandwidth to Mbps
     */
    static formatMbps(mbps: number): string;
}

declare class RTTDetector {
    private rttSamples;
    private maxSamples;
    private ewmaRtt;
    private ewmaAlpha;
    recordRTT(rttMs: number): void;
    getRTT(): number;
    reset(): void;
    static formatRTT(rttMs: number): string;
}

interface SmartLoaderContextHolder {
    cache?: SegmentCache;
    scheduler?: PrefetchScheduler;
    networkMonitor?: NetworkMonitor;
    isEnabled: () => boolean;
}
declare function setGlobalEngineContext(context: SmartLoaderContextHolder): void;
declare const DefaultLoaderClass: any;
declare class SmartFragmentLoader extends DefaultLoaderClass implements Loader<FragmentLoaderContext> {
    stats: LoaderStats;
    context: FragmentLoaderContext | null;
    private callbacks;
    constructor(config?: any);
    abort(): void;
    destroy(): void;
    load(context: FragmentLoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<FragmentLoaderContext>): void;
}

declare class StatusCard {
    private engine;
    private container?;
    private timer;
    constructor(engine: SmartBufferEngine);
    render(): HTMLElement;
    update(): void;
    destroy(): void;
}

declare class StatusControl {
    private art;
    private engine;
    private controlEl?;
    private popupEl?;
    private btnWrapper?;
    private timer;
    private isOpen;
    constructor(art: Artplayer, engine: SmartBufferEngine);
    register(): void;
    private mountPopup;
    toggle(): void;
    close(): void;
    update(): void;
    private onDocumentClick;
    destroy(): void;
}

declare class SettingsPanel {
    private art;
    private engine;
    private statusCard?;
    constructor(art: Artplayer, engine: SmartBufferEngine);
    register(): void;
    private updateMenuTooltip;
    destroy(): void;
}

/**
 * ArtPlayer 智能视频加载与多分片并发预加载插件
 */
declare function artplayerPluginSmartBuffer(options?: PluginOptions): (art: Artplayer) => SmartBufferPluginInstance;
declare namespace artplayerPluginSmartBuffer {
    var createHlsCustomType: (HlsClass?: any, customConfig?: Record<string, any>) => (video: HTMLVideoElement, url: string, art: Artplayer) => void;
}
declare const createHlsCustomType: (HlsClass?: any, customConfig?: Record<string, any>) => (video: HTMLVideoElement, url: string, art: Artplayer) => void;

export { AdaptiveQualityController, type ConfigChangeListener, ConfigManager, DEFAULT_CONFIG, DynamicBufferManager, type EngineStatus, type FragmentInfo, HlsAdapter, ManifestObserver, type Mp4Chunk, Mp4RangeEngine, NetworkMonitor, type NetworkQuality, type NetworkStats, PRESET_CONFIGS, type PluginOptions, PrefetchScheduler, type PresetMode, PriorityTaskQueue, ProgressBarTracker, RTTDetector, RecoveryManager, type RetryOptions, type ScheduledTask, SegmentCache, type SegmentCacheItem, SettingsPanel, type SmartBufferConfig, SmartBufferEngine, type SmartBufferPluginInstance, SmartFragmentLoader, type SmartLoaderContextHolder, StatusCard, StatusControl, TaskPriority, ThroughputDetector, type ThroughputSample, artplayerPluginSmartBuffer, createHlsCustomType, artplayerPluginSmartBuffer as default, setGlobalEngineContext };
