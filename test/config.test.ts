import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager } from '../src/config/config-manager';
import { DEFAULT_CONFIG, PRESET_CONFIGS } from '../src/config/defaults';

describe('ConfigManager', () => {
  let manager: ConfigManager;

  beforeEach(() => {
    // Clear localStorage mockup
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
    manager = new ConfigManager({ storageKey: 'test_smart_buffer' });
  });

  it('should initialize with safe default config', () => {
    const config = manager.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('default');
    expect(config.minConcurrency).toBe(2);
    expect(config.maxConcurrency).toBe(4);
    expect(config.targetBufferLength).toBe(30);
    expect(config.maxBufferLength).toBe(80);
  });

  it('should switch presets correctly', () => {
    manager.updateConfig({ mode: 'weak-network' });
    const cfg = manager.getConfig();
    expect(cfg.mode).toBe('weak-network');
    expect(cfg.targetBufferLength).toBe(60);
    expect(cfg.maxConcurrency).toBe(8);

    manager.updateConfig({ mode: 'high-speed' });
    const highCfg = manager.getConfig();
    expect(highCfg.mode).toBe('high-speed');
    expect(highCfg.maxConcurrency).toBe(6);
  });

  it('should switch to custom mode when parameters are modified manually', () => {
    manager.updateConfig({ maxConcurrency: 6 });
    const cfg = manager.getConfig();
    expect(cfg.mode).toBe('custom');
    expect(cfg.maxConcurrency).toBe(6);
  });

  it('should sanitize and enforce boundaries on config parameters', () => {
    manager.updateConfig({
      minConcurrency: -5,
      maxConcurrency: 99,
      targetBufferLength: 2,
      maxBufferLength: 10,
      maxPreloadSegments: 99,
      qualitySafetyFactor: 1.5,
    });
    const cfg = manager.getConfig();
    expect(cfg.minConcurrency).toBe(1);
    expect(cfg.maxConcurrency).toBe(8); // Capped at safe maximum 8
    expect(cfg.targetBufferLength).toBe(5); // Minimum 5s
    expect(cfg.maxPreloadSegments).toBe(20); // Capped at safe maximum 20
    expect(cfg.qualitySafetyFactor).toBe(1.0); // Capped at 1.0
  });

  it('should reset back to defaults', () => {
    manager.updateConfig({ maxConcurrency: 8, mode: 'custom' });
    manager.resetConfig();
    const cfg = manager.getConfig();
    expect(cfg.mode).toBe('default');
    expect(cfg.maxConcurrency).toBe(DEFAULT_CONFIG.maxConcurrency);
  });

  it('should notify subscribers when configuration changes', () => {
    let notified = false;
    let changedKeys: string[] = [];

    manager.subscribe((config, keys) => {
      notified = true;
      changedKeys = keys as string[];
    });

    manager.updateConfig({ targetBufferLength: 35 });
    expect(notified).toBe(true);
    expect(changedKeys).toContain('targetBufferLength');
  });
});
