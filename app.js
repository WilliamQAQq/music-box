(function () {
  "use strict";

  const ns = window.__MusicBox || {};
  const cat = ns.catalog;
  const {
    KEYS,
    AUDIO_EXTS,
    IMAGE_EXTS,
    COVER_NAMES,
    MAX_ERROR_STREAK,
    GENRE_PRESETS,
    GENRE_META,
    inferGenre,
    genreRank,
    genreCategory,
    buildSearchKey,
    tokenizeQuery,
    matchesSearchTokens,
    fmtTime,
    hashLibrarySignature,
    storageGet,
    storageSet,
    setPressedButtonState,
    debounce,
  } = cat;

  const DEFAULT_DOC_TITLE = document.title || "GitHub 音乐盒 · 维多利亚留声机";
  const PRELOAD_DELAY_MS = 1400;
  const PRELOAD_TIMEOUT_MS = 12000;
  const MAX_PRELOAD_CACHE = 12;

  const $ = (id) => document.getElementById(id);

  const els = {
    audio: $("audio"),
    topbar: document.querySelector(".topbar"),
    content: document.querySelector(".content"),
    player: $("player"),
    banner: $("banner"),
    bannerTitle: $("bannerTitle"),
    bannerSub: $("bannerSub"),
    bannerCta: $("bannerCta"),
    reloadBtn: $("reloadBtn"),
    settingsBtn: $("settingsBtn"),
    genreShelfTabs: $("genreShelfTabs"),
    genreShelf: $("genreShelf"),
    genreStage: $("genreStage"),
    genreStageSeal: $("genreStageSeal"),
    genreStageTitle: $("genreStageTitle"),
    genreStageDesc: $("genreStageDesc"),
    playGenreBtn: $("playGenreBtn"),
    shuffleGenreBtn: $("shuffleGenreBtn"),
    clearGenreBtn: $("clearGenreBtn"),
    searchInput: $("searchInput"),
    searchClearBtn: $("searchClearBtn"),
    locateTrackBtn: $("locateTrackBtn"),
    trackCount: $("trackCount"),
    playlist: $("playlist"),
    emptyState: $("emptyState"),
    viewToggle: $("viewToggle"),
    lyricsPanel: $("lyricsPanel"),
    lyricsTrackName: $("lyricsTrackName"),
    lyricsTransBtn: $("lyricsTransBtn"),
    lyricsCloseBtn: $("lyricsCloseBtn"),
    lyricsScroll: $("lyricsScroll"),
    lyricsList: $("lyricsList"),
    lyricsFollowBtn: $("lyricsFollowBtn"),
    lyricsToggleBtn: $("lyricsToggleBtn"),
    vinylFxBtn: $("vinylFxBtn"),
    synthFxBtn: $("synthFxBtn"),
    queueToggleBtn: $("queueToggleBtn"),
    queueCountBadge: $("queueCountBadge"),
    queueBackdrop: $("queueBackdrop"),
    queueDrawer: $("queueDrawer"),
    queueDrawerTitle: $("queueDrawerTitle"),
    queueReshuffleBtn: $("queueReshuffleBtn"),
    queueClearUpcomingBtn: $("queueClearUpcomingBtn"),
    queueCloseBtn: $("queueCloseBtn"),
    queueList: $("queueList"),
    queueEmpty: $("queueEmpty"),
    playerTrack: document.querySelector(".player-track"),
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

  let tracks = [];         // { title, artist, album, genre, cover, url, path, dir, _searchKey }
  let covers = new Map();  // dir -> cover url
  let order = [];          // 当前播放队列上下文(tracks 下标)
  let pos = -1;            // 当前曲目在 order 中的位置
  let filteredTracks = []; // 歌单筛选+搜索后按当前视图排序的 tracks 下标
  let currentIndex = -1;   // 当前曲目在 tracks[] 中的下标
  let activePlaylistEl = null; // 当前高亮的 .playlist-item DOM 引用(O(1) 更新)
  let activeGenre = "all"; // 当前选中的风格歌单("all" 表示全部馆藏)
  let shelfCategory = "all"; // 当前专区分组 ("all" | "salon" | "military")
  let shelfTabsApi = null;
  let lastModalTrigger = null;
  let lastQueueTrigger = null;

  let shuffle = storageGet(KEYS.SHUFFLE, "0") === "1";
  let repeat = storageGet(KEYS.REPEAT, "none") || "none";
  let view = storageGet(KEYS.VIEW, "genre") || "genre";
  let isSeeking = false;
  let errorStreak = 0;
  let lastVolume = 80;
  let loadSeq = 0;

  // 下一首音频智能预加载状态
  let preloadTimer = null;
  let preloadAbortTimer = null;
  let preloadAudioEl = null;
  let activePreloadUrl = "";
  const preloadedUrls = new Set();

  const audio = els.audio;
  const DEFAULT_COVER = els.coverArt.getAttribute("src");

  const audioFx = ns.createAudioFxController({
    audio,
    vinylBtn: els.vinylFxBtn,
    synthBtn: els.synthFxBtn,
    toast,
  });

  const lyricsCtrl = ns.createLyricsController({
    audio,
    els,
    getCurrentTrack: () => (currentIndex !== -1 ? tracks[currentIndex] || null : null),
    defaultTrackSub,
    safePlay,
    onBeforeMobileOpen: () => closeQueueDrawer(false),
  });

  /* ---------------- settings ---------------- */

  function loadSettings() {
    try {
      const raw = storageGet(KEYS.STORE, "");
      if (raw) Object.assign(settings, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    storageSet(KEYS.STORE, JSON.stringify(settings));
  }

  function fillSettingsForm() {
    els.setOwner.value = settings.owner;
    els.setRepo.value = settings.repo;
    els.setBranch.value = settings.branch;
    els.setPath.value = settings.path;
    els.setToken.value = settings.token;
  }

  function setBackgroundInert(isInert) {
    [els.topbar, els.content, els.player, els.queueDrawer].forEach((el) => {
      if (!el) return;
      if (isInert) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  function openSettings(triggerEl) {
    closeQueueDrawer(false);
    const active = document.activeElement;
    lastModalTrigger = (triggerEl && triggerEl.nodeType === 1)
      ? triggerEl
      : (active && active !== document.body ? active : els.settingsBtn);
    fillSettingsForm();
    els.formError.textContent = "";
    els.settingsModal.hidden = false;
    setBackgroundInert(true);
    els.setOwner.focus();
  }

  function closeSettings() {
    els.settingsModal.hidden = true;
    setBackgroundInert(false);
    const target = (lastModalTrigger && lastModalTrigger !== document.body && !lastModalTrigger.hidden)
      ? lastModalTrigger
      : els.settingsBtn;
    lastModalTrigger = null;
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }

  els.settingsBtn.addEventListener("click", () => openSettings(els.settingsBtn));
  els.bannerCta.addEventListener("click", () => {
    if (settings.owner && settings.repo) loadLibrary(true);
    else openSettings(els.bannerCta);
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
    activeGenre = "all";
    saveSettings();
    closeSettings();
    loadLibrary(true);
  });

  if (els.resetSettingsBtn) {
    els.resetSettingsBtn.addEventListener("click", () => {
      settings = Object.assign({}, DEFAULT_SETTINGS);
      activeGenre = "all";
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
        const rawStem = p.slice(p.lastIndexOf("/") + 1, dot)
          .replace(/(_|\s)+spotdown\.org$/i, "")
          .replace(/\s*\(SPOTISAVER\)$/i, "");
        let artist = "";
        let title = rawStem;
        const dashIdx = rawStem.indexOf(" - ");
        if (dashIdx > 0) {
          artist = rawStem.slice(0, dashIdx).trim();
          title = rawStem.slice(dashIdx + 3).trim();
        }
        title = title.replace(/[_-]+/g, " ").trim();
        const genre = inferGenre(artist, "", p);
        newTracks.push({ title, artist, album: "", genre, cover: "", path: p, dir, url: rawUrl(branch, p) });
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

  /* ---------------- loading & cache ---------------- */

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
      const artist = item.artist ? String(item.artist) : "";
      t.push({
        title: String(item.title || url.slice(url.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")),
        artist: artist,
        album: item.album ? String(item.album) : "",
        genre: inferGenre(artist, item.genre, url),
        cover: item.cover ? String(item.cover) : "",
        url: url,
        path: url,
        dir: dir,
      });
      if (item.cover && !c.has(dir)) c.set(dir, String(item.cover));
    });
    return { tracks: t, covers: c };
  }

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

  function loadCache() {
    try {
      const raw = storageGet(KEYS.CACHE, "");
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (c && c.covers) c.covers = new Map(c.covers);
      return c;
    } catch (e) { return null; }
  }

  function saveCache(c) {
    try {
      storageSet(KEYS.CACHE, JSON.stringify(c));
    } catch (e) { /* ignore quota */ }
  }

  // 有缓存时先秒开缓存；默认仓库同时在后台拉取最新 music.json，用轻量指纹比对变化
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

    let cacheSig = "";
    if (useCache) {
      cacheSig = cache.sig || hashLibrarySignature(cache.tracks, cache.covers);
      applyLibrary(cache);
      showBanner(false);
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
        if (useCache) return;
        const branch = await getDefaultBranch();
        data = await fetchTracks(branch);
      }
      if (seq !== loadSeq) return;

      const newCovers = toCoverMap(data.covers);
      const nextSig = hashLibrarySignature(data.tracks, newCovers);
      const changed = !useCache || nextSig !== cacheSig;
      if (changed || (cache && !cache.sig)) {
        saveCache({
          owner: settings.owner,
          repo: settings.repo,
          branch: settings.branch,
          path: settings.path,
          sig: nextSig,
          tracks: data.tracks,
          covers: [...newCovers],
        });
      }
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

  function applyLibrary(data) {
    const oldTracks = tracks;
    tracks = (data.tracks || []).map((t) => {
      const genre = inferGenre(t.artist, t.genre, t.url || t.path);
      const next = Object.assign({}, t, { genre });
      next._searchKey = buildSearchKey(next);
      return next;
    });
    covers = toCoverMap(data.covers);

    const idxByUrl = new Map(tracks.map((t, i) => [t.url, i]));
    const remap = (i) => {
      const t = oldTracks[i];
      return t && idxByUrl.has(t.url) ? idxByUrl.get(t.url) : -1;
    };
    if (currentIndex !== -1) currentIndex = remap(currentIndex);
    order = order.map(remap).filter((i) => i !== -1);
    pos = currentIndex !== -1 ? order.indexOf(currentIndex) : -1;

    if (activeGenre !== "all" && !tracks.some((t) => (t.genre || "其他典藏") === activeGenre)) {
      activeGenre = "all";
    }

    if (!tracks.length) {
      filteredTracks = [];
      activePlaylistEl = null;
      els.genreShelf.hidden = true;
      els.genreStage.hidden = true;
      els.emptyState.hidden = false;
      els.playlist.innerHTML = "";
      renderCount();
      updateLocateBtn();
      updateQueueUI();
      return;
    }
    renderGenreShelf();
    applyFilter();
    updateQueueUI();
    setLoading(false);
  }

  /* ---------------- style playlists shelf ---------------- */

  function updateShelfTabCounts(counts) {
    if (!els.genreShelfTabs) return;
    let salonGenres = 0;
    let militaryGenres = 0;
    GENRE_PRESETS.forEach((p) => {
      if ((counts.get(p.id) || 0) > 0) {
        if (p.category === "military") militaryGenres++;
        else salonGenres++;
      }
    });
    let extraGenres = 0;
    counts.forEach((cnt, id) => {
      if (cnt > 0 && !GENRE_META.has(id)) extraGenres++;
    });
    const totalGenres = salonGenres + militaryGenres + extraGenres;
    els.genreShelfTabs.hidden = totalGenres === 0;
    els.genreShelfTabs.querySelectorAll(".shelf-tab").forEach((btn) => {
      const catId = btn.dataset.category;
      if (catId === "all") btn.textContent = "全部专区 (" + totalGenres + ")";
      else if (catId === "salon") btn.textContent = "\uD83C\uDFB7 沙龙流派 (" + salonGenres + ")";
      else if (catId === "military") btn.textContent = "\uD83C\uDFBA 国歌军乐 (" + militaryGenres + ")";
    });
  }

  function collectGenreItems() {
    const counts = new Map();
    let hasAnyGenre = false;
    let salonTrackCount = 0;
    let militaryTrackCount = 0;
    tracks.forEach((t) => {
      if (t.genre) hasAnyGenre = true;
      const g = t.genre || "其他典藏";
      counts.set(g, (counts.get(g) || 0) + 1);
      if (genreCategory(g) === "military") militaryTrackCount++;
      else salonTrackCount++;
    });
    updateShelfTabCounts(counts);
    if (!hasAnyGenre) return [];

    let summaryItem;
    if (shelfCategory === "salon") {
      summaryItem = {
        id: "all",
        category: "salon",
        name: "全部沙龙流派",
        sub: "八大维多利亚沙龙唱片集",
        seal: "#c98236",
        desc: "涵盖爵士名伶、交响夜曲、器乐爵士、节奏蓝调、独立与华语摇滚、城市民谣及古典剧场礼乐。",
        count: salonTrackCount,
      };
    } else if (shelfCategory === "military") {
      summaryItem = {
        id: "all",
        category: "military",
        name: "全部国歌军乐",
        sub: "中 · 美 · 俄 · 法 · 德 · 日 · 英 七国军礼典藏",
        seal: "#b91c1c",
        desc: "汇集中国、美国、俄罗斯、法国、德国、日本与英国七国庄严国歌与历史经典行进军乐。",
        count: militaryTrackCount,
      };
    } else {
      summaryItem = {
        id: "all",
        category: "all",
        name: "全部馆藏",
        sub: "十五大专区完整唱片库",
        seal: "#d4a64a",
        desc: "留声机全馆典藏唱片，涵盖爵士、灵魂蓝调、独立与华语摇滚、古典沙龙及七国国歌军乐特辑。",
        count: tracks.length,
      };
    }

    const items = [summaryItem];

    GENRE_PRESETS.forEach((p) => {
      const cnt = counts.get(p.id) || 0;
      if (cnt > 0) {
        if (shelfCategory === "all" || p.category === shelfCategory) {
          items.push({
            id: p.id,
            category: p.category,
            flag: p.flag || "",
            name: p.id,
            sub: p.sub,
            seal: p.seal,
            desc: p.desc,
            count: cnt,
          });
        }
        counts.delete(p.id);
      }
    });

    if (shelfCategory === "all" || shelfCategory === "salon") {
      counts.forEach((cnt, id) => {
        if (cnt > 0) {
          items.push({ id: id, category: "other", name: id, sub: "馆藏曲目精选", seal: "#9e7632", desc: "按曲风归档的唱片合集。", count: cnt });
        }
      });
    }

    return items;
  }

  function renderGenreShelf() {
    const items = collectGenreItems();
    if (!items.length) {
      els.genreShelf.hidden = true;
      els.genreStage.hidden = true;
      return;
    }
    els.genreShelf.hidden = false;
    const frag = document.createDocumentFragment();

    items.forEach((it) => {
      const card = document.createElement("div");
      card.className = "genre-card" + (activeGenre === it.id ? " active" : "");
      card.dataset.genre = it.id;
      card.style.setProperty("--seal", it.seal);

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "genre-card-main";
      mainBtn.setAttribute("aria-pressed", activeGenre === it.id ? "true" : "false");

      const disc = document.createElement("span");
      disc.className = "genre-disc";
      disc.setAttribute("aria-hidden", "true");

      const body = document.createElement("span");
      body.className = "genre-card-body";

      const top = document.createElement("span");
      top.className = "genre-card-top";

      const name = document.createElement("span");
      name.className = "genre-card-name";
      if (it.flag) {
        const flag = document.createElement("span");
        flag.className = "genre-card-flag";
        flag.textContent = it.flag;
        name.appendChild(flag);
      }
      name.appendChild(document.createTextNode(it.name));

      const count = document.createElement("span");
      count.className = "genre-card-count";
      count.textContent = it.count + " 首";

      top.append(name, count);

      const sub = document.createElement("span");
      sub.className = "genre-card-sub";
      sub.textContent = it.sub;

      body.append(top, sub);
      mainBtn.append(disc, body);
      mainBtn.addEventListener("click", () => {
        selectGenre(activeGenre === it.id && it.id !== "all" ? "all" : it.id);
      });

      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "genre-play-btn";
      playBtn.title = "立即播放「" + it.name + "」";
      playBtn.setAttribute("aria-label", "立即播放 " + it.name);
      playBtn.textContent = "\u25B6";
      playBtn.addEventListener("click", () => startGenrePlaylist(it.id, null));

      card.append(mainBtn, playBtn);
      frag.appendChild(card);
    });

    els.genreShelf.innerHTML = "";
    els.genreShelf.appendChild(frag);
    renderGenreStage();
  }

  function updateGenreShelfHighlight() {
    els.genreShelf.querySelectorAll(".genre-card").forEach((card) => {
      const on = card.dataset.genre === activeGenre;
      card.classList.toggle("active", on);
      const btn = card.querySelector(".genre-card-main");
      if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderGenreStage();
  }

  function renderGenreStage() {
    if (activeGenre === "all" || els.genreShelf.hidden) {
      els.genreStage.hidden = true;
      return;
    }
    const meta = GENRE_META.get(activeGenre) || { seal: "#9e7632", desc: "按曲风归档的留声机歌单。" };
    els.genreStage.hidden = false;
    els.genreStage.style.setProperty("--seal", meta.seal);
    els.genreStageTitle.textContent = activeGenre;
    els.genreStageDesc.textContent = meta.desc;
  }

  function selectGenre(id) {
    activeGenre = id || "all";
    updateGenreShelfHighlight();
    applyFilter();
  }

  function clearSearchValue() {
    els.searchInput.value = "";
    if (els.searchClearBtn) els.searchClearBtn.hidden = true;
  }

  // forceShuffle: null=保持当前随机设置，false=顺序播放，true=随机播放
  function startGenrePlaylist(id, forceShuffle) {
    activeGenre = id || "all";
    clearSearchValue();
    if (forceShuffle !== null) {
      shuffle = !!forceShuffle;
      storageSet(KEYS.SHUFFLE, shuffle ? "1" : "0");
      setPressedButtonState(els.shuffleBtn, shuffle);
    }
    updateGenreShelfHighlight();
    applyFilter();
    if (!filteredTracks.length) return;
    errorStreak = 0;
    buildOrder(null);
    playAt(0);
    let label = activeGenre;
    if (activeGenre === "all") {
      label = shelfCategory === "military" ? "全部国歌军乐" : shelfCategory === "salon" ? "全部沙龙流派" : "全部馆藏";
    }
    toast((shuffle ? "随机起奏：" : "正在播放歌单：") + label);
  }

  els.playGenreBtn.addEventListener("click", () => startGenrePlaylist(activeGenre, false));
  els.shuffleGenreBtn.addEventListener("click", () => startGenrePlaylist(activeGenre, true));
  els.clearGenreBtn.addEventListener("click", () => selectGenre("all"));

  /* ---------------- filtering & playlist rendering ---------------- */

  function applyFilter() {
    const rawQ = els.searchInput.value;
    if (els.searchClearBtn) els.searchClearBtn.hidden = !rawQ;
    const tokens = tokenizeQuery(rawQ);
    filteredTracks = [];

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const g = t.genre || "其他典藏";
      if (activeGenre !== "all") {
        if (g !== activeGenre) continue;
      } else if (shelfCategory !== "all") {
        if (genreCategory(g) !== shelfCategory) continue;
      }
      if (!tokens.length || matchesSearchTokens(t._searchKey || buildSearchKey(t), tokens)) {
        filteredTracks.push(i);
      }
    }

    if (view === "genre") {
      filteredTracks.sort((a, b) => {
        const ga = tracks[a].genre || "其他典藏";
        const gb = tracks[b].genre || "其他典藏";
        const ra = genreRank(ga);
        const rb = genreRank(gb);
        if (ra !== rb) return ra - rb;
        if (ga !== gb) return ga.localeCompare(gb, "zh-CN");
        return a - b;
      });
    }

    els.emptyState.hidden = !tracks.length || filteredTracks.length > 0;
    renderPlaylist(false);
    updateLocateBtn();
  }

  const debouncedFilter = debounce(applyFilter, 75);

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
    if (!settings.owner || !settings.repo) { openSettings(els.reloadBtn); return; }
    loadLibrary(true);
  });

  els.searchInput.addEventListener("input", () => {
    if (els.searchClearBtn) els.searchClearBtn.hidden = !els.searchInput.value;
    debouncedFilter();
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      debouncedFilter.flush();
    } else if (e.key === "Escape" && els.searchInput.value) {
      e.stopPropagation();
      debouncedFilter.cancel();
      clearSearchValue();
      applyFilter();
    }
  });

  if (els.searchClearBtn) {
    els.searchClearBtn.addEventListener("click", () => {
      debouncedFilter.cancel();
      clearSearchValue();
      applyFilter();
      els.searchInput.focus();
    });
  }

  function renderCount() {
    const len = filteredTracks.length;
    if (!len) {
      els.trackCount.textContent = "0 首";
      return;
    }
    if (activeGenre !== "all" || view === "artist") {
      const artists = new Set();
      for (let i = 0; i < len; i++) {
        artists.add(tracks[filteredTracks[i]].artist || "未分类");
      }
      els.trackCount.textContent = len + " 首 · " + artists.size + " 位歌手";
    } else if (view === "genre") {
      const genres = new Set();
      for (let i = 0; i < len; i++) {
        genres.add(tracks[filteredTracks[i]].genre || "其他典藏");
      }
      els.trackCount.textContent = len + " 首 · " + genres.size + " 大风格";
    } else {
      els.trackCount.textContent = len + " 首";
    }
  }

  function formatItemMeta(t, mode) {
    const cleanAlbum = t.album && t.album.toLowerCase() !== "unknown album" ? t.album : "";
    if (mode === "genre") return t.artist || cleanAlbum || t.dir || "/";
    if (mode === "artist") return cleanAlbum || t.genre || t.dir || "/";
    if (t.artist && t.genre) return t.artist + " · " + t.genre;
    return t.artist || cleanAlbum || t.genre || t.dir || "/";
  }

  function makeItem(tIndex, k, mode, tabTargetK) {
    const t = tracks[tIndex];
    const li = document.createElement("li");
    li.className = "playlist-item";
    li.dataset.index = tIndex;
    const isRovingTarget = k === tabTargetK;
    li.tabIndex = isRovingTarget ? 0 : -1;
    if (tIndex === currentIndex) {
      li.classList.add("active");
      if (!audio.paused) li.classList.add("playing");
      activePlaylistEl = li;
    }

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = k + 1;

    const eq = document.createElement("span");
    eq.className = "eq";
    eq.setAttribute("aria-hidden", "true");
    eq.innerHTML = "<span></span><span></span><span></span>";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = t.title;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = formatItemMeta(t, mode);

    const enqueueBtn = document.createElement("button");
    enqueueBtn.type = "button";
    enqueueBtn.className = "playlist-enqueue-btn";
    enqueueBtn.title = "添加到下一首播放";
    enqueueBtn.setAttribute("aria-label", "下一首播放 " + t.title);
    enqueueBtn.textContent = "+";
    enqueueBtn.tabIndex = isRovingTarget ? 0 : -1;

    li.append(idx, eq, name, meta, enqueueBtn);
    return li;
  }

  function setPlaylistRovingTabIndex(activeLi) {
    if (!activeLi) return;
    els.playlist.querySelectorAll('.playlist-item[tabindex="0"], .playlist-enqueue-btn[tabindex="0"]').forEach((el) => {
      if (el !== activeLi && el.parentElement !== activeLi) el.tabIndex = -1;
    });
    activeLi.tabIndex = 0;
    const btn = activeLi.querySelector(".playlist-enqueue-btn");
    if (btn) btn.tabIndex = 0;
  }

  els.playlist.addEventListener("click", (e) => {
    const enqueueBtn = e.target.closest(".playlist-enqueue-btn");
    const li = e.target.closest(".playlist-item");
    if (!li) return;
    setPlaylistRovingTabIndex(li);
    const tIndex = Number(li.dataset.index);
    if (isNaN(tIndex)) return;
    if (enqueueBtn) {
      e.stopPropagation();
      enqueueNext(tIndex);
      return;
    }
    playTrackByIndex(tIndex);
  });

  els.playlist.addEventListener("keydown", (e) => {
    const enqueueBtn = e.target.closest(".playlist-enqueue-btn");
    const li = e.target.closest(".playlist-item");
    if (!li) return;

    if (enqueueBtn) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        li.focus();
      }
      return;
    }

    if (e.key === "ArrowRight") {
      const btn = li.querySelector(".playlist-enqueue-btn");
      if (btn) {
        e.preventDefault();
        btn.focus();
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      setPlaylistRovingTabIndex(li);
      const tIndex = Number(li.dataset.index);
      if (!isNaN(tIndex)) playTrackByIndex(tIndex);
    } else if (e.key === " ") {
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      const items = Array.from(els.playlist.querySelectorAll(".playlist-item"));
      const curIdx = items.indexOf(li);
      if (curIdx === -1 || !items.length) return;
      e.preventDefault();
      let nextIdx = curIdx;
      if (e.key === "ArrowDown") nextIdx = Math.min(items.length - 1, curIdx + 1);
      else if (e.key === "ArrowUp") nextIdx = Math.max(0, curIdx - 1);
      else if (e.key === "Home") nextIdx = 0;
      else if (e.key === "End") nextIdx = items.length - 1;
      const targetLi = items[nextIdx];
      if (targetLi) {
        setPlaylistRovingTabIndex(targetLi);
        targetLi.focus();
      }
    }
  });

  els.playlist.addEventListener("keyup", (e) => {
    if (e.key !== " ") return;
    if (e.target.closest(".playlist-enqueue-btn")) return;
    const li = e.target.closest(".playlist-item");
    if (!li) return;
    setPlaylistRovingTabIndex(li);
    const tIndex = Number(li.dataset.index);
    if (!isNaN(tIndex)) playTrackByIndex(tIndex);
  });

  function renderPlaylist(scrollToActive) {
    renderCount();
    activePlaylistEl = null;
    const frag = document.createDocumentFragment();
    const activeK = currentIndex !== -1 ? filteredTracks.indexOf(currentIndex) : -1;
    const tabTargetK = activeK !== -1 ? activeK : 0;

    if (view === "genre" && activeGenre === "all") {
      const groupCounts = new Map();
      filteredTracks.forEach((tIndex) => {
        const g = tracks[tIndex].genre || "其他典藏";
        groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
      });
      let lastGenre = null;
      filteredTracks.forEach((tIndex, k) => {
        const g = tracks[tIndex].genre || "其他典藏";
        if (g !== lastGenre) {
          lastGenre = g;
          const hdr = document.createElement("li");
          hdr.className = "playlist-header";
          hdr.textContent = g + " (" + groupCounts.get(g) + " 首)";
          frag.appendChild(hdr);
        }
        frag.appendChild(makeItem(tIndex, k, "genre", tabTargetK));
      });
    } else if (view === "artist") {
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
        frag.appendChild(makeItem(tIndex, k, "artist", tabTargetK));
      });
    } else {
      const itemMode = view === "genre" ? "genre" : "flat";
      filteredTracks.forEach((tIndex, k) => {
        frag.appendChild(makeItem(tIndex, k, itemMode, tabTargetK));
      });
    }
    els.playlist.innerHTML = "";
    els.playlist.appendChild(frag);
    if (scrollToActive) scrollActiveIntoView();
  }

  function highlightActive(scroll) {
    if (activePlaylistEl && activePlaylistEl.isConnected) {
      activePlaylistEl.classList.remove("active", "playing");
    }
    activePlaylistEl = null;
    if (currentIndex !== -1) {
      const curEl = els.playlist.querySelector('.playlist-item[data-index="' + currentIndex + '"]');
      if (curEl) {
        curEl.classList.add("active");
        if (!audio.paused) curEl.classList.add("playing");
        activePlaylistEl = curEl;
        setPlaylistRovingTabIndex(curEl);
      }
    }
    if (scroll) scrollActiveIntoView();
    updateLocateBtn();
  }

  function getScrollBehavior() {
    const preferReduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    return preferReduced ? "auto" : "smooth";
  }

  function scrollActiveIntoView() {
    if (currentIndex === -1) return;
    const el = (activePlaylistEl && activePlaylistEl.isConnected)
      ? activePlaylistEl
      : els.playlist.querySelector(".playlist-item.active");
    if (el) el.scrollIntoView({ block: "center", behavior: getScrollBehavior() });
  }

  function updateLocateBtn() {
    if (!els.locateTrackBtn) return;
    els.locateTrackBtn.hidden = currentIndex === -1 || !tracks[currentIndex];
  }

  function locateCurrentTrack() {
    if (currentIndex === -1 || !tracks[currentIndex]) return;
    if (filteredTracks.indexOf(currentIndex) === -1) {
      debouncedFilter.cancel();
      clearSearchValue();
      activeGenre = "all";
      shelfCategory = "all";
      if (shelfTabsApi) shelfTabsApi.sync(false);
      renderGenreShelf();
      applyFilter();
    }
    highlightActive(true);
    if (activePlaylistEl && typeof activePlaylistEl.focus === "function") {
      activePlaylistEl.focus({ preventScroll: true });
    }
  }

  if (els.locateTrackBtn) {
    els.locateTrackBtn.addEventListener("click", locateCurrentTrack);
  }

  function setView(next) {
    if (next !== "genre" && next !== "artist" && next !== "flat") next = "genre";
    view = next;
    storageSet(KEYS.VIEW, view);
    els.viewToggle.querySelectorAll("button").forEach((b) => {
      setPressedButtonState(b, b.dataset.view === view);
    });
    applyFilter();
  }

  els.viewToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) setView(btn.dataset.view);
  });

  /* ---------------- queue drawer & playback logic ---------------- */

  function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function arrangeOrder(list, first) {
    const out = list.slice();
    if (shuffle) {
      shuffleInPlace(out);
      const i = first == null ? -1 : out.indexOf(first);
      if (i > 0) { out.splice(i, 1); out.unshift(first); }
    }
    return out;
  }

  function buildOrder(first) {
    order = arrangeOrder(filteredTracks, first);
    pos = first == null ? -1 : order.indexOf(first);
    updateQueueUI();
  }

  function ensureOrder() {
    if (order.length) return true;
    if (!filteredTracks.length) return false;
    buildOrder(currentIndex !== -1 && filteredTracks.indexOf(currentIndex) !== -1 ? currentIndex : null);
    return order.length > 0;
  }

  function enqueueNext(tIndex) {
    const t = tracks[tIndex];
    if (!t) return;
    if (tIndex === currentIndex && pos !== -1) {
      toast("正在播放：" + t.title);
      return;
    }
    if (!order.length && filteredTracks.length) {
      buildOrder(null);
    }
    if (pos === -1) {
      const existing = order.indexOf(tIndex);
      if (existing !== -1) order.splice(existing, 1);
      order.unshift(tIndex);
    } else {
      for (let i = order.length - 1; i >= 0; i--) {
        if (i !== pos && order[i] === tIndex) {
          order.splice(i, 1);
          if (i < pos) pos--;
        }
      }
      order.splice(pos + 1, 0, tIndex);
    }
    updateQueueUI();
    if (!audio.paused) scheduleNextPreload();
    toast("已加入下一首播放：" + t.title);
  }

  function moveQueueItemNext(qIdx) {
    if (qIdx < 0 || qIdx >= order.length || qIdx === pos) return;
    const insertTarget = pos >= 0 ? pos + 1 : 0;
    if (qIdx === insertTarget) return;
    const item = order.splice(qIdx, 1)[0];
    let nextPos = pos;
    if (pos >= 0 && qIdx < pos) nextPos = pos - 1;
    const actualInsert = nextPos >= 0 ? Math.min(order.length, nextPos + 1) : 0;
    order.splice(actualInsert, 0, item);
    pos = nextPos;
    updateQueueUI();
    if (!audio.paused) scheduleNextPreload();
  }

  function removeQueueItem(qIdx) {
    if (qIdx < 0 || qIdx >= order.length) return;
    if (qIdx === pos) {
      toast("正在播放中的曲目不可移除");
      return;
    }
    order.splice(qIdx, 1);
    if (pos > qIdx) pos--;
    updateQueueUI();
    if (!audio.paused) scheduleNextPreload();
  }

  function reshuffleQueue() {
    if (order.length < 2) return;
    if (pos >= 0 && currentIndex !== -1 && order[pos] === currentIndex) {
      if (pos < order.length - 2) {
        const head = order.slice(0, pos + 1);
        const tail = shuffleInPlace(order.slice(pos + 1));
        order = head.concat(tail);
      } else {
        const rest = shuffleInPlace(order.filter((_, idx) => idx !== pos));
        order = [currentIndex].concat(rest);
        pos = 0;
      }
    } else {
      shuffleInPlace(order);
      pos = currentIndex !== -1 ? order.indexOf(currentIndex) : -1;
    }
    updateQueueUI();
    if (!audio.paused) scheduleNextPreload();
    if (els.queueReshuffleBtn && els.queueReshuffleBtn.disabled && document.activeElement === els.queueReshuffleBtn && els.queueCloseBtn) {
      els.queueCloseBtn.focus();
    }
    toast("已随机重排播放队列");
  }

  function clearUpcomingQueue() {
    if (!order.length) return;
    if (pos >= 0 && currentIndex !== -1 && order[pos] === currentIndex) {
      order = [currentIndex];
      pos = 0;
    } else {
      order = [];
      pos = -1;
    }
    cancelPreload();
    updateQueueUI();
    if (els.queueClearUpcomingBtn && els.queueClearUpcomingBtn.disabled && document.activeElement === els.queueClearUpcomingBtn && els.queueCloseBtn) {
      els.queueCloseBtn.focus();
    }
    toast("已清空后续待播队列");
  }

  function updateQueueUI() {
    const total = order.length;
    const upcoming = pos >= 0 ? Math.max(0, total - pos - 1) : total;
    if (els.queueCountBadge) {
      els.queueCountBadge.textContent = upcoming > 99 ? "99+" : String(upcoming);
      els.queueCountBadge.hidden = upcoming === 0;
    }
    if (els.queueDrawerTitle) {
      els.queueDrawerTitle.textContent = "播放队列 (" + total + " 首)";
    }
    if (els.queueReshuffleBtn) {
      els.queueReshuffleBtn.disabled = total < 2;
    }
    if (els.queueClearUpcomingBtn) {
      els.queueClearUpcomingBtn.disabled = pos >= 0 ? total <= pos + 1 : total === 0;
    }
    if (els.queueDrawer && !els.queueDrawer.hidden) {
      renderQueueDrawer();
    }
  }

  function renderQueueDrawer() {
    if (!els.queueList || !els.queueEmpty) return;
    if (!order.length) {
      els.queueList.innerHTML = "";
      els.queueEmpty.hidden = false;
      return;
    }
    els.queueEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    const nextIdx = pos >= 0 ? pos + 1 : 0;

    for (let i = 0; i < order.length; i++) {
      const tIndex = order[i];
      const t = tracks[tIndex];
      if (!t) continue;

      const isCurrent = i === pos;
      const isPlayed = pos >= 0 && i < pos;
      const li = document.createElement("li");
      li.className = "queue-item" + (isCurrent ? " active" : "") + (isPlayed ? " past" : "");
      li.dataset.qidx = i;

      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "queue-item-play";
      playBtn.title = "立即播放：" + t.title;

      const numSpan = document.createElement("span");
      numSpan.className = "queue-num";
      numSpan.textContent = isCurrent ? "\u25B6" : String(i + 1);

      const info = document.createElement("span");
      info.className = "queue-item-info";

      const title = document.createElement("span");
      title.className = "queue-item-title";
      title.textContent = t.title;

      const sub = document.createElement("span");
      sub.className = "queue-item-sub";
      sub.textContent = t.artist || t.genre || t.dir || "/";

      info.append(title, sub);
      playBtn.append(numSpan, info);
      li.appendChild(playBtn);

      if (!isCurrent) {
        const actions = document.createElement("span");
        actions.className = "queue-item-actions";

        if (i !== nextIdx) {
          const topBtn = document.createElement("button");
          topBtn.type = "button";
          topBtn.className = "queue-act-btn queue-act-next";
          topBtn.title = "移至下一首播放";
          topBtn.setAttribute("aria-label", "将 " + t.title + " 移至下一首播放");
          topBtn.textContent = "\u2191";
          actions.appendChild(topBtn);
        }

        const rmBtn = document.createElement("button");
        rmBtn.type = "button";
        rmBtn.className = "queue-act-btn queue-act-remove";
        rmBtn.title = "从队列移除";
        rmBtn.setAttribute("aria-label", "从队列移除 " + t.title);
        rmBtn.textContent = "\u00D7";
        actions.appendChild(rmBtn);
        li.appendChild(actions);
      }

      frag.appendChild(li);
    }

    els.queueList.innerHTML = "";
    els.queueList.appendChild(frag);
  }

  function openQueueDrawer(triggerEl) {
    if (!els.queueDrawer) return;
    if (lyricsCtrl) lyricsCtrl.closeMobile(false);
    const active = document.activeElement;
    lastQueueTrigger = (triggerEl && triggerEl.nodeType === 1)
      ? triggerEl
      : (active && active !== document.body ? active : els.queueToggleBtn);

    if (els.queueBackdrop) els.queueBackdrop.hidden = false;
    els.queueDrawer.hidden = false;
    document.body.classList.add("queue-open");
    setPressedButtonState(els.queueToggleBtn, true);
    renderQueueDrawer();

    requestAnimationFrame(() => {
      const curItem = els.queueList.querySelector(".queue-item.active");
      if (curItem) curItem.scrollIntoView({ block: "nearest", behavior: "auto" });
      if (els.queueCloseBtn && typeof els.queueCloseBtn.focus === "function") {
        els.queueCloseBtn.focus();
      }
    });
  }

  function closeQueueDrawer(restoreFocus) {
    if (!els.queueDrawer || els.queueDrawer.hidden) return;
    els.queueDrawer.hidden = true;
    if (els.queueBackdrop) els.queueBackdrop.hidden = true;
    document.body.classList.remove("queue-open");
    setPressedButtonState(els.queueToggleBtn, false);
    if (restoreFocus) {
      const target = (lastQueueTrigger && lastQueueTrigger !== document.body && !lastQueueTrigger.hidden)
        ? lastQueueTrigger
        : els.queueToggleBtn;
      if (target && typeof target.focus === "function") target.focus();
    }
    lastQueueTrigger = null;
  }

  function toggleQueueDrawer(triggerEl) {
    if (!els.queueDrawer) return;
    if (els.queueDrawer.hidden) openQueueDrawer(triggerEl);
    else closeQueueDrawer(true);
  }

  if (els.queueToggleBtn) {
    els.queueToggleBtn.addEventListener("click", () => toggleQueueDrawer(els.queueToggleBtn));
  }
  if (els.queueCloseBtn) {
    els.queueCloseBtn.addEventListener("click", () => closeQueueDrawer(true));
  }
  if (els.queueBackdrop) {
    els.queueBackdrop.addEventListener("click", () => closeQueueDrawer(true));
  }
  if (els.queueReshuffleBtn) {
    els.queueReshuffleBtn.addEventListener("click", reshuffleQueue);
  }
  if (els.queueClearUpcomingBtn) {
    els.queueClearUpcomingBtn.addEventListener("click", clearUpcomingQueue);
  }
  if (els.queueList) {
    els.queueList.addEventListener("click", (e) => {
      const li = e.target.closest(".queue-item");
      if (!li) return;
      const qIdx = Number(li.dataset.qidx);
      if (isNaN(qIdx)) return;

      if (e.target.closest(".queue-act-next")) {
        moveQueueItemNext(qIdx);
        return;
      }
      if (e.target.closest(".queue-act-remove")) {
        removeQueueItem(qIdx);
        return;
      }
      if (e.target.closest(".queue-item-play")) {
        errorStreak = 0;
        playAt(qIdx);
      }
    });
  }

  function playAt(p) {
    pos = p;
    currentIndex = order[p];
    startPlayback();
    updateQueueUI();
  }

  function playTrackByIndex(tIndex) {
    errorStreak = 0;
    buildOrder(tIndex);
    if (pos === -1) { order.unshift(tIndex); pos = 0; }
    playAt(pos);
  }

  function syncSlider(el) {
    if (!el) return;
    const min = Number(el.min) || 0;
    const rawMax = Number(el.max);
    const max = rawMax > min ? rawMax : min + 1;
    const val = rawMax > min ? Math.min(max, Math.max(min, Number(el.value) || 0)) : min;
    el.style.setProperty("--attr-min", min);
    el.style.setProperty("--attr-max", max);
    el.style.setProperty("--control-value", val);
  }

  function setPlayingUI(playing) {
    document.body.classList.toggle("is-playing", playing);
    els.iconPlay.style.display = playing ? "none" : "";
    els.iconPause.style.display = playing ? "" : "none";

    if (activePlaylistEl && activePlaylistEl.isConnected) {
      activePlaylistEl.classList.toggle("playing", playing && Number(activePlaylistEl.dataset.index) === currentIndex);
    } else if (currentIndex !== -1) {
      const curEl = els.playlist.querySelector('.playlist-item[data-index="' + currentIndex + '"]');
      if (curEl) {
        activePlaylistEl = curEl;
        curEl.classList.toggle("playing", playing);
      }
    }

    if (playing && currentIndex !== -1 && tracks[currentIndex]) {
      const t = tracks[currentIndex];
      document.title = "\u266B " + t.title + (t.artist ? " · " + t.artist : "") + " | GitHub 音乐盒";
    } else {
      document.title = DEFAULT_DOC_TITLE;
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }

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

  function defaultTrackSub(t) {
    if (!t) return "轻触歌单或曲目，落针起奏";
    const subParts = [];
    if (t.artist) subParts.push(t.artist);
    if (t.genre) subParts.push(t.genre);
    return subParts.length ? subParts.join(" · ") : (t.album || t.dir || "/");
  }

  /* ---------------- smart next-track audio preloader ---------------- */

  function cancelPreload() {
    clearTimeout(preloadTimer);
    preloadTimer = null;
    clearTimeout(preloadAbortTimer);
    preloadAbortTimer = null;
    activePreloadUrl = "";
    if (preloadAudioEl) {
      preloadAudioEl.oncanplaythrough = null;
      preloadAudioEl.onloadeddata = null;
      preloadAudioEl.onerror = null;
      preloadAudioEl.removeAttribute("src");
      try { preloadAudioEl.load(); } catch (e) { /* ignore */ }
    }
  }

  function getNextPreloadTrack() {
    if (repeat === "one" || !order.length) return null;
    const nextPos = pos + 1 < order.length ? pos + 1 : (repeat === "all" && order.length > 1 ? 0 : -1);
    if (nextPos === -1) return null;
    const t = tracks[order[nextPos]];
    if (!t || !t.url) return null;
    const curTrack = currentIndex !== -1 ? tracks[currentIndex] : null;
    if (curTrack && t.url === curTrack.url) return null;
    if (preloadedUrls.has(t.url)) return null;
    return t;
  }

  function canNetworkPreload() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return true;
    if (conn.saveData) return false;
    return conn.effectiveType !== "slow-2g" && conn.effectiveType !== "2g";
  }

  function rememberPreloadedUrl(url) {
    if (preloadedUrls.size >= MAX_PRELOAD_CACHE) {
      const oldest = preloadedUrls.values().next().value;
      if (oldest !== undefined) preloadedUrls.delete(oldest);
    }
    preloadedUrls.add(url);
  }

  function scheduleNextPreload() {
    clearTimeout(preloadTimer);
    if (audio.paused || !canNetworkPreload()) return;
    const nextTrack = getNextPreloadTrack();
    if (!nextTrack) return;

    preloadTimer = setTimeout(() => {
      preloadTimer = null;
      if (audio.paused) return;
      const targetTrack = getNextPreloadTrack();
      if (!targetTrack || targetTrack.url === activePreloadUrl) return;

      cancelPreload();
      if (!preloadAudioEl) {
        preloadAudioEl = new Audio();
        preloadAudioEl.crossOrigin = "anonymous";
        preloadAudioEl.preload = "auto";
        preloadAudioEl.muted = true;
        preloadAudioEl.volume = 0;
      }

      const targetUrl = targetTrack.url;
      activePreloadUrl = targetUrl;

      const releasePreloader = (remember) => {
        if (remember) rememberPreloadedUrl(targetUrl);
        if (activePreloadUrl === targetUrl) cancelPreload();
      };

      preloadAudioEl.onloadeddata = () => rememberPreloadedUrl(targetUrl);
      preloadAudioEl.oncanplaythrough = () => releasePreloader(true);
      preloadAudioEl.onerror = () => releasePreloader(false);
      preloadAbortTimer = setTimeout(() => releasePreloader(false), PRELOAD_TIMEOUT_MS);

      preloadAudioEl.src = targetUrl;
      try { preloadAudioEl.load(); } catch (e) { cancelPreload(); }
    }, PRELOAD_DELAY_MS);
  }

  function startPlayback() {
    const t = tracks[currentIndex];
    if (!t) return;
    cancelPreload();
    isSeeking = false;
    audio.src = t.url;
    els.seek.max = 0;
    els.seek.value = 0;
    syncSlider(els.seek);
    els.curTime.textContent = "0:00";
    els.durTime.textContent = "0:00";
    safePlay();
    els.trackTitle.textContent = t.title;
    els.trackSub.textContent = defaultTrackSub(t);
    const cover = t.cover || lookupCover(t.dir);
    els.coverArt.src = cover || DEFAULT_COVER;
    highlightActive(true);
    updateMediaSession(t, cover);
    lyricsCtrl.loadForTrack(t);
  }

  function nextTrack(auto) {
    if (!ensureOrder()) return;
    if (pos < order.length - 1) { playAt(pos + 1); return; }
    if (auto === true && repeat !== "all") return;
    if (shuffle && order.length > 1) {
      const last = order[order.length - 1];
      order = arrangeOrder(order, null);
      if (order[0] === last) order.push(order.shift());
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
    lyricsCtrl.resetPosition();
    safePlay();
  }

  function togglePlay() {
    if (currentIndex === -1 && !audio.currentSrc) {
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
    storageSet(KEYS.SHUFFLE, shuffle ? "1" : "0");
    setPressedButtonState(els.shuffleBtn, shuffle);
    if (order.length) {
      const cur = currentIndex !== -1 ? currentIndex : null;
      if (shuffle) {
        order = arrangeOrder(order, cur);
      } else if (filteredTracks.length && (cur === null || filteredTracks.indexOf(cur) !== -1)) {
        order = filteredTracks.slice();
      } else {
        order = order.slice().sort((a, b) => a - b);
      }
      pos = cur == null ? -1 : order.indexOf(cur);
    }
    updateQueueUI();
    if (!audio.paused) scheduleNextPreload();
    toast(shuffle ? "已开启随机播放" : "已关闭随机播放");
  }

  function cycleRepeat() {
    const modes = ["none", "all", "one"];
    const labels = { none: "循环关闭", all: "列表循环", one: "单曲循环" };
    const i = modes.indexOf(repeat);
    repeat = modes[(i + 1) % modes.length];
    storageSet(KEYS.REPEAT, repeat);
    updateRepeatUI();
    if (!audio.paused) scheduleNextPreload();
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
      syncSlider(els.seek);
      els.durTime.textContent = fmtTime(audio.duration);
    }
  }

  audio.addEventListener("loadedmetadata", updateDuration);
  audio.addEventListener("durationchange", updateDuration);

  audio.addEventListener("timeupdate", () => {
    if (!isSeeking && isFinite(audio.duration)) {
      els.seek.value = audio.currentTime;
      syncSlider(els.seek);
      els.curTime.textContent = fmtTime(audio.currentTime);
    }
    if (!isSeeking) {
      lyricsCtrl.syncToTime(audio.currentTime, false);
    }
  });

  audio.addEventListener("seeked", () => {
    lyricsCtrl.syncToTime(audio.currentTime, false);
  });

  audio.addEventListener("play", () => {
    setPlayingUI(true);
    audioFx.onPlay();
  });

  audio.addEventListener("playing", () => {
    errorStreak = 0;
    audioFx.onPlaying();
    lyricsCtrl.updateCollapsedSubtitle();
    scheduleNextPreload();
  });

  audio.addEventListener("pause", () => {
    setPlayingUI(false);
    audioFx.onPauseOrEnd();
    lyricsCtrl.updateCollapsedSubtitle();
    clearTimeout(preloadTimer);
    preloadTimer = null;
  });

  audio.addEventListener("ended", () => {
    audioFx.onPauseOrEnd();
    if (repeat === "one") { restart(); return; }
    nextTrack(true);
  });

  audio.addEventListener("error", () => {
    if (currentIndex === -1 || !audio.error) return;
    setPlayingUI(false);
    cancelPreload();
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
    syncSlider(els.seek);
    const v = parseFloat(els.seek.value);
    els.curTime.textContent = fmtTime(v);
    lyricsCtrl.syncToTime(v, true);
  });
  els.seek.addEventListener("change", () => {
    const v = parseFloat(els.seek.value);
    if (isFinite(audio.duration)) audio.currentTime = v;
    syncSlider(els.seek);
    isSeeking = false;
    lyricsCtrl.syncToTime(v, false);
  });

  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    els.volume.value = v;
    syncSlider(els.volume);
    audio.volume = v / 100;
    storageSet(KEYS.VOLUME, v);
    if (v > 0) lastVolume = v;
    setPressedButtonState(els.muteBtn, v === 0);
    audioFx.updateGraph(false);
  }

  els.volume.addEventListener("input", () => setVolume(els.volume.value));

  els.muteBtn.addEventListener("click", () => {
    if (Number(els.volume.value) > 0) setVolume(0);
    else setVolume(lastVolume || 80);
  });

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
        album: (t.album && t.album.toLowerCase() !== "unknown album" ? t.album : "") || t.genre || settings.repo,
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
    if (e.key === "Escape") {
      if (els.queueDrawer && !els.queueDrawer.hidden) {
        closeQueueDrawer(true);
        return;
      }
      if (lyricsCtrl.isMobileOpen()) {
        lyricsCtrl.closeMobile(true);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target;
    const tag = (target.tagName || "").toLowerCase();
    if (target.isContentEditable || tag === "textarea" || tag === "select") return;
    if (tag === "input") {
      if (target.type !== "range") return;
      if (e.key.indexOf("Arrow") === 0) return;
    }
    if ((tag === "button" || tag === "a") && (e.key === " " || e.key === "Enter")) return;
    if (
      target.closest &&
      target.closest(".playlist-item") &&
      (e.key === " " || e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End")
    ) {
      return;
    }
    if (
      target.closest &&
      target.closest(".shelf-tab") &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End")
    ) {
      return;
    }
    if (
      target.closest &&
      target.closest("#lyricsScroll") &&
      (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown" || e.key === "Home" || e.key === "End")
    ) {
      lyricsCtrl.enterUserScrollMode();
      return;
    }
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
      case "l": case "L": lyricsCtrl.togglePanel(); break;
      case "v": case "V": audioFx.toggleVinylFx(); break;
      case "s": case "S": audioFx.toggleSynthFx(); break;
      case "q": case "Q": toggleQueueDrawer(els.queueToggleBtn); break;
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

  function initShelfTabs() {
    const tabWrap = els.genreShelfTabs;
    if (!tabWrap) return null;
    const tabs = Array.from(tabWrap.querySelectorAll(".shelf-tab"));

    function sync(focusTab) {
      tabs.forEach((b) => {
        const on = b.dataset.category === shelfCategory;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
        if (on && focusTab) b.focus();
      });
    }

    function activateShelfTab(catId, focusTab) {
      if (catId !== shelfCategory) {
        shelfCategory = catId;
        if (activeGenre !== "all" && shelfCategory !== "all" && genreCategory(activeGenre) !== shelfCategory) {
          activeGenre = "all";
        }
        renderGenreShelf();
        applyFilter();
      }
      sync(focusTab);
    }

    tabs.forEach((btn, idx) => {
      btn.tabIndex = btn.dataset.category === shelfCategory ? 0 : -1;
      btn.addEventListener("click", () => {
        activateShelfTab(btn.dataset.category || "all", false);
      });
      btn.addEventListener("keydown", (e) => {
        let nextIdx = -1;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = tabs.length - 1;
        if (nextIdx !== -1) {
          e.preventDefault();
          activateShelfTab(tabs[nextIdx].dataset.category || "all", true);
        }
      });
    });

    return { sync };
  }

  /* ---------------- init ---------------- */

  function init() {
    loadSettings();
    updateRepeatUI();
    setPressedButtonState(els.shuffleBtn, shuffle);
    setView(view);
    shelfTabsApi = initShelfTabs();
    const v = parseInt(storageGet(KEYS.VOLUME, ""), 10);
    if (!isNaN(v)) {
      if (v > 0) lastVolume = Math.min(100, v);
      setVolume(v);
    } else {
      syncSlider(els.volume);
    }
    syncSlider(els.seek);
    lyricsCtrl.init();
    audioFx.syncUI();
    if (els.vinylFxBtn) els.vinylFxBtn.addEventListener("click", audioFx.toggleVinylFx);
    if (els.synthFxBtn) els.synthFxBtn.addEventListener("click", audioFx.toggleSynthFx);
    updateQueueUI();
    setupMediaSession();
    loadLibrary(false);
  }

  init();
})();
