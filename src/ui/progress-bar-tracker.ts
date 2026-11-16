import type Artplayer from 'artplayer';
import { SmartBufferEngine } from '../engine';

const PROGRESS_STYLE_ID = 'art-smart-buffer-progress-style';

function injectProgressStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PROGRESS_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = PROGRESS_STYLE_ID;
  style.textContent = `
    /* Smart Buffer 预加载分段底轨容器 */
    .art-video-player .art-control-progress-inner .art-progress-smart-preloaded,
    .art-video-player .art-progress .art-control-progress-inner .art-progress-smart-preloaded,
    .art-video-player .art-progress .art-progress-smart-preloaded {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      bottom: 0 !important;
      height: 100% !important;
      width: 100% !important;
      background: transparent !important;
      z-index: 15 !important; /* 高于原生 loaded (10)，低于 played (20) */
      pointer-events: none !important;
      border-radius: 2px;
    }

    /* 离散分段缓存色块（真实呈现连续缓冲与断层空洞） */
    .art-video-player .art-progress-smart-chunk {
      position: absolute !important;
      top: 0 !important;
      bottom: 0 !important;
      height: 100% !important;
      background: #4ade80 !important; /* 清晰鲜明的浅绿色 (Tailwind Green 400) */
      border-radius: 2px;
      pointer-events: none !important;
      box-shadow: 0 0 8px rgba(35, 158, 80, 0.7);
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* 原生 loaded 缓冲条在 Smart Buffer 激活时设为半透明浅绿色 */
    .art-video-player.art-smart-buffer-enabled .art-progress-loaded {
      background-color: rgba(35, 158, 80, 0.5) !important;
    }
  `;
  document.head.appendChild(style);
}

export class ProgressBarTracker {
  private art: Artplayer;
  private engine: SmartBufferEngine;
  private preloadBar?: HTMLDivElement;
  private timer: any = null;

  constructor(art: Artplayer, engine: SmartBufferEngine) {
    this.art = art;
    this.engine = engine;
  }

  public attach(): void {
    injectProgressStyles();

    const mount = () => {
      if (!this.art.template || !this.art.template.$progress) return;
      const progressEl = this.art.template.$progress;

      // 准确定位 ArtPlayer 内部进度条容器 .art-control-progress-inner
      const inner =
        progressEl.querySelector('.art-control-progress-inner') ||
        progressEl.querySelector('[class*="progress-inner"]') ||
        progressEl.querySelector('.art-control-progress') ||
        progressEl;

      if (!inner) return;

      let bar = inner.querySelector('.art-progress-smart-preloaded') as HTMLDivElement | null;
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'art-progress-smart-preloaded';
        bar.title = 'Smart Buffer 预加载安全区';

        // 插入在 .art-progress-played 之前，确保已播放位置红色条置于最上层
        const playedEl = inner.querySelector('.art-progress-played');
        if (playedEl && playedEl.parentNode === inner) {
          inner.insertBefore(bar, playedEl);
        } else {
          inner.appendChild(bar);
        }
      }
      this.preloadBar = bar;

      if (this.art.template.$player) {
        this.art.template.$player.classList.add('art-smart-buffer-enabled');
      }
    };

    mount();
    this.art.on('ready', () => {
      mount();
      this.update();
    });
    this.art.on('video:loadedmetadata', () => {
      mount();
      this.update();
    });
    this.art.on('video:canplay', () => {
      mount();
      this.update();
    });

    // 提高刷新频率至 250ms，保持动画与进度绝对丝滑
    this.timer = setInterval(() => {
      if (!this.preloadBar) {
        mount();
      }
      this.update();
    }, 250);

    this.art.on('video:timeupdate', () => this.update());
    this.art.on('video:progress', () => this.update());
  }

  public update(): void {
    if (!this.preloadBar) {
      if (!this.art.template || !this.art.template.$progress) return;
      const inner =
        this.art.template.$progress.querySelector('.art-control-progress-inner') ||
        this.art.template.$progress.querySelector('[class*="progress-inner"]') ||
        this.art.template.$progress.querySelector('.art-control-progress') ||
        this.art.template.$progress;
      this.preloadBar = inner?.querySelector('.art-progress-smart-preloaded') as HTMLDivElement;
      if (!this.preloadBar) return;
    }

    if (!this.engine.getConfig().enabled) {
      this.clearChunks();
      this.preloadBar.style.display = 'none';
      if (this.art.template && this.art.template.$player) {
        this.art.template.$player.classList.remove('art-smart-buffer-enabled');
      }
      return;
    }

    this.preloadBar.style.display = 'block';
    if (this.art.template && this.art.template.$player) {
      this.art.template.$player.classList.add('art-smart-buffer-enabled');
    }

    const video = this.art.video;
    if (!video) return;

    const duration = video.duration || this.art.duration || 0;
    if (!duration || duration <= 0 || isNaN(duration) || !isFinite(duration)) {
      this.clearChunks();
      return;
    }

    // 收集所有有效区间：原生 MSE 缓冲区与 SegmentCache 中真实已完成分片区间
    interface TimeRange {
      start: number;
      end: number;
    }
    const allRanges: TimeRange[] = [];

    // 1. MSE 已解码缓冲区
    if (video.buffered && video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (end > start) {
          allRanges.push({ start, end });
        }
      }
    }

    // 2. SegmentCache 中真实已完成分片区间
    const cachedRanges = this.engine.segmentCache.getCachedTimeRanges();
    allRanges.push(...cachedRanges);

    if (allRanges.length === 0) {
      this.clearChunks();
      return;
    }

    // 3. 排序与合并重叠或连续分片（容差 0.25s，超出则保留空白缝隙呈现断层空洞）
    allRanges.sort((a, b) => a.start - b.start);
    const merged: TimeRange[] = [];
    let cur = { start: allRanges[0].start, end: allRanges[0].end };

    for (let i = 1; i < allRanges.length; i++) {
      const next = allRanges[i];
      if (next.start <= cur.end + 0.25) {
        cur.end = Math.max(cur.end, next.end);
      } else {
        merged.push({ ...cur });
        cur = { start: next.start, end: next.end };
      }
    }
    merged.push(cur);

    // 4. 多段离散色块渲染
    this.renderChunks(merged, duration);
  }

  private clearChunks(): void {
    if (this.preloadBar) {
      while (this.preloadBar.firstChild) {
        this.preloadBar.removeChild(this.preloadBar.firstChild);
      }
    }
  }

  private renderChunks(ranges: Array<{ start: number; end: number }>, duration: number): void {
    if (!this.preloadBar) return;

    const container = this.preloadBar;
    const existing = container.children;

    // 保持 DOM 元素数量与区间数量一致
    while (existing.length < ranges.length) {
      const chunk = document.createElement('div');
      chunk.className = 'art-progress-smart-chunk';
      container.appendChild(chunk);
    }
    while (existing.length > ranges.length) {
      container.removeChild(container.lastChild!);
    }

    // 真实呈现各连续区间的物理比例与空洞间隙
    for (let i = 0; i < ranges.length; i++) {
      const chunk = existing[i] as HTMLDivElement;
      const r = ranges[i];
      const leftPct = Math.max(0, Math.min(100, (r.start / duration) * 100));
      const rightPct = Math.max(0, Math.min(100, (r.end / duration) * 100));
      const widthPct = Math.max(0, rightPct - leftPct);

      chunk.style.left = `${leftPct.toFixed(2)}%`;
      chunk.style.width = `${widthPct.toFixed(2)}%`;
    }
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.art.template && this.art.template.$player) {
      this.art.template.$player.classList.remove('art-smart-buffer-enabled');
    }
    if (this.preloadBar && this.preloadBar.parentNode) {
      this.preloadBar.parentNode.removeChild(this.preloadBar);
    }
    this.preloadBar = undefined;
  }
}
