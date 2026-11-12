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
├── index.html            页面结构(维多利亚双栏沙龙、唱词卷轴与播放队列浮层)
├── style.css             样式(维多利亚黑胶留声机复古主题,响应式与触控适配)
├── app.js                主控逻辑(配置弹窗、缓存签名加载、筛选、队列管理、预加载与快捷键)
├── js/
│   ├── catalog-data.js   常量、流派/文件名映射、FNV-1a 指纹签名、分词检索与通用工具
│   ├── audio-fx.js       Web Audio DSP 引擎(异步双 LFO 合成器重合成与无缝循环黑胶模拟，关闭即断开旁路)
│   └── lyrics.js         LRC 时间轴解析、双语译文切换与自由滚动歌词控制器
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
改完 `index.html / style.css / app.js / js/*.js` 后,**必须把 index.html 里的版本号 `?v=21` 递增(如 `?v=22`)**。
否则访问者浏览器用缓存旧 JS,看不到更新(本项目踩过这个坑)。

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

- 分组渲染:按 `genre` / `artist` 在列表中插入 `playlist-header` 吸顶标题;清单变更比对使用 64-bit FNV-1a 指纹签名(`sig`),避免每次启动全量 `JSON.stringify` 比较和无效磁盘写入。
- 循环三档:`none → all → one`;`repeat-one` 类给按钮加"1"角标。
- 播放顺序与队列抽屉(`order[]`/`pos`/`#queueDrawer`):点歌时以当前可见列表为上下文,随机模式使用 Fisher-Yates 洗牌;列表每行附 `+` 下一首按钮,队列抽屉支持跳播、顶置下一首、移除、重洗与清空后续。
- 下一首智能预加载:起播稳定 1.4 秒后检查 `navigator.connection`(`saveData` / `2g` 跳过),利用离屏 `Audio` 预热下一首并自动释放解码器。
- 自然播完到列表末尾:列表循环则从头(随机模式重新洗牌),否则停止;手动点"下一首"在末尾回到开头。单曲循环只影响自然播完,手动切歌照常切。
- 播放出错自动跳下一首,连续 3 首失败即停止(防止断网时无限跳歌);`play()` 的 AbortError(切歌打断)不提示。
- 系统媒体键:Media Session API(初始化时注册一次,play/pause 分开处理);键盘:空格/方向键/N/P/M/L/V/S/Q,带 Ctrl/Alt/⌘ 时不拦截,设置弹窗打开时只响应 Esc。
- 搜索匹配标题/歌手/专辑/风格/路径,支持空格分隔多关键词 AND 防抖检索与一键清空/定位当前曲目。
- 生成脚本用 `mutagen.File(..., easy=True)`,mp3/m4a/flac/ogg 都能读歌手与风格标签。
- 模拟黑胶音效: Web Audio API (高低通/中频峰化滤波、偶次+tanh 软饱和且 DC 归零、33.3 RPM 抖晃延迟调制与 6 秒余弦交叉淡化无缝粉红噪声/炒豆爆音;关闭后 140ms 自动断开节点零空转开销)。
- 模拟合成器音效: Web Audio API (奇偶双异步 LFO 驱动六级高谐振全通 PWM 相位梳状矩阵、双共振峰雕刻与空气感高架、24dB/oct 双级联 Moog 阶梯低通滤波器 VCF、三声部 Juno 正交复音合唱与带限空间回声;关闭后 140ms 自动断开节点与停振 LFO)。
- localStorage 键:`gh-music-box-settings-v2`、`gh-music-box-cache-v2`、`gh-shuffle`、`gh-repeat`、`gh-view-v2`、`gh-volume`、`gh-lyrics-open`、`gh-lyrics-trans`、`gh-lyrics-live-v1`、`gh-vinyl-fx`、`gh-synth-fx`。

## 交接对象

- 仓库已公开,任何人可查看/克隆。
- 如需写权限,把接收方加为仓库协作者,或将仓库转移到接收方账号。
