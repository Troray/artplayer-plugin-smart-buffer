import type Artplayer from 'artplayer';
import { SmartBufferEngine } from '../engine';

const STYLE_ID = 'art-smart-buffer-control-style';

function injectControlStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* 控制栏中的 Smart Buffer 监控按钮容器：与 .art-control-setting 保持 100% 相同的高度和 flex 居中基准线 */
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

    /* 彻底禁用任何原生与 hint.css 提示框，鼠标悬停直接触发实时面板，杜绝多余的 tooltip 重叠干扰 */
    .art-video-player .art-control-smartBufferStatus:before,
    .art-video-player .art-control-smartBufferStatus:after,
    .art-video-player .art-smart-buffer-btn-wrapper:before,
    .art-video-player .art-smart-buffer-btn-wrapper:after {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
    }

    /* 按钮自身包装器：全高度垂直水平居中 */
    .art-smart-buffer-btn-wrapper {
      position: relative;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 100% !important;
      height: 100% !important;
      line-height: 1 !important;
    }

    /* 图标容器：精确 22x22px，与 .art-control-setting 的 22x22 svg 尺寸完全一致，杜绝 scale 变形与位移 */
    .art-smart-buffer-svg-icon {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 22px !important;
      height: 22px !important;
      line-height: 1 !important;
      box-sizing: border-box !important;
    }

    /* 保证 SVG 描边显示，绝对不被 ArtPlayer 的 svg { fill: #fff } 渲染成白色半圆实心面疙瘩 */
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

    /* 运行指示绿点：位于图标右上方 */
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

    /* 悬浮/点击弹出的 Smart Buffer 实时性能监控卡片 */
    .art-smart-buffer-popup-panel {
      position: absolute;
      bottom: calc(100% + 14px);
      right: 0px; /* 紧贴按钮右边缘对齐，预留右侧设置与全屏按钮间距，100% 杜绝超出播放器右边界 */
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

    /* 底部指向控制按钮的小三角指示箭头：对齐按钮中心（按钮宽约 40px，中心距右边缘 20px） */
    .art-smart-buffer-popup-panel::after {
      content: '';
      position: absolute;
      bottom: -6px;
      right: 14px; /* 20px - 6px = 14px，精准正对按钮中心 */
      width: 11px;
      height: 11px;
      background: rgba(22, 23, 27, 0.96);
      border-right: 1px solid rgba(255, 255, 255, 0.16);
      border-bottom: 1px solid rgba(255, 255, 255, 0.16);
      transform: rotate(45deg);
    }

    /* 鼠标悬停显示，或点击常开（.art-smart-buffer-open） */
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

export class StatusControl {
  private art: Artplayer;
  private engine: SmartBufferEngine;
  private controlEl?: HTMLElement;
  private popupEl?: HTMLDivElement;
  private btnWrapper?: HTMLElement;
  private timer: any = null;
  private isOpen = false;

  constructor(art: Artplayer, engine: SmartBufferEngine) {
    this.art = art;
    this.engine = engine;
  }

  public register(): void {
    injectControlStyles();

    this.art.controls.add({
      name: 'smartBufferStatus',
      position: 'right',
      index: 25, // 位于设置按钮（index: 30）左侧，与设置按钮严格处于同一直线
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
      click: (component: any, event: Event) => {
        event.stopPropagation();
        this.toggle();
      },
      mounted: (el: HTMLElement) => {
        this.controlEl = el;
        this.btnWrapper = el.querySelector('.art-smart-buffer-btn-wrapper') as HTMLElement;
        this.mountPopup(el);
      },
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('click', this.onDocumentClick);
    }
  }

  private mountPopup(controlEl: HTMLElement): void {
    if (this.popupEl) return;

    const popup = document.createElement('div');
    popup.className = 'art-smart-buffer-popup-panel';
    popup.addEventListener('click', (e) => {
      // 阻止面板内部点击向上传播触发关闭
      e.stopPropagation();
    });

    controlEl.appendChild(popup);
    this.popupEl = popup;

    this.update();

    // 启动 800ms 实时刷新监控数据
    this.timer = setInterval(() => {
      this.update();
    }, 800);
  }

  public toggle(): void {
    if (!this.controlEl) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.controlEl.classList.add('art-smart-buffer-open');
    } else {
      this.controlEl.classList.remove('art-smart-buffer-open');
    }
  }

  public close(): void {
    if (!this.controlEl) return;
    this.isOpen = false;
    this.controlEl.classList.remove('art-smart-buffer-open');
  }

  public update(): void {
    if (!this.popupEl) return;

    const config = this.engine.getConfig();
    const s = this.engine.getStatus();
    const isOnline = this.engine.recoveryManager.getIsOnline();

    // 根据插件开关状态调整右上角小圆点状态
    if (this.controlEl) {
      const dot = this.controlEl.querySelector('.art-smart-buffer-pulse-dot') as HTMLElement;
      if (dot) {
        if (!config.enabled) {
          dot.style.backgroundColor = '#757575';
          dot.style.boxShadow = 'none';
        } else {
          dot.style.backgroundColor = isOnline ? '#4ade80' : '#ef5350';
          dot.style.boxShadow = isOnline ? '0 0 6px #4ade80' : '0 0 6px #ef5350';
        }
      }

      if (!config.showNetworkStatus) {
        this.controlEl.style.display = 'none';
        return;
      } else {
        this.controlEl.style.display = 'flex';
      }
    }

    let concurrencyHtml = '';
    if (s.activeConcurrency > 0) {
      concurrencyHtml = `<span style="color:#ffb74d; font-weight:600;">${s.activeConcurrency} / ${s.maxConcurrency} <small style="color:#4fc3f7; font-weight:normal;">(加速中)</small></span>`;
    } else if (parseFloat(s.bufferLengthFormatted) >= (config.targetBufferLength || 30)) {
      concurrencyHtml = `<span style="color:#4ade80; font-weight:600;">0 / ${s.maxConcurrency} <small style="color:#81c784; font-weight:normal;">(已足额待命)</small></span>`;
    } else {
      concurrencyHtml = `<span style="color:#aaa; font-weight:600;">0 / ${s.maxConcurrency} <small style="color:#888; font-weight:normal;">(就绪)</small></span>`;
    }

    this.popupEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px; margin-bottom:8px;">
        <span style="font-weight:600; color:#4fc3f7; font-size:13px; display:flex; align-items:center; gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 22 22" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block; width:16px; height:16px; fill:none!important; stroke:#4fc3f7!important;">
            <path d="M 4.9 17.1 A 8 8 0 1 1 17.1 17.1" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" style="fill:none!important; stroke:#4fc3f7!important; stroke-width:2!important;"/>
            <line x1="11" y1="12.5" x2="15.5" y2="8" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" style="fill:none!important; stroke:#4fc3f7!important; stroke-width:2!important;"/>
            <circle cx="11" cy="12.5" r="1.8" fill="#4fc3f7" stroke="none" style="fill:#4fc3f7!important; stroke:none!important;"/>
          </svg>
          Smart Buffer 实时监控
        </span>
        <span style="color:${isOnline ? '#4ade80' : '#ef5350'}; font-size:11px; font-weight:500;">
          ${isOnline ? '● 在线' : '● 离线'}
        </span>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size:12px; line-height:1.5;">
        <div>网络质量: <span style="color:#ffb74d; font-weight:500;">${s.networkQuality}</span></div>
        <div>实时下载: <span style="color:#4fc3f7; font-weight:600;">${s.downloadSpeedFormatted}</span></div>
        <div>预估带宽: <span style="color:#ba68c8; font-weight:600;">${s.bandwidthFormatted}</span></div>
        <div>响应延迟: <span style="color:#fff;">${s.rttFormatted}</span></div>
        <div>有效缓冲: <span style="color:#4ade80; font-weight:600;">${s.bufferLengthFormatted}</span></div>
        <div>预载分片: <span style="color:#fff; font-weight:600;">${s.preloadedSegmentsCount} 段</span></div>
        <div>并发线程: ${concurrencyHtml}</div>
        <div>当前画质: <span style="color:#fff;">${s.currentQuality}</span></div>
        <div>卡顿统计: <span style="color:${s.rebufferCount > 0 ? '#ef5350' : '#4ade80'};">${s.rebufferCount} 次 (${s.rebufferDurationFormatted})</span></div>
        <div>占用内存: <span style="color:#aaa;">${s.cacheSizeMB}</span></div>
      </div>

      <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06); font-size:11px; color:#888; display:flex; justify-content:space-between; align-items:center;">
        <span>模式: <b style="color:#e0e0e0;">${config.mode}</b></span>
        <span style="color:#4fc3f7; cursor:pointer;" title="${this.isOpen ? '点击已锁定保持显示' : '点击图标可锁定面板'}">
          ${this.isOpen ? '📌 已固定显示' : '📌 点击可固定'}
        </span>
      </div>
      <div style="margin-top:4px; font-size:10px; color:#777; line-height:1.4; word-break:break-word; white-space:normal;">
        * 缓冲充足时线程自动待命；进度跳转或缓冲消耗时全速并发。
      </div>
    `;
  }

  private onDocumentClick = (e: MouseEvent) => {
    if (!this.controlEl) return;
    if (!this.controlEl.contains(e.target as Node)) {
      this.close();
    }
  };

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', this.onDocumentClick);
    }
    if (this.popupEl && this.popupEl.parentNode) {
      this.popupEl.parentNode.removeChild(this.popupEl);
    }
    this.popupEl = undefined;
    this.controlEl = undefined;
    this.btnWrapper = undefined;
  }
}
