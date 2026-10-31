(function () {
  "use strict";

  const STORE_KEY = "gh-music-box-settings-v2";
  const CACHE_KEY = "gh-music-box-cache-v2";

  const AUDIO_EXTS = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "webm"];
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
  const COVER_NAMES = ["cover", "folder", "album", "albumart", "artwork", "front", "poster"];

  // 连续多少首播放失败后停止自动跳歌(防止断网时无限跳歌)
  const MAX_ERROR_STREAK = 3;

  const $ = (id) => document.getElementById(id);

  const els = {
    audio: $("audio"),
    banner: $("banner"),
    bannerTitle: $("bannerTitle"),
    bannerSub: $("bannerSub"),
    bannerCta: $("bannerCta"),
    reloadBtn: $("reloadBtn"),
    settingsBtn: $("settingsBtn"),
    searchInput: $("searchInput"),
    trackCount: $("trackCount"),
    playlist: $("playlist"),
    emptyState: $("emptyState"),
    viewToggle: $("viewToggle"),
    coverArt: $("coverArt"),
    trackTitle: $("trackTitle"),
    trackSub: $("trackSub"),
    playBtn: $("playBtn"),
    iconPlay: $("iconPlay"),
    iconPause: $("iconPause"),
    prevBtn: $("prevBtn"),
    nextBtn: $("nextBtn"),
    shuffleBtn: $("shuffleBtn"),
    repeatBtn: $("repeatBtn"),
    muteBtn: $("muteBtn"),
    seek: $("seek"),
    volume: $("volume"),
    curTime: $("curTime"),
    durTime: $("durTime"),
    settingsModal: $("settingsModal"),
    settingsForm: $("settingsForm"),
    setOwner: $("setOwner"),
    setRepo: $("setRepo"),
    setBranch: $("setBranch"),
    setPath: $("setPath"),
    setToken: $("setToken"),
    resetSettingsBtn: $("resetSettingsBtn"),
    closeModalBtn: $("closeModalBtn"),
    formError: $("formError"),
    toast: $("toast"),
  };

  const DEFAULT_SETTINGS = {
    owner: "WilliamQAQq",
    repo: "music-box",
    branch: "",
    path: "music",
    token: "",
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS);

  let tracks = [];        // { title, artist, album, url, path, dir }
  let covers = new Map(); // dir -> cover url
  let order = [];         // 当前播放上下文(tracks 下标),随机模式下为打乱后的顺序
  let pos = -1;           // 当前曲目在 order 中的位置
  let filteredTracks = []; // 搜索过滤后可见的 tracks 下标
  let currentIndex = -1;  // 当前曲目在 tracks[] 中的下标

  let shuffle = localStorage.getItem("gh-shuffle") === "1";
  let repeat = localStorage.getItem("gh-repeat") || "none";
  let view = localStorage.getItem("gh-view") || "artist";
  let isSeeking = false;
  let errorStreak = 0;
  let lastVolume = 80;    // 取消静音时恢复的音量

  const audio = els.audio;
  const DEFAULT_COVER = els.coverArt.getAttribute("src");

  /* ---------------- settings ---------------- */

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) Object.assign(settings, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  }

  function fillSettingsForm() {
    els.setOwner.value = settings.owner;
    els.setRepo.value = settings.repo;
    els.setBranch.value = settings.branch;
    els.setPath.value = settings.path;
    els.setToken.value = settings.token;
  }

  function openSettings() {
    fillSettingsForm();
    els.formError.textContent = "";
    els.settingsModal.hidden = false;
    els.setOwner.focus();
  }

  function closeSettings() {
    els.settingsModal.hidden = true;
  }

  els.settingsBtn.addEventListener("click", openSettings);
  els.bannerCta.addEventListener("click", () => {
    if (settings.owner && settings.repo) loadLibrary(true);
    else openSettings();
  });
  els.closeModalBtn.addEventListener("click", closeSettings);
  els.settingsModal.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });

  els.settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    settings.owner = els.setOwner.value.trim();
    settings.repo = els.setRepo.value.trim();
    settings.branch = els.setBranch.value.trim();
    settings.path = els.setPath.value.trim().replace(/^\/+|\/+$/g, "");
    settings.token = els.setToken.value.trim();
    saveSettings();
    closeSettings();
    loadLibrary(true);
  });

  if (els.resetSettingsBtn) {
    els.resetSettingsBtn.addEventListener("click", () => {
      settings = Object.assign({}, DEFAULT_SETTINGS);
      saveSettings();
      fillSettingsForm();
      closeSettings();
      loadLibrary(true);
    });
  }

  /* ---------------- github api ---------------- */

  function ghHeaders() {
    const h = { Accept: "application/vnd.github+json" };
    if (settings.token) h.Authorization = "token " + settings.token;
    return h;
  }

  async function ghFetch(url) {
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      if (res.status === 401) msg = "令牌无效或已过期";
      if (res.status === 403) msg = "访问被拒绝(私有仓库需令牌，或触发 API 限流)";
      if (res.status === 404) msg = "仓库或路径不存在";
      if (res.status === 429) msg = "GitHub API 限流，请稍后重试或填入令牌";
      throw new Error(msg);
    }
    return res.json();
  }

  async function getDefaultBranch() {
    if (settings.branch) return settings.branch;
    const info = await ghFetch(
      "https://api.github.com/repos/" + encodeURIComponent(settings.owner) + "/" + encodeURIComponent(settings.repo)
    );
    return info.default_branch || "main";
  }

  function rawUrl(branch, path) {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return "https://raw.githubusercontent.com/" +
      encodeURIComponent(settings.owner) + "/" +
      encodeURIComponent(settings.repo) + "/" +
      encodeURIComponent(branch) + "/" +
      encodedPath;
  }

  async function fetchTracks(branch) {
    const tree = await ghFetch(
      "https://api.github.com/repos/" +
      encodeURIComponent(settings.owner) + "/" +
      encodeURIComponent(settings.repo) + "/git/trees/" +
      encodeURIComponent(branch) + "?recursive=1"
    );
    if (tree.truncated) toast("仓库较大，文件列表可能不完整", true);

    const items = tree.tree || [];
    const prefix = settings.path ? settings.path.replace(/\/+$/, "") + "/" : "";

    const newTracks = [];
    const coverMap = new Map();

    for (const it of items) {
      if (it.type !== "blob") continue;
      const p = it.path || "";
      if (prefix && p.indexOf(prefix) !== 0) continue;

      const lower = p.toLowerCase();
      const dot = lower.lastIndexOf(".");
      if (dot === -1) continue;
      const ext = lower.slice(dot + 1);
      const baseName = lower.slice(lower.lastIndexOf("/") + 1, dot);
      const dir = p.slice(0, p.lastIndexOf("/"));

      if (AUDIO_EXTS.indexOf(ext) !== -1) {
        const title = p.slice(p.lastIndexOf("/") + 1, dot).replace(/[_-]+/g, " ");
        newTracks.push({ title, artist: "", album: "", path: p, dir, url: rawUrl(branch, p) });
      } else if (IMAGE_EXTS.indexOf(ext) !== -1) {
        if (!coverMap.has(dir) || COVER_NAMES.indexOf(baseName) !== -1) {
          coverMap.set(dir, rawUrl(branch, p));
        }
      }
    }

    newTracks.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
    return { tracks: newTracks, covers: coverMap };
  }

  function lookupCover(dir) {
    let d = dir;
    while (true) {
      if (covers.has(d)) return covers.get(d);
      if (!d) break;
      const i = d.lastIndexOf("/");
      if (i === -1) d = "";
      else d = d.slice(0, i);
    }
    return null;
  }

  /* ---------------- loading ---------------- */

  async function loadFromMusicJson() {
    const res = await fetch("music.json", { cache: "no-store" });
    if (!res.ok) throw new Error("no music.json");
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error("bad music.json");
    const t = [];
    const c = new Map();
    list.forEach((item) => {
      if (!item || !item.url) return;
      const url = String(item.url);
      const dir = item.dir || (url.indexOf("/") !== -1 ? url.slice(0, url.lastIndexOf("/")) : "");
      t.push({
        title: String(item.title || url.slice(url.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")),
        artist: item.artist ? String(item.artist) : "",
        album: item.album ? String(item.album) : "",
        cover: item.cover ? String(item.cover) : "",
        url: url,
        path: url,
        dir: dir,
      });
      if (item.cover && !c.has(dir)) c.set(dir, String(item.cover));
    });
    return { tracks: t, covers: c };
  }

  // 是否可使用本站同源 music.json(默认仓库且未指定其他分支，目录为空/music 或 music 子目录)
  function canUseLocalManifest() {
    if (settings.owner.toLowerCase() !== DEFAULT_SETTINGS.owner.toLowerCase()) return false;
    if (settings.repo.toLowerCase() !== DEFAULT_SETTINGS.repo.toLowerCase()) return false;
    if (settings.branch) return false;
    const p = settings.path;
    return !p || p === DEFAULT_SETTINGS.path || p.indexOf(DEFAULT_SETTINGS.path + "/") === 0;
  }

  function filterLocalManifest(data) {
    const p = settings.path;
    if (!p || p === DEFAULT_SETTINGS.path) return data;
    const prefix = p.replace(/\/+$/, "") + "/";
    return {
      tracks: data.tracks.filter((t) => t.path.indexOf(prefix) === 0),
      covers: data.covers,
    };
  }

  function toCoverMap(c) {
    return c instanceof Map ? c : new Map(c || []);
  }

  function libraryKey(t, c) {
    return JSON.stringify([t || [], [...toCoverMap(c)]]);
  }

  let loadSeq = 0;

  // 有缓存时先秒开缓存；默认仓库同时在后台拉取最新 music.json，有变化就更新(加歌后刷新即可见)
  async function loadLibrary(force) {
    if (!settings.owner || !settings.repo) {
      showBanner(true);
      return;
    }

    const seq = ++loadSeq;
    const useLocal = canUseLocalManifest();
    const cache = force ? null : loadCache();
    const useCache = !!(cache &&
      cache.owner === settings.owner &&
      cache.repo === settings.repo &&
      (cache.branch || "") === settings.branch &&
      (cache.path === undefined ? DEFAULT_SETTINGS.path : cache.path) === settings.path &&
      Array.isArray(cache.tracks) && cache.tracks.length);

    if (useCache) {
      applyLibrary(cache);
      showBanner(false);
      // 自定义外部仓库走 GitHub API(有每小时限额)，命中缓存时不自动后台重扫，点刷新按钮再扫
      if (!useLocal) return;
    } else {
      setLoading(true);
    }

    try {
      let data = null;
      if (useLocal) {
        try {
          data = filterLocalManifest(await loadFromMusicJson());
        } catch (e) { /* music.json 不存在时回退到 GitHub API */ }
      }
      if (!data || !data.tracks.length) {
        // 已有缓存时不为后台刷新消耗 GitHub API 限额
        if (useCache) return;
        const branch = await getDefaultBranch();
        data = await fetchTracks(branch);
      }
      if (seq !== loadSeq) return;

      const newCovers = toCoverMap(data.covers);
      const changed = !useCache || libraryKey(data.tracks, newCovers) !== libraryKey(cache.tracks, cache.covers);
      saveCache({
        owner: settings.owner,
        repo: settings.repo,
        branch: settings.branch,
        path: settings.path,
        tracks: data.tracks,
        covers: [...newCovers],
      });
      if (changed) {
        applyLibrary({ tracks: data.tracks, covers: newCovers });
        toast((useCache ? "歌单已更新，共 " : "已加载 ") + data.tracks.length + " 首音乐");
      }
      showBanner(false);
    } catch (err) {
      if (seq !== loadSeq || useCache) return;
      setLoading(false);
      els.trackCount.textContent = "";
      showBanner(true);
      toast("加载失败：" + err.message, true);
    }
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (c.covers) c.covers = new Map(c.covers);
      return c;
    } catch (e) { return null; }
  }

  function saveCache(c) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* ignore */ }
  }

  function applyLibrary(data) {
    // 歌单更新时按 url 重新映射当前曲目与播放顺序，避免正在播放的歌错位
    const oldTracks = tracks;
    tracks = data.tracks;
    covers = toCoverMap(data.covers);
    const idxByUrl = new Map(tracks.map((t, i) => [t.url, i]));
    const remap = (i) => {
      const t = oldTracks[i];
      return t && idxByUrl.has(t.url) ? idxByUrl.get(t.url) : -1;
    };
    if (currentIndex !== -1) currentIndex = remap(currentIndex);
    order = order.map(remap).filter((i) => i !== -1);
    pos = currentIndex !== -1 ? order.indexOf(currentIndex) : -1;

    if (!tracks.length) {
      filteredTracks = [];
      els.emptyState.hidden = false;
      els.playlist.innerHTML = "";
      renderCount();
      return;
    }
    els.emptyState.hidden = true;
    applyFilter();
    setLoading(false);
  }

  function applyFilter() {
    const q = els.searchInput.value.trim().toLowerCase();
    filteredTracks = [];
    tracks.forEach((t, i) => {
      if (!q ||
        t.title.toLowerCase().indexOf(q) !== -1 ||
        t.artist.toLowerCase().indexOf(q) !== -1 ||
        t.album.toLowerCase().indexOf(q) !== -1 ||
        t.path.toLowerCase().indexOf(q) !== -1) {
        filteredTracks.push(i);
      }
    });
    renderPlaylist(false);
  }

  function setLoading(on) {
    if (on) {
      els.playlist.innerHTML = '<div class="spinner"></div>';
      els.trackCount.textContent = "加载中…";
      els.emptyState.hidden = true;
    } else {
      const sp = els.playlist.querySelector(".spinner");
      if (sp) sp.remove();
    }
  }

  function showBanner(show) {
    els.banner.hidden = !show;
    if (show) {
      if (settings.owner && settings.repo) {
        els.bannerTitle.textContent = "音乐列表加载失败";
        els.bannerSub.textContent = "请检查网络后重试；如需从其他 GitHub 仓库读取，可在右上角设置中修改";
        els.bannerCta.textContent = "重试";
      } else {
        els.bannerTitle.textContent = "设置你的 GitHub 音乐仓库";
        els.bannerSub.textContent = "填入仓库信息后即可在线播放仓库里的音乐";
        els.bannerCta.textContent = "打开设置";
      }
    }
  }

  els.reloadBtn.addEventListener("click", () => {
    if (!settings.owner || !settings.repo) { openSettings(); return; }
    loadLibrary(true);
  });

  els.searchInput.addEventListener("input", applyFilter);

  /* ---------------- playlist rendering ---------------- */

  function renderCount() {
    if (view === "artist") {
      const artists = new Set(filteredTracks.map((i) => tracks[i].artist || "未分类"));
      els.trackCount.textContent = filteredTracks.length + " 首 · " + artists.size + " 位歌手";
    } else {
      els.trackCount.textContent = filteredTracks.length + " 首";
    }
  }

  function makeItem(tIndex, k, showMeta) {
    const t = tracks[tIndex];
    const li = document.createElement("li");
    li.className = "playlist-item";
    li.dataset.index = tIndex;
    if (tIndex === currentIndex) li.classList.add("active");
    if (tIndex === currentIndex && !audio.paused) li.classList.add("playing");

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = k + 1;

    const eq = document.createElement("span");
    eq.className = "eq";
    eq.innerHTML = "<span></span><span></span><span></span>";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = t.title;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = showMeta && t.artist ? t.artist : (t.album || t.dir || "/");

    li.append(idx, eq, name, meta);
    li.addEventListener("click", () => playTrackByIndex(tIndex));
    return li;
  }

  function renderPlaylist(scrollToActive) {
    renderCount();
    const frag = document.createDocumentFragment();
    if (view === "artist") {
      let lastArtist = null;
      filteredTracks.forEach((tIndex, k) => {
        const artist = tracks[tIndex].artist || "未分类";
        if (artist !== lastArtist) {
          lastArtist = artist;
          const hdr = document.createElement("li");
          hdr.className = "playlist-header";
          hdr.textContent = artist;
          frag.appendChild(hdr);
        }
        frag.appendChild(makeItem(tIndex, k, false));
      });
    } else {
      filteredTracks.forEach((tIndex, k) => {
        frag.appendChild(makeItem(tIndex, k, true));
      });
    }
    els.playlist.innerHTML = "";
    els.playlist.appendChild(frag);
    if (scrollToActive) scrollActiveIntoView();
  }

  // 切歌时只更新高亮，不重建整个列表
  function highlightActive(scroll) {
    els.playlist.querySelectorAll(".playlist-item").forEach((li) => {
      const on = Number(li.dataset.index) === currentIndex;
      li.classList.toggle("active", on);
      li.classList.toggle("playing", on && !audio.paused);
    });
    if (scroll) scrollActiveIntoView();
  }

  function scrollActiveIntoView() {
    if (currentIndex === -1) return;
    const el = els.playlist.querySelector(".playlist-item.active");
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function setView(next) {
    if (next !== "artist" && next !== "flat") return;
    view = next;
    localStorage.setItem("gh-view", view);
    els.viewToggle.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.view === view);
    });
    applyFilter();
  }

  els.viewToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) setView(btn.dataset.view);
  });

  /* ---------------- player logic ---------------- */

  function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // 按当前随机开关排列播放顺序；first 若在列表中则排在最前
  function arrangeOrder(list, first) {
    const out = list.slice();
    if (shuffle) {
      shuffleInPlace(out);
      const i = first == null ? -1 : out.indexOf(first);
      if (i > 0) { out.splice(i, 1); out.unshift(first); }
    } else {
      out.sort((a, b) => a - b);
    }
    return out;
  }

  // 以当前可见列表(搜索结果)作为播放上下文
  function buildOrder(first) {
    order = arrangeOrder(filteredTracks, first);
    pos = first == null ? -1 : order.indexOf(first);
  }

  function ensureOrder() {
    if (order.length) return true;
    if (!filteredTracks.length) return false;
    buildOrder(currentIndex !== -1 && filteredTracks.indexOf(currentIndex) !== -1 ? currentIndex : null);
    return order.length > 0;
  }

  function playAt(p) {
    pos = p;
    currentIndex = order[p];
    startPlayback();
  }

  function playTrackByIndex(tIndex) {
    errorStreak = 0;
    buildOrder(tIndex);
    if (pos === -1) { order.unshift(tIndex); pos = 0; }
    playAt(pos);
  }

  function setPlayingUI(playing) {
    els.iconPlay.style.display = playing ? "none" : "";
    els.iconPause.style.display = playing ? "" : "none";
    els.playlist.querySelectorAll(".playlist-item").forEach((el) => {
      const isCur = Number(el.dataset.index) === currentIndex;
      el.classList.toggle("playing", playing && isCur);
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }

  // play() 被切歌打断时会以 AbortError 拒绝，这属于正常情况，不应提示错误；
  // 真正的解码/网络错误会触发 audio 的 error 事件，在那里统一处理。
  function safePlay() {
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch((e) => {
        if (!e || e.name === "AbortError") return;
        setPlayingUI(false);
        if (e.name === "NotAllowedError") toast("浏览器阻止了自动播放，请点击播放按钮", true);
      });
    }
  }

  function startPlayback() {
    const t = tracks[currentIndex];
    if (!t) return;
    isSeeking = false;
    audio.src = t.url;
    els.seek.max = 0;
    els.seek.value = 0;
    els.curTime.textContent = "0:00";
    els.durTime.textContent = "0:00";
    safePlay();
    els.trackTitle.textContent = t.title;
    els.trackSub.textContent = t.artist || t.album || t.dir || "/";
    const cover = t.cover || lookupCover(t.dir);
    els.coverArt.src = cover || DEFAULT_COVER;
    highlightActive(true);
    updateMediaSession(t, cover);
  }

  // auto=true 表示自然播完/出错后的自动切歌；手动点“下一首”传 false
  function nextTrack(auto) {
    if (!ensureOrder()) return;
    if (pos < order.length - 1) { playAt(pos + 1); return; }
    // 已到列表末尾：自然播完且没开列表循环则停止
    if (auto === true && repeat !== "all") return;
    if (shuffle && order.length > 1) {
      const last = order[order.length - 1];
      order = arrangeOrder(order, null);
      if (order[0] === last) order.push(order.shift()); // 新一轮不立刻重复刚播完的歌
    }
    playAt(0);
  }

  function prevTrack() {
    if (currentIndex !== -1 && audio.currentTime > 3) { restart(); return; }
    if (!ensureOrder()) return;
    if (pos > 0) { playAt(pos - 1); return; }
    if (currentIndex === -1 || pos === -1) { playAt(0); return; }
    if (repeat === "all" && order.length > 1) { playAt(order.length - 1); return; }
    restart();
  }

  function restart() {
    audio.currentTime = 0;
    safePlay();
  }

  function togglePlay() {
    if (currentIndex === -1 && !audio.currentSrc) {
      // 还没播过任何歌：从当前列表开头(随机模式下为随机一首)开始
      if (ensureOrder()) playAt(pos >= 0 ? pos : 0);
      return;
    }
    if (audio.error && currentIndex !== -1) {
      errorStreak = 0;
      startPlayback();
      return;
    }
    if (audio.paused) safePlay();
    else audio.pause();
  }

  function toggleShuffle() {
    shuffle = !shuffle;
    localStorage.setItem("gh-shuffle", shuffle ? "1" : "0");
    els.shuffleBtn.classList.toggle("on", shuffle);
    if (order.length) {
      const cur = currentIndex !== -1 ? currentIndex : null;
      order = arrangeOrder(order, cur);
      pos = cur == null ? -1 : order.indexOf(cur);
    }
    toast(shuffle ? "已开启随机播放" : "已关闭随机播放");
  }

  function cycleRepeat() {
    const modes = ["none", "all", "one"];
    const labels = { none: "循环关闭", all: "列表循环", one: "单曲循环" };
    const i = modes.indexOf(repeat);
    repeat = modes[(i + 1) % modes.length];
    localStorage.setItem("gh-repeat", repeat);
    updateRepeatUI();
    toast("循环模式：" + labels[repeat]);
  }

  function updateRepeatUI() {
    if (["none", "all", "one"].indexOf(repeat) === -1) repeat = "none";
    els.repeatBtn.classList.toggle("on", repeat !== "none");
    els.repeatBtn.classList.toggle("repeat-one", repeat === "one");
    els.repeatBtn.title = repeat === "none" ? "循环模式：关闭" : repeat === "all" ? "循环模式：列表循环" : "循环模式：单曲循环";
  }

  /* ---------------- audio events ---------------- */

  function updateDuration() {
    if (isFinite(audio.duration)) {
      els.seek.max = audio.duration;
      els.durTime.textContent = fmt(audio.duration);
    }
  }

  audio.addEventListener("loadedmetadata", updateDuration);
  audio.addEventListener("durationchange", updateDuration);

  audio.addEventListener("timeupdate", () => {
    if (!isSeeking && isFinite(audio.duration)) {
      els.seek.value = audio.currentTime;
      els.curTime.textContent = fmt(audio.currentTime);
    }
  });

  audio.addEventListener("play", () => setPlayingUI(true));

  audio.addEventListener("playing", () => { errorStreak = 0; });

  audio.addEventListener("pause", () => setPlayingUI(false));

  audio.addEventListener("ended", () => {
    if (repeat === "one") { restart(); return; }
    nextTrack(true);
  });

  audio.addEventListener("error", () => {
    if (currentIndex === -1 || !audio.error) return;
    setPlayingUI(false);
    const t = tracks[currentIndex];
    errorStreak++;
    if (order.length <= 1 || (pos >= order.length - 1 && repeat !== "all")) {
      toast("无法播放：" + (t ? t.title : ""), true);
      return;
    }
    if (errorStreak >= Math.min(order.length, MAX_ERROR_STREAK)) {
      toast("连续 " + errorStreak + " 首无法播放，已停止(请检查网络)", true);
      return;
    }
    toast("无法播放：" + (t ? t.title : ""), true);
    // 出错时即使是单曲循环也跳到下一首，避免卡死在坏文件上
    nextTrack(true);
  });

  /* ---------------- controls ---------------- */

  els.playBtn.addEventListener("click", togglePlay);
  els.nextBtn.addEventListener("click", () => nextTrack(false));
  els.prevBtn.addEventListener("click", prevTrack);
  els.shuffleBtn.addEventListener("click", toggleShuffle);
  els.repeatBtn.addEventListener("click", cycleRepeat);

  els.seek.addEventListener("input", () => {
    isSeeking = true;
    els.curTime.textContent = fmt(parseFloat(els.seek.value));
  });
  els.seek.addEventListener("change", () => {
    if (isFinite(audio.duration)) audio.currentTime = parseFloat(els.seek.value);
    isSeeking = false;
  });

  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    els.volume.value = v;
    audio.volume = v / 100;
    localStorage.setItem("gh-volume", v);
    if (v > 0) lastVolume = v;
    els.muteBtn.classList.toggle("on", v === 0);
  }

  els.volume.addEventListener("input", () => setVolume(els.volume.value));

  els.muteBtn.addEventListener("click", () => {
    if (Number(els.volume.value) > 0) setVolume(0);
    else setVolume(lastVolume || 80);
  });

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------------- media session ---------------- */

  function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const handlers = {
      play: () => { if (audio.paused) togglePlay(); },
      pause: () => audio.pause(),
      previoustrack: prevTrack,
      nexttrack: () => nextTrack(false),
      seekto: (d) => {
        if (d && isFinite(d.seekTime) && isFinite(audio.duration)) audio.currentTime = d.seekTime;
      },
    };
    Object.keys(handlers).forEach((k) => {
      try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (e) { /* 不支持该动作 */ }
    });
  }

  function updateMediaSession(t, cover) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || settings.owner,
        album: t.album || settings.repo,
        artwork: cover ? [{ src: cover, sizes: "512x512" }] : [],
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- keyboard ---------------- */

  document.addEventListener("keydown", (e) => {
    if (!els.settingsModal.hidden) {
      if (e.key === "Escape") closeSettings();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 不拦截 Ctrl+P 等浏览器快捷键

    const target = e.target;
    const tag = (target.tagName || "").toLowerCase();
    if (target.isContentEditable || tag === "textarea" || tag === "select") return;
    if (tag === "input") {
      if (target.type !== "range") return;            // 文本/搜索框里正常打字
      if (e.key.indexOf("Arrow") === 0) return;       // 滑块用方向键自行调节
    }
    // 焦点在按钮上时，空格/回车交给按钮原生行为，避免“按一次触发两次”
    if ((tag === "button" || tag === "a") && (e.key === " " || e.key === "Enter")) return;
    if (e.repeat && e.key.indexOf("Arrow") !== 0) return;

    switch (e.key) {
      case " ": e.preventDefault(); togglePlay(); break;
      case "ArrowRight":
        if (isFinite(audio.duration)) { e.preventDefault(); audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
        break;
      case "ArrowLeft":
        if (isFinite(audio.duration)) { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
        break;
      case "ArrowUp": e.preventDefault(); setVolume(Number(els.volume.value) + 5); break;
      case "ArrowDown": e.preventDefault(); setVolume(Number(els.volume.value) - 5); break;
      case "n": case "N": nextTrack(false); break;
      case "p": case "P": prevTrack(); break;
      case "m": case "M": els.muteBtn.click(); break;
    }
  });

  /* ---------------- toast ---------------- */

  let toastTimer = null;
  function toast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.classList.toggle("error", !!isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  /* ---------------- init ---------------- */

  function init() {
    loadSettings();
    updateRepeatUI();
    els.shuffleBtn.classList.toggle("on", shuffle);
    setView(view === "flat" ? "flat" : "artist");
    const v = parseInt(localStorage.getItem("gh-volume"), 10);
    if (!isNaN(v)) {
      if (v > 0) lastVolume = Math.min(100, v);
      setVolume(v);
    }
    setupMediaSession();
    loadLibrary(false);
  }

  init();
})();
