import { SmartBufferEngine } from '../engine';

export class StatusCard {
  private engine: SmartBufferEngine;
  private container?: HTMLElement;
  private timer: any = null;

  constructor(engine: SmartBufferEngine) {
    this.engine = engine;
  }

  public render(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'art-smart-buffer-status-card';
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

    // Start auto-refresh timer (every 800ms)
    this.timer = setInterval(() => {
      this.update();
    }, 800);

    return card;
  }

  public update(): void {
    if (!this.container) return;

    const s = this.engine.getStatus();
    const isOnline = this.engine.recoveryManager.getIsOnline();
    const config = this.engine.getConfig();

    let concurrencyHtml = '';
    if (s.activeConcurrency > 0) {
      concurrencyHtml = `<span style="color:#ffb74d;">${s.activeConcurrency} / ${s.maxConcurrency} (加速中)</span>`;
    } else if (parseFloat(s.bufferLengthFormatted) >= (config.targetBufferLength || 30)) {
      concurrencyHtml = `<span style="color:#81c784;">0 / ${s.maxConcurrency} (已足额待命)</span>`;
    } else {
      concurrencyHtml = `<span style="color:#aaa;">0 / ${s.maxConcurrency} (就绪)</span>`;
    }

    this.container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:4px; margin-bottom:5px;">
        <span style="font-weight:600; color:#4fc3f7; font-size:12px;">Smart Buffer 实时监控</span>
        <span style="color:${isOnline ? '#81c784' : '#e57373'}; font-size:11px;">${isOnline ? '● 在线' : '● 离线'}</span>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; font-size:11px;">
        <div>网络质量: <span style="color:#ffb74d;">${s.networkQuality}</span></div>
        <div>实时下载: <span style="color:#4fc3f7;">${s.downloadSpeedFormatted}</span></div>
        <div>预估带宽: <span style="color:#ba68c8;">${s.bandwidthFormatted}</span></div>
        <div>响应延迟: <span style="color:#fff;">${s.rttFormatted}</span></div>
        <div>有效缓冲: <span style="color:#81c784; font-weight:600;">${s.bufferLengthFormatted}</span></div>
        <div>预载分片: <span style="color:#fff;">${s.preloadedSegmentsCount} 段</span></div>
        <div>并发线程: ${concurrencyHtml}</div>
        <div>当前画质: <span style="color:#fff;">${s.currentQuality}</span></div>
        <div>卡顿统计: <span style="color:${s.rebufferCount > 0 ? '#e57373' : '#81c784'};">${s.rebufferCount} 次 (${s.rebufferDurationFormatted})</span></div>
        <div>占用内存: <span style="color:#aaa;">${s.cacheSizeMB}</span></div>
      </div>
    `;
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.container = undefined;
  }
}
