import type Artplayer from 'artplayer';
import type { Setting } from 'artplayer/types/setting';
import { SmartBufferEngine } from '../engine';
import { PresetMode } from '../types';
import { StatusCard } from './status-card';

const STYLE_ID = 'art-smart-buffer-panel-style';

function injectCustomStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* 仅隐藏普通设置项的冗余左侧图标以节省横向空间，但保留返回上一级菜单 (art-setting-item-back) 的返回箭头 < 图标 */
    .art-video-player .art-settings .art-setting-panel .art-setting-item:not(.art-setting-item-back) .art-setting-item-left .art-setting-item-left-icon {
      display: none !important;
    }
    /* 二级/三级子菜单顶部的返回上一级菜单：确保 < 图标清晰可见并规范对齐 */
    .art-video-player .art-settings .art-setting-panel .art-setting-item.art-setting-item-back .art-setting-item-left .art-setting-item-left-icon {
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      margin-right: 6px;
      cursor: pointer;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item.art-setting-item-back .art-setting-item-left .art-setting-item-left-icon svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item.art-setting-item-back {
      font-weight: 500;
      color: #fff;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item:not(.art-setting-item-back) .art-setting-item-left {
      margin-right: 12px;
      flex-shrink: 0;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-left .art-setting-item-left-text {
      font-size: 13px;
      white-space: nowrap;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-right .art-setting-item-right-tooltip {
      font-size: 12px;
      color: #4fc3f7;
      min-width: 48px;
      text-align: right;
    }
    .art-video-player .art-settings .art-setting-panel .art-setting-item .art-setting-item-right input[type="range"] {
      width: 110px;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

export class SettingsPanel {
  private art: Artplayer;
  private engine: SmartBufferEngine;
  private statusCard?: StatusCard;

  constructor(art: Artplayer, engine: SmartBufferEngine) {
    this.art = art;
    this.engine = engine;
  }

  public register(): void {
    injectCustomStyles();

    const config = this.engine.getConfig();
    this.statusCard = new StatusCard(this.engine);

    const getModeLabel = (mode: PresetMode): string => {
      switch (mode) {
        case 'default':
          return '默认 (Default)';
        case 'weak-network':
          return '弱网优化 (Weak Net)';
        case 'high-speed':
          return '高速网络 (High Speed)';
        case 'stable':
          return '稳定优先 (Stable)';
        case 'custom':
          return '自定义 (Custom)';
      }
    };

    const PANEL_WIDTH = 380;

    const settingConfig: Setting = {
      html: '智能加载 (Smart Buffer)',
      name: 'smartBuffer',
      width: PANEL_WIDTH,
      tooltip: config.enabled ? getModeLabel(config.mode) : '已关闭',
      selector: [
        // 1. 插件总开关
        {
          html: '智能加载总开关',
          switch: config.enabled,
          onSwitch: (item: any) => {
            const next = !item.switch;
            this.engine.updateConfig({ enabled: next });
            this.updateMenuTooltip();
            if (this.art.notice) {
              this.art.notice.show = `智能加载: ${next ? '已开启' : '已关闭'}`;
            }
            return next;
          },
        },

        // 2. 预置模式选择
        {
          html: '预置模式选择',
          width: PANEL_WIDTH,
          tooltip: getModeLabel(this.engine.getConfig().mode),
          onSelect: (item: any) => {
            const mode = item.mode as PresetMode;
            this.engine.updateConfig({ mode });
            this.updateMenuTooltip();
            if (this.art.notice) {
              this.art.notice.show = `已应用模式: ${getModeLabel(mode)}`;
            }
            return getModeLabel(mode);
          },
          selector: [
            {
              html: '默认模式 (均衡 4并发/30s缓冲)',
              mode: 'default',
              default: config.mode === 'default',
            },
            {
              html: '弱网优化 (多线程加速 8并发/60s缓冲)',
              mode: 'weak-network',
              default: config.mode === 'weak-network',
            },
            {
              html: '高速网络 (激进 6并发/30s缓冲)',
              mode: 'high-speed',
              default: config.mode === 'high-speed',
            },
            {
              html: '稳定优先 (充足 6并发/80s缓冲)',
              mode: 'stable',
              default: config.mode === 'stable',
            },
          ],
        },

        // 4. 自定义高级参数
        {
          html: '高级参数设置',
          width: PANEL_WIDTH,
          selector: [
            {
              html: '最大并发下载数',
              tooltip: `${this.engine.getConfig().maxConcurrency} 线程`,
              range: [this.engine.getConfig().maxConcurrency, 1, 8, 1],
              onChange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxConcurrency: val });
                return `${val} 线程`;
              },
              onRange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxConcurrency: val });
                if (this.art.notice) {
                  this.art.notice.show = `最大并发数已设为: ${val} 线程`;
                }
                return `${val} 线程`;
              },
            },
            {
              html: '目标缓冲时间',
              tooltip: `${this.engine.getConfig().targetBufferLength} 秒`,
              range: [this.engine.getConfig().targetBufferLength, 10, 100, 5],
              onChange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ targetBufferLength: val });
                return `${val} 秒`;
              },
              onRange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ targetBufferLength: val });
                if (this.art.notice) {
                  this.art.notice.show = `目标缓冲时间已设为: ${val} 秒`;
                }
                return `${val} 秒`;
              },
            },
            {
              html: '最大预加载分片数',
              tooltip: `${this.engine.getConfig().maxPreloadSegments} 段`,
              range: [this.engine.getConfig().maxPreloadSegments, 1, 10, 1],
              onChange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxPreloadSegments: val });
                return `${val} 段`;
              },
              onRange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxPreloadSegments: val });
                if (this.art.notice) {
                  this.art.notice.show = `最大预加载分片已设为: ${val} 段`;
                }
                return `${val} 段`;
              },
            },
            {
              html: '最大缓存内存',
              tooltip: `${this.engine.getConfig().maxCacheSizeMB} MB`,
              range: [this.engine.getConfig().maxCacheSizeMB, 30, 300, 10],
              onChange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxCacheSizeMB: val });
                return `${val} MB`;
              },
              onRange: (item: any) => {
                const val = Number(item.range[0]);
                this.engine.updateConfig({ maxCacheSizeMB: val });
                if (this.art.notice) {
                  this.art.notice.show = `最大缓存容量已设为: ${val} MB`;
                }
                return `${val} MB`;
              },
            },
            {
              html: '自适应网络画质切换',
              switch: this.engine.getConfig().autoQuality,
              onSwitch: (item: any) => {
                const next = !item.switch;
                this.engine.updateConfig({ autoQuality: next });
                if (this.art.notice) {
                  this.art.notice.show = `自适应画质: ${next ? '已开启' : '已关闭'}`;
                }
                return next;
              },
            },
            {
              html: '弱网动态降低并发',
              switch: this.engine.getConfig().dynamicConcurrency,
              onSwitch: (item: any) => {
                const next = !item.switch;
                this.engine.updateConfig({ dynamicConcurrency: next });
                if (this.art.notice) {
                  this.art.notice.show = `弱网动态并发: ${next ? '已开启' : '已关闭'}`;
                }
                return next;
              },
            },
            {
              html: '网络异常自动重试与恢复',
              switch: this.engine.getConfig().autoRecovery,
              onSwitch: (item: any) => {
                const next = !item.switch;
                this.engine.updateConfig({ autoRecovery: next });
                if (this.art.notice) {
                  this.art.notice.show = `异常自动重试: ${next ? '已开启' : '已关闭'}`;
                }
                return next;
              },
            },
            {
              html: '恢复安全默认设置',
              onClick: () => {
                this.engine.resetConfig();
                if (this.art.notice) {
                  this.art.notice.show = 'Smart Buffer 已恢复默认参数';
                }
                this.updateMenuTooltip();
              },
            },
          ],
        },
      ],
    };

    this.art.setting.add(settingConfig);
  }

  private updateMenuTooltip(): void {
    const cfg = this.engine.getConfig();
    const tooltip = cfg.enabled ? cfg.mode : '已关闭';
    this.art.setting.update({
      name: 'smartBuffer',
      tooltip,
    });
  }

  public destroy(): void {
    this.statusCard?.destroy();
  }
}
