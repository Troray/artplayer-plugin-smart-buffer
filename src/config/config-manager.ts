import { SmartBufferConfig, PresetMode, PluginOptions } from '../types';
import { DEFAULT_CONFIG, PRESET_CONFIGS } from './defaults';

const STORAGE_VERSION = 'v1';
const DEFAULT_STORAGE_KEY = `artplayer_smart_buffer_${STORAGE_VERSION}`;

export type ConfigChangeListener = (config: SmartBufferConfig, changedKeys: Array<keyof SmartBufferConfig>) => void;

export class ConfigManager {
  private config: SmartBufferConfig;
  private storageKey: string;
  private listeners: Set<ConfigChangeListener> = new Set();

  constructor(options?: PluginOptions) {
    this.storageKey = options?.storageKey || DEFAULT_STORAGE_KEY;
    this.config = this.loadConfig(options);
  }

  public getConfig(): Readonly<SmartBufferConfig> {
    return { ...this.config };
  }

  public updateConfig(patch: Partial<SmartBufferConfig>, save = true): SmartBufferConfig {
    const prev = { ...this.config };
    const changedKeys: Array<keyof SmartBufferConfig> = [];

    // If changing mode to a preset (not custom), load preset values
    if (patch.mode && patch.mode !== 'custom' && patch.mode !== this.config.mode) {
      const presetValues = PRESET_CONFIGS[patch.mode];
      if (presetValues) {
        Object.assign(patch, presetValues);
      }
    } else if (!patch.mode) {
      // If user modified any preset-related parameter manually, mark mode as 'custom'
      const isParamModified = Object.keys(patch).some(
        (key) => key !== 'mode' && key !== 'enabled' && key !== 'showNetworkStatus'
      );
      if (isParamModified && this.config.mode !== 'custom') {
        patch.mode = 'custom';
      }
    }

    const next = { ...this.config, ...patch };
    const validated = this.validateAndSanitize(next);

    for (const key of Object.keys(validated) as Array<keyof SmartBufferConfig>) {
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

  public resetConfig(): SmartBufferConfig {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig();
    this.notifyListeners(Object.keys(DEFAULT_CONFIG) as Array<keyof SmartBufferConfig>);
    return this.getConfig();
  }

  public subscribe(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(changedKeys: Array<keyof SmartBufferConfig>): void {
    const current = this.getConfig();
    for (const listener of this.listeners) {
      try {
        listener(current, changedKeys);
      } catch (err) {
        console.error('[SmartBuffer:ConfigManager] Error in config listener:', err);
      }
    }
  }

  private validateAndSanitize(cfg: SmartBufferConfig): SmartBufferConfig {
    const sanitized: SmartBufferConfig = { ...cfg };

    sanitized.enabled = Boolean(cfg.enabled);

    const validModes: PresetMode[] = ['default', 'weak-network', 'high-speed', 'stable', 'custom'];
    sanitized.mode = validModes.includes(cfg.mode) ? cfg.mode : 'default';

    sanitized.minConcurrency = Math.max(1, Math.min(4, Math.floor(cfg.minConcurrency || 1)));
    sanitized.maxConcurrency = Math.max(sanitized.minConcurrency, Math.min(8, Math.floor(cfg.maxConcurrency || 3)));

    sanitized.targetBufferLength = Math.max(5, Math.min(120, Math.floor(cfg.targetBufferLength || 20)));
    sanitized.maxBufferLength = Math.max(
      sanitized.targetBufferLength,
      Math.min(300, Math.floor(cfg.maxBufferLength || 60))
    );

    sanitized.maxPreloadSegments = Math.max(1, Math.min(12, Math.floor(cfg.maxPreloadSegments || 4)));
    sanitized.maxCacheSizeMB = Math.max(20, Math.min(1000, Math.floor(cfg.maxCacheSizeMB || 100)));

    sanitized.autoQuality = Boolean(cfg.autoQuality);
    sanitized.qualitySafetyFactor = Math.max(0.3, Math.min(1.0, Number(cfg.qualitySafetyFactor) || 0.75));

    sanitized.autoRecovery = Boolean(cfg.autoRecovery);
    sanitized.maxRetries = Math.max(1, Math.min(20, Math.floor(cfg.maxRetries || 5)));

    sanitized.dynamicConcurrency = Boolean(cfg.dynamicConcurrency);
    sanitized.backgroundPreload = Boolean(cfg.backgroundPreload);
    sanitized.showNetworkStatus = Boolean(cfg.showNetworkStatus);

    return sanitized;
  }

  private loadConfig(options?: PluginOptions): SmartBufferConfig {
    let stored: Partial<SmartBufferConfig> = {};

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          stored = JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn('[SmartBuffer:ConfigManager] Failed to read localStorage:', e);
    }

    const merged = {
      ...DEFAULT_CONFIG,
      ...stored,
      ...options,
    };

    return this.validateAndSanitize(merged);
  }

  private saveConfig(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.config));
      }
    } catch (e) {
      console.warn('[SmartBuffer:ConfigManager] Failed to write localStorage:', e);
    }
  }
}
