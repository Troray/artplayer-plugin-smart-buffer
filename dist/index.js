"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AdaptiveQualityController: () => AdaptiveQualityController,
  ConfigManager: () => ConfigManager,
  DEFAULT_CONFIG: () => DEFAULT_CONFIG,
  DynamicBufferManager: () => DynamicBufferManager,
  HlsAdapter: () => HlsAdapter,
  ManifestObserver: () => ManifestObserver,
  Mp4RangeEngine: () => Mp4RangeEngine,
  NetworkMonitor: () => NetworkMonitor,
  PRESET_CONFIGS: () => PRESET_CONFIGS,
  PrefetchScheduler: () => PrefetchScheduler,
  PriorityTaskQueue: () => PriorityTaskQueue,
  ProgressBarTracker: () => ProgressBarTracker,
  RTTDetector: () => RTTDetector,
  RecoveryManager: () => RecoveryManager,
  SegmentCache: () => SegmentCache,
  SettingsPanel: () => SettingsPanel,
  SmartBufferEngine: () => SmartBufferEngine,
  SmartFragmentLoader: () => SmartFragmentLoader,
  StatusCard: () => StatusCard,
  StatusControl: () => StatusControl,
  TaskPriority: () => TaskPriority,
  ThroughputDetector: () => ThroughputDetector,
  artplayerPluginSmartBuffer: () => artplayerPluginSmartBuffer,
  createHlsCustomType: () => createHlsCustomType,
  default: () => index_default,
  setGlobalEngineContext: () => setGlobalEngineContext
});
module.exports = __toCommonJS(index_exports);

// src/config/defaults.ts
var DEFAULT_CONFIG = {
  enabled: true,
  mode: "default",
  minConcurrency: 2,
  maxConcurrency: 4,
  targetBufferLength: 30,
  maxBufferLength: 80,
  maxPreloadSegments: 6,
  maxCacheSizeMB: 150,
  autoQuality: true,
  qualitySafetyFactor: 0.75,
  autoRecovery: true,
  maxRetries: 5,
  dynamicConcurrency: true,
  backgroundPreload: false,
  showNetworkStatus: true
};
var PRESET_CONFIGS = {
  // 默认模式：均衡 4线程/30s缓冲，适合常见日常网络
  default: {
    minConcurrency: 2,
    maxConcurrency: 4,
    targetBufferLength: 30,
    maxBufferLength: 80,
    maxPreloadSegments: 6,
    maxCacheSizeMB: 150,
    autoQuality: true,
    qualitySafetyFactor: 0.75,
    dynamicConcurrency: true
  },
  // 弱网/极弱网优化模式：类似 IDM 多线程加速，激进开启 6~8 线程并发抢占带宽，缓冲深度提升至 60~120秒构建超深安全区
  "weak-network": {
    minConcurrency: 4,
    maxConcurrency: 8,
    targetBufferLength: 60,
    maxBufferLength: 120,
    maxPreloadSegments: 12,
    maxCacheSizeMB: 300,
    autoQuality: true,
    qualitySafetyFactor: 0.65,
    dynamicConcurrency: false
    // 弱网下全力打满并发，不随意被算法降级
  },
  // 高速网络模式：适合大带宽光纤网络，追求秒开与瞬时跳转
  "high-speed": {
    minConcurrency: 3,
    maxConcurrency: 6,
    targetBufferLength: 30,
    maxBufferLength: 90,
    maxPreloadSegments: 8,
    maxCacheSizeMB: 200,
    autoQuality: true,
    qualitySafetyFactor: 0.85,
    dynamicConcurrency: true
  },
  // 稳定优先模式：超长视频连续平稳播放，超深缓冲
  stable: {
    minConcurrency: 4,
    maxConcurrency: 6,
    targetBufferLength: 80,
    maxBufferLength: 150,
    maxPreloadSegments: 10,
    maxCacheSizeMB: 300,
    autoQuality: true,
    qualitySafetyFactor: 0.7,
    dynamicConcurrency: false
  }
};

// src/config/config-manager.ts
var STORAGE_VERSION = "v1";
var DEFAULT_STORAGE_KEY = `artplayer_smart_buffer_${STORAGE_VERSION}`;
var ConfigManager = class {
  constructor(options) {
    this.listeners = /* @__PURE__ */ new Set();
    this.storageKey = options?.storageKey || DEFAULT_STORAGE_KEY;
    this.config = this.loadConfig(options);
  }
  getConfig() {
    return { ...this.config };
  }
  updateConfig(patch, save = true) {
    const prev = { ...this.config };
    const changedKeys = [];
    if (patch.mode && patch.mode !== "custom" && patch.mode !== this.config.mode) {
      const presetValues = PRESET_CONFIGS[patch.mode];
      if (presetValues) {
        Object.assign(patch, presetValues);
      }
    } else if (!patch.mode) {
      const isParamModified = Object.keys(patch).some(
        (key) => key !== "mode" && key !== "enabled" && key !== "showNetworkStatus"
      );
      if (isParamModified && this.config.mode !== "custom") {
        patch.mode = "custom";
      }
    }
    const next = { ...this.config, ...patch };
    const validated = this.validateAndSanitize(next);
    for (const key of Object.keys(validated)) {
      if (validated[key] !== prev[key]) {
        changedKeys.push(key);
      }
    }
    this.config = validated;
    if (save) {
      this.saveConfig();
    }
    if (changedKeys.length > 0) {
      this.notifyListeners(changedKeys);
    }
    return this.getConfig();
  }
  resetConfig() {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig();
    this.notifyListeners(Object.keys(DEFAULT_CONFIG));
    return this.getConfig();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notifyListeners(changedKeys) {
    const current = this.getConfig();
    for (const listener of this.listeners) {
      try {
        listener(current, changedKeys);
      } catch (err) {
        console.error("[SmartBuffer:ConfigManager] Error in config listener:", err);
      }
    }
  }
  validateAndSanitize(cfg) {
    const sanitized = { ...cfg };
    sanitized.enabled = Boolean(cfg.enabled);
    const validModes = ["default", "weak-network", "high-speed", "stable", "custom"];
    sanitized.mode = validModes.includes(cfg.mode) ? cfg.mode : "default";
    sanitized.minConcurrency = Math.max(1, Math.min(4, Math.floor(cfg.minConcurrency || 1)));
    sanitized.maxConcurrency = Math.max(sanitized.minConcurrency, Math.min(8, Math.floor(cfg.maxConcurrency || 3)));
    sanitized.targetBufferLength = Math.max(5, Math.min(120, Math.floor(cfg.targetBufferLength || 20)));
    sanitized.maxBufferLength = Math.max(
      sanitized.targetBufferLength,
      Math.min(300, Math.floor(cfg.maxBufferLength || 60))
    );
    sanitized.maxPreloadSegments = Math.max(1, Math.min(20, Math.floor(cfg.maxPreloadSegments || 4)));
    sanitized.maxCacheSizeMB = Math.max(20, Math.min(1e3, Math.floor(cfg.maxCacheSizeMB || 100)));
    sanitized.autoQuality = Boolean(cfg.autoQuality);
    sanitized.qualitySafetyFactor = Math.max(0.3, Math.min(1, Number(cfg.qualitySafetyFactor) || 0.75));
    sanitized.autoRecovery = Boolean(cfg.autoRecovery);
    sanitized.maxRetries = Math.max(1, Math.min(20, Math.floor(cfg.maxRetries || 5)));
    sanitized.dynamicConcurrency = Boolean(cfg.dynamicConcurrency);
    sanitized.backgroundPreload = Boolean(cfg.backgroundPreload);
    sanitized.showNetworkStatus = Boolean(cfg.showNetworkStatus);
    return sanitized;
  }
  loadConfig(options) {
    let stored = {};
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          stored = JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn("[SmartBuffer:ConfigManager] Failed to read localStorage:", e);
    }
    const merged = {
      ...DEFAULT_CONFIG,
      ...stored,
      ...options
    };
    return this.validateAndSanitize(merged);
  }
  saveConfig() {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.config));
      }
    } catch (e) {
      console.warn("[SmartBuffer:ConfigManager] Failed to write localStorage:", e);
    }
  }
};

// src/network/throughput.ts
var ThroughputDetector = class {
  constructor() {
    this.samples = [];
    this.maxSamples = 20;
    this.ewmaEstimateMbps = 0;
    this.ewmaAlpha = 0.25;
  }
  // Weight for latest sample
  /**
   * Record a downloaded chunk/segment sample
   * @param bytes Number of bytes received
   * @param durationMs Duration of transfer in milliseconds
   */
  recordSample(bytes, durationMs) {
    const validDuration = Math.max(durationMs, 10);
    const speedBytesPerSec = bytes / validDuration * 1e3;
    const speedMbps = bytes * 8 / (validDuration / 1e3) / 1e6;
    const sample = {
      bytes,
      durationMs: validDuration,
      timestamp: Date.now(),
      speedBytesPerSec,
      speedMbps
    };
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    if (this.ewmaEstimateMbps === 0) {
      this.ewmaEstimateMbps = speedMbps;
    } else {
      this.ewmaEstimateMbps = this.ewmaAlpha * speedMbps + (1 - this.ewmaAlpha) * this.ewmaEstimateMbps;
    }
    return sample;
  }
  /**
   * Get the most recent single download speed in Bytes/s
   */
  getInstantSpeedBytesPerSec() {
    if (this.samples.length === 0) return 0;
    return this.samples[this.samples.length - 1].speedBytesPerSec;
  }
  /**
   * Get recent average speed in Bytes/s over a time window (default 5000ms)
   */
  getRecentAverageSpeedBytesPerSec(windowMs = 5e3) {
    const now = Date.now();
    const recent = this.samples.filter((s) => now - s.timestamp <= windowMs);
    if (recent.length === 0) {
      return this.getInstantSpeedBytesPerSec();
    }
    let totalBytes = 0;
    let totalDurationMs = 0;
    for (const s of recent) {
      totalBytes += s.bytes;
      totalDurationMs += s.durationMs;
    }
    if (totalDurationMs <= 0) return 0;
    return totalBytes / totalDurationMs * 1e3;
  }
  /**
   * Get EWMA smoothed bandwidth estimate in Mbps
   */
  getEstimatedBandwidthMbps() {
    return this.ewmaEstimateMbps;
  }
  /**
   * Clear recorded samples
   */
  reset() {
    this.samples = [];
    this.ewmaEstimateMbps = 0;
  }
  /**
   * Format speed to human readable string (e.g., 3.52 MB/s, 450 KB/s)
   */
  static formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return "0 KB/s";
    if (bytesPerSec >= 1024 * 1024) {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
    }
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  }
  /**
   * Format bandwidth to Mbps
   */
  static formatMbps(mbps) {
    if (!mbps || mbps <= 0) return "0 Mbps";
    return `${mbps.toFixed(2)} Mbps`;
  }
};

// src/network/rtt.ts
var RTTDetector = class {
  constructor() {
    this.rttSamples = [];
    this.maxSamples = 15;
    this.ewmaRtt = 0;
    this.ewmaAlpha = 0.3;
  }
  recordRTT(rttMs) {
    const validRtt = Math.max(1, rttMs);
    this.rttSamples.push(validRtt);
    if (this.rttSamples.length > this.maxSamples) {
      this.rttSamples.shift();
    }
    if (this.ewmaRtt === 0) {
      this.ewmaRtt = validRtt;
    } else {
      this.ewmaRtt = this.ewmaAlpha * validRtt + (1 - this.ewmaAlpha) * this.ewmaRtt;
    }
  }
  getRTT() {
    return Math.round(this.ewmaRtt);
  }
  reset() {
    this.rttSamples = [];
    this.ewmaRtt = 0;
  }
  static formatRTT(rttMs) {
    if (!rttMs || rttMs <= 0) return "-- ms";
    return `${Math.round(rttMs)} ms`;
  }
};

// src/network/network-monitor.ts
var NetworkMonitor = class {
  constructor(video) {
    this.throughput = new ThroughputDetector();
    this.rttDetector = new RTTDetector();
    this.totalRequests = 0;
    this.failedRequests = 0;
    this.rebufferCount = 0;
    this.rebufferDuration = 0;
    this.lastRebufferStart = 0;
    this.isRebuffering = false;
    this.eventListeners = [];
    if (video) {
      this.attachVideo(video);
    }
  }
  attachVideo(video) {
    this.detachVideo();
    this.videoElement = video;
    const onWaiting = () => {
      if (!this.isRebuffering && !video.paused && !video.ended) {
        this.isRebuffering = true;
        this.lastRebufferStart = performance.now();
        this.rebufferCount++;
      }
    };
    const onPlaying = () => {
      if (this.isRebuffering) {
        this.isRebuffering = false;
        if (this.lastRebufferStart > 0) {
          this.rebufferDuration += (performance.now() - this.lastRebufferStart) / 1e3;
          this.lastRebufferStart = 0;
        }
      }
    };
    const onPause = () => {
      if (this.isRebuffering) {
        this.isRebuffering = false;
        if (this.lastRebufferStart > 0) {
          this.rebufferDuration += (performance.now() - this.lastRebufferStart) / 1e3;
          this.lastRebufferStart = 0;
        }
      }
    };
    this.addListener(video, "waiting", onWaiting);
    this.addListener(video, "playing", onPlaying);
    this.addListener(video, "pause", onPause);
  }
  detachVideo() {
    for (const { target, type, listener } of this.eventListeners) {
      target.removeEventListener(type, listener);
    }
    this.eventListeners = [];
    this.videoElement = void 0;
  }
  addListener(target, type, listener) {
    target.addEventListener(type, listener);
    this.eventListeners.push({ target, type, listener });
  }
  /**
   * Record a completed transfer
   */
  recordDownload(bytes, durationMs, rttMs) {
    this.totalRequests++;
    this.throughput.recordSample(bytes, durationMs);
    if (typeof rttMs === "number" && rttMs > 0) {
      this.rttDetector.recordRTT(rttMs);
    }
  }
  /**
   * Record an observed RTT (Round Trip Time) sample directly
   */
  recordRTT(rttMs) {
    if (typeof rttMs === "number" && rttMs > 0) {
      this.rttDetector.recordRTT(rttMs);
    }
  }
  /**
   * Record a failed request
   */
  recordFailure() {
    this.totalRequests++;
    this.failedRequests++;
  }
  /**
   * Calculate available playable buffer ahead of currentTime (in seconds)
   * Accurately finds the TimeRange encompassing currentTime.
   */
  getBufferLength() {
    if (!this.videoElement) return 0;
    const { currentTime, buffered } = this.videoElement;
    if (!buffered || buffered.length === 0) return 0;
    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (currentTime >= start - 0.5 && currentTime <= end) {
        return Math.max(0, end - currentTime);
      }
    }
    return 0;
  }
  /**
   * Get failure rate (0 - 1)
   */
  getFailureRate() {
    if (this.totalRequests === 0) return 0;
    return this.failedRequests / this.totalRequests;
  }
  /**
   * Categorize network quality
   */
  getNetworkQuality() {
    const bwMbps = this.throughput.getEstimatedBandwidthMbps();
    const buffer = this.getBufferLength();
    const failureRate = this.getFailureRate();
    if (bwMbps === 0) {
      return { quality: "good", label: "\u68C0\u6D4B\u4E2D (Detecting)" };
    }
    let quality = "fair";
    let label = "\u4E00\u822C (Fair)";
    if (bwMbps < 0.8) {
      quality = "extreme-poor";
      label = "\u6781\u5DEE (Very Poor)";
    } else if (bwMbps < 2) {
      quality = "poor";
      label = "\u8F83\u5DEE (Poor)";
    } else if (bwMbps < 5) {
      quality = "fair";
      label = "\u4E00\u822C (Fair)";
    } else if (bwMbps < 10) {
      quality = "good";
      label = "\u826F\u597D (Good)";
    } else {
      quality = "excellent";
      label = "\u4F18\u79C0 (Excellent)";
    }
    if ((failureRate > 0.3 || this.isRebuffering && buffer < 1) && quality !== "extreme-poor") {
      if (quality === "excellent") {
        quality = "good";
        label = "\u826F\u597D (\u6CE2\u52A8)";
      } else if (quality === "good") {
        quality = "fair";
        label = "\u4E00\u822C (\u6CE2\u52A8)";
      } else if (quality === "fair") {
        quality = "poor";
        label = "\u8F83\u5DEE (\u4E0D\u7A33\u5B9A)";
      } else if (quality === "poor") {
        quality = "extreme-poor";
        label = "\u6781\u5DEE (\u4E2D\u65AD)";
      }
    }
    return { quality, label };
  }
  getStats() {
    const instantBytes = this.throughput.getInstantSpeedBytesPerSec();
    const smoothBytes = this.throughput.getRecentAverageSpeedBytesPerSec();
    const bwMbps = this.throughput.getEstimatedBandwidthMbps();
    const rtt = this.rttDetector.getRTT();
    const bufferLength = this.getBufferLength();
    const failureRate = this.getFailureRate();
    const { quality, label } = this.getNetworkQuality();
    let currentRebufferDuration = this.rebufferDuration;
    if (this.isRebuffering && this.lastRebufferStart > 0) {
      currentRebufferDuration += (performance.now() - this.lastRebufferStart) / 1e3;
    }
    return {
      instantSpeedBytesPerSec: instantBytes,
      smoothSpeedBytesPerSec: smoothBytes,
      instantSpeedMbps: instantBytes * 8 / 1e6,
      smoothSpeedMbps: smoothBytes * 8 / 1e6,
      bandwidthEstimateMbps: bwMbps,
      rtt,
      failureRate,
      bufferLength,
      rebufferCount: this.rebufferCount,
      rebufferDuration: Math.round(currentRebufferDuration * 10) / 10,
      networkQuality: quality,
      networkQualityLabel: label
    };
  }
  reset() {
    this.throughput.reset();
    this.rttDetector.reset();
    this.totalRequests = 0;
    this.failedRequests = 0;
    this.rebufferCount = 0;
    this.rebufferDuration = 0;
    this.lastRebufferStart = 0;
    this.isRebuffering = false;
  }
  destroy() {
    this.detachVideo();
    this.reset();
  }
};

// src/cache/segment-cache.ts
var SegmentCache = class {
  constructor(maxCacheSizeMB = 100) {
    this.cache = /* @__PURE__ */ new Map();
    this.currentSizeBytes = 0;
    this.maxCacheSizeBytes = maxCacheSizeMB * 1024 * 1024;
  }
  setMaxCacheSizeMB(maxMB) {
    this.maxCacheSizeBytes = Math.max(20, maxMB) * 1024 * 1024;
    this.enforceLimit();
  }
  generateKey(level, sn, url, byteRange) {
    if (byteRange) {
      return `${level}_${sn}_${byteRange.start}-${byteRange.end}_${url}`;
    }
    return `${level}_${sn}_${url}`;
  }
  has(key) {
    return this.cache.has(key);
  }
  get(key) {
    const item = this.cache.get(key);
    if (item) {
      item.lastAccessedAt = Date.now();
    }
    return item;
  }
  put(item) {
    const existing = this.cache.get(item.key);
    if (existing && existing.data) {
      this.currentSizeBytes -= existing.size;
    }
    item.lastAccessedAt = Date.now();
    this.cache.set(item.key, item);
    if (item.data && item.status === "completed") {
      this.currentSizeBytes += item.size;
      this.enforceLimit();
    }
  }
  markCompleted(key, data) {
    const item = this.cache.get(key);
    if (!item) return;
    item.status = "completed";
    item.data = data;
    item.size = data.byteLength;
    item.lastAccessedAt = Date.now();
    this.currentSizeBytes += item.size;
    this.enforceLimit();
  }
  markFailed(key) {
    const item = this.cache.get(key);
    if (item) {
      item.status = "failed";
    }
  }
  remove(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    if (item.status === "loading" && item.abortController) {
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
  pruneConsumed(currentTime, gracePeriodSec = 10) {
    const threshold = currentTime - gracePeriodSec;
    const toRemove = [];
    for (const [key, item] of this.cache.entries()) {
      if (item.sn === "initSegment") continue;
      if (typeof item.startTime !== "number" || typeof item.duration !== "number") continue;
      if (item.status === "completed" && item.startTime + item.duration < threshold) {
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
  purgeOtherLevels(currentLevel) {
    const toRemove = [];
    for (const [key, item] of this.cache.entries()) {
      if (item.level !== currentLevel && item.status === "completed") {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.remove(key);
    }
  }
  getCacheSizeMB() {
    return Math.round(this.currentSizeBytes / (1024 * 1024) * 100) / 100;
  }
  getMaxCachedTime() {
    let maxTime = 0;
    for (const item of this.cache.values()) {
      if (item.status === "completed" && typeof item.startTime === "number" && typeof item.duration === "number") {
        maxTime = Math.max(maxTime, item.startTime + item.duration);
      }
    }
    return maxTime;
  }
  getCompletedCount() {
    let count = 0;
    for (const item of this.cache.values()) {
      if (item.status === "completed") count++;
    }
    return count;
  }
  clear() {
    for (const item of this.cache.values()) {
      if (item.status === "loading" && item.abortController) {
        item.abortController.abort();
      }
    }
    this.cache.clear();
    this.currentSizeBytes = 0;
  }
  enforceLimit() {
    if (this.currentSizeBytes <= this.maxCacheSizeBytes) return;
    const items = Array.from(this.cache.entries()).filter(([_, item]) => item.status === "completed" && item.data).sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    for (const [key, item] of items) {
      if (this.currentSizeBytes <= this.maxCacheSizeBytes) break;
      this.remove(key);
    }
  }
};

// src/recovery/recovery-manager.ts
var RecoveryManager = class {
  constructor() {
    this.isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    this.onlineListeners = [];
    this.activeFailuresCount = 0;
    this.handleOnline = () => {
      this.isOnline = true;
      for (const cb of this.onlineListeners) {
        try {
          cb();
        } catch (e) {
          console.error("[SmartBuffer:RecoveryManager] Error in online listener:", e);
        }
      }
    };
    this.handleOffline = () => {
      this.isOnline = false;
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }
  onNetworkRestored(callback) {
    this.onlineListeners.push(callback);
    return () => {
      const idx = this.onlineListeners.indexOf(callback);
      if (idx !== -1) this.onlineListeners.splice(idx, 1);
    };
  }
  getIsOnline() {
    return this.isOnline;
  }
  /**
   * Determine if an error is recoverable by retrying
   */
  isRecoverableError(statusOrError) {
    if (typeof statusOrError === "number") {
      if (statusOrError === 401 || statusOrError === 403 || statusOrError === 404 || statusOrError === 410) {
        return false;
      }
      return statusOrError === 408 || statusOrError === 429 || statusOrError >= 500;
    }
    if (statusOrError instanceof Error) {
      const msg = statusOrError.message.toLowerCase();
      if (msg.includes("abort")) return false;
      return true;
    }
    return true;
  }
  /**
   * Calculate backoff delay in ms with jitter
   */
  getBackoffDelay(attempt, initialDelayMs = 1e3, maxDelayMs = 16e3) {
    const exponential = initialDelayMs * Math.pow(2, attempt);
    const delayWithJitter = exponential * (0.8 + Math.random() * 0.4);
    return Math.min(maxDelayMs, Math.round(delayWithJitter));
  }
  recordFailure() {
    this.activeFailuresCount++;
  }
  recordSuccess() {
    if (this.activeFailuresCount > 0) {
      this.activeFailuresCount--;
    }
  }
  hasFailures() {
    return this.activeFailuresCount > 0;
  }
  destroy() {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    this.onlineListeners = [];
    this.activeFailuresCount = 0;
  }
};

// src/buffer/buffer-manager.ts
var DynamicBufferManager = class {
  constructor(config, networkMonitor) {
    this.config = config;
    this.networkMonitor = networkMonitor;
    this.dynamicTargetBuffer = config.targetBufferLength;
    this.dynamicConcurrency = config.maxConcurrency;
  }
  updateConfig(config) {
    this.config = config;
    if (!config.dynamicConcurrency) {
      this.dynamicConcurrency = config.maxConcurrency;
    }
  }
  /**
   * Re-evaluate dynamic buffer targets and concurrency based on real-time network conditions
   */
  evaluate() {
    const stats = this.networkMonitor.getStats();
    const currentBuffer = stats.bufferLength;
    const quality = stats.networkQuality;
    const isBufferLow = currentBuffer < 3;
    if (!this.config.dynamicConcurrency || this.config.mode === "weak-network") {
      this.dynamicTargetBuffer = Math.max(this.config.targetBufferLength, 60);
      this.dynamicConcurrency = this.config.maxConcurrency;
      return {
        targetBuffer: this.dynamicTargetBuffer,
        concurrency: this.dynamicConcurrency,
        isBufferLow
      };
    }
    switch (quality) {
      case "extreme-poor":
      case "poor":
        this.dynamicConcurrency = this.config.maxConcurrency;
        this.dynamicTargetBuffer = Math.max(this.config.targetBufferLength, 60);
        break;
      case "fair":
      case "good":
      case "excellent":
        this.dynamicConcurrency = this.config.maxConcurrency;
        this.dynamicTargetBuffer = this.config.targetBufferLength;
        break;
    }
    if (currentBuffer < 1 && this.dynamicConcurrency > 2) {
      this.dynamicConcurrency = 2;
    }
    return {
      targetBuffer: this.dynamicTargetBuffer,
      concurrency: this.dynamicConcurrency,
      isBufferLow
    };
  }
  getTargetBufferLength() {
    return this.dynamicTargetBuffer;
  }
  getEffectiveConcurrency() {
    return this.dynamicConcurrency;
  }
};

// src/hls/hls-adapter.ts
var import_hls3 = __toESM(require("hls.js"));

// src/hls/manifest-observer.ts
var import_hls = __toESM(require("hls.js"));
var ManifestObserver = class {
  constructor(hls) {
    this.currentLevelIndex = 0;
    this.isLive = false;
    this.levelFragments = /* @__PURE__ */ new Map();
    this.lastLoadingSn = -1;
    this.onManifestParsed = (event, data) => {
      if (data && data.levels && data.levels.length > 0) {
        this.currentLevelIndex = this.hls?.currentLevel ?? 0;
        if (this.currentLevelIndex < 0) this.currentLevelIndex = 0;
      }
    };
    this.onLevelSwitched = (event, data) => {
      if (typeof data.level === "number" && data.level >= 0) {
        this.currentLevelIndex = data.level;
      }
    };
    this.onLevelLoaded = (event, data) => {
      const { level, details } = data;
      if (!details) return;
      this.isLive = Boolean(details.live);
      const fragments = [];
      if (details.fragments && Array.isArray(details.fragments)) {
        for (const frag of details.fragments) {
          let byteRange;
          if (typeof frag.byteRangeStartOffset === "number" && typeof frag.byteRangeEndOffset === "number") {
            byteRange = {
              start: frag.byteRangeStartOffset,
              end: frag.byteRangeEndOffset - 1
              // HTTP range header is inclusive
            };
          }
          fragments.push({
            sn: frag.sn,
            level: frag.level,
            url: frag.url,
            start: frag.start,
            duration: frag.duration,
            end: frag.start + frag.duration,
            byteRange,
            rawFragment: frag
          });
        }
      }
      this.levelFragments.set(level, fragments);
    };
    this.onFragLoading = (event, data) => {
      if (data && data.frag) {
        this.lastLoadingSn = data.frag.sn;
      }
    };
    if (hls) {
      this.attachHls(hls);
    }
  }
  attachHls(hls) {
    this.hls = hls;
    const events = hls.constructor.Events || import_hls.default.Events;
    hls.on(events.LEVEL_LOADED, this.onLevelLoaded);
    hls.on(events.LEVEL_SWITCHED, this.onLevelSwitched);
    hls.on(events.FRAG_LOADING, this.onFragLoading);
    hls.on(events.MANIFEST_PARSED, this.onManifestParsed);
    this.syncLevels(hls);
  }
  syncLevels(hls) {
    const targetHls = hls || this.hls;
    if (!targetHls || !targetHls.levels || targetHls.levels.length === 0) return;
    this.currentLevelIndex = targetHls.currentLevel >= 0 ? targetHls.currentLevel : 0;
    for (let i = 0; i < targetHls.levels.length; i++) {
      const lvl = targetHls.levels[i];
      if (lvl && lvl.details) {
        this.onLevelLoaded("", { level: i, details: lvl.details });
      }
    }
  }
  isEmpty() {
    return this.levelFragments.size === 0;
  }
  detachHls() {
    if (!this.hls) return;
    try {
      const events = this.hls.constructor.Events || import_hls.default.Events;
      this.hls.off(events.LEVEL_LOADED, this.onLevelLoaded);
      this.hls.off(events.LEVEL_SWITCHED, this.onLevelSwitched);
      this.hls.off(events.FRAG_LOADING, this.onFragLoading);
      this.hls.off(events.MANIFEST_PARSED, this.onManifestParsed);
    } catch (e) {
    }
    this.hls = void 0;
    this.levelFragments.clear();
  }
  getCurrentLevelIndex() {
    return this.currentLevelIndex;
  }
  getIsLive() {
    return this.isLive;
  }
  getLastLoadingSn() {
    return this.lastLoadingSn;
  }
  /**
   * Find candidate upcoming fragments ahead of currentTime within the buffer window
   */
  getUpcomingFragments(currentTime, targetWindowSec, maxCount, levelOverride) {
    const level = levelOverride ?? this.currentLevelIndex;
    const frags = this.levelFragments.get(level);
    if (!frags || frags.length === 0) return [];
    const windowEnd = currentTime + targetWindowSec;
    const results = [];
    for (const frag of frags) {
      if (frag.end <= currentTime) {
        continue;
      }
      if (frag.start > windowEnd) {
        break;
      }
      results.push(frag);
      if (results.length >= maxCount) {
        break;
      }
    }
    return results;
  }
  /**
   * Find candidate upcoming fragments ahead of currentTime that need preloading,
   * skipping already cached/active ones so we can fill all available concurrency slots.
   */
  getUncachedCandidateFragments(currentTime, lookaheadSec, maxCount, isUncached) {
    if (this.levelFragments.size === 0) {
      this.syncLevels();
    }
    const level = this.currentLevelIndex;
    let frags = this.levelFragments.get(level);
    if (!frags || frags.length === 0) {
      frags = this.levelFragments.values().next().value;
    }
    if (!frags || frags.length === 0) return [];
    const windowEnd = currentTime + lookaheadSec;
    const results = [];
    for (const frag of frags) {
      if (frag.end <= currentTime) {
        continue;
      }
      if (frag.start > windowEnd) {
        break;
      }
      if (isUncached(frag)) {
        results.push(frag);
        if (results.length >= maxCount) {
          break;
        }
      }
    }
    return results;
  }
  /**
   * Find fragment info matching a sequence number
   */
  getFragmentBySn(level, sn) {
    const frags = this.levelFragments.get(level);
    if (!frags) return void 0;
    return frags.find((f) => f.sn === sn);
  }
  clear() {
    this.levelFragments.clear();
    this.lastLoadingSn = -1;
  }
};

// src/scheduler/priority-queue.ts
var TaskPriority = /* @__PURE__ */ ((TaskPriority2) => {
  TaskPriority2[TaskPriority2["CRITICAL"] = 0] = "CRITICAL";
  TaskPriority2[TaskPriority2["HIGH"] = 1] = "HIGH";
  TaskPriority2[TaskPriority2["NORMAL"] = 2] = "NORMAL";
  TaskPriority2[TaskPriority2["LOW"] = 3] = "LOW";
  return TaskPriority2;
})(TaskPriority || {});
var PriorityTaskQueue = class {
  constructor() {
    this.queue = [];
  }
  enqueue(task) {
    const index = this.queue.findIndex((item) => item.priority > task.priority);
    if (index === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(index, 0, task);
    }
  }
  dequeue() {
    return this.queue.shift();
  }
  peek() {
    return this.queue[0];
  }
  remove(id) {
    const idx = this.queue.findIndex((task) => task.id === id);
    if (idx !== -1) {
      const [task] = this.queue.splice(idx, 1);
      return task;
    }
    return void 0;
  }
  updatePriority(id, newPriority) {
    const task = this.remove(id);
    if (task) {
      task.priority = newPriority;
      this.enqueue(task);
      return true;
    }
    return false;
  }
  clear() {
    for (const task of this.queue) {
      task.abortController.abort();
    }
    this.queue = [];
  }
  size() {
    return this.queue.length;
  }
  getAll() {
    return [...this.queue];
  }
};

// src/scheduler/prefetch-scheduler.ts
var PrefetchScheduler = class {
  constructor(config, cache, networkMonitor, manifestObserver, recoveryManager, bufferManager) {
    this.queue = new PriorityTaskQueue();
    this.activeTasks = /* @__PURE__ */ new Map();
    this.config = config;
    this.cache = cache;
    this.networkMonitor = networkMonitor;
    this.manifestObserver = manifestObserver;
    this.recoveryManager = recoveryManager;
    this.bufferManager = bufferManager;
  }
  updateConfig(config) {
    this.config = config;
  }
  getActiveConcurrency() {
    return this.activeTasks.size;
  }
  getActiveTask(key) {
    return this.activeTasks.get(key);
  }
  /**
   * Fetch a segment with specified priority.
   * If already cached, returns immediately.
   * If already downloading, promotes priority and returns existing promise.
   */
  async loadSegment(frag, priority = 2 /* NORMAL */) {
    const key = this.cache.generateKey(frag.level, frag.sn, frag.url, frag.byteRange);
    const cached = this.cache.get(key);
    if (cached && cached.status === "completed" && cached.data) {
      return cached.data;
    }
    const active = this.activeTasks.get(key);
    if (active) {
      if (priority < active.priority) {
        active.priority = priority;
      }
      return active.promise;
    }
    return this.executeDownload(frag, key, priority);
  }
  /**
   * Main scheduler tick called on playback progression
   */
  tick(currentTime, videoPaused) {
    if (!this.config.enabled) return;
    this.cache.pruneConsumed(currentTime, 10);
    const { targetBuffer, concurrency } = this.bufferManager.evaluate();
    const currentBuffer = this.networkMonitor.getBufferLength();
    if (videoPaused && !this.config.backgroundPreload && currentBuffer >= 15) {
      return;
    }
    const maxHorizon = Math.max(targetBuffer, this.config.maxBufferLength);
    if (currentBuffer >= maxHorizon) {
      return;
    }
    const effectiveConcurrency = this.config.dynamicConcurrency ? concurrency : this.config.maxConcurrency;
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
      const priority = i === 0 ? 1 /* HIGH */ : 2 /* NORMAL */;
      const abortController = new AbortController();
      const task = {
        id: key,
        priority,
        sn: frag.sn,
        level: frag.level,
        startTime: frag.start,
        abortController,
        createdAt: Date.now(),
        execute: () => this.executeDownload(frag, key, priority, abortController)
      };
      this.queue.enqueue(task);
    }
    this.drainQueue(effectiveConcurrency);
  }
  /**
   * Handle Seek: cancel active tasks that fall out of the new buffer window
   */
  onSeek(newTime) {
    const targetBuffer = this.bufferManager.getTargetBufferLength();
    const windowEnd = newTime + targetBuffer + 10;
    this.queue.clear();
    for (const [key, active] of this.activeTasks.entries()) {
      const item = this.cache.get(key);
      if (item) {
        if (item.startTime + item.duration < newTime - 2 || item.startTime > windowEnd) {
          active.abortController.abort();
          this.activeTasks.delete(key);
          this.cache.remove(key);
        }
      }
    }
    this.cache.pruneConsumed(newTime, 5);
  }
  drainQueue(maxConcurrency) {
    while (this.activeTasks.size < maxConcurrency && this.queue.size() > 0) {
      const task = this.queue.dequeue();
      if (!task) break;
      if (this.activeTasks.has(task.id) || this.cache.has(task.id)) {
        continue;
      }
      task.execute().catch(() => {
      });
    }
  }
  async executeDownload(frag, key, priority, existingController) {
    const abortController = existingController || new AbortController();
    const cacheItem = {
      key,
      url: frag.url,
      sn: frag.sn,
      level: frag.level,
      startTime: frag.start,
      duration: frag.duration,
      quality: frag.level,
      size: 0,
      status: "loading",
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      byteRange: frag.byteRange,
      abortController
    };
    this.cache.put(cacheItem);
    const downloadPromise = (async () => {
      let attempts = 0;
      const maxRetries = this.config.autoRecovery ? this.config.maxRetries : 1;
      while (attempts < maxRetries) {
        const startTime = performance.now();
        let tfirst = 0;
        try {
          const headers = {};
          if (frag.byteRange) {
            headers["Range"] = `bytes=${frag.byteRange.start}-${frag.byteRange.end}`;
          }
          const response = await fetch(frag.url, {
            headers,
            signal: abortController.signal
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
          this.cache.markCompleted(key, arrayBuffer);
          this.networkMonitor.recordDownload(arrayBuffer.byteLength, durationMs, rttMs);
          this.recoveryManager.recordSuccess();
          return arrayBuffer;
        } catch (error) {
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
      promise: downloadPromise
    });
    try {
      const buffer = await downloadPromise;
      return buffer;
    } finally {
      this.activeTasks.delete(key);
      const effectiveConcurrency = this.config.dynamicConcurrency ? this.bufferManager.getEffectiveConcurrency() : this.config.maxConcurrency;
      this.drainQueue(effectiveConcurrency);
    }
  }
  clearAll() {
    this.queue.clear();
    for (const [key, active] of this.activeTasks.entries()) {
      active.abortController.abort();
      this.cache.remove(key);
    }
    this.activeTasks.clear();
  }
};

// src/abr/quality-controller.ts
var AdaptiveQualityController = class {
  // 8s cooldown between quality upgrades to avoid flapping
  constructor(config, networkMonitor, hls) {
    this.userManualLevel = -1;
    // -1 means auto
    this.lastSwitchTime = 0;
    this.switchCooldownMs = 8e3;
    this.config = config;
    this.networkMonitor = networkMonitor;
    this.hls = hls;
  }
  attachHls(hls) {
    this.hls = hls;
  }
  detachHls() {
    this.hls = void 0;
  }
  updateConfig(config) {
    this.config = config;
  }
  setUserManualLevel(levelIndex) {
    this.userManualLevel = levelIndex;
    if (this.hls) {
      this.hls.currentLevel = levelIndex;
    }
  }
  isManual() {
    return this.userManualLevel >= 0;
  }
  /**
   * Evaluate network conditions and adjust quality level if needed
   */
  evaluate() {
    if (!this.config.autoQuality || !this.config.enabled || !this.hls) {
      return;
    }
    if (this.userManualLevel >= 0) {
      return;
    }
    const levels = this.hls.levels;
    if (!levels || levels.length <= 1) return;
    const stats = this.networkMonitor.getStats();
    const bwMbps = stats.bandwidthEstimateMbps;
    const bufferLen = stats.bufferLength;
    if (bwMbps <= 0) return;
    const availableBwBps = bwMbps * 1e6 * this.config.qualitySafetyFactor;
    const currentLevelIndex = this.hls.currentLevel >= 0 ? this.hls.currentLevel : this.hls.loadLevel;
    const currentLevel = levels[currentLevelIndex] || levels[0];
    const currentBitrate = currentLevel.bitrate;
    const now = Date.now();
    if (bufferLen < 4 || currentBitrate > availableBwBps) {
      let targetIndex = 0;
      for (let i = levels.length - 1; i >= 0; i--) {
        if (levels[i].bitrate <= availableBwBps) {
          targetIndex = i;
          break;
        }
      }
      if (targetIndex < currentLevelIndex) {
        this.hls.nextLevel = targetIndex;
        this.lastSwitchTime = now;
        return;
      }
    }
    if (now - this.lastSwitchTime < this.switchCooldownMs) {
      return;
    }
    if (bufferLen > 12 && currentLevelIndex < levels.length - 1) {
      const nextLevel = levels[currentLevelIndex + 1];
      if (availableBwBps >= nextLevel.bitrate * 1.2) {
        this.hls.nextLevel = currentLevelIndex + 1;
        this.lastSwitchTime = now;
      }
    }
  }
  getCurrentQualityName() {
    if (!this.hls || !this.hls.levels || this.hls.levels.length === 0) {
      return "Auto";
    }
    const idx = this.hls.currentLevel >= 0 ? this.hls.currentLevel : this.hls.loadLevel;
    const lvl = this.hls.levels[idx];
    if (!lvl) return "Auto";
    if (lvl.height) {
      return `${lvl.height}P`;
    }
    if (lvl.name) {
      return lvl.name;
    }
    return `${Math.round(lvl.bitrate / 1e3)} Kbps`;
  }
};

// src/hls/smart-loader.ts
var import_hls2 = __toESM(require("hls.js"));
var globalEngineContext = {
  isEnabled: () => false
};
function setGlobalEngineContext(context) {
  globalEngineContext = context;
}
var DefaultLoaderClass = import_hls2.default.DefaultConfig?.loader || class {
};
var SmartFragmentLoader = class extends DefaultLoaderClass {
  constructor(config) {
    super(config);
    this.context = null;
    this.callbacks = null;
    this.stats = this.stats || {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 }
    };
  }
  abort() {
    if (typeof super.abort === "function") {
      super.abort();
    } else {
      this.stats.aborted = true;
      if (this.callbacks && this.callbacks.onAbort) {
        this.callbacks.onAbort(this.stats, this.context, null);
      }
    }
  }
  destroy() {
    if (typeof super.destroy === "function") {
      super.destroy();
    }
    this.callbacks = null;
    this.context = null;
  }
  load(context, config, callbacks) {
    this.context = context;
    this.callbacks = callbacks;
    const { frag, url } = context;
    if (!globalEngineContext.isEnabled() || !globalEngineContext.cache || !frag) {
      super.load(context, config, callbacks);
      return;
    }
    let byteRange;
    if (typeof frag.byteRangeStartOffset === "number" && typeof frag.byteRangeEndOffset === "number") {
      byteRange = {
        start: frag.byteRangeStartOffset,
        end: frag.byteRangeEndOffset - 1
      };
    }
    const key = globalEngineContext.cache.generateKey(frag.level, frag.sn, url, byteRange);
    const cached = globalEngineContext.cache.get(key);
    if (cached && cached.status === "completed" && cached.data) {
      const now = performance.now();
      this.stats.loading.start = now;
      this.stats.loading.first = now;
      this.stats.loading.end = now;
      this.stats.loaded = cached.size;
      this.stats.total = cached.size;
      const response = {
        url,
        data: cached.data.slice(0)
        // ALWAYS clone so worker transfer does not neuter cached buffer!
      };
      queueMicrotask(() => {
        if (!this.stats.aborted && this.callbacks?.onSuccess) {
          this.callbacks.onSuccess(response, this.stats, context, null);
        }
      });
      return;
    }
    const active = globalEngineContext.scheduler?.getActiveTask(key);
    if (active) {
      this.stats.loading.start = performance.now();
      active.promise.then((arrayBuffer) => {
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
              data: arrayBuffer.slice(0)
            },
            this.stats,
            context,
            null
          );
        }
      }).catch(() => {
        if (this.stats.aborted) return;
        super.load(context, config, callbacks);
      });
      return;
    }
    const wrappedCallbacks = {
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
            status: "completed",
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            byteRange
          });
          if (globalEngineContext.networkMonitor) {
            const duration = Math.max(1, stats.loading.end - stats.loading.start);
            let rttMs = 0;
            if (stats.loading && stats.loading.first > stats.loading.start) {
              rttMs = Math.max(1, stats.loading.first - stats.loading.start);
            } else if (stats.tfirst && stats.trequest && stats.tfirst > stats.trequest) {
              rttMs = Math.max(1, stats.tfirst - stats.trequest);
            }
            if (rttMs <= 0 && typeof performance !== "undefined" && performance.getEntriesByName) {
              const entries = performance.getEntriesByName(ctx.url);
              if (entries.length > 0) {
                const entry = entries[entries.length - 1];
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
      }
    };
    super.load(context, config, wrappedCallbacks);
  }
};

// src/hls/hls-adapter.ts
var HlsAdapter = class {
  constructor(config, cache, networkMonitor, recoveryManager, bufferManager) {
    this.pollTimer = null;
    this.videoListeners = [];
    this.onLevelSwitched = (event, data) => {
      if (typeof data.level === "number") {
        this.cache.purgeOtherLevels(data.level);
      }
    };
    this.onFragLoaded = (event, data) => {
      if (!data || !data.stats) return;
      const stats = data.stats;
      let rtt = 0;
      if (stats.loading && stats.loading.first > stats.loading.start) {
        rtt = Math.max(1, stats.loading.first - stats.loading.start);
      } else if (stats.tfirst && stats.trequest && stats.tfirst > stats.trequest) {
        rtt = Math.max(1, stats.tfirst - stats.trequest);
      }
      if (rtt <= 0 && data.frag && data.frag.url && typeof performance !== "undefined" && performance.getEntriesByName) {
        const entries = performance.getEntriesByName(data.frag.url);
        if (entries.length > 0) {
          const entry = entries[entries.length - 1];
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
    this.onHlsError = (event, data) => {
      if (!data) return;
      if (data.fatal) {
        switch (data.type) {
          case "networkError":
            this.networkMonitor.recordFailure();
            if (this.config.autoRecovery && this.hls) {
              console.warn("[SmartBuffer:HlsAdapter] Fatal network error encountered, attempting recovery...");
              this.hls.startLoad();
            }
            break;
          case "mediaError":
            if (this.config.autoRecovery && this.hls) {
              console.warn("[SmartBuffer:HlsAdapter] Fatal media error encountered, recovering media...");
              this.hls.recoverMediaError();
            }
            break;
          default:
            console.error("[SmartBuffer:HlsAdapter] Unrecoverable fatal error:", data);
            break;
        }
      }
    };
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
    setGlobalEngineContext({
      cache: this.cache,
      scheduler: this.scheduler,
      networkMonitor: this.networkMonitor,
      isEnabled: () => this.config.enabled
    });
  }
  updateConfig(config) {
    this.config = config;
    this.scheduler.updateConfig(config);
    this.qualityController.updateConfig(config);
    this.bufferManager.updateConfig(config);
    this.cache.setMaxCacheSizeMB(config.maxCacheSizeMB);
  }
  attach(hls, video) {
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
    const events = hls.constructor.Events || import_hls3.default.Events;
    hls.on(events.ERROR, this.onHlsError);
    hls.on(events.LEVEL_SWITCHED, this.onLevelSwitched);
    hls.on(events.FRAG_LOADED, this.onFragLoaded);
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
    this.addVideoListener("timeupdate", onTimeUpdate);
    this.addVideoListener("seeking", onSeeking);
    this.addVideoListener("seeked", onSeeked);
    this.addVideoListener("play", onPlay);
    this.pollTimer = setInterval(() => {
      this.onTick();
    }, 600);
  }
  detach() {
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
        const events = this.hls.constructor.Events || import_hls3.default.Events;
        this.hls.off(events.ERROR, this.onHlsError);
        this.hls.off(events.LEVEL_SWITCHED, this.onLevelSwitched);
        this.hls.off(events.FRAG_LOADED, this.onFragLoaded);
      } catch (e) {
      }
    }
    this.manifestObserver.detachHls();
    this.qualityController.detachHls();
    this.networkMonitor.detachVideo();
    this.scheduler.clearAll();
    this.hls = void 0;
    this.video = void 0;
  }
  addVideoListener(type, handler) {
    if (this.video) {
      this.video.addEventListener(type, handler);
      this.videoListeners.push({ type, handler });
    }
  }
  onTick() {
    if (!this.config.enabled || !this.video) return;
    if (this.manifestObserver.isEmpty() && this.hls) {
      this.manifestObserver.syncLevels(this.hls);
    }
    const currentTime = this.video.currentTime;
    const isPaused = this.video.paused;
    this.scheduler.tick(currentTime, isPaused);
    this.qualityController.evaluate();
  }
  getQualityController() {
    return this.qualityController;
  }
  getScheduler() {
    return this.scheduler;
  }
};

// src/mp4/mp4-engine.ts
var Mp4RangeEngine = class {
  constructor(config, networkMonitor, recoveryManager) {
    this.totalSize = 0;
    this.supportsRange = false;
    this.chunkSize = 2 * 1024 * 1024;
    // 2MB chunk default
    this.chunks = [];
    this.activeDownloads = /* @__PURE__ */ new Map();
    this.pollTimer = null;
    this.config = config;
    this.networkMonitor = networkMonitor;
    this.recoveryManager = recoveryManager;
  }
  updateConfig(config) {
    this.config = config;
  }
  /**
   * Probe whether the MP4 URL supports HTTP Range
   */
  async probeRangeSupport(url) {
    try {
      const res = await fetch(url, {
        method: "HEAD"
      });
      const acceptRanges = res.headers.get("accept-ranges");
      const contentLength = res.headers.get("content-length");
      if (contentLength) {
        this.totalSize = parseInt(contentLength, 10) || 0;
      }
      if (acceptRanges === "bytes" || this.totalSize > 0) {
        this.supportsRange = true;
        return true;
      }
      const rangeTest = await fetch(url, {
        headers: { Range: "bytes=0-1" }
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
  async attach(video, url) {
    this.detach();
    this.video = video;
    this.url = url;
    const isSupported = await this.probeRangeSupport(url);
    if (!isSupported || !this.config.enabled) {
      video.src = url;
      return false;
    }
    this.initChunks();
    this.startWorker();
    return true;
  }
  detach() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const controller of this.activeDownloads.values()) {
      controller.abort();
    }
    this.activeDownloads.clear();
    this.chunks = [];
    this.video = void 0;
    this.url = void 0;
  }
  initChunks() {
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
        status: "idle"
      });
      offset = end + 1;
      index++;
    }
  }
  startWorker() {
    this.pollTimer = setInterval(() => {
      this.scheduleNextChunks();
    }, 800);
  }
  scheduleNextChunks() {
    if (!this.config.enabled || !this.video || !this.url) return;
    const maxConcurrency = this.config.maxConcurrency;
    if (this.activeDownloads.size >= maxConcurrency) return;
    const idleChunks = this.chunks.filter((c) => c.status === "idle");
    for (const chunk of idleChunks) {
      if (this.activeDownloads.size >= maxConcurrency) break;
      this.downloadChunk(chunk);
    }
  }
  async downloadChunk(chunk) {
    if (!this.url) return;
    chunk.status = "downloading";
    const controller = new AbortController();
    chunk.abortController = controller;
    this.activeDownloads.set(chunk.index, controller);
    const startTime = performance.now();
    try {
      const startTime2 = performance.now();
      const res = await fetch(this.url, {
        headers: {
          Range: `bytes=${chunk.start}-${chunk.end}`
        },
        signal: controller.signal
      });
      const tfirst = performance.now();
      const rttMs = Math.max(1, tfirst - startTime2);
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buffer = await res.arrayBuffer();
      const durationMs = Math.max(1, performance.now() - startTime2);
      chunk.data = buffer;
      chunk.status = "completed";
      this.networkMonitor.recordDownload(buffer.byteLength, durationMs, rttMs);
      this.recoveryManager.recordSuccess();
    } catch (e) {
      if (controller.signal.aborted) {
        chunk.status = "idle";
      } else {
        chunk.status = "failed";
        this.networkMonitor.recordFailure();
        this.recoveryManager.recordFailure();
      }
    } finally {
      this.activeDownloads.delete(chunk.index);
    }
  }
  getChunksCount() {
    const total = this.chunks.length;
    const completed = this.chunks.filter((c) => c.status === "completed").length;
    const active = this.activeDownloads.size;
    return { total, completed, active };
  }
};

// src/ui/progress-bar-tracker.ts
var PROGRESS_STYLE_ID = "art-smart-buffer-progress-style";
function injectProgressStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PROGRESS_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PROGRESS_STYLE_ID;
  style.textContent = `
    /* \u6D45\u7EFF\u8272 Smart Buffer \u9884\u52A0\u8F7D\u5B89\u5168\u533A\u8FDB\u5EA6\u6761 */
    .art-video-player .art-control-progress-inner .art-progress-smart-preloaded,
    .art-video-player .art-progress .art-control-progress-inner .art-progress-smart-preloaded,
    .art-video-player .art-progress .art-progress-smart-preloaded {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      bottom: 0 !important;
      height: 100% !important;
      width: 0%;
      background: #4ade80 !important; /* \u6E05\u6670\u9C9C\u660E\u7684\u6D45\u7EFF\u8272 (Tailwind Green 400) */
      z-index: 15 !important; /* \u9AD8\u4E8E\u539F\u751F loaded (10)\uFF0C\u4F4E\u4E8E played (20) */
      pointer-events: none !important;
      border-radius: 2px;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 0 8px rgba(35, 158, 80, 0.7);
    }

    /* \u539F\u751F loaded \u7F13\u51B2\u6761\u5728 Smart Buffer \u6FC0\u6D3B\u65F6\u540C\u6B65\u8BBE\u4E3A\u6D45\u7EFF\u8272\uFF0C\u5F7B\u5E95\u544A\u522B\u6C89\u95F7\u7070\u8272 */
    .art-video-player.art-smart-buffer-enabled .art-progress-loaded {
      background-color: rgba(35, 158, 80, 0.5) !important;
    }
  `;
  document.head.appendChild(style);
}
var ProgressBarTracker = class {
  constructor(art, engine) {
    this.timer = null;
    this.art = art;
    this.engine = engine;
  }
  attach() {
    injectProgressStyles();
    const mount = () => {
      if (!this.art.template || !this.art.template.$progress) return;
      const progressEl = this.art.template.$progress;
      const inner = progressEl.querySelector(".art-control-progress-inner") || progressEl.querySelector('[class*="progress-inner"]') || progressEl.querySelector(".art-control-progress") || progressEl;
      if (!inner) return;
      let bar = inner.querySelector(".art-progress-smart-preloaded");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "art-progress-smart-preloaded";
        bar.title = "Smart Buffer \u9884\u52A0\u8F7D\u5B89\u5168\u533A";
        const playedEl = inner.querySelector(".art-progress-played");
        if (playedEl && playedEl.parentNode === inner) {
          inner.insertBefore(bar, playedEl);
        } else {
          inner.appendChild(bar);
        }
      }
      this.preloadBar = bar;
      if (this.art.template.$player) {
        this.art.template.$player.classList.add("art-smart-buffer-enabled");
      }
    };
    mount();
    this.art.on("ready", () => {
      mount();
      this.update();
    });
    this.art.on("video:loadedmetadata", () => {
      mount();
      this.update();
    });
    this.art.on("video:canplay", () => {
      mount();
      this.update();
    });
    this.timer = setInterval(() => {
      if (!this.preloadBar) {
        mount();
      }
      this.update();
    }, 250);
    this.art.on("video:timeupdate", () => this.update());
    this.art.on("video:progress", () => this.update());
  }
  update() {
    if (!this.preloadBar) {
      if (!this.art.template || !this.art.template.$progress) return;
      const inner = this.art.template.$progress.querySelector(".art-control-progress-inner") || this.art.template.$progress.querySelector('[class*="progress-inner"]') || this.art.template.$progress.querySelector(".art-control-progress") || this.art.template.$progress;
      this.preloadBar = inner?.querySelector(".art-progress-smart-preloaded");
      if (!this.preloadBar) return;
    }
    if (!this.engine.getConfig().enabled) {
      this.preloadBar.style.width = "0%";
      this.preloadBar.style.display = "none";
      if (this.art.template && this.art.template.$player) {
        this.art.template.$player.classList.remove("art-smart-buffer-enabled");
      }
      return;
    }
    this.preloadBar.style.display = "block";
    if (this.art.template && this.art.template.$player) {
      this.art.template.$player.classList.add("art-smart-buffer-enabled");
    }
    const video = this.art.video;
    if (!video) return;
    const duration = video.duration || this.art.duration || 0;
    if (!duration || duration <= 0 || isNaN(duration) || !isFinite(duration)) {
      this.preloadBar.style.width = "0%";
      return;
    }
    let maxBuffered = 0;
    if (video.buffered && video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (video.currentTime >= start - 1 && video.currentTime <= end + 1) {
          maxBuffered = Math.max(maxBuffered, end);
        } else if (end > maxBuffered && start <= video.currentTime + 60) {
          maxBuffered = Math.max(maxBuffered, end);
        }
      }
      if (maxBuffered === 0) {
        maxBuffered = video.buffered.end(video.buffered.length - 1);
      }
    }
    const maxCached = this.engine.segmentCache.getMaxCachedTime();
    const furthestPreload = Math.max(maxBuffered, maxCached);
    const pct = Math.min(100, Math.max(0, furthestPreload / duration * 100));
    this.preloadBar.style.width = `${pct.toFixed(2)}%`;
  }
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.art.template && this.art.template.$player) {
      this.art.template.$player.classList.remove("art-smart-buffer-enabled");
    }
    if (this.preloadBar && this.preloadBar.parentNode) {
      this.preloadBar.parentNode.removeChild(this.preloadBar);
    }
    this.preloadBar = void 0;
  }
};

// src/engine.ts
var SmartBufferEngine = class {
  constructor(options) {
    this.isDestroyed = false;
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
    this.configManager.subscribe((newConfig) => {
      this.onConfigChanged(newConfig);
    });
  }
  attachPlayer(art) {
    this.art = art;
    art.smartBufferEngine = this;
    if (art.video) {
      this.networkMonitor.attachVideo(art.video);
    }
    let currentHls = art.hls;
    if (currentHls && art.video) {
      this.hlsAdapter.attach(currentHls, art.video);
    }
    try {
      Object.defineProperty(art, "hls", {
        configurable: true,
        enumerable: true,
        get: () => currentHls,
        set: (newHls) => {
          currentHls = newHls;
          if (newHls && art.video) {
            this.hlsAdapter.attach(newHls, art.video);
          }
        }
      });
    } catch (e) {
    }
    art.on("video:loadedmetadata", () => {
      if (art.hls && art.video) {
        this.hlsAdapter.attach(art.hls, art.video);
      }
    });
    art.on("ready", () => {
      if (art.hls && art.video) {
        this.hlsAdapter.attach(art.hls, art.video);
      }
    });
    this.progressBarTracker = new ProgressBarTracker(art, this);
    this.progressBarTracker.attach();
    art.on("destroy", () => {
      this.destroy();
    });
  }
  attachHls(hls, video) {
    this.hlsAdapter.attach(hls, video);
  }
  updateConfig(patch) {
    return this.configManager.updateConfig(patch);
  }
  resetConfig() {
    return this.configManager.resetConfig();
  }
  getConfig() {
    return this.configManager.getConfig();
  }
  getStatus() {
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
      cacheSizeMB: `${this.segmentCache.getCacheSizeMB()} MB`
    };
  }
  onConfigChanged(newConfig) {
    this.hlsAdapter.updateConfig(newConfig);
    this.mp4Engine.updateConfig(newConfig);
    this.segmentCache.setMaxCacheSizeMB(newConfig.maxCacheSizeMB);
    if (!newConfig.enabled) {
      this.segmentCache.clear();
      this.hlsAdapter.getScheduler().clearAll();
    }
  }
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.progressBarTracker?.destroy();
    this.hlsAdapter.detach();
    this.mp4Engine.detach();
    this.networkMonitor.destroy();
    this.recoveryManager.destroy();
    this.segmentCache.clear();
    this.art = void 0;
  }
};

// src/ui/status-card.ts
var StatusCard = class {
  constructor(engine) {
    this.timer = null;
    this.engine = engine;
  }
  render() {
    const card = document.createElement("div");
    card.className = "art-smart-buffer-status-card";
    card.style.cssText = `
      padding: 8px 12px;
      font-size: 11px;
      line-height: 1.5;
      color: #e0e0e0;
      background: rgba(30, 31, 34, 0.96);
      border-radius: 6px;
      margin: 4px 6px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      user-select: none;
    `;
    this.container = card;
    this.update();
    this.timer = setInterval(() => {
      this.update();
    }, 800);
    return card;
  }
  update() {
    if (!this.container) return;
    const s = this.engine.getStatus();
    const isOnline = this.engine.recoveryManager.getIsOnline();
    const config = this.engine.getConfig();
    let concurrencyHtml = "";
    if (s.activeConcurrency > 0) {
      concurrencyHtml = `<span style="color:#ffb74d;">${s.activeConcurrency} / ${s.maxConcurrency} (\u52A0\u901F\u4E2D)</span>`;
    } else if (parseFloat(s.bufferLengthFormatted) >= (config.targetBufferLength || 30)) {
      concurrencyHtml = `<span style="color:#81c784;">0 / ${s.maxConcurrency} (\u5DF2\u8DB3\u989D\u5F85\u547D)</span>`;
    } else {
      concurrencyHtml = `<span style="color:#aaa;">0 / ${s.maxConcurrency} (\u5C31\u7EEA)</span>`;
    }
    this.container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:4px; margin-bottom:5px;">
        <span style="font-weight:600; color:#4fc3f7; font-size:12px;">Smart Buffer \u5B9E\u65F6\u76D1\u63A7</span>
        <span style="color:${isOnline ? "#81c784" : "#e57373"}; font-size:11px;">${isOnline ? "\u25CF \u5728\u7EBF" : "\u25CF \u79BB\u7EBF"}</span>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; font-size:11px;">
        <div>\u7F51\u7EDC\u8D28\u91CF: <span style="color:#ffb74d;">${s.networkQuality}</span></div>
        <div>\u5B9E\u65F6\u4E0B\u8F7D: <span style="color:#4fc3f7;">${s.downloadSpeedFormatted}</span></div>
        <div>\u9884\u4F30\u5E26\u5BBD: <span style="color:#ba68c8;">${s.bandwidthFormatted}</span></div>
        <div>\u54CD\u5E94\u5EF6\u8FDF: <span style="color:#fff;">${s.rttFormatted}</span></div>
        <div>\u6709\u6548\u7F13\u51B2: <span style="color:#81c784; font-weight:600;">${s.bufferLengthFormatted}</span></div>
        <div>\u9884\u8F7D\u5206\u7247: <span style="color:#fff;">${s.preloadedSegmentsCount} \u6BB5</span></div>
        <div>\u5E76\u53D1\u7EBF\u7A0B: ${concurrencyHtml}</div>
        <div>\u5F53\u524D\u753B\u8D28: <span style="color:#fff;">${s.currentQuality}</span></div>
        <div>\u5361\u987F\u7EDF\u8BA1: <span style="color:${s.rebufferCount > 0 ? "#e57373" : "#81c784"};">${s.rebufferCount} \u6B21 (${s.rebufferDurationFormatted})</span></div>
        <div>\u5360\u7528\u5185\u5B58: <span style="color:#aaa;">${s.cacheSizeMB}</span></div>
      </div>
    `;
  }
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.container = void 0;
  }
};

// src/ui/settings-panel.ts
var STYLE_ID = "art-smart-buffer-panel-style";
function injectCustomStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* \u4EC5\u9690\u85CF\u666E\u901A\u8BBE\u7F6E\u9879\u7684\u5197\u4F59\u5DE6\u4FA7\u56FE\u6807\u4EE5\u8282\u7701\u6A2A\u5411\u7A7A\u95F4\uFF0C\u4F46\u4FDD\u7559\u8FD4\u56DE\u4E0A\u4E00\u7EA7\u83DC\u5355 (art-setting-item-back) \u7684\u8FD4\u56DE\u7BAD\u5934 < \u56FE\u6807 */
    .art-video-player .art-settings .art-setting-panel .art-setting-item:not(.art-setting-item-back) .art-setting-item-left .art-setting-item-left-icon {
      display: none !important;
    }
    /* \u4E8C\u7EA7/\u4E09\u7EA7\u5B50\u83DC\u5355\u9876\u90E8\u7684\u8FD4\u56DE\u4E0A\u4E00\u7EA7\u83DC\u5355\uFF1A\u786E\u4FDD < \u56FE\u6807\u6E05\u6670\u53EF\u89C1\u5E76\u89C4\u8303\u5BF9\u9F50 */
    .art-video-player .art-settings .art-setting-panel .art-setting-item.art-setting-item-back .art-setting-item-left .art-setting-item-left-icon {
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      margin-right: 6px;
      cursor: pointer;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item.art-setting-item-back .art-setting-item-left .art-setting-item-left-icon svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item.art-setting-item-back {
      font-weight: 500;
      color: #fff;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item:not(.art-setting-item-back) .art-setting-item-left {
      margin-right: 12px;
      flex-shrink: 0;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-left .art-setting-item-left-text {
      font-size: 13px;
      white-space: nowrap;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-right .art-setting-item-right-tooltip {
      font-size: 12px;
      color: #4fc3f7;
      min-width: 48px;
      text-align: right;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-right input[type="range"] {
      width: 110px;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}
var SettingsPanel = class {
  constructor(art, engine) {
    this.art = art;
    this.engine = engine;
  }
  register() {
    injectCustomStyles();
    const config = this.engine.getConfig();
    this.statusCard = new StatusCard(this.engine);
    const getModeLabel = (mode) => {
      switch (mode) {
        case "default":
          return "\u9ED8\u8BA4 (Default)";
        case "weak-network":
          return "\u5F31\u7F51\u4F18\u5316 (Weak Net)";
        case "high-speed":
          return "\u9AD8\u901F\u7F51\u7EDC (High Speed)";
        case "stable":
          return "\u7A33\u5B9A\u4F18\u5148 (Stable)";
        case "custom":
          return "\u81EA\u5B9A\u4E49 (Custom)";
      }
    };
    const PANEL_WIDTH = 380;
    const settingConfig = {
      html: "\u667A\u80FD\u52A0\u8F7D (Smart Buffer)",
      name: "smartBuffer",
      width: PANEL_WIDTH,
      tooltip: config.enabled ? getModeLabel(config.mode) : "\u5DF2\u5173\u95ED",
      selector: [
        // 1. 插件总开关
        {
          html: "\u667A\u80FD\u52A0\u8F7D\u603B\u5F00\u5173",
          switch: config.enabled,
          onSwitch: (item) => {
            const next = !item.switch;
            this.engine.updateConfig({ enabled: next });
            this.updateMenuTooltip();
            if (this.art.notice) {
              this.art.notice.show = `\u667A\u80FD\u52A0\u8F7D: ${next ? "\u5DF2\u5F00\u542F" : "\u5DF2\u5173\u95ED"}`;
            }
            return next;
          }
        },
        // 2. 预置模式选择
        {
          html: "\u9884\u7F6E\u6A21\u5F0F\u9009\u62E9",
          width: PANEL_WIDTH,
          tooltip: getModeLabel(this.engine.getConfig().mode),
          onSelect: (item) => {
            const mode = item.mode;
            this.engine.updateConfig({ mode });
            this.updateMenuTooltip();
            if (this.art.notice) {
              this.art.notice.show = `\u5DF2\u5E94\u7528\u6A21\u5F0F: ${getModeLabel(mode)}`;
            }
            return getModeLabel(mode);
          },
          selector: [
            {
              html: "\u9ED8\u8BA4\u6A21\u5F0F (\u5747\u8861 4\u5E76\u53D1/30s\u7F13\u51B2)",
              mode: "default",
              default: config.mode === "default"
            },
            {
              html: "\u5F31\u7F51\u4F18\u5316 (\u591A\u7EBF\u7A0B\u52A0\u901F 8\u5E76\u53D1/60s\u7F13\u51B2)",
              mode: "weak-network",
              default: config.mode === "weak-network"
            },
            {
              html: "\u9AD8\u901F\u7F51\u7EDC (\u6FC0\u8FDB 6\u5E76\u53D1/30s\u7F13\u51B2)",
              mode: "high-speed",
              default: config.mode === "high-speed"
            },
            {
              html: "\u7A33\u5B9A\u4F18\u5148 (\u5145\u8DB3 6\u5E76\u53D1/80s\u7F13\u51B2)",
              mode: "stable",
              default: config.mode === "stable"
            }
          ]
        },
        // 4. 自定义高级参数
        {
          html: "\u9AD8\u7EA7\u53C2\u6570\u8BBE\u7F6E",
          width: PANEL_WIDTH,
          selector: [
            {
              html: "\u6700\u5927\u5E76\u53D1\u4E0B\u8F7D\u6570",
              tooltip: `${this.engine.getConfig().maxConcurrency} \u7EBF\u7A0B`,
              range: [this.engine.getConfig().maxConcurrency, 1, 8, 1],
              onChange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxConcurrency: val });
                return `${val} \u7EBF\u7A0B`;
              },
              onRange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxConcurrency: val });
                if (this.art.notice) {
                  this.art.notice.show = `\u6700\u5927\u5E76\u53D1\u6570\u5DF2\u8BBE\u4E3A: ${val} \u7EBF\u7A0B`;
                }
                return `${val} \u7EBF\u7A0B`;
              }
            },
            {
              html: "\u76EE\u6807\u7F13\u51B2\u65F6\u95F4",
              tooltip: `${this.engine.getConfig().targetBufferLength} \u79D2`,
              range: [this.engine.getConfig().targetBufferLength, 10, 100, 5],
              onChange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ targetBufferLength: val });
                return `${val} \u79D2`;
              },
              onRange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ targetBufferLength: val });
                if (this.art.notice) {
                  this.art.notice.show = `\u76EE\u6807\u7F13\u51B2\u65F6\u95F4\u5DF2\u8BBE\u4E3A: ${val} \u79D2`;
                }
                return `${val} \u79D2`;
              }
            },
            {
              html: "\u6700\u5927\u9884\u52A0\u8F7D\u5206\u7247\u6570",
              tooltip: `${this.engine.getConfig().maxPreloadSegments} \u6BB5`,
              range: [this.engine.getConfig().maxPreloadSegments, 1, 20, 1],
              onChange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxPreloadSegments: val });
                return `${val} \u6BB5`;
              },
              onRange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxPreloadSegments: val });
                if (this.art.notice) {
                  this.art.notice.show = `\u6700\u5927\u9884\u52A0\u8F7D\u5206\u7247\u5DF2\u8BBE\u4E3A: ${val} \u6BB5`;
                }
                return `${val} \u6BB5`;
              }
            },
            {
              html: "\u6700\u5927\u7F13\u5B58\u5185\u5B58",
              tooltip: `${this.engine.getConfig().maxCacheSizeMB} MB`,
              range: [this.engine.getConfig().maxCacheSizeMB, 30, 300, 10],
              onChange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxCacheSizeMB: val });
                return `${val} MB`;
              },
              onRange: (item) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxCacheSizeMB: val });
                if (this.art.notice) {
                  this.art.notice.show = `\u6700\u5927\u7F13\u5B58\u5BB9\u91CF\u5DF2\u8BBE\u4E3A: ${val} MB`;
                }
                return `${val} MB`;
              }
            },
            {
              html: "\u81EA\u9002\u5E94\u7F51\u7EDC\u753B\u8D28\u5207\u6362",
              switch: this.engine.getConfig().autoQuality,
              onSwitch: (item) => {
                const next = !item.switch;
                this.engine.updateConfig({ autoQuality: next });
                if (this.art.notice) {
                  this.art.notice.show = `\u81EA\u9002\u5E94\u753B\u8D28: ${next ? "\u5DF2\u5F00\u542F" : "\u5DF2\u5173\u95ED"}`;
                }
                return next;
              }
            },
            {
              html: "\u5F31\u7F51\u52A8\u6001\u964D\u4F4E\u5E76\u53D1",
              switch: this.engine.getConfig().dynamicConcurrency,
              onSwitch: (item) => {
                const next = !item.switch;
                this.engine.updateConfig({ dynamicConcurrency: next });
                if (this.art.notice) {
                  this.art.notice.show = `\u5F31\u7F51\u52A8\u6001\u5E76\u53D1: ${next ? "\u5DF2\u5F00\u542F" : "\u5DF2\u5173\u95ED"}`;
                }
                return next;
              }
            },
            {
              html: "\u7F51\u7EDC\u5F02\u5E38\u81EA\u52A8\u91CD\u8BD5\u4E0E\u6062\u590D",
              switch: this.engine.getConfig().autoRecovery,
              onSwitch: (item) => {
                const next = !item.switch;
                this.engine.updateConfig({ autoRecovery: next });
                if (this.art.notice) {
                  this.art.notice.show = `\u5F02\u5E38\u81EA\u52A8\u91CD\u8BD5: ${next ? "\u5DF2\u5F00\u542F" : "\u5DF2\u5173\u95ED"}`;
                }
                return next;
              }
            },
            {
              html: "\u6062\u590D\u5B89\u5168\u9ED8\u8BA4\u8BBE\u7F6E",
              onClick: () => {
                this.engine.resetConfig();
                if (this.art.notice) {
                  this.art.notice.show = "Smart Buffer \u5DF2\u6062\u590D\u9ED8\u8BA4\u53C2\u6570";
                }
                this.updateMenuTooltip();
              }
            }
          ]
        }
      ]
    };
    this.art.setting.add(settingConfig);
  }
  updateMenuTooltip() {
    const cfg = this.engine.getConfig();
    const tooltip = cfg.enabled ? cfg.mode : "\u5DF2\u5173\u95ED";
    this.art.setting.update({
      name: "smartBuffer",
      tooltip
    });
  }
  destroy() {
    this.statusCard?.destroy();
  }
};

// src/ui/status-control.ts
var STYLE_ID2 = "art-smart-buffer-control-style";
function injectControlStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID2)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID2;
  style.textContent = `
    /* \u63A7\u5236\u680F\u4E2D\u7684 Smart Buffer \u76D1\u63A7\u6309\u94AE\u5BB9\u5668\uFF1A\u4E0E .art-control-setting \u4FDD\u6301 100% \u76F8\u540C\u7684\u9AD8\u5EA6\u548C flex \u5C45\u4E2D\u57FA\u51C6\u7EBF */
    .art-video-player .art-control-smartBufferStatus {
      position: relative !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      height: 100% !important;
      min-height: var(--art-control-height, 46px) !important;
      min-width: 40px !important;
      cursor: pointer;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
    }

    /* \u5F7B\u5E95\u7981\u7528\u4EFB\u4F55\u539F\u751F\u4E0E hint.css \u63D0\u793A\u6846\uFF0C\u9F20\u6807\u60AC\u505C\u76F4\u63A5\u89E6\u53D1\u5B9E\u65F6\u9762\u677F\uFF0C\u675C\u7EDD\u591A\u4F59\u7684 tooltip \u91CD\u53E0\u5E72\u6270 */
    .art-video-player .art-control-smartBufferStatus:before,
    .art-video-player .art-control-smartBufferStatus:after,
    .art-video-player .art-smart-buffer-btn-wrapper:before,
    .art-video-player .art-smart-buffer-btn-wrapper:after {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
    }

    /* \u6309\u94AE\u81EA\u8EAB\u5305\u88C5\u5668\uFF1A\u5168\u9AD8\u5EA6\u5782\u76F4\u6C34\u5E73\u5C45\u4E2D */
    .art-smart-buffer-btn-wrapper {
      position: relative;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 100% !important;
      height: 100% !important;
      line-height: 1 !important;
    }

    /* \u56FE\u6807\u5BB9\u5668\uFF1A\u7CBE\u786E 22x22px\uFF0C\u4E0E .art-control-setting \u7684 22x22 svg \u5C3A\u5BF8\u5B8C\u5168\u4E00\u81F4\uFF0C\u675C\u7EDD scale \u53D8\u5F62\u4E0E\u4F4D\u79FB */
    .art-smart-buffer-svg-icon {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 22px !important;
      height: 22px !important;
      line-height: 1 !important;
      box-sizing: border-box !important;
    }

    /* \u4FDD\u8BC1 SVG \u63CF\u8FB9\u663E\u793A\uFF0C\u7EDD\u5BF9\u4E0D\u88AB ArtPlayer \u7684 svg { fill: #fff } \u6E32\u67D3\u6210\u767D\u8272\u534A\u5706\u5B9E\u5FC3\u9762\u7599\u7629 */
    .art-smart-buffer-svg-icon svg {
      display: block !important;
      width: 22px !important;
      height: 22px !important;
      fill: none !important;
      stroke: currentColor !important;
    }

    .art-smart-buffer-svg-icon svg path,
    .art-smart-buffer-svg-icon svg line {
      fill: none !important;
      stroke: currentColor !important;
    }

    .art-smart-buffer-svg-icon svg circle {
      fill: currentColor !important;
      stroke: none !important;
    }

    /* \u8FD0\u884C\u6307\u793A\u7EFF\u70B9\uFF1A\u4F4D\u4E8E\u56FE\u6807\u53F3\u4E0A\u65B9 */
    .art-smart-buffer-pulse-dot {
      position: absolute;
      top: 10px;
      right: 7px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #4ade80;
      box-shadow: 0 0 5px #4ade80;
      pointer-events: none;
      transition: background-color 0.3s ease;
    }

    /* \u60AC\u6D6E/\u70B9\u51FB\u5F39\u51FA\u7684 Smart Buffer \u5B9E\u65F6\u6027\u80FD\u76D1\u63A7\u5361\u7247 */
    .art-smart-buffer-popup-panel {
      position: absolute;
      bottom: calc(100% + 14px);
      right: 0px; /* \u7D27\u8D34\u6309\u94AE\u53F3\u8FB9\u7F18\u5BF9\u9F50\uFF0C\u9884\u7559\u53F3\u4FA7\u8BBE\u7F6E\u4E0E\u5168\u5C4F\u6309\u94AE\u95F4\u8DDD\uFF0C100% \u675C\u7EDD\u8D85\u51FA\u64AD\u653E\u5668\u53F3\u8FB9\u754C */
      width: 340px;
      max-width: calc(100vw - 32px);
      background: rgba(22, 23, 27, 0.96);
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75);
      padding: 12px 14px;
      z-index: 100 !important;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px) scale(0.98);
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.2s;
      user-select: none;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    /* \u5E95\u90E8\u6307\u5411\u63A7\u5236\u6309\u94AE\u7684\u5C0F\u4E09\u89D2\u6307\u793A\u7BAD\u5934\uFF1A\u5BF9\u9F50\u6309\u94AE\u4E2D\u5FC3\uFF08\u6309\u94AE\u5BBD\u7EA6 40px\uFF0C\u4E2D\u5FC3\u8DDD\u53F3\u8FB9\u7F18 20px\uFF09 */
    .art-smart-buffer-popup-panel::after {
      content: '';
      position: absolute;
      bottom: -6px;
      right: 14px; /* 20px - 6px = 14px\uFF0C\u7CBE\u51C6\u6B63\u5BF9\u6309\u94AE\u4E2D\u5FC3 */
      width: 11px;
      height: 11px;
      background: rgba(22, 23, 27, 0.96);
      border-right: 1px solid rgba(255, 255, 255, 0.16);
      border-bottom: 1px solid rgba(255, 255, 255, 0.16);
      transform: rotate(45deg);
    }

    /* \u9F20\u6807\u60AC\u505C\u663E\u793A\uFF0C\u6216\u70B9\u51FB\u5E38\u5F00\uFF08.art-smart-buffer-open\uFF09 */
    .art-video-player .art-control-smartBufferStatus:hover .art-smart-buffer-popup-panel,
    .art-video-player .art-control-smartBufferStatus.art-smart-buffer-open .art-smart-buffer-popup-panel {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translateY(0) scale(1) !important;
      pointer-events: auto !important;
    }
  `;
  document.head.appendChild(style);
}
var StatusControl = class {
  constructor(art, engine) {
    this.timer = null;
    this.isOpen = false;
    this.onDocumentClick = (e) => {
      if (!this.controlEl) return;
      if (!this.controlEl.contains(e.target)) {
        this.close();
      }
    };
    this.art = art;
    this.engine = engine;
  }
  register() {
    injectControlStyles();
    this.art.controls.add({
      name: "smartBufferStatus",
      position: "right",
      index: 25,
      // 位于设置按钮（index: 30）左侧，与设置按钮严格处于同一直线
      html: `
        <div class="art-smart-buffer-btn-wrapper">
          <div class="art-smart-buffer-svg-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" style="display:block; width:22px; height:22px; fill:none!important; stroke:currentColor!important;">
              <path d="M 4.9 17.1 A 8 8 0 1 1 17.1 17.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="fill:none!important; stroke:currentColor!important; stroke-width:2!important; stroke-linecap:round!important;"/>
              <line x1="11" y1="12.5" x2="15.5" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="fill:none!important; stroke:currentColor!important; stroke-width:2!important; stroke-linecap:round!important;"/>
              <circle cx="11" cy="12.5" r="1.8" fill="currentColor" stroke="none" style="fill:currentColor!important; stroke:none!important;"/>
            </svg>
          </div>
          <span class="art-smart-buffer-pulse-dot"></span>
        </div>
      `,
      click: (component, event) => {
        event.stopPropagation();
        this.toggle();
      },
      mounted: (el) => {
        this.controlEl = el;
        this.btnWrapper = el.querySelector(".art-smart-buffer-btn-wrapper");
        this.mountPopup(el);
      }
    });
    if (typeof document !== "undefined") {
      document.addEventListener("click", this.onDocumentClick);
    }
  }
  mountPopup(controlEl) {
    if (this.popupEl) return;
    const popup = document.createElement("div");
    popup.className = "art-smart-buffer-popup-panel";
    popup.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    controlEl.appendChild(popup);
    this.popupEl = popup;
    this.update();
    this.timer = setInterval(() => {
      this.update();
    }, 800);
  }
  toggle() {
    if (!this.controlEl) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.controlEl.classList.add("art-smart-buffer-open");
    } else {
      this.controlEl.classList.remove("art-smart-buffer-open");
    }
  }
  close() {
    if (!this.controlEl) return;
    this.isOpen = false;
    this.controlEl.classList.remove("art-smart-buffer-open");
  }
  update() {
    if (!this.popupEl) return;
    const config = this.engine.getConfig();
    const s = this.engine.getStatus();
    const isOnline = this.engine.recoveryManager.getIsOnline();
    if (this.controlEl) {
      const dot = this.controlEl.querySelector(".art-smart-buffer-pulse-dot");
      if (dot) {
        if (!config.enabled) {
          dot.style.backgroundColor = "#757575";
          dot.style.boxShadow = "none";
        } else {
          dot.style.backgroundColor = isOnline ? "#4ade80" : "#ef5350";
          dot.style.boxShadow = isOnline ? "0 0 6px #4ade80" : "0 0 6px #ef5350";
        }
      }
      if (!config.showNetworkStatus) {
        this.controlEl.style.display = "none";
        return;
      } else {
        this.controlEl.style.display = "flex";
      }
    }
    let concurrencyHtml = "";
    if (s.activeConcurrency > 0) {
      concurrencyHtml = `<span style="color:#ffb74d; font-weight:600;">${s.activeConcurrency} / ${s.maxConcurrency} <small style="color:#4fc3f7; font-weight:normal;">(\u52A0\u901F\u4E2D)</small></span>`;
    } else if (parseFloat(s.bufferLengthFormatted) >= (config.targetBufferLength || 30)) {
      concurrencyHtml = `<span style="color:#4ade80; font-weight:600;">0 / ${s.maxConcurrency} <small style="color:#81c784; font-weight:normal;">(\u5DF2\u8DB3\u989D\u5F85\u547D)</small></span>`;
    } else {
      concurrencyHtml = `<span style="color:#aaa; font-weight:600;">0 / ${s.maxConcurrency} <small style="color:#888; font-weight:normal;">(\u5C31\u7EEA)</small></span>`;
    }
    this.popupEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px; margin-bottom:8px;">
        <span style="font-weight:600; color:#4fc3f7; font-size:13px; display:flex; align-items:center; gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 22 22" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block; width:16px; height:16px; fill:none!important; stroke:#4fc3f7!important;">
            <path d="M 4.9 17.1 A 8 8 0 1 1 17.1 17.1" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" style="fill:none!important; stroke:#4fc3f7!important; stroke-width:2!important;"/>
            <line x1="11" y1="12.5" x2="15.5" y2="8" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" style="fill:none!important; stroke:#4fc3f7!important; stroke-width:2!important;"/>
            <circle cx="11" cy="12.5" r="1.8" fill="#4fc3f7" stroke="none" style="fill:#4fc3f7!important; stroke:none!important;"/>
          </svg>
          Smart Buffer \u5B9E\u65F6\u76D1\u63A7
        </span>
        <span style="color:${isOnline ? "#4ade80" : "#ef5350"}; font-size:11px; font-weight:500;">
          ${isOnline ? "\u25CF \u5728\u7EBF" : "\u25CF \u79BB\u7EBF"}
        </span>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size:12px; line-height:1.5;">
        <div>\u7F51\u7EDC\u8D28\u91CF: <span style="color:#ffb74d; font-weight:500;">${s.networkQuality}</span></div>
        <div>\u5B9E\u65F6\u4E0B\u8F7D: <span style="color:#4fc3f7; font-weight:600;">${s.downloadSpeedFormatted}</span></div>
        <div>\u9884\u4F30\u5E26\u5BBD: <span style="color:#ba68c8; font-weight:600;">${s.bandwidthFormatted}</span></div>
        <div>\u54CD\u5E94\u5EF6\u8FDF: <span style="color:#fff;">${s.rttFormatted}</span></div>
        <div>\u6709\u6548\u7F13\u51B2: <span style="color:#4ade80; font-weight:600;">${s.bufferLengthFormatted}</span></div>
        <div>\u9884\u8F7D\u5206\u7247: <span style="color:#fff; font-weight:600;">${s.preloadedSegmentsCount} \u6BB5</span></div>
        <div>\u5E76\u53D1\u7EBF\u7A0B: ${concurrencyHtml}</div>
        <div>\u5F53\u524D\u753B\u8D28: <span style="color:#fff;">${s.currentQuality}</span></div>
        <div>\u5361\u987F\u7EDF\u8BA1: <span style="color:${s.rebufferCount > 0 ? "#ef5350" : "#4ade80"};">${s.rebufferCount} \u6B21 (${s.rebufferDurationFormatted})</span></div>
        <div>\u5360\u7528\u5185\u5B58: <span style="color:#aaa;">${s.cacheSizeMB}</span></div>
      </div>

      <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06); font-size:11px; color:#888; display:flex; justify-content:space-between; align-items:center;">
        <span>\u6A21\u5F0F: <b style="color:#e0e0e0;">${config.mode}</b></span>
        <span style="color:#4fc3f7; cursor:pointer;" title="${this.isOpen ? "\u70B9\u51FB\u5DF2\u9501\u5B9A\u4FDD\u6301\u663E\u793A" : "\u70B9\u51FB\u56FE\u6807\u53EF\u9501\u5B9A\u9762\u677F"}">
          ${this.isOpen ? "\u{1F4CC} \u5DF2\u56FA\u5B9A\u663E\u793A" : "\u{1F4CC} \u70B9\u51FB\u53EF\u56FA\u5B9A"}
        </span>
      </div>
      <div style="margin-top:4px; font-size:10px; color:#777; line-height:1.4; word-break:break-word; white-space:normal;">
        * \u7F13\u51B2\u5145\u8DB3\u65F6\u7EBF\u7A0B\u81EA\u52A8\u5F85\u547D\uFF1B\u8FDB\u5EA6\u8DF3\u8F6C\u6216\u7F13\u51B2\u6D88\u8017\u65F6\u5168\u901F\u5E76\u53D1\u3002
      </div>
    `;
  }
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("click", this.onDocumentClick);
    }
    if (this.popupEl && this.popupEl.parentNode) {
      this.popupEl.parentNode.removeChild(this.popupEl);
    }
    this.popupEl = void 0;
    this.controlEl = void 0;
    this.btnWrapper = void 0;
  }
};

// src/index.ts
function artplayerPluginSmartBuffer(options) {
  return (art) => {
    const engine = new SmartBufferEngine(options);
    const settingsPanel = new SettingsPanel(art, engine);
    const statusControl = new StatusControl(art, engine);
    engine.attachPlayer(art);
    settingsPanel.register();
    statusControl.register();
    art.on("destroy", () => {
      statusControl.destroy();
      settingsPanel.destroy();
      engine.destroy();
    });
    const instance = {
      name: "artplayerPluginSmartBuffer",
      version: "1.0.0",
      get config() {
        return engine.getConfig();
      },
      engine,
      updateConfig: (patch) => engine.updateConfig(patch),
      resetConfig: () => engine.resetConfig(),
      getStatus: () => engine.getStatus(),
      destroy: () => {
        statusControl.destroy();
        settingsPanel.destroy();
        engine.destroy();
      }
    };
    return instance;
  };
}
artplayerPluginSmartBuffer.createHlsCustomType = function(HlsClass, customConfig) {
  return function(video, url, art) {
    const HlsConstructor = HlsClass || window.Hls;
    if (HlsConstructor && HlsConstructor.isSupported()) {
      if (art.hls) {
        art.hls.destroy();
      }
      const hlsConfig = {
        fLoader: SmartFragmentLoader,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        ...customConfig
      };
      const hls = new HlsConstructor(hlsConfig);
      hls.loadSource(url);
      hls.attachMedia(video);
      art.hls = hls;
      if (art.smartBufferEngine) {
        art.smartBufferEngine.attachHls(hls, video);
      }
      art.on("destroy", () => {
        hls.destroy();
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    } else {
      art.notice.show = "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u64AD\u653E M3U8 \u683C\u5F0F\u89C6\u9891";
    }
  };
};
var createHlsCustomType = artplayerPluginSmartBuffer.createHlsCustomType;
var index_default = artplayerPluginSmartBuffer;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AdaptiveQualityController,
  ConfigManager,
  DEFAULT_CONFIG,
  DynamicBufferManager,
  HlsAdapter,
  ManifestObserver,
  Mp4RangeEngine,
  NetworkMonitor,
  PRESET_CONFIGS,
  PrefetchScheduler,
  PriorityTaskQueue,
  ProgressBarTracker,
  RTTDetector,
  RecoveryManager,
  SegmentCache,
  SettingsPanel,
  SmartBufferEngine,
  SmartFragmentLoader,
  StatusCard,
  StatusControl,
  TaskPriority,
  ThroughputDetector,
  artplayerPluginSmartBuffer,
  createHlsCustomType,
  setGlobalEngineContext
});
//# sourceMappingURL=index.js.map