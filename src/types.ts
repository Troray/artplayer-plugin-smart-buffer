import type Artplayer from 'artplayer';
import type Hls from 'hls.js';

export type PresetMode = 'default' | 'weak-network' | 'high-speed' | 'stable' | 'custom';

export type NetworkQuality = 'extreme-poor' | 'poor' | 'fair' | 'good' | 'excellent';

export interface SmartBufferConfig {
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

export interface SegmentCacheItem {
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
  byteRange?: { start: number; end: number };
  abortController?: AbortController;
  promise?: Promise<ArrayBuffer>;
}

export interface NetworkStats {
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

export interface EngineStatus {
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

export interface PluginOptions extends Partial<SmartBufferConfig> {
  /** 自定义存储 key */
  storageKey?: string;
  /** 是否在控制台打印调试日志 */
  debug?: boolean;
}

export interface SmartBufferPluginInstance {
  name: string;
  version: string;
  config: SmartBufferConfig;
  engine: any;
  updateConfig: (patch: Partial<SmartBufferConfig>) => void;
  resetConfig: () => void;
  getStatus: () => EngineStatus;
  destroy: () => void;
}
