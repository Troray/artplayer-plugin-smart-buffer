# Smart Buffer Engine (artplayer-plugin-smart-buffer)

> 适用于 ArtPlayer 的智能视频加载与多分片并发预加载引擎插件。专为弱网、高延迟、带宽波动等恶劣网络环境设计，提供类似 IDM / XDM 多线程加速的视频预加载体验，彻底消除缓冲卡顿。

[![npm version](https://img.shields.io/badge/npm-v1.0.0-blue.svg)](https://www.npmjs.com/)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![author](https://img.shields.io/badge/author-Troray-blue.svg)](https://github.com/Troray)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)

---

## 🌟 核心痛点与解决思路

在网络环境不佳（如高延迟、限速、Wi-Fi 波动、跨国 CDN 较慢）时，原生 HTML5 / HLS 播放器通常采用**单分片串行请求**：
- 播放完分片 1 后才去请求分片 2，任何一个分片因 TCP 慢启动或延迟抖动阻塞，播放器就会立刻耗尽缓冲并进入**长时间菊花转圈卡顿**。

**Smart Buffer Engine** 借鉴了 IDM / XDM 等多线程下载器的设计理念：
1. **多分片受控并发预加载**：在当前播放分片正常下载的同时，调度器以优先级队列提前并发拉取后续 3~6 个分片并缓存至安全内存池；
2. **0ms 零延迟分片交付**：当 `hls.js` 解复用器向加载器请求下一分片时，直接从内存中 0ms 瞬间响应交付，消除网络等待；
3. **动态网络质量与缓冲自适应**：基于 EWMA（指数加权移动平均）平滑检测真实吞吐量与 RTT，根据网络优劣动态伸缩并发数（1~8）和目标缓冲深度（10s~60s）；
4. **进度跳转智能防御**：用户 Seek 拖动进度条时，毫秒级取消偏离视窗的预加载任务，零带宽浪费；
5. **ArtPlayer 原生设置面板无缝集成**：播放器菜单内含独立「智能加载」入口，提供预置模式（默认、弱网优化、高速网络、稳定优先、自定义）及 800ms 实时刷新监控看板。

---

## 📦 安装

```bash
npm install artplayer-plugin-smart-buffer artplayer hls.js
```

或者使用 CDN 引入：

```html
<script src="https://cdn.jsdelivr.net/npm/artplayer/dist/artplayer.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js/dist/hls.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/artplayer-plugin-smart-buffer/dist/index.global.js"></script>
```

---

## 🚀 快速上手

### 推荐方式：搭配 `createHlsCustomType` 极简集成

```javascript
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import artplayerPluginSmartBuffer from 'artplayer-plugin-smart-buffer';

const art = new Artplayer({
  container: '#player',
  url: 'https://example.com/video.m3u8',
  type: 'm3u8',
  setting: true,
  customType: {
    // 一键注入已绑定 SmartFragmentLoader 的 hls 调度器
    m3u8: artplayerPluginSmartBuffer.createHlsCustomType(Hls),
  },
  plugins: [
    artplayerPluginSmartBuffer({
      mode: 'default',          // 默认模式
      maxConcurrency: 3,       // 最大 3 线程并发拉取
      targetBufferLength: 25,   // 目标缓冲 25 秒
      autoQuality: true,       // 弱网自动画质降级防卡顿
    }),
  ],
});
```

---

## ⚙️ 预置模式速查 (Preset Modes)

| 预置模式 | 并发数 | 目标缓冲 | 最大缓冲 | 适用场景 |
| :--- | :---: | :---: | :---: | :--- |
| **`default` (默认)** | 2 ~ 4 | 30 秒 | 80 秒 | 大多数日常网络环境，平滑且低资源消耗 |
| **`weak-network` (弱网优化)** | 4 ~ 8 | 60 秒 | 120 秒 | 类似 IDM 多线程加速，激进打满 8 并发抢占带宽，构建 120 秒超深安全缓冲防卡顿 |
| **`high-speed` (高速网络)** | 3 ~ 6 | 30 秒 | 90 秒 | 百兆宽带及以上，追求秒开与瞬时跳转 |
| **`stable` (稳定优先)** | 4 ~ 6 | 80 秒 | 150 秒 | 适合长视频平稳播放，超深缓冲抗长周期网络抖动 |
| **`custom` (自定义)** | 自定义 | 自定义 | 自定义 | 允许在 ArtPlayer 面板或配置项中自由设定 |

---

## 🎛️ 完整配置参数说明 (SmartBufferConfig)

| 参数名 | 类型 | 默认值 | 取值范围 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `enabled` | `boolean` | `true` | `true / false` | 插件全局总开关，关闭后无缝降级到原生加载 |
| `mode` | `string` | `'default'` | 见预置模式 | 预置配置模板，修改任意参数会自动切为 `custom` |
| `minConcurrency` | `number` | `2` | `1 ~ 4` | 最小并发下载请求数 |
| `maxConcurrency` | `number` | `4` | `1 ~ 8` | 最大并发下载请求数（多线程预加载分片数） |
| `targetBufferLength` | `number` | `30` | `5 ~ 120` | 目标缓冲时长（秒），达到后自动暂停远端预载 |
| `maxBufferLength` | `number` | `80` | `10 ~ 300` | 最大缓冲上限（秒） |
| `maxPreloadSegments` | `number` | `6` | `1 ~ 20` | 单次预加载最多排队的分片数量 |
| `maxCacheSizeMB` | `number` | `150` | `20 ~ 1000` | 内存中允许保留的最大分片数据缓存（MB） |
| `autoQuality` | `boolean` | `true` | `true / false` | 是否根据网络吞吐量自动决策 M3U8 清晰度 |
| `qualitySafetyFactor` | `number` | `0.75` | `0.3 ~ 1.0` | 画质选择安全系数（目标码率 $\le$ 估算带宽 $\times$ 系数） |
| `autoRecovery` | `boolean` | `true` | `true / false` | 遇到网络抖动或超时是否进行指数退避自动重试 |
| `maxRetries` | `number` | `5` | `1 ~ 20` | 单个分片下载失败的最大重试次数 |
| `dynamicConcurrency` | `boolean` | `true` | `true / false` | 网络较差或卡顿时是否自动下调并发避免争抢带宽 |
| `backgroundPreload` | `boolean` | `false` | `true / false` | 视频暂停时是否继续在后台预加载后续分片 |
| `showNetworkStatus` | `boolean` | `true` | `true / false` | 是否在播放器设置面板中展示实时性能状态卡片 |

---

## 🟢 进度条预加载安全区可视化 (Progress Bar Tracker)

插件在 ArtPlayer 原生进度条（`.art-progress-inner`）内注入了**浅绿色（Light Green，`#81c784`）**的并发预加载指示条：
- **深粉色 / 红色**：已播放进度；
- **浅白色**：原生 HTML5 / MSE 已解码缓冲；
- **浅绿色**：Smart Buffer 多线程已提前拉取并就绪于高速内存中的**安全防护区**。
用户可一目了然看清预加载储备量，彻底告别盲目等待。
| `backgroundPreload` | `boolean` | `false` | `true / false` | 视频暂停时是否继续在后台预加载后续分片 |
| `showNetworkStatus` | `boolean` | `true` | `true / false` | 是否在播放器设置面板中展示实时性能状态卡片 |

---

## 📊 实时网络与缓冲监控看板 (Toolbar Status Control)

插件在播放器底部工具栏（与「设置」齿轮图标同一行）提供了独立的性能监控图标与交互式浮层卡片：
- **常驻指示**：图标右上角常驻呼吸绿点，实时表征 Smart Buffer 引擎与网络连接健康度；
- **鼠标悬停 / 点击交互**：
  - **鼠标悬停**：平滑弹出清晰大尺寸的 800ms 实时监控看板，移出自动隐藏；
  - **点击锁定**：点击图标可将看板固定常开（Pinned），方便持续调试与观察；再次点击或点击播放器任意区域即可收起；
- **解耦设置菜单**：将高信息密度看板移出设置面板，彻底解决 ArtPlayer 设置菜单高度被压缩截断的问题。

```
+---------------------------------------------+
| 仪表盘 Smart Buffer 实时性能监控      ● 在线 |
|---------------------------------------------|
| 网络质量: 优秀 (Excellent)  实时下载: 1.62 MB/s |
| 预估带宽: 11.99 Mbps      响应延迟: 132 ms    |
| 有效缓冲: 126.2 s         预载分片: 34 段     |
| 并发线程: 0 / 8           当前画质: 800P      |
| 卡顿统计: 0 次 (0.0s)     占用内存: 30.17 MB  |
|---------------------------------------------|
| 模式: weak-network          💡 点击可固定显示 |
+---------------------------------------------+
```

---

## 🏗️ 架构设计与执行流

```
ArtPlayer 实例
  │
  ├── 设置菜单 UI & 实时监控看板 (每 800ms 刷新)
  └── SmartBufferEngine
        ├── NetworkMonitor (Throughput & RTT EWMA 平滑计算)
        ├── DynamicBufferManager (动态缓冲深度计算)
        ├── AdaptiveQualityController (自适应清晰度决策)
        ├── RecoveryManager (网络异常与指数退避重试)
        ├── SegmentCache (LRU 内存池，超出自动释放)
        └── HlsAdapter / PrefetchScheduler (并发调度队列)
              │
              ├── [Priority 0] 播放关键分片 ──► 0ms 缓存直出 / 阻塞直通
              └── [Priority 1~3] 预加载分片 ──► 并发 Fetch 写入 SegmentCache
```

### 关键防踩坑设计
1. **分片解复用与 MSE 注入顺序严格交由 `hls.js` 原生控制**：
   并发预加载仅在**网络请求层**和**内存缓存层**生效，绝不直接向 `SourceBuffer` 追加无序分片，确保时间戳和时序 100% 正确。
2. **Seek 进度跳转毫秒级取消**：
   通过 `AbortController` 瞬时中止已偏离新视窗的无效请求，杜绝多余流量开销。
3. **关闭插件平滑降级**：
   用户关闭智能加载后，系统自动释放预加载队列和缓存，无缝回退到原生加载路径，不影响常规播放。

---

## 🌐 浏览器兼容性

| 浏览器 | 支持状态 | 备注 |
| :--- | :---: | :--- |
| **Chrome / Edge / Chromium** | ✅ 完全支持 | MSE、Fetch、AbortController 完整支持 |
| **Firefox** | ✅ 完全支持 | 完全兼容 |
| **Safari (macOS / iPadOS)** | ✅ 支持 | 支持 MSE 环境，可配合 hls.js 或原生降级播放 |
| **移动端 (iOS Safari)** | ⚠️ 自动降级 | iOS Safari 不完全支持 MSE 时自动降级为原生 HLS 播放 |

---

## 🧪 运行测试与演示

```bash
# 启动单元测试 (Vitest)
npm test

# 生产环境打包构建 (TSUP)
npm run build
```

在本地直接双击打开 `index.html` 即可进入弱网模拟交互演练场，实时测试极弱网、网络瞬断与恢复场景。

---

## 👨‍💻 开发者 (Author)

- **作者 / 维护者**: [Troray](https://github.com/Troray)
- **GitHub 主页**: [@Troray](https://github.com/Troray)

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 许可协议开源。Copyright (c) 2026 [Troray](https://github.com/Troray).
