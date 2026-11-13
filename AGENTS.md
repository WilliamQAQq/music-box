# 项目交接说明(AGENTS.md)

本文件供 AI 代码工具(如 Google Antigravity)与后续维护者快速理解本项目。

## 项目是什么

一个以 **GitHub 仓库为存储**的在线音乐播放器,部署在 GitHub Pages。

- 在线地址:https://williamqaqq.github.io/music-box/
- 仓库:https://github.com/WilliamQAQq/music-box (公开,约 475MB)
- 纯前端静态项目,无框架、无构建步骤,按 `defer` 顺序加载模块化脚本(`window.__MusicBox`)。

## 文件结构

```
/ (仓库根目录,即 GitHub Pages 站点根)
├── README.md             GitHub 仓库中文展示主页
├── README_EN.md          GitHub 仓库英文展示主页
├── index.html            页面结构(维多利亚双栏沙龙、唱词卷轴、调音台浮层与队列抽屉)
├── style.css             样式(维多利亚黑胶留声机复古主题,响应式与触控适配)
├── manifest.webmanifest  PWA 应用清单(可安装桌面应用图标与元信息)
├── sw.js                 Service Worker(应用外壳 SWR 缓存、Range 音频离线缓存与 LRU 淘汰)
├── app.js                主控编排(视图筛选、Keyed DOM 队列/列表、播放调度、预加载与快捷键)
├── js/
│   ├── catalog-data.js   常量、流派映射、FNV-1a 指纹签名、分享哈希编解码、LRC 导出与检索工具
│   ├── user-state.js     用户个人状态管理(我的珍藏、最近聆听、断点续播、睡眠定时与 A-B 复读)
│   ├── library-loader.js 曲库清单加载器(music.json / localStorage 指纹缓存 / GitHub API 兜底 / 设置弹窗)
│   ├── audio-fx.js       Web Audio DSP 引擎(黑胶/合成器分支、3 段 EQ、频谱 analyser 节点与 Crossfade/睡眠淡出总线)
│   ├── lyrics.js         LRC 时间轴解析、按需延迟加载、唱词检索、双语切换与 .lrc 导出控制器
│   └── studio-ui.js      留声机调音台浮层(<dialog popover="auto">、黄铜实时 Canvas 频谱、EQ/混合/倍速/Crossfade/分享直链)
├── tests/
│   ├── verify.mjs        Node 单元测试套件(清单一致性、工具函数、状态持久化与回归保护)
│   └── e2e_smoke.mjs     Playwright 无头浏览器端到端验证(桌面与 375px 移动端实测)
├── music.json            音乐清单(前端主数据源:标题/歌手/专辑/风格/相对路径)
├── lyrics.json           全馆时间轴滚动歌词库(LRC 原文/双语译文/纯器乐标记)
├── music/                音乐文件(mp3 等,目前 166 首)
└── .github/
    ├── assets/           README 实机预览图
    ├── gen_music_json.py 清单生成脚本(扫描 music/ 并读取 ID3 标签与在线歌词)
    └── workflows/update-music.yml   GitHub Actions:push 音乐后自动重跑脚本
```

## 核心机制

1. 前端 `app.js` 启动后 `fetch("music.json")`(同源相对路径,`cache: no-store`)得到曲目列表并渲染。
   老访客有 localStorage 缓存时先秒开缓存,同时后台拉最新 `music.json`,有变化自动刷新列表(加歌后刷新页面即见)。
2. 顶部展示十五大「风格歌单与国歌军乐」唱片集卡片(含「全部专区 / 🎷 沙龙流派 / 🎺 国歌军乐」分组切换，可一键整张播放或筛选进入歌单),列表支持「按风格 / 按作者 / 全部」三种视图切换(默认"按风格")。
3. 点击播放时,`<audio>` 的 src 直接用 music.json 里的相对 URL(浏览器自动按页面域名解析)。
4. 若 `music.json` 缺失或为空,前端自动回退到 GitHub API(`git/trees`)列文件(有 60 次/小时/IP 限流,仅作兜底)。

## 日常操作

### 加歌(唯一常规操作)
```
把 mp3 放入 music/ 文件夹
git pull --rebase; git add .; git commit -m "music: xxx"; git push
```
push 触发 GitHub Actions → 重新生成 `music.json`(自动读 ID3 歌手/专辑)→ Pages 重新构建 → 刷新页面可见。
先 `git pull --rebase` 是因为 Actions 机器人可能已往远端提交过 `music.json`,不拉取会导致 push 被拒。

### 改前端代码
改完 `index.html / style.css / app.js / js/*.js` 后,**必须同步递增 `index.html` 与 `sw.js` 里的缓存版本号(当前为 `?v=22` / `VERSION = "v22"`)**。
否则访问者浏览器或 Service Worker 会继续命中旧缓存,看不到更新(本项目踩过这个坑)。

### 运行本地测试与静态检查
```
node --test tests/verify.mjs
node tests/e2e_smoke.mjs
```

### 手动重新生成清单(本地)
```
python .github/gen_music_json.py   # 需要 mutagen: pip install mutagen
```

## 注意事项 / 坑

- **工作流依赖 mutagen**:`update-music.yml` 里那行 `python -m pip install --quiet mutagen` 不能删,否则 Actions 生成的 music.json 丢失所有 ID3 歌手信息(曾因此出过事故)。
- **无 ID3 标签的文件 / 风格归类**:在 `.github/gen_music_json.py` 的 `MANUAL_ARTIST` 补歌手,`ARTIST_GENRE` / `MANUAL_GENRE` 维护风格歌单映射(无映射时自动按 ID3 `genre` 标签推断或归入"其他典藏")。
- **GitHub 限制**:仓库建议 <1GB、单文件 <100MB。当前约 475MB,单曲最大约 15.5MB。私有仓库无法免费启用 GitHub Pages,需保持公开。
- **浏览器缓存**:music.json 用 `no-store` 拉取,且有本地缓存时也会后台重新拉取,加歌后刷新即见;前端 JS/CSS 靠 `?v=` 版本号破缓存。
- **`hidden` 属性**:style.css 里有全局 `[hidden]{display:none !important}`,不要删,否则带 `display` 样式的元素(如横幅)用 `hidden` 隐藏不掉。
- **URL 编码**:前端用相对 URL(原样交给浏览器),API 兜底路径时按路径段 `encodeURIComponent`。

## 技术要点(app.js)

- 分组渲染与 Keyed DOM 复用:按 `genre` / `artist` 在列表中插入 `playlist-header` 吸顶标题,列表行按 URL、队列行按 URL+出现序号复用 DOM 节点 (`replaceChildren`),避免筛选、收藏与队列调序重建整棵 DOM 树;清单变更比对使用 64-bit FNV-1a 指纹签名(`sig`)。
- 性能与离线优化:`lyrics.json` 采用真正按需延迟加载(首屏冷启动 0 歌词字节请求),`timeupdate` 仅在跨整秒边界时更新 `#curTime`;频谱 Canvas 基于 `contentvisibilityautostatechange` / 页面可见性 / 暂停状态自动停帧节能;通过 `sw.js` 提供仅限 `http:`/`https:` 的 Range 安全离线音轨缓存(兼容本地 `file://` 直接打开)。
- 个人雅集与留声机调音台:支持个人收藏(`♥` / `F` 键)、最近 45 首聆听历史、上次断点续播横幅、URL 分享直链(`#track=...&t=...`),以及 `<dialog popover="auto">` 顶层调音台(`E` 键):实时频谱、3 段 EQ + 预设、黑胶/合成器浓淡比例、0.75x–1.5x 保调倍速、0/2/4/6s Crossfade 曲间淡入淡出、睡眠定时(播完本曲/15/30/60 分钟渐弱停播)与 A-B 区间精听复读(`[ / ] / \`)。
- 循环三档:`none → all → one`;`repeat-one` 类给按钮加"1"角标。
- 播放顺序与队列抽屉(`order[]`/`pos`/`#queueDrawer`):点歌时以当前可见列表为上下文,随机模式使用 Fisher-Yates 洗牌;列表每行附 `♥` 与 `+` 下一首按钮,队列抽屉支持跳播、顶置下一首、移除、重洗与清空后续。
- 下一首智能预加载:起播稳定 1.4 秒后检查 `navigator.connection`(`saveData` / `2g` 跳过),利用离屏 `Audio` 预热下一首并自动释放解码器。
- 自然播完到列表末尾:列表循环则从头(随机模式重新洗牌),否则停止;手动点"下一首"在末尾回到开头。单曲循环只影响自然播完,手动切歌照常切。
- 播放出错自动跳下一首,连续 3 首失败即停止(防止断网时无限跳歌);`play()` 的 AbortError(切歌打断)不提示。
- 系统媒体键:Media Session API(初始化时注册一次,play/pause 分开处理);键盘:空格/方向键/N/P/M/L/V/S/Q/E/F/`[`/`]`/`\`,带 Ctrl/Alt/⌘ 时不拦截,设置弹窗打开时只响应 Esc。
- 搜索匹配标题/歌手/专辑/风格/路径,支持空格分隔多关键词 AND 防抖检索与一键清空/定位当前曲目。
- 生成脚本用 `mutagen.File(..., easy=True)`,mp3/m4a/flac/ogg 都能读歌手与风格标签。
- 模拟黑胶/合成器/均衡 DSP: Web Audio API 延迟创建上下文与节点,关闭后 140ms 自动断开节点与停振 LFO,零空转开销;并通过 `masterGain` 实现 Crossfade 与睡眠定时 10 秒柔顺渐弱。
- localStorage 键:`gh-music-box-settings-v2`、`gh-music-box-cache-v2`、`gh-shuffle`、`gh-repeat`、`gh-view-v2`、`gh-volume`、`gh-lyrics-open`、`gh-lyrics-trans`、`gh-lyrics-live-v1`、`gh-vinyl-fx`、`gh-synth-fx`、`gh-favorites-v1`、`gh-recent-v1`、`gh-resume-v1`、`gh-eq-v1`、`gh-fx-mix-v1`、`gh-playback-speed-v1`、`gh-crossfade-v1`、`gh-spectrum-v1`。

## 交接对象

- 仓库已公开,任何人可查看/克隆。
- 如需写权限,把接收方加为仓库协作者,或将仓库转移到接收方账号。
