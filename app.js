(function () {
  "use strict";

  const STORE_KEY = "gh-music-box-settings";
  const CACHE_KEY = "gh-music-box-cache";

  const AUDIO_EXTS = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "webm"];
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
  const COVER_NAMES = ["cover", "folder", "album", "albumart", "artwork", "front", "poster"];

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
    closeModalBtn: $("closeModalBtn"),
    formError: $("formError"),
    toast: $("toast"),
  };

  let settings = {
    owner: "WilliamQAQq",
    repo: "music-box",
    branch: "",
    path: "music",
    token: "",
  };

  let tracks = [];        // { title, url, path, dir }
  let covers = new Map(); // dir -> cover url
  let order = [];         // play order of track indices
  let pos = -1;           // current position within order
  let filteredTracks = []; // indices visible after search
  let currentIndex = -1;  // index in tracks[]

  let shuffle = localStorage.getItem("gh-shuffle") === "1";
  let repeat = localStorage.getItem("gh-repeat") || "none";
  let isSeeking = false;

  const audio = els.audio;

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
  els.bannerCta.addEventListener("click", openSettings);
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
        const title = baseName.replace(/[_-]+/g, " ");
        newTracks.push({ title, path: p, dir, url: rawUrl(branch, p) });
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

  async function loadLibrary(force) {
    if (!settings.owner || !settings.repo) {
      showBanner(true);
      return;
    }

    const cache = loadCache();
    if (!force && cache && cache.owner === settings.owner && cache.repo === settings.repo) {
      applyLibrary(cache);
      showBanner(false);
      return;
    }

    setLoading(true);
    try {
      const branch = await getDefaultBranch();
      const { tracks: t, covers: c } = await fetchTracks(branch);
      tracks = t;
      covers = c;
      saveCache({ owner: settings.owner, repo: settings.repo, branch, tracks: t, covers: [...c] });
      applyLibrary({ tracks: t, covers: c });
      showBanner(false);
      toast("已加载 " + t.length + " 首音乐");
    } catch (err) {
      setLoading(false);
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
    tracks = data.tracks;
    covers = data.covers instanceof Map ? data.covers : new Map(data.covers);
    if (!tracks.length) {
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
      if (!q || t.title.toLowerCase().indexOf(q) !== -1 || t.path.toLowerCase().indexOf(q) !== -1) {
        filteredTracks.push(i);
      }
    });
    renderPlaylist();
  }

  function setLoading(on) {
    els.playlist.innerHTML = on ? '<div class="spinner"></div>' : "";
    els.trackCount.textContent = on ? "加载中…" : "";
    els.emptyState.hidden = on;
  }

  function showBanner(show) {
    els.banner.hidden = !show;
    if (show) {
      if (settings.owner && settings.repo) {
        els.bannerTitle.textContent = "音乐仓库加载失败";
        els.bannerSub.textContent = "请检查仓库是否公开、地址是否正确，或添加访问令牌";
        els.bannerCta.textContent = "重新配置";
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
    els.trackCount.textContent = filteredTracks.length + " 首";
  }

  function renderPlaylist() {
    renderCount();
    const frag = document.createDocumentFragment();
    filteredTracks.forEach((tIndex, k) => {
      const t = tracks[tIndex];
      const li = document.createElement("li");
      li.className = "playlist-item";
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
      meta.textContent = t.dir || "/";

      li.append(idx, eq, name, meta);
      li.addEventListener("click", () => playTrackByIndex(tIndex));
      frag.appendChild(li);
    });
    els.playlist.innerHTML = "";
    els.playlist.appendChild(frag);

    if (currentIndex !== -1) {
      const el = els.playlist.querySelector(".playlist-item.active");
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /* ---------------- player logic ---------------- */

  function playTrackByIndex(tIndex) {
    if (order.length === 0 || !filteredTracks.includes(tIndex)) {
      order = filteredTracks.slice();
    }
    pos = order.indexOf(tIndex);
    if (pos === -1) { order = filteredTracks.slice(); pos = order.indexOf(tIndex); }
    if (pos === -1) return;
    currentIndex = tIndex;
    startPlayback();
  }

  function startPlayback() {
    const t = tracks[currentIndex];
    if (!t) return;
    audio.src = t.url;
    audio.play().catch(() => toast("无法播放该文件", true));
    els.trackTitle.textContent = t.title;
    els.trackSub.textContent = t.dir || "/";
    const cover = lookupCover(t.dir);
    if (cover) els.coverArt.src = cover;
    renderPlaylist();
    updateMediaSession(t, cover);
  }

  function currentTrack() {
    return currentIndex !== -1 ? tracks[currentIndex] : null;
  }

  function nextTrack() {
    if (!order.length) return;
    if (repeat === "one") { restart(); return; }
    if (shuffle && order.length > 1) {
      let n;
      do { n = Math.floor(Math.random() * order.length); } while (n === pos && order.length > 1);
      pos = n;
    } else {
      if (pos >= order.length - 1) {
        if (repeat === "all") pos = 0;
        else return;
      } else {
        pos++;
      }
    }
    currentIndex = order[pos];
    startPlayback();
  }

  function prevTrack() {
    if (audio.currentTime > 3 || !order.length) { restart(); return; }
    if (shuffle && order.length > 1) {
      let n;
      do { n = Math.floor(Math.random() * order.length); } while (n === pos && order.length > 1);
      pos = n;
    } else if (pos > 0) {
      pos--;
    } else {
      restart();
      return;
    }
    currentIndex = order[pos];
    startPlayback();
  }

  function restart() {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function togglePlay() {
    if (currentIndex === -1 && order.length) {
      playTrackByIndex(order[0]);
      return;
    }
    if (!currentTrack()) return;
    if (audio.paused) audio.play().catch(() => toast("无法播放该文件", true));
    else audio.pause();
  }

  function toggleShuffle() {
    shuffle = !shuffle;
    localStorage.setItem("gh-shuffle", shuffle ? "1" : "0");
    els.shuffleBtn.classList.toggle("on", shuffle);
    if (shuffle) toast("已开启随机播放");
  }

  function cycleRepeat() {
    const modes = ["none", "all", "one"];
    const i = modes.indexOf(repeat);
    repeat = modes[(i + 1) % modes.length];
    localStorage.setItem("gh-repeat", repeat);
    updateRepeatUI();
  }

  function updateRepeatUI() {
    els.repeatBtn.classList.toggle("on", repeat !== "none");
    els.repeatBtn.classList.toggle("repeat-one", repeat === "one");
    els.repeatBtn.title = repeat === "none" ? "循环模式：关闭" : repeat === "all" ? "循环模式：列表循环" : "循环模式：单曲循环";
  }

  /* ---------------- audio events ---------------- */

  audio.addEventListener("loadedmetadata", () => {
    if (isFinite(audio.duration)) {
      els.seek.max = audio.duration;
      els.durTime.textContent = fmt(audio.duration);
    }
  });

  audio.addEventListener("durationchange", () => {
    if (isFinite(audio.duration)) {
      els.seek.max = audio.duration;
      els.durTime.textContent = fmt(audio.duration);
    }
  });

  audio.addEventListener("timeupdate", () => {
    if (!isSeeking && isFinite(audio.duration)) {
      els.seek.value = audio.currentTime;
      els.curTime.textContent = fmt(audio.currentTime);
    }
  });

  audio.addEventListener("play", () => {
    els.iconPlay.style.display = "none";
    els.iconPause.style.display = "";
    els.playlist.querySelectorAll(".playlist-item.active").forEach((el) => el.classList.add("playing"));
    navigator.mediaSession && (navigator.mediaSession.playbackState = "playing");
  });

  audio.addEventListener("pause", () => {
    els.iconPlay.style.display = "";
    els.iconPause.style.display = "none";
    els.playlist.querySelectorAll(".playlist-item.playing").forEach((el) => el.classList.remove("playing"));
    navigator.mediaSession && (navigator.mediaSession.playbackState = "paused");
  });

  audio.addEventListener("ended", () => {
    if (repeat === "one") { restart(); return; }
    nextTrack();
  });

  audio.addEventListener("error", () => {
    if (currentIndex !== -1) {
      toast("无法播放：" + (tracks[currentIndex] ? tracks[currentIndex].path : ""), true);
      nextTrack();
    }
  });

  /* ---------------- controls ---------------- */

  els.playBtn.addEventListener("click", togglePlay);
  els.nextBtn.addEventListener("click", nextTrack);
  els.prevBtn.addEventListener("click", prevTrack);
  els.shuffleBtn.addEventListener("click", toggleShuffle);
  els.repeatBtn.addEventListener("click", cycleRepeat);

  els.seek.addEventListener("input", () => {
    isSeeking = true;
    els.curTime.textContent = fmt(parseFloat(els.seek.value));
  });
  els.seek.addEventListener("change", () => {
    audio.currentTime = parseFloat(els.seek.value);
    isSeeking = false;
  });

  function setVolume(v) {
    audio.volume = v / 100;
    localStorage.setItem("gh-volume", v);
    els.muteBtn.classList.toggle("on", v === 0);
  }

  els.volume.addEventListener("input", () => setVolume(parseInt(els.volume.value, 10)));

  els.muteBtn.addEventListener("click", () => {
    if (audio.volume > 0) { els.volume.value = 0; setVolume(0); }
    else { els.volume.value = 80; setVolume(80); }
  });

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------------- media session ---------------- */

  function updateMediaSession(t, cover) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: settings.owner,
        album: settings.repo,
        artwork: cover ? [{ src: cover, sizes: "512x512" }] : [],
      });
      navigator.mediaSession.setActionHandler("play", togglePlay);
      navigator.mediaSession.setActionHandler("pause", togglePlay);
      navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
      navigator.mediaSession.setActionHandler("nexttrack", nextTrack);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- keyboard ---------------- */

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    switch (e.key) {
      case " ": e.preventDefault(); togglePlay(); break;
      case "ArrowRight": audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
      case "ArrowLeft": audio.currentTime = Math.max(0, audio.currentTime - 5); break;
      case "ArrowUp": e.preventDefault(); els.volume.value = Math.min(100, parseInt(els.volume.value, 10) + 5); setVolume(parseInt(els.volume.value, 10)); break;
      case "ArrowDown": e.preventDefault(); els.volume.value = Math.max(0, parseInt(els.volume.value, 10) - 5); setVolume(parseInt(els.volume.value, 10)); break;
      case "n": case "N": nextTrack(); break;
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
    const v = parseInt(localStorage.getItem("gh-volume"), 10);
    if (!isNaN(v)) { els.volume.value = v; audio.volume = v / 100; els.muteBtn.classList.toggle("on", v === 0); }
    loadLibrary(false);
  }

  init();
})();
