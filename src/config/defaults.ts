import { SmartBufferConfig, PresetMode } from '../types';

export const DEFAULT_CONFIG: SmartBufferConfig = {
  enabled: true,
  mode: 'default',
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
  showNetworkStatus: true,
  withCredentials: false,
};

export const PRESET_CONFIGS: Record<Exclude<PresetMode, 'custom'>, Partial<SmartBufferConfig>> = {
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
    dynamicConcurrency: true,
  },

  // 弱网/极弱网优化模式：类似 IDM 多线程加速，激进开启 6~8 线程并发抢占带宽，缓冲深度提升至 60~120秒构建超深安全区
  'weak-network': {
    minConcurrency: 4,
    maxConcurrency: 8,
    targetBufferLength: 60,
    maxBufferLength: 120,
    maxPreloadSegments: 12,
    maxCacheSizeMB: 300,
    autoQuality: true,
    qualitySafetyFactor: 0.65,
    dynamicConcurrency: false, // 弱网下全力打满并发，不随意被算法降级
  },

  // 高速网络模式：适合大带宽光纤网络，追求秒开与瞬时跳转
  'high-speed': {
    minConcurrency: 3,
    maxConcurrency: 6,
    targetBufferLength: 30,
    maxBufferLength: 90,
    maxPreloadSegments: 8,
    maxCacheSizeMB: 200,
    autoQuality: true,
    qualitySafetyFactor: 0.85,
    dynamicConcurrency: true,
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
    qualitySafetyFactor: 0.70,
    dynamicConcurrency: false,
  },
};
