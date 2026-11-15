import type Hls from 'hls.js';
import { SmartBufferConfig } from '../types';
import { NetworkMonitor } from '../network/network-monitor';

export class AdaptiveQualityController {
  private hls?: Hls;
  private config: SmartBufferConfig;
  private networkMonitor: NetworkMonitor;

  private userManualLevel: number = -1; // -1 means auto
  private lastSwitchTime = 0;
  private switchCooldownMs = 8000; // 8s cooldown between quality upgrades to avoid flapping

  constructor(config: SmartBufferConfig, networkMonitor: NetworkMonitor, hls?: Hls) {
    this.config = config;
    this.networkMonitor = networkMonitor;
    this.hls = hls;
  }

  public attachHls(hls: Hls): void {
    this.hls = hls;
  }

  public detachHls(): void {
    this.hls = undefined;
  }

  public updateConfig(config: SmartBufferConfig): void {
    this.config = config;
  }

  public setUserManualLevel(levelIndex: number): void {
    this.userManualLevel = levelIndex;
    if (this.hls) {
      this.hls.currentLevel = levelIndex;
    }
  }

  public isManual(): boolean {
    return this.userManualLevel >= 0;
  }

  /**
   * Evaluate network conditions and adjust quality level if needed
   */
  public evaluate(): void {
    if (!this.config.autoQuality || !this.config.enabled || !this.hls) {
      return;
    }

    // If user has explicitly chosen a manual quality level, do not override
    if (this.userManualLevel >= 0) {
      return;
    }

    const levels = this.hls.levels;
    if (!levels || levels.length <= 1) return;

    const stats = this.networkMonitor.getStats();
    const bwMbps = stats.bandwidthEstimateMbps;
    const bufferLen = stats.bufferLength;

    if (bwMbps <= 0) return; // Not enough samples yet

    const availableBwBps = bwMbps * 1_000_000 * this.config.qualitySafetyFactor;
    const currentLevelIndex = this.hls.currentLevel >= 0 ? this.hls.currentLevel : this.hls.loadLevel;
    const currentLevel = levels[currentLevelIndex] || levels[0];
    const currentBitrate = currentLevel.bitrate;

    const now = Date.now();

    // 1. Critical downscale condition: buffer is dangerously low or current bitrate exceeds estimated bandwidth
    if (bufferLen < 4 || currentBitrate > availableBwBps) {
      // Find highest level that fits into available bandwidth
      let targetIndex = 0;
      for (let i = levels.length - 1; i >= 0; i--) {
        if (levels[i].bitrate <= availableBwBps) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex < currentLevelIndex) {
        // Downscale immediately without cooldown
        this.hls.nextLevel = targetIndex;
        this.lastSwitchTime = now;
        return;
      }
    }

    // 2. Upscale condition: buffer is healthy, available bandwidth significantly exceeds next bitrate, and cooldown passed
    if (now - this.lastSwitchTime < this.switchCooldownMs) {
      return;
    }

    if (bufferLen > 12 && currentLevelIndex < levels.length - 1) {
      const nextLevel = levels[currentLevelIndex + 1];
      // Require 20% margin above next level bitrate
      if (availableBwBps >= nextLevel.bitrate * 1.2) {
        this.hls.nextLevel = currentLevelIndex + 1;
        this.lastSwitchTime = now;
      }
    }
  }

  public getCurrentQualityName(): string {
    if (!this.hls || !this.hls.levels || this.hls.levels.length === 0) {
      return 'Auto';
    }
    const idx = this.hls.currentLevel >= 0 ? this.hls.currentLevel : this.hls.loadLevel;
    const lvl = this.hls.levels[idx];
    if (!lvl) return 'Auto';

    if (lvl.height) {
      return `${lvl.height}P`;
    }
    if (lvl.name) {
      return lvl.name;
    }
    return `${Math.round(lvl.bitrate / 1000)} Kbps`;
  }
}
