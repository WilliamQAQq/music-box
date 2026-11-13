(function () {
  "use strict";

  const ns = window.__MusicBox || {};
  const cat = ns.catalog;
  const {
    KEYS,
    COLLECTION_FAVORITES,
    COLLECTION_RECENT,
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
    storageGet,
    storageSet,
    setPressedButtonState,
    debounce,
    parseTrackShareHash,
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
    resumeBar: $("resumeBar"),
    resumeText: $("resumeText"),
    resumePlayBtn: $("resumePlayBtn"),
    resumeDismissBtn: $("resumeDismissBtn"),
    searchInput: $("searchInput"),
    searchClearBtn: $("searchClearBtn"),
    locateTrackBtn: $("locateTrackBtn"),
    trackCount: $("trackCount"),
    playlist: $("playlist"),
    emptyState: $("emptyState"),
    viewToggle: $("viewToggle"),
    lyricsPanel: $("lyricsPanel"),
    lyricsTrackName: $("lyricsTrackName"),
    lyricsSearchBtn: $("lyricsSearchBtn"),
    lyricsExportBtn: $("lyricsExportBtn"),
    lyricsTransBtn: $("lyricsTransBtn"),
    lyricsCloseBtn: $("lyricsCloseBtn"),
    lyricsSearchBar: $("lyricsSearchBar"),
    lyricsSearchInput: $("lyricsSearchInput"),
    lyricsSearchCount: $("lyricsSearchCount"),
    lyricsSearchClearBtn: $("lyricsSearchClearBtn"),
    lyricsScroll: $("lyricsScroll"),
    lyricsList: $("lyricsList"),
    lyricsFollowBtn: $("lyricsFollowBtn"),
    lyricsToggleBtn: $("lyricsToggleBtn"),
    vinylFxBtn: $("vinylFxBtn"),
    synthFxBtn: $("synthFxBtn"),
    studioBtn: $("studioBtn"),
    studioBadgeDot: $("studioBadgeDot"),
    studioPanel: $("studioPanel"),
    studioCloseBtn: $("studioCloseBtn"),
    spectrumBox: $("spectrumBox"),
    spectrumCanvas: $("spectrumCanvas"),
    spectrumToggleBtn: $("spectrumToggleBtn"),
    eqPresetBtns: Array.from(document.querySelectorAll(".eq-preset-btn")),
    eqBass: $("eqBass"),
    eqBassVal: $("eqBassVal"),
    eqMid: $("eqMid"),
    eqMidVal: $("eqMidVal"),
    eqTreble: $("eqTreble"),
    eqTrebleVal: $("eqTrebleVal"),
    vinylMixRange: $("vinylMixRange"),
    vinylMixVal: $("vinylMixVal"),
    synthMixRange: $("synthMixRange"),
    synthMixVal: $("synthMixVal"),
    speedBtns: Array.from(document.querySelectorAll(".studio-pill-btn[data-speed]")),
    crossfadeBtns: Array.from(document.querySelectorAll(".studio-pill-btn[data-xfade]")),
    sleepBtns: Array.from(document.querySelectorAll(".studio-pill-btn[data-sleep]")),
    sleepStatusText: $("sleepStatusText"),
    abSetABtn: $("abSetABtn"),
    abSetBBtn: $("abSetBBtn"),
    abToggleBtn: $("abToggleBtn"),
    abClearBtn: $("abClearBtn"),
    abReadout: $("abReadout"),
    shareTrackBtn: $("shareTrackBtn"),
    shareStatus: $("shareStatus"),
    swCacheInfo: $("swCacheInfo"),
    clearAudioCacheBtn: $("clearAudioCacheBtn"),
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
    closeModalBtn: $("closeModalBtn"),
    resetSettingsBtn: $("resetSettingsBtn"),
    r2FieldsWrap: $("r2FieldsWrap"),
    githubFieldsWrap: $("githubFieldsWrap"),
    setR2Url: $("setR2Url"),
    setR2Key: $("setR2Key"),
    r2QuotaDetails: $("r2QuotaDetails"),
    r2QuotaBadge: $("r2QuotaBadge"),
    r2QuotaSummary: $("r2QuotaSummary"),
    refreshR2QuotaBtn: $("refreshR2QuotaBtn"),
    r2QuotaGrid: $("r2QuotaGrid"),
    quotaDailyBar: $("quotaDailyBar"),
    quotaDailyVal: $("quotaDailyVal"),
    quotaClassBBar: $("quotaClassBBar"),
    quotaClassBVal: $("quotaClassBVal"),
    quotaClassABar: $("quotaClassABar"),
    quotaClassAVal: $("quotaClassAVal"),
    quotaStorageBar: $("quotaStorageBar"),
    quotaStorageVal: $("quotaStorageVal"),
    setOwner: $("setOwner"),
    setRepo: $("setRepo"),
    setBranch: $("setBranch"),
    setPath: $("setPath"),
    setToken: $("setToken"),
    formError: $("formError"),
    toast: $("toast"),
  };

  const DEFAULT_COVER = els.coverArt.getAttribute("src");

  let tracks = [];
  let covers = new Map();
  let trackIdxByUrl = new Map();
  let filteredTracks = [];
  let order = [];
  let pos = -1;
  let currentIndex = -1;
  let activePlaylistEl = null;

  let shuffle = storageGet(KEYS.SHUFFLE, "0") === "1";
  let repeat = storageGet(KEYS.REPEAT, "none");
  let view = storageGet(KEYS.VIEW, "genre");
  let activeGenre = "all";
  let shelfCategory = "all";
  let shelfTabsApi = null;

  let isSeeking = false;
  let lastVolume = 80;
  let baseVolume = 0.8;
  let fallbackGainFactor = 1.0;
  let errorStreak = 0;

  let pendingSeekSec = 0;
  let initialDeepLinkHandled = false;
  let lastShownCurSec = -1;
  let inTailFade = false;
  let lastQueueTrigger = null;

  // 智能预加载状态（复用单个离屏 Audio）
  let preloadAudioEl = null;
  let preloadTimer = null;
  let preloadAbortTimer = null;
  let activePreloadUrl = "";
  const preloadedUrls = new Set();
  const swCachedUrls = new Set();

  // Keyed DOM 复用缓存，避免过滤、收藏、重排队列时重建节点树
  const playlistRowCache = new Map();
  const queueRowCache = new Map();

  const audio = els.audio;
  audio.volume = baseVolume;

  /* ---------------- module wiring ---------------- */

  let toastTimer = null;
  function toast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.classList.toggle("error", !!isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  function applyEffectiveVolume() {
    const vol = Math.max(0, Math.min(1, baseVolume * fallbackGainFactor));
    audio.volume = vol;
  }

  const audioFx = ns.createAudioFxController({
    audio,
    vinylBtn: els.vinylFxBtn,
    synthBtn: els.synthFxBtn,
    toast,
    getBaseVolume: () => baseVolume,
    onFallbackGainChange: (factor) => {
      fallbackGainFactor = factor;
      applyEffectiveVolume();
    },
  });

  const userState = ns.createUserStateController({
    onSleepFade: (factor) => audioFx.setSleepFadeFactor(factor),
    onSleepExpire: () => {
      if (!audio.paused) audio.pause();
      if (currentIndex !== -1 && tracks[currentIndex]) {
        userState.saveResume(tracks[currentIndex].url, audio.currentTime || 0, tracks[currentIndex].title, true);
      }
      toast("晚安：睡眠定时已温柔暂停播放");
    },
  });

  const lyricsCtrl = ns.createLyricsController({
    audio,
    els,
    getCurrentTrack: () => (currentIndex !== -1 ? tracks[currentIndex] : null),
    defaultTrackSub,
    safePlay,
    toast,
    onBeforeMobileOpen: () => {
      closeQueueDrawer(false);
      if (studioCtrl && studioCtrl.isOpen()) studioCtrl.closeStudio(false);
    },
  });

  const studioCtrl = ns.createStudioController({
    audio,
    els,
    audioFx,
    userState,
    getCurrentTrack: () => (currentIndex !== -1 ? tracks[currentIndex] : null),
    syncSlider,
    toast,
    onBeforeOpen: () => closeQueueDrawer(false),
    onCrossfadeChange: (sec) => {
      if (sec <= 0 && inTailFade) {
        inTailFade = false;
        audioFx.setTransitionFadeFactor(1, true);
      }
    },
  });

  const libraryLoader = ns.createLibraryLoader({
    els,
    toast,
    onApplyLibrary: applyLibrary,
    onLoadingChange: setLoading,
    onBannerChange: showBanner,
    onBeforeModalOpen: () => {
      closeQueueDrawer(false);
      lyricsCtrl.closeMobile(false);
      if (studioCtrl.isOpen()) studioCtrl.closeStudio(false);
    },
    onSettingsResetFilter: () => {
      activeGenre = "all";
      shelfCategory = "all";
      if (shelfTabsApi) shelfTabsApi.sync(false);
    },
    onExternalLyricsChange: (cfg) => {
      lyricsCtrl.setExternalLyricsSource(cfg.r2Url, cfg.r2Key, cfg.sourceMode);
    },
  });

  /* ---------------- library apply & shelf ---------------- */

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

  function showBanner(show, st) {
    const s = st || libraryLoader.getSettings();
    els.banner.hidden = !show;
    if (show) {
      const hasR2 = !!(s.r2Url && (s.sourceMode === "r2" || s.sourceMode === "hybrid"));
      const hasGh = !!(s.owner && s.repo && s.sourceMode !== "r2");
      if (hasR2 || hasGh) {
        els.bannerTitle.textContent = "音乐列表加载失败";
        els.bannerSub.textContent = "请检查网络或 Cloudflare R2 网关配置后重试，也可在右上角设置中切换数据源";
        els.bannerCta.textContent = "重试";
      } else {
        els.bannerTitle.textContent = "设置你的音乐数据源";
        els.bannerSub.textContent = "填入 GitHub 仓库或 Cloudflare R2 网关地址即可在线播放";
        els.bannerCta.textContent = "打开设置";
      }
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
    covers = data.covers instanceof Map ? data.covers : new Map(data.covers || []);
    trackIdxByUrl = new Map(tracks.map((t, i) => [t.url, i]));

    // 清理已下线曲目的 DOM 缓存，同时保留现存节点的 DOM 引用与用户持久化收藏/历史（避免切源或网关暂退时误删）
    playlistRowCache.forEach((_, url) => {
      if (!trackIdxByUrl.has(url)) playlistRowCache.delete(url);
    });

    const remap = (i) => {
      const t = oldTracks[i];
      return t && trackIdxByUrl.has(t.url) ? trackIdxByUrl.get(t.url) : -1;
    };
    if (currentIndex !== -1) currentIndex = remap(currentIndex);
    order = order.map(remap).filter((i) => i !== -1);
    pos = currentIndex !== -1 ? order.indexOf(currentIndex) : -1;

    const isPersonalGenre = activeGenre === COLLECTION_FAVORITES || activeGenre === COLLECTION_RECENT;
    if (activeGenre !== "all" && !isPersonalGenre && !tracks.some((t) => (t.genre || "其他典藏") === activeGenre)) {
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

    if (!initialDeepLinkHandled) {
      initialDeepLinkHandled = true;
      handleStartupTarget();
    }
  }

  function getReachablePersonalCounts() {
    let favCnt = 0;
    let recCnt = 0;
    userState.getFavoriteUrls().forEach((u) => { if (trackIdxByUrl.has(u)) favCnt++; });
    userState.getRecentUrls().forEach((u) => { if (trackIdxByUrl.has(u)) recCnt++; });
    return { favCnt, recCnt };
  }

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
    const { favCnt, recCnt } = getReachablePersonalCounts();
    els.genreShelfTabs.hidden = totalGenres === 0;
    els.genreShelfTabs.querySelectorAll(".shelf-tab").forEach((btn) => {
      const catId = btn.dataset.category;
      if (catId === "all") btn.textContent = "全部专区 (" + (totalGenres + 2) + ")";
      else if (catId === "personal") btn.textContent = "\u2665 我的雅集 (" + favCnt + (recCnt ? "+" + recCnt : "") + ")";
      else if (catId === "salon") btn.textContent = "\uD83C\uDFB7 沙龙流派 (" + salonGenres + ")";
      else if (catId === "military") btn.textContent = "\uD83C\uDFBA 国歌军乐 (" + militaryGenres + ")";
    });
  }

  function updatePersonalShelfCountsInPlace() {
    const { favCnt, recCnt } = getReachablePersonalCounts();
    if (els.genreShelfTabs) {
      const pTab = els.genreShelfTabs.querySelector('.shelf-tab[data-category="personal"]');
      if (pTab) pTab.textContent = "\u2665 我的雅集 (" + favCnt + (recCnt ? "+" + recCnt : "") + ")";
    }
    const favCardCount = els.genreShelf.querySelector('.genre-card[data-genre="' + COLLECTION_FAVORITES + '"] .genre-card-count');
    if (favCardCount) favCardCount.textContent = favCnt + " 首";
    const recCardCount = els.genreShelf.querySelector('.genre-card[data-genre="' + COLLECTION_RECENT + '"] .genre-card-count');
    if (recCardCount) recCardCount.textContent = recCnt + " 首";
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
    if (!hasAnyGenre && shelfCategory !== "personal") return [];

    const { favCnt, recCnt } = getReachablePersonalCounts();
    const favItem = {
      id: COLLECTION_FAVORITES,
      category: "personal",
      flag: "\u2665",
      name: "我的珍藏",
      sub: "私人收藏黑胶歌单 (快捷键 F)",
      seal: "#9f1239",
      desc: "随手加心收藏的心水曲目，自动持久化于本地唱片柜。",
      count: favCnt,
    };
    const recItem = {
      id: COLLECTION_RECENT,
      category: "personal",
      flag: "\u23F2",
      name: "最近聆听",
      sub: "近 45 首留声落针足迹",
      seal: "#b45309",
      desc: "按最近一次完整落针顺序排列，方便迅速寻回方才的旋律。",
      count: recCnt,
    };

    if (shelfCategory === "personal") {
      return [favItem, recItem];
    }

    let summaryItem;
    if (shelfCategory === "salon") {
      summaryItem = {
        id: "all",
        category: "salon",
        name: "全部沙龙流派",
        sub: "十一大维多利亚沙龙唱片集",
        seal: "#c98236",
        desc: "涵盖爵士名伶、交响夜曲、器乐爵士、节奏蓝调、独立与华语摇滚、城市民谣、古典剧场礼乐、暗夜模拟恐怖、世界民谣及当代热门新声。",
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
        sub: "十八大专区完整唱片库",
        seal: "#d4a64a",
        desc: "留声机全馆典藏唱片，涵盖爵士、摇滚、古典沙龙、模拟恐怖、世界民谣、热门新声及七国国歌军乐特辑。",
        count: tracks.length,
      };
    }

    const items = [summaryItem];
    if (shelfCategory === "all") {
      items.push(favItem, recItem);
    }

    GENRE_PRESETS.forEach((p) => {
      const cnt = counts.get(p.id) || 0;
      if (cnt > 0 && (shelfCategory === "all" || p.category === shelfCategory)) {
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
    });

    if (shelfCategory === "all" || shelfCategory === "salon") {
      counts.forEach((cnt, id) => {
        if (cnt > 0) {
          items.push({ id, category: "other", name: id, sub: "馆藏曲目精选", seal: "#9e7632", desc: "按曲风归档的唱片合集。", count: cnt });
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

    els.genreShelf.replaceChildren(frag);
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
    let meta;
    if (activeGenre === COLLECTION_FAVORITES) {
      meta = { seal: "#9f1239", desc: "私人收藏黑胶歌单（点击曲目右侧桃心或按 F 随时加入/移出）。", title: "我的珍藏" };
    } else if (activeGenre === COLLECTION_RECENT) {
      meta = { seal: "#b45309", desc: "按最近一次聆听顺序保存，最多收录 45 首历史曲目。", title: "最近聆听" };
    } else {
      const m = GENRE_META.get(activeGenre) || { seal: "#9e7632", desc: "按曲风归档的留声机歌单。" };
      meta = { seal: m.seal, desc: m.desc, title: activeGenre };
    }
    els.genreStage.hidden = false;
    els.genreStage.style.setProperty("--seal", meta.seal);
    els.genreStageTitle.textContent = meta.title;
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

  function startGenrePlaylist(id, forceShuffle) {
    if (!tracks.length) return;
    activeGenre = id || "all";
    clearSearchValue();
    if (forceShuffle !== null) {
      shuffle = !!forceShuffle;
      storageSet(KEYS.SHUFFLE, shuffle ? "1" : "0");
      setPressedButtonState(els.shuffleBtn, shuffle);
    }
    updateGenreShelfHighlight();
    applyFilter();
    if (!filteredTracks.length) {
      toast("该歌单当前暂无曲目", true);
      return;
    }
    errorStreak = 0;
    buildOrder(null);
    playAt(0);
    let label = activeGenre;
    if (activeGenre === COLLECTION_FAVORITES) label = "我的珍藏";
    else if (activeGenre === COLLECTION_RECENT) label = "最近聆听";
    else if (activeGenre === "all") {
      label = shelfCategory === "military" ? "全部国歌军乐" : shelfCategory === "salon" ? "全部沙龙流派" : shelfCategory === "personal" ? "我的雅集" : "全部馆藏";
    }
    toast((shuffle ? "随机起奏：" : "正在播放歌单：") + label);
  }

  els.playGenreBtn.addEventListener("click", () => startGenrePlaylist(activeGenre, false));
  els.shuffleGenreBtn.addEventListener("click", () => startGenrePlaylist(activeGenre, true));
  els.clearGenreBtn.addEventListener("click", () => selectGenre("all"));

  /* ---------------- filtering & keyed playlist rendering ---------------- */

  function applyFilter() {
    const rawQ = els.searchInput.value;
    if (els.searchClearBtn) els.searchClearBtn.hidden = !rawQ;
    const tokens = tokenizeQuery(rawQ);
    filteredTracks = [];

    if (activeGenre === COLLECTION_FAVORITES) {
      userState.getFavoriteUrls().forEach((url) => {
        const idx = trackIdxByUrl.get(url);
        if (idx === undefined) return;
        const t = tracks[idx];
        if (!tokens.length || matchesSearchTokens(t._searchKey || buildSearchKey(t), tokens)) {
          filteredTracks.push(idx);
        }
      });
    } else if (activeGenre === COLLECTION_RECENT) {
      userState.getRecentUrls().forEach((url) => {
        const idx = trackIdxByUrl.get(url);
        if (idx === undefined) return;
        const t = tracks[idx];
        if (!tokens.length || matchesSearchTokens(t._searchKey || buildSearchKey(t), tokens)) {
          filteredTracks.push(idx);
        }
      });
    } else {
      const isPersonalTabAll = shelfCategory === "personal" && activeGenre === "all";
      const favUrls = isPersonalTabAll ? new Set(userState.getFavoriteUrls()) : null;
      const recUrls = isPersonalTabAll ? new Set(userState.getRecentUrls()) : null;

      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const g = t.genre || "其他典藏";
        if (activeGenre !== "all") {
          if (g !== activeGenre) continue;
        } else if (isPersonalTabAll) {
          if (!favUrls.has(t.url) && !recUrls.has(t.url)) continue;
        } else if (shelfCategory !== "all") {
          if (genreCategory(g) !== shelfCategory) continue;
        }
        if (!tokens.length || matchesSearchTokens(t._searchKey || buildSearchKey(t), tokens)) {
          filteredTracks.push(i);
        }
      }

      if (view === "genre" && !isPersonalTabAll) {
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
    }

    els.emptyState.hidden = !tracks.length || filteredTracks.length > 0;
    renderPlaylist(false);
    updateLocateBtn();
  }

  const debouncedFilter = debounce(applyFilter, 75);

  els.searchInput.addEventListener("input", () => {
    if (els.searchClearBtn) els.searchClearBtn.hidden = !els.searchInput.value;
    debouncedFilter();
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") debouncedFilter.flush();
    else if (e.key === "Escape" && els.searchInput.value) {
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
    } else if (view === "genre" && shelfCategory !== "personal") {
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

  function syncRowFavButton(btn, isFav, title) {
    if (!btn) return;
    btn.classList.toggle("is-fav", isFav);
    btn.textContent = isFav ? "\u2665" : "\u2661";
    btn.title = isFav ? "移出我的珍藏" : "加入我的珍藏 (快捷键 F)";
    btn.setAttribute("aria-pressed", isFav ? "true" : "false");
    btn.setAttribute("aria-label", (isFav ? "移出珍藏：" : "收藏：") + title);
  }

  function getOrCreatePlaylistRow(tIndex, k, mode, tabTargetK) {
    const t = tracks[tIndex];
    const isRovingTarget = k === tabTargetK;
    const isFav = userState.isFavorite(t.url);
    const metaText = formatItemMeta(t, mode);
    let entry = playlistRowCache.get(t.url);

    if (!entry) {
      const li = document.createElement("li");
      li.className = "playlist-item";

      const idxEl = document.createElement("span");
      idxEl.className = "idx";

      const eqEl = document.createElement("span");
      eqEl.className = "eq";
      eqEl.setAttribute("aria-hidden", "true");
      eqEl.innerHTML = "<span></span><span></span><span></span>";

      const nameEl = document.createElement("span");
      nameEl.className = "name";

      const metaEl = document.createElement("span");
      metaEl.className = "meta";

      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "playlist-fav-btn";

      const enqueueBtn = document.createElement("button");
      enqueueBtn.type = "button";
      enqueueBtn.className = "playlist-enqueue-btn";
      enqueueBtn.title = "添加到下一首播放";
      enqueueBtn.textContent = "+";

      li.append(idxEl, eqEl, nameEl, metaEl, favBtn, enqueueBtn);
      entry = { li, idxEl, eqEl, nameEl, metaEl, favBtn, enqueueBtn };
      playlistRowCache.set(t.url, entry);
    }

    entry.li.dataset.index = String(tIndex);
    entry.li.tabIndex = isRovingTarget ? 0 : -1;
    const isActive = tIndex === currentIndex;
    entry.li.classList.toggle("active", isActive);
    entry.li.classList.toggle("playing", isActive && !audio.paused);
    if (isActive) activePlaylistEl = entry.li;

    if (entry.idxEl.textContent !== String(k + 1)) entry.idxEl.textContent = String(k + 1);
    if (entry.nameEl.textContent !== t.title) entry.nameEl.textContent = t.title;
    if (entry.metaEl.textContent !== metaText) entry.metaEl.textContent = metaText;
    syncRowFavButton(entry.favBtn, isFav, t.title);
    entry.favBtn.tabIndex = isRovingTarget ? 0 : -1;
    entry.enqueueBtn.tabIndex = isRovingTarget ? 0 : -1;
    entry.enqueueBtn.setAttribute("aria-label", "下一首播放 " + t.title);
    return entry.li;
  }

  function setPlaylistRovingTabIndex(activeLi) {
    if (!activeLi) return;
    els.playlist.querySelectorAll('.playlist-item[tabindex="0"], .playlist-fav-btn[tabindex="0"], .playlist-enqueue-btn[tabindex="0"]').forEach((el) => {
      if (el !== activeLi && el.parentElement !== activeLi) el.tabIndex = -1;
    });
    activeLi.tabIndex = 0;
    const favBtn = activeLi.querySelector(".playlist-fav-btn");
    const enqBtn = activeLi.querySelector(".playlist-enqueue-btn");
    if (favBtn) favBtn.tabIndex = 0;
    if (enqBtn) enqBtn.tabIndex = 0;
  }

  function renderPlaylist(scrollToActive) {
    renderCount();
    activePlaylistEl = null;
    const frag = document.createDocumentFragment();
    const activeK = currentIndex !== -1 ? filteredTracks.indexOf(currentIndex) : -1;
    const tabTargetK = activeK !== -1 ? activeK : 0;

    if (view === "genre" && activeGenre === "all" && shelfCategory !== "personal") {
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
        frag.appendChild(getOrCreatePlaylistRow(tIndex, k, "genre", tabTargetK));
      });
    } else if (view === "artist" && activeGenre !== COLLECTION_FAVORITES && activeGenre !== COLLECTION_RECENT) {
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
        frag.appendChild(getOrCreatePlaylistRow(tIndex, k, "artist", tabTargetK));
      });
    } else {
      const itemMode = view === "genre" ? "genre" : "flat";
      filteredTracks.forEach((tIndex, k) => {
        frag.appendChild(getOrCreatePlaylistRow(tIndex, k, itemMode, tabTargetK));
      });
    }
    els.playlist.replaceChildren(frag);
    if (scrollToActive) scrollActiveIntoView();
  }

  els.playlist.addEventListener("click", (e) => {
    const favBtn = e.target.closest(".playlist-fav-btn");
    const enqueueBtn = e.target.closest(".playlist-enqueue-btn");
    const li = e.target.closest(".playlist-item");
    if (!li) return;
    setPlaylistRovingTabIndex(li);
    const tIndex = Number(li.dataset.index);
    if (isNaN(tIndex) || !tracks[tIndex]) return;
    if (favBtn) {
      e.stopPropagation();
      toggleTrackFavoriteByIndex(tIndex);
      return;
    }
    if (enqueueBtn) {
      e.stopPropagation();
      enqueueNext(tIndex);
      return;
    }
    playTrackByIndex(tIndex);
  });

  els.playlist.addEventListener("keydown", (e) => {
    const favBtn = e.target.closest(".playlist-fav-btn");
    const enqueueBtn = e.target.closest(".playlist-enqueue-btn");
    const li = e.target.closest(".playlist-item");
    if (!li) return;

    if (enqueueBtn) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const fb = li.querySelector(".playlist-fav-btn");
        if (fb) fb.focus();
        else li.focus();
      }
      return;
    }
    if (favBtn) {
      if (e.key === "ArrowLeft") { e.preventDefault(); li.focus(); }
      else if (e.key === "ArrowRight") {
        const eb = li.querySelector(".playlist-enqueue-btn");
        if (eb) { e.preventDefault(); eb.focus(); }
      }
      return;
    }

    if (e.key === "ArrowRight") {
      const btn = li.querySelector(".playlist-fav-btn") || li.querySelector(".playlist-enqueue-btn");
      if (btn) { e.preventDefault(); btn.focus(); }
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
    if (e.target.closest(".playlist-enqueue-btn") || e.target.closest(".playlist-fav-btn")) return;
    const li = e.target.closest(".playlist-item");
    if (!li) return;
    setPlaylistRovingTabIndex(li);
    const tIndex = Number(li.dataset.index);
    if (!isNaN(tIndex)) playTrackByIndex(tIndex);
  });

  function highlightActive(scroll) {
    if (activePlaylistEl && activePlaylistEl.isConnected) {
      activePlaylistEl.classList.remove("active", "playing");
    }
    activePlaylistEl = null;
    if (currentIndex !== -1 && tracks[currentIndex]) {
      const cached = playlistRowCache.get(tracks[currentIndex].url);
      const curEl = (cached && cached.li.isConnected)
        ? cached.li
        : els.playlist.querySelector('.playlist-item[data-index="' + currentIndex + '"]');
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

  /* ---------------- favorites, recent & resume ---------------- */

  function toggleTrackFavoriteByIndex(tIndex) {
    const t = tracks[tIndex];
    if (!t) return;
    const added = userState.toggleFavorite(t.url);
    toast((added ? "已加入珍藏：" : "已移出珍藏：") + t.title);
  }

  userState.subscribe("favorites", (payload) => {
    updatePersonalShelfCountsInPlace();
    if (activeGenre === COLLECTION_FAVORITES || (shelfCategory === "personal" && activeGenre === "all")) {
      applyFilter();
    } else if (payload && payload.url) {
      const entry = playlistRowCache.get(payload.url);
      if (entry) {
        const idx = trackIdxByUrl.get(payload.url);
        const title = idx !== undefined && tracks[idx] ? tracks[idx].title : "";
        syncRowFavButton(entry.favBtn, payload.added, title);
      }
    }
  });

  userState.subscribe("recent", () => {
    updatePersonalShelfCountsInPlace();
    if (activeGenre === COLLECTION_RECENT || (shelfCategory === "personal" && activeGenre === "all")) {
      applyFilter();
    }
  });

  function hideResumeBar() {
    if (els.resumeBar) els.resumeBar.hidden = true;
  }

  function prepareTrackAtTime(tIndex, seekSec, autoPlay) {
    const t = tracks[tIndex];
    if (!t) return;
    errorStreak = 0;
    if (!order.length || order.indexOf(tIndex) === -1) {
      buildOrder(tIndex);
    }
    pos = order.indexOf(tIndex);
    currentIndex = tIndex;
    pendingSeekSec = Math.max(0, Number(seekSec) || 0);
    lastShownCurSec = -1;
    inTailFade = false;
    audioFx.setTransitionFadeFactor(1, true);
    cancelPreload();
    isSeeking = false;
    audio.src = t.url;
    els.seek.max = 0;
    els.seek.value = 0;
    syncSlider(els.seek);
    els.curTime.textContent = fmtTime(pendingSeekSec);
    els.durTime.textContent = "0:00";
    els.trackTitle.textContent = t.title;
    els.trackSub.textContent = defaultTrackSub(t);
    const cover = t.cover || libraryLoader.lookupCover(covers, t.dir);
    els.coverArt.src = cover || DEFAULT_COVER;
    highlightActive(true);
    updateQueueUI();
    updateMediaSession(t, cover);
    lyricsCtrl.loadForTrack(t);
    if (autoPlay) safePlay();
  }

  function handleStartupTarget() {
    const share = parseTrackShareHash(window.location.hash);
    if (share && trackIdxByUrl.has(share.url)) {
      const idx = trackIdxByUrl.get(share.url);
      hideResumeBar();
      prepareTrackAtTime(idx, share.time, false);
      toast("已定位分享曲目：" + tracks[idx].title + (share.time > 0 ? " (" + fmtTime(share.time) + ")" : ""));
      return;
    }

    const saved = userState.getResume();
    if (saved && trackIdxByUrl.has(saved.url) && currentIndex === -1 && (saved.time >= 3 || saved.title)) {
      const tr = tracks[trackIdxByUrl.get(saved.url)];
      if (els.resumeText) {
        els.resumeText.textContent = "上次听到：《" + tr.title + "》" + (saved.time > 0 ? " · " + fmtTime(saved.time) : "");
      }
      if (els.resumeBar) els.resumeBar.hidden = false;
    }
  }

  window.addEventListener("hashchange", () => {
    const share = parseTrackShareHash(window.location.hash);
    if (share && trackIdxByUrl.has(share.url)) {
      hideResumeBar();
      prepareTrackAtTime(trackIdxByUrl.get(share.url), share.time, false);
      toast("已定位分享曲目：" + tracks[trackIdxByUrl.get(share.url)].title);
    }
  });

  if (els.resumePlayBtn) {
    els.resumePlayBtn.addEventListener("click", () => {
      const saved = userState.getResume();
      hideResumeBar();
      if (!saved || !trackIdxByUrl.has(saved.url)) return;
      prepareTrackAtTime(trackIdxByUrl.get(saved.url), saved.time, true);
    });
  }
  if (els.resumeDismissBtn) {
    els.resumeDismissBtn.addEventListener("click", () => {
      hideResumeBar();
      userState.clearResume();
    });
  }

  window.addEventListener("pagehide", () => {
    if (currentIndex !== -1 && tracks[currentIndex]) {
      userState.saveResume(tracks[currentIndex].url, audio.currentTime || 0, tracks[currentIndex].title, true);
    }
  });

  /* ---------------- queue drawer & keyed DOM reuse ---------------- */

  function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function arrangeOrder(indices, first) {
    const out = indices.slice();
    if (shuffle) shuffleInPlace(out);
    if (first != null) {
      const i = out.indexOf(first);
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
    if (!order.length && filteredTracks.length) buildOrder(null);
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
      toast("已清空当前曲目之外的待播队列");
    } else {
      order = [];
      pos = -1;
      toast("已清空播放队列");
    }
    updateQueueUI();
    cancelPreload();
    if (els.queueClearUpcomingBtn && els.queueClearUpcomingBtn.disabled && document.activeElement === els.queueClearUpcomingBtn && els.queueCloseBtn) {
      els.queueCloseBtn.focus();
    }
  }

  function updateQueueUI() {
    const len = order.length;
    if (els.queueCountBadge) {
      els.queueCountBadge.textContent = len > 99 ? "99+" : String(len);
      els.queueCountBadge.hidden = len === 0;
    }
    if (els.queueDrawerTitle) els.queueDrawerTitle.textContent = "播放队列 (" + len + " 首)";
    if (els.queueReshuffleBtn) els.queueReshuffleBtn.disabled = len < 2;
    if (els.queueClearUpcomingBtn) {
      els.queueClearUpcomingBtn.disabled = len === 0 || (len === 1 && pos === 0);
    }
    if (els.queueDrawer && !els.queueDrawer.hidden) renderQueueDrawer();
  }

  function renderQueueDrawer() {
    if (!els.queueList || !els.queueEmpty) return;
    if (!order.length) {
      queueRowCache.clear();
      els.queueList.replaceChildren();
      els.queueEmpty.hidden = false;
      return;
    }
    els.queueEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    const seenKeys = new Set();
    const occCounts = new Map();

    for (let i = 0; i < order.length; i++) {
      const t = tracks[order[i]];
      if (!t) continue;
      const occ = (occCounts.get(t.url) || 0) + 1;
      occCounts.set(t.url, occ);
      const cacheKey = t.url + "#" + occ;
      seenKeys.add(cacheKey);

      const isActive = i === pos;
      const isNext = pos >= 0 && i === pos + 1;
      const isPast = pos >= 0 && i < pos;
      const subText = t.artist || t.genre || "";

      let entry = queueRowCache.get(cacheKey);
      if (!entry) {
        const li = document.createElement("li");
        li.className = "queue-item";

        const playRowBtn = document.createElement("button");
        playRowBtn.type = "button";
        playRowBtn.className = "queue-item-play";

        const num = document.createElement("span");
        num.className = "queue-num";

        const info = document.createElement("span");
        info.className = "queue-item-info";

        const titleEl = document.createElement("span");
        titleEl.className = "queue-item-title";

        const subEl = document.createElement("span");
        subEl.className = "queue-item-sub";

        info.append(titleEl, subEl);
        playRowBtn.append(num, info);

        const actions = document.createElement("div");
        actions.className = "queue-item-actions";

        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "queue-act-btn queue-act-next";
        nextBtn.title = "置为下一首播放";
        nextBtn.textContent = "\u2191";

        const rmBtn = document.createElement("button");
        rmBtn.type = "button";
        rmBtn.className = "queue-act-btn queue-act-remove";
        rmBtn.title = "从队列移除";
        rmBtn.textContent = "\u00D7";

        actions.append(nextBtn, rmBtn);
        li.append(playRowBtn, actions);
        entry = { li, num, titleEl, subEl, actions, nextBtn, rmBtn };
        queueRowCache.set(cacheKey, entry);
      }

      entry.li.dataset.qidx = String(i);
      entry.li.classList.toggle("active", isActive);
      entry.li.classList.toggle("past", isPast);
      entry.num.textContent = isActive ? "\u25B6" : String(i + 1);
      if (entry.titleEl.textContent !== t.title) entry.titleEl.textContent = t.title;
      if (entry.subEl.textContent !== subText) entry.subEl.textContent = subText;
      entry.actions.hidden = isActive;
      entry.nextBtn.hidden = isNext;
      entry.nextBtn.setAttribute("aria-label", "下一首播放 " + t.title);
      entry.rmBtn.setAttribute("aria-label", "移除 " + t.title);

      frag.appendChild(entry.li);
    }

    queueRowCache.forEach((_, key) => {
      if (!seenKeys.has(key)) queueRowCache.delete(key);
    });
    els.queueList.replaceChildren(frag);
  }

  function openQueueDrawer(triggerEl) {
    if (!els.queueDrawer) return;
    lyricsCtrl.closeMobile(false);
    if (studioCtrl && studioCtrl.isOpen()) studioCtrl.closeStudio(false);
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

  if (els.queueToggleBtn) els.queueToggleBtn.addEventListener("click", () => toggleQueueDrawer(els.queueToggleBtn));
  if (els.queueCloseBtn) els.queueCloseBtn.addEventListener("click", () => closeQueueDrawer(true));
  if (els.queueBackdrop) els.queueBackdrop.addEventListener("click", () => closeQueueDrawer(true));
  if (els.queueReshuffleBtn) els.queueReshuffleBtn.addEventListener("click", reshuffleQueue);
  if (els.queueClearUpcomingBtn) els.queueClearUpcomingBtn.addEventListener("click", clearUpcomingQueue);
  if (els.queueList) {
    els.queueList.addEventListener("click", (e) => {
      const li = e.target.closest(".queue-item");
      if (!li) return;
      const qIdx = Number(li.dataset.qidx);
      if (isNaN(qIdx)) return;
      if (e.target.closest(".queue-act-next")) { moveQueueItemNext(qIdx); return; }
      if (e.target.closest(".queue-act-remove")) { removeQueueItem(qIdx); return; }
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
    const nextTrackItem = getNextPreloadTrack();
    if (!nextTrackItem) return;

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

  /* ---------------- playback core ---------------- */

  function startPlayback() {
    const t = tracks[currentIndex];
    if (!t) return;
    hideResumeBar();
    cancelPreload();
    isSeeking = false;
    pendingSeekSec = 0;
    lastShownCurSec = -1;
    inTailFade = false;
    userState.clearAbLoop();

    const xfade = studioCtrl.getCrossfadeSec();
    if (xfade > 0) audioFx.fadeInOver(Math.min(xfade * 700, 2200));
    else audioFx.setTransitionFadeFactor(1, true);

    audio.src = t.url;
    studioCtrl.applyPlaybackSpeed(Number(storageGet(KEYS.SPEED, "1")) || 1, false);
    els.seek.max = 0;
    els.seek.value = 0;
    syncSlider(els.seek);
    els.curTime.textContent = "0:00";
    els.durTime.textContent = "0:00";
    safePlay();
    els.trackTitle.textContent = t.title;
    els.trackSub.textContent = defaultTrackSub(t);
    const cover = t.cover || libraryLoader.lookupCover(covers, t.dir);
    els.coverArt.src = cover || DEFAULT_COVER;
    highlightActive(true);
    updateMediaSession(t, cover);
    userState.recordRecent(t.url);
    userState.saveResume(t.url, 0, t.title, true);
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
    inTailFade = false;
    audioFx.setTransitionFadeFactor(1, true);
    audio.currentTime = 0;
    lastShownCurSec = 0;
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
    if (audio.paused) {
      hideResumeBar();
      safePlay();
    } else {
      audio.pause();
    }
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
    if (!isFinite(audio.duration)) return;
    const savedRate = Number(storageGet(KEYS.SPEED, "1")) || 1;
    if (Math.abs(audio.playbackRate - savedRate) > 0.005) {
      studioCtrl.applyPlaybackSpeed(savedRate, false);
    }
    els.seek.max = audio.duration;
    if (pendingSeekSec > 0) {
      const target = Math.min(Math.max(0, pendingSeekSec), Math.max(0, audio.duration - 0.5));
      pendingSeekSec = 0;
      audio.currentTime = target;
      els.seek.value = target;
      els.curTime.textContent = fmtTime(target);
      lastShownCurSec = Math.floor(target);
      lyricsCtrl.syncToTime(target, true);
    }
    syncSlider(els.seek);
    els.durTime.textContent = fmtTime(audio.duration);
  }

  audio.addEventListener("loadedmetadata", updateDuration);
  audio.addEventListener("durationchange", updateDuration);

  audio.addEventListener("timeupdate", () => {
    const cur = audio.currentTime || 0;
    if (!isSeeking && isFinite(audio.duration)) {
      // A-B 复读检查
      const abJump = userState.getAbJumpTarget(cur);
      if (abJump !== null) {
        audio.currentTime = abJump;
        lyricsCtrl.syncToTime(abJump, true);
        return;
      }

      els.seek.value = cur;
      syncSlider(els.seek);
      const sec = Math.floor(cur);
      if (sec !== lastShownCurSec) {
        lastShownCurSec = sec;
        els.curTime.textContent = fmtTime(sec);
      }

      // Crossfade 尾声平滑衰减（非单曲循环、存在下一曲时生效）
      const xfade = studioCtrl.getCrossfadeSec();
      const rem = audio.duration - cur;
      if (xfade > 0 && !audio.paused && repeat !== "one" && audio.duration > xfade + 2 && rem > 0 && rem <= xfade) {
        inTailFade = true;
        audioFx.setTransitionFadeFactor(Math.max(0.05, rem / xfade), false);
      } else if (inTailFade) {
        inTailFade = false;
        audioFx.setTransitionFadeFactor(1, false);
      }
    }

    if (!isSeeking) {
      lyricsCtrl.syncToTime(cur, false);
      if (!audio.paused && currentIndex !== -1 && tracks[currentIndex] && cur >= 2) {
        userState.saveResume(tracks[currentIndex].url, cur, tracks[currentIndex].title, false);
      }
    }
  });

  audio.addEventListener("seeked", () => {
    lastShownCurSec = Math.floor(audio.currentTime || 0);
    lyricsCtrl.syncToTime(audio.currentTime || 0, false);
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
    if (
      currentIndex !== -1 &&
      tracks[currentIndex] &&
      !swCachedUrls.has(tracks[currentIndex].url) &&
      "serviceWorker" in navigator &&
      navigator.serviceWorker.controller
    ) {
      swCachedUrls.add(tracks[currentIndex].url);
      try {
        navigator.serviceWorker.controller.postMessage({
          type: "CACHE_TRACK",
          url: tracks[currentIndex].url,
        });
      } catch (e) { /* ignore */ }
    }
  });

  audio.addEventListener("pause", () => {
    setPlayingUI(false);
    audioFx.onPauseOrEnd();
    lyricsCtrl.updateCollapsedSubtitle();
    clearTimeout(preloadTimer);
    preloadTimer = null;
    if (currentIndex !== -1 && tracks[currentIndex]) {
      userState.saveResume(tracks[currentIndex].url, audio.currentTime || 0, tracks[currentIndex].title, true);
    }
  });

  audio.addEventListener("ended", () => {
    audioFx.onPauseOrEnd();
    if (userState.notifyTrackEndedForSleep()) {
      toast("本曲已播完，睡眠定时已停止播放");
      return;
    }
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
    lastShownCurSec = Math.floor(v);
    lyricsCtrl.syncToTime(v, false);
  });

  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    els.volume.value = v;
    syncSlider(els.volume);
    baseVolume = v / 100;
    applyEffectiveVolume();
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
    const s = libraryLoader.getSettings();
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
    return s;
  }

  function updateMediaSession(t, cover) {
    if (!("mediaSession" in navigator)) return;
    const s = libraryLoader.getSettings();
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || (t.source === "r2" ? "Cloudflare R2" : s.owner),
        album: (t.album && t.album.toLowerCase() !== "unknown album" ? t.album : "") || t.genre || (t.source === "r2" ? "R2 云端私藏" : s.repo),
        artwork: cover ? [{ src: cover, sizes: "512x512" }] : [],
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- keyboard ---------------- */

  document.addEventListener("keydown", (e) => {
    if (libraryLoader.isModalOpen()) {
      if (e.key === "Escape") libraryLoader.closeSettings();
      return;
    }
    if (e.key === "Escape") {
      if (studioCtrl.isOpen()) { studioCtrl.closeStudio(true); return; }
      if (els.queueDrawer && !els.queueDrawer.hidden) { closeQueueDrawer(true); return; }
      if (lyricsCtrl.isMobileOpen()) { lyricsCtrl.closeMobile(true); return; }
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
      case "e": case "E": studioCtrl.toggleStudio(els.studioBtn); break;
      case "f": case "F":
        if (currentIndex !== -1) toggleTrackFavoriteByIndex(currentIndex);
        else toast("请先选择一首曲目再收藏", true);
        break;
      case "[":
        if (currentIndex !== -1) {
          const st = userState.setAbPointA(audio.currentTime || 0);
          toast("已设定复读起点 A：" + fmtTime(st.a));
        }
        break;
      case "]":
        if (currentIndex !== -1) {
          const res = userState.setAbPointB(audio.currentTime || 0);
          if (res.error) toast(res.error, true);
          else toast("已设定复读终点 B：" + fmtTime(res.state.b) + "（开始复读）");
        }
        break;
      case "\\":
        if (userState.getAbLoopState().active || userState.getAbLoopState().b !== null) {
          userState.clearAbLoop();
          toast("已清除 A-B 复读区间");
        }
        break;
    }
  });

  /* ---------------- shelf tabs ---------------- */

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
        if (shelfCategory === "personal") {
          if (activeGenre !== COLLECTION_FAVORITES && activeGenre !== COLLECTION_RECENT) {
            activeGenre = "all";
          }
        } else if (activeGenre !== "all" && shelfCategory !== "all" && genreCategory(activeGenre) !== shelfCategory) {
          activeGenre = "all";
        }
        renderGenreShelf();
        applyFilter();
      }
      sync(focusTab);
    }

    tabs.forEach((btn, idx) => {
      btn.tabIndex = btn.dataset.category === shelfCategory ? 0 : -1;
      btn.addEventListener("click", () => activateShelfTab(btn.dataset.category || "all", false));
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

  /* ---------------- init & PWA ---------------- */

  function registerServiceWorkerIfSupported() {
    if (!("serviceWorker" in navigator)) return;
    const proto = window.location && window.location.protocol;
    if (proto !== "http:" && proto !== "https:") return;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      if (reg && reg.update) reg.update().catch(() => {});
    }).catch(() => { /* ignore offline/restricted origin */ });
  }

  function init() {
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
    studioCtrl.init();
    audioFx.syncUI();
    if (els.vinylFxBtn) els.vinylFxBtn.addEventListener("click", audioFx.toggleVinylFx);
    if (els.synthFxBtn) els.synthFxBtn.addEventListener("click", audioFx.toggleSynthFx);

    updateQueueUI();
    setupMediaSession();
    registerServiceWorkerIfSupported();
    libraryLoader.loadLibrary(false);
  }

  init();
})();
