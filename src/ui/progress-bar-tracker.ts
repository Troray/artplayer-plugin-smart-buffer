import type Artplayer from 'artplayer';
import { SmartBufferEngine } from '../engine';

const PROGRESS_STYLE_ID = 'art-smart-buffer-progress-style';

function injectProgressStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PROGRESS_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = PROGRESS_STYLE_ID;
  style.textContent = `
    /* 浅绿色 Smart Buffer 预加载安全区进度条 */
    .art-video-player .art-control-progress-inner .art-progress-smart-preloaded,
    .art-video-player .art-progress .art-control-progress-inner .art-progress-smart-preloaded,
    .art-video-player .art-progress .art-progress-smart-preloaded {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      bottom: 0 !important;
      height: 100% !important;
      width: 0%;
      background: #4ade80 !important; /* 清晰鲜明的浅绿色 (Tailwind Green 400) */
      z-index: 15 !important; /* 高于原生 loaded (10)，低于 played (20) */
      pointer-events: none !important;
      border-radius: 2px;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 0 8px rgba(35, 158, 80, 0.7);
    }

    /* 原生 loaded 缓冲条在 Smart Buffer 激活时同步设为浅绿色，彻底告别沉闷灰色 */
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
      this.preloadBar.style.width = '0%';
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
      this.preloadBar.style.width = '0%';
      return;
    }

    // 1. 获取原生 HTML5 / MSE 已解码缓冲区的最远时间戳
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

    // 2. 获取 Smart Buffer 内存缓存池中已就绪分片的最远时间戳
    const maxCached = this.engine.segmentCache.getMaxCachedTime();

    // 3. 取两者最大者作为真正的安全预加载视界
    const furthestPreload = Math.max(maxBuffered, maxCached);
    const pct = Math.min(100, Math.max(0, (furthestPreload / duration) * 100));

    this.preloadBar.style.width = `${pct.toFixed(2)}%`;
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
