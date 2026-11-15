import type Artplayer from 'artplayer';
import type Hls from 'hls.js';
import { SmartBufferEngine } from './engine';
import { SettingsPanel } from './ui/settings-panel';
import { StatusControl } from './ui/status-control';
import { SmartFragmentLoader } from './hls/smart-loader';
import { PluginOptions, SmartBufferPluginInstance } from './types';

export * from './types';
export * from './engine';
export * from './config/defaults';
export * from './config/config-manager';
export * from './network/throughput';
export * from './network/rtt';
export * from './network/network-monitor';
export * from './cache/segment-cache';
export * from './scheduler/priority-queue';
export * from './scheduler/prefetch-scheduler';
export * from './hls/manifest-observer';
export * from './hls/smart-loader';
export * from './hls/hls-adapter';
export * from './abr/quality-controller';
export * from './buffer/buffer-manager';
export * from './recovery/recovery-manager';
export * from './mp4/mp4-engine';
export * from './ui/status-card';
export * from './ui/status-control';
export * from './ui/settings-panel';
export * from './ui/progress-bar-tracker';

/**
 * ArtPlayer 智能视频加载与多分片并发预加载插件
 */
export function artplayerPluginSmartBuffer(options?: PluginOptions) {
  return (art: Artplayer): SmartBufferPluginInstance => {
    const engine = new SmartBufferEngine(options);
    const settingsPanel = new SettingsPanel(art, engine);
    const statusControl = new StatusControl(art, engine);

    // Attach to player and mount UI
    engine.attachPlayer(art);
    settingsPanel.register();
    statusControl.register();

    // Hook cleanup
    art.on('destroy', () => {
      statusControl.destroy();
      settingsPanel.destroy();
      engine.destroy();
    });

    const instance: SmartBufferPluginInstance = {
      name: 'artplayerPluginSmartBuffer',
      version: '1.0.0',
      get config() {
        return engine.getConfig();
      },
      engine,
      updateConfig: (patch) => engine.updateConfig(patch),
      resetConfig: () => engine.resetConfig(),
      getStatus: () => engine.getStatus(),
      destroy: () => {
        statusControl.destroy();
        settingsPanel.destroy();
        engine.destroy();
      },
    };

    return instance;
  };
}

/**
 * 便捷辅助工厂方法：生成已自动注入 SmartFragmentLoader 的 ArtPlayer customType.m3u8 处理器
 */
artplayerPluginSmartBuffer.createHlsCustomType = function (
  HlsClass?: any,
  customConfig?: Record<string, any>
) {
  return function (video: HTMLVideoElement, url: string, art: Artplayer) {
    const HlsConstructor = HlsClass || (window as any).Hls;
    if (HlsConstructor && HlsConstructor.isSupported()) {
      if ((art as any).hls) {
        (art as any).hls.destroy();
      }

      const hlsConfig = {
        fLoader: SmartFragmentLoader,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        ...customConfig,
      };

      const hls = new HlsConstructor(hlsConfig);
      hls.loadSource(url);
      hls.attachMedia(video);
      (art as any).hls = hls;

      // Directly attach to smartBufferEngine if attached
      if ((art as any).smartBufferEngine) {
        (art as any).smartBufferEngine.attachHls(hls, video);
      }

      art.on('destroy', () => {
        hls.destroy();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      art.notice.show = '当前浏览器不支持播放 M3U8 格式视频';
    }
  };
};

export const createHlsCustomType = artplayerPluginSmartBuffer.createHlsCustomType;

export default artplayerPluginSmartBuffer;
