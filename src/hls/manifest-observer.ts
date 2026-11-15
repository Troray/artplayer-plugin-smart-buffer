import Hls, { Fragment } from 'hls.js';

export interface FragmentInfo {
  sn: number | string;
  level: number;
  url: string;
  start: number;
  duration: number;
  end: number;
  byteRange?: { start: number; end: number };
  rawFragment: Fragment;
}

export class ManifestObserver {
  private hls?: Hls;
  private currentLevelIndex = 0;
  private isLive = false;
  private levelFragments: Map<number, FragmentInfo[]> = new Map();
  private lastLoadingSn: number | string = -1;

  constructor(hls?: Hls) {
    if (hls) {
      this.attachHls(hls);
    }
  }

  public attachHls(hls: Hls): void {
    this.hls = hls;

    const events = (hls.constructor as typeof Hls).Events || Hls.Events;
    hls.on(events.LEVEL_LOADED as any, this.onLevelLoaded);
    hls.on(events.LEVEL_SWITCHED as any, this.onLevelSwitched);
    hls.on(events.FRAG_LOADING as any, this.onFragLoading);
    hls.on(events.MANIFEST_PARSED as any, this.onManifestParsed);

    // Sync any existing level details if already parsed
    this.syncLevels(hls);
  }

  public syncLevels(hls?: Hls): void {
    const targetHls = hls || this.hls;
    if (!targetHls || !targetHls.levels || targetHls.levels.length === 0) return;

    this.currentLevelIndex = targetHls.currentLevel >= 0 ? targetHls.currentLevel : 0;
    for (let i = 0; i < targetHls.levels.length; i++) {
      const lvl = targetHls.levels[i];
      if (lvl && lvl.details) {
        this.onLevelLoaded('', { level: i, details: lvl.details });
      }
    }
  }

  public isEmpty(): boolean {
    return this.levelFragments.size === 0;
  }

  public detachHls(): void {
    if (!this.hls) return;
    try {
      const events = (this.hls.constructor as typeof Hls).Events || Hls.Events;
      this.hls.off(events.LEVEL_LOADED as any, this.onLevelLoaded);
      this.hls.off(events.LEVEL_SWITCHED as any, this.onLevelSwitched);
      this.hls.off(events.FRAG_LOADING as any, this.onFragLoading);
      this.hls.off(events.MANIFEST_PARSED as any, this.onManifestParsed);
    } catch (e) {
      // Ignore cleanup error if hls destroyed
    }
    this.hls = undefined;
    this.levelFragments.clear();
  }

  private onManifestParsed = (event: string, data: any) => {
    if (data && data.levels && data.levels.length > 0) {
      this.currentLevelIndex = this.hls?.currentLevel ?? 0;
      if (this.currentLevelIndex < 0) this.currentLevelIndex = 0;
    }
  };

  private onLevelSwitched = (event: string, data: { level: number }) => {
    if (typeof data.level === 'number' && data.level >= 0) {
      this.currentLevelIndex = data.level;
    }
  };

  private onLevelLoaded = (event: string, data: { level: number; details: any }) => {
    const { level, details } = data;
    if (!details) return;

    this.isLive = Boolean(details.live);

    const fragments: FragmentInfo[] = [];
    if (details.fragments && Array.isArray(details.fragments)) {
      for (const frag of details.fragments) {
        let byteRange: { start: number; end: number } | undefined;
        if (typeof frag.byteRangeStartOffset === 'number' && typeof frag.byteRangeEndOffset === 'number') {
          byteRange = {
            start: frag.byteRangeStartOffset,
            end: frag.byteRangeEndOffset - 1, // HTTP range header is inclusive
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
          rawFragment: frag,
        });
      }
    }

    this.levelFragments.set(level, fragments);
  };

  private onFragLoading = (event: string, data: { frag: Fragment }) => {
    if (data && data.frag) {
      this.lastLoadingSn = data.frag.sn;
    }
  };

  public getCurrentLevelIndex(): number {
    return this.currentLevelIndex;
  }

  public getIsLive(): boolean {
    return this.isLive;
  }

  public getLastLoadingSn(): number | string {
    return this.lastLoadingSn;
  }

  /**
   * Find candidate upcoming fragments ahead of currentTime within the buffer window
   */
  public getUpcomingFragments(
    currentTime: number,
    targetWindowSec: number,
    maxCount: number,
    levelOverride?: number
  ): FragmentInfo[] {
    const level = levelOverride ?? this.currentLevelIndex;
    const frags = this.levelFragments.get(level);
    if (!frags || frags.length === 0) return [];

    const windowEnd = currentTime + targetWindowSec;
    const results: FragmentInfo[] = [];

    for (const frag of frags) {
      // If fragment has already ended in the past, skip
      if (frag.end <= currentTime) {
        continue;
      }

      // If fragment is beyond the target buffer window, stop collecting
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
  public getUncachedCandidateFragments(
    currentTime: number,
    lookaheadSec: number,
    maxCount: number,
    isUncached: (frag: FragmentInfo) => boolean
  ): FragmentInfo[] {
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
    const results: FragmentInfo[] = [];

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
  public getFragmentBySn(level: number, sn: number | string): FragmentInfo | undefined {
    const frags = this.levelFragments.get(level);
    if (!frags) return undefined;
    return frags.find((f) => f.sn === sn);
  }

  public clear(): void {
    this.levelFragments.clear();
    this.lastLoadingSn = -1;
  }
}
