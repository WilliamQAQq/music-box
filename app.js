(function () {
  "use strict";

  const STORE_KEY = "gh-music-box-settings-v2";
  const CACHE_KEY = "gh-music-box-cache-v2";
  const VIEW_KEY = "gh-view-v2";

  const AUDIO_EXTS = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "webm"];
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
  const COVER_NAMES = ["cover", "folder", "album", "albumart", "artwork", "front", "poster"];

  // 连续多少首播放失败后停止自动跳歌(防止断网时无限跳歌)
  const MAX_ERROR_STREAK = 3;

  // 八大维多利亚风格唱片集定义(顺序即展示顺序)
  const GENRE_PRESETS = [
    {
      id: "黄金年代 · 爵士名伶",
      sub: "Billie Holiday · Ella · Chet Baker · Julie London",
      seal: "#c98236",
      desc: "1930–60 年代烟嗓名伶与摇摆黄金岁月，留声机最经典的温柔夜色。",
    },
    {
      id: "交响爵士 · 浪漫夜曲",
      sub: "Laufey & 冰岛交响乐团 · Anthony Lazaro",
      seal: "#b85668",
      desc: "古典管弦乐团与现代爵士女声的浪漫交织，宛如烛光音乐厅现场。",
    },
    {
      id: "蓝调之音 · 器乐爵士",
      sub: "Miles Davis · Coltrane · Ryo Fukui · Glenn Miller",
      seal: "#4d8a88",
      desc: "小号、萨克斯与钢琴三重奏的深夜即兴，兼具冷爵士与大乐队摇摆。",
    },
    {
      id: "灵魂低吟 · 节奏蓝调",
      sub: "Bill Withers · Etta James · Sam Cooke · 陶喆",
      seal: "#bc6039",
      desc: "深情滚烫的灵魂乐与节奏布鲁斯经典，直抵人心的律动与嘶吼。",
    },
    {
      id: "先锋浪潮 · 独立摇滚",
      sub: "万能青年旅店 · 草东 · 刺猬 · 惘闻 · 回春丹",
      seal: "#5d8b67",
      desc: "当代华语独立乐队、后摇器乐与合成器浪潮，锋利诗意的新声。",
    },
    {
      id: "赤焰岁月 · 华语摇滚",
      sub: "崔健 · 唐朝 · 窦唯 · 黑豹 · 二手玫瑰 · 罗大佑",
      seal: "#a8333a",
      desc: "华语摇滚开山火种与时代呐喊，粗粝炽热的经典现场记忆。",
    },
    {
      id: "街巷叙事 · 民谣流行",
      sub: "暗杠 · 一杯陈豆浆 · 任浩铭",
      seal: "#b89a58",
      desc: "温润质朴的城市民谣与华语金曲，适合静夜独酌的街巷故事。",
    },
    {
      id: "古典沙龙 · 剧场礼乐",
      sub: "Erik Satie · 卡农 · 俄式与古典探戈 · 红军合唱团",
      seal: "#88507c",
      desc: "大提琴钢琴室内乐、旧日俄式及阿根廷探戈、恢弘合唱与庄重礼乐，重现沙龙风华。",
    },
  ];

  // 旧缓存兜底歌手->风格映射(与 .github/gen_music_json.py 保持一致)
  const ARTIST_GENRE_MAP = {
    "billie holiday": "黄金年代 · 爵士名伶",
    "chet baker": "黄金年代 · 爵士名伶",
    "dean martin": "黄金年代 · 爵士名伶",
    "dinah washington": "黄金年代 · 爵士名伶",
    "ella fitzgerald": "黄金年代 · 爵士名伶",
    "ella fitzgerald, paul weston and his orchestra": "黄金年代 · 爵士名伶",
    "etta jones": "黄金年代 · 爵士名伶",
    "john coltrane, johnny hartman": "黄金年代 · 爵士名伶",
    "julie london": "黄金年代 · 爵士名伶",
    "louis armstrong": "黄金年代 · 爵士名伶",
    "peggy lee": "黄金年代 · 爵士名伶",
    "laufey, iceland symphony orchestra": "交响爵士 · 浪漫夜曲",
    "laufey": "交响爵士 · 浪漫夜曲",
    "anthony lazaro": "交响爵士 · 浪漫夜曲",
    "duke ellington, john coltrane": "蓝调之音 · 器乐爵士",
    "glenn miller": "蓝调之音 · 器乐爵士",
    "lester young": "蓝调之音 · 器乐爵士",
    "lester young, oscar peterson trio": "蓝调之音 · 器乐爵士",
    "miles davis, john coltrane, bill evans": "蓝调之音 · 器乐爵士",
    "oliver nelson": "蓝调之音 · 器乐爵士",
    "ryo fukui": "蓝调之音 · 器乐爵士",
    "sidney bechet, muggsy spanier": "蓝调之音 · 器乐爵士",
    "berlioz, ted jasper": "蓝调之音 · 器乐爵士",
    "bill withers": "灵魂低吟 · 节奏蓝调",
    "etta james": "灵魂低吟 · 节奏蓝调",
    "james brown": "灵魂低吟 · 节奏蓝调",
    "sam cooke": "灵魂低吟 · 节奏蓝调",
    "william bell": "灵魂低吟 · 节奏蓝调",
    "david tao": "灵魂低吟 · 节奏蓝调",
    "万能青年旅店": "先锋浪潮 · 独立摇滚",
    "no party for cao dong": "先锋浪潮 · 独立摇滚",
    "刺猬hedgehog": "先锋浪潮 · 独立摇滚",
    "回春丹": "先锋浪潮 · 独立摇滚",
    "海龟先生": "先锋浪潮 · 独立摇滚",
    "蛙池": "先锋浪潮 · 独立摇滚",
    "當代電影大師": "先锋浪潮 · 独立摇滚",
    "wang wen": "先锋浪潮 · 独立摇滚",
    "发光曲线": "先锋浪潮 · 独立摇滚",
    "白紙扇（hardcore raver in tears）": "先锋浪潮 · 独立摇滚",
    "快乐老家": "先锋浪潮 · 独立摇滚",
    "vh (vast & hazy)": "先锋浪潮 · 独立摇滚",
    "ado": "赤焰岁月 · 华语摇滚",
    "black panther": "赤焰岁月 · 华语摇滚",
    "dou wei": "赤焰岁月 · 华语摇滚",
    "second hand rose": "赤焰岁月 · 华语摇滚",
    "tang dynasty": "赤焰岁月 · 华语摇滚",
    "wang feng": "赤焰岁月 · 华语摇滚",
    "xtx (xie tianxiao)": "赤焰岁月 · 华语摇滚",
    "xu wei": "赤焰岁月 · 华语摇滚",
    "反光镜乐队": "赤焰岁月 · 华语摇滚",
    "崔健": "赤焰岁月 · 华语摇滚",
    "羅大佑": "赤焰岁月 · 华语摇滚",
    "陳明章, 王明輝": "赤焰岁月 · 华语摇滚",
    "暗杠": "街巷叙事 · 民谣流行",
    "一杯陈豆浆": "街巷叙事 · 民谣流行",
    "任浩铭, 黄勇": "街巷叙事 · 民谣流行",
    "benny martin/the wong janice": "古典沙龙 · 剧场礼乐",
    "carlos gardel": "古典沙龙 · 剧场礼乐",
    "erik satie/philippe entremont": "古典沙龙 · 剧场礼乐",
    "francis shaw": "古典沙龙 · 剧场礼乐",
    "mandela catalogue": "古典沙龙 · 剧场礼乐",
    "pyotr leshchenko": "古典沙龙 · 剧场礼乐",
    "the red army choir": "古典沙龙 · 剧场礼乐",
    "юрий щербаков": "古典沙龙 · 剧场礼乐",
    "美国国歌": "古典沙龙 · 剧场礼乐",
  };

  const GENRE_RANK = new Map(GENRE_PRESETS.map((g, idx) => [g.id, idx]));
  const GENRE_META = new Map(GENRE_PRESETS.map((g) => [g.id, g]));

  const $ = (id) => document.getElementById(id);

  const els = {
    audio: $("audio"),
    banner: $("banner"),
    bannerTitle: $("bannerTitle"),
    bannerSub: $("bannerSub"),
    bannerCta: $("bannerCta"),
    reloadBtn: $("reloadBtn"),
    settingsBtn: $("settingsBtn"),
    genreShelf: $("genreShelf"),
    genreStage: $("genreStage"),
    genreStageSeal: $("genreStageSeal"),
    genreStageTitle: $("genreStageTitle"),
    genreStageDesc: $("genreStageDesc"),
    playGenreBtn: $("playGenreBtn"),
    shuffleGenreBtn: $("shuffleGenreBtn"),
    clearGenreBtn: $("clearGenreBtn"),
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

  let tracks = [];         // { title, artist, album, genre, cover, url, path, dir }
  let covers = new Map();  // dir -> cover url
  let order = [];          // 当前播放上下文(tracks 下标)
  let pos = -1;            // 当前曲目在 order 中的位置
  let filteredTracks = []; // 歌单筛选+搜索后按当前视图排序的 tracks 下标
  let currentIndex = -1;   // 当前曲目在 tracks[] 中的下标
  let activeGenre = "all"; // 当前选中的风格歌单("all" 表示全部馆藏)

  let shuffle = localStorage.getItem("gh-shuffle") === "1";
  let repeat = localStorage.getItem("gh-repeat") || "none";
  let view = localStorage.getItem(VIEW_KEY) || "genre";
  let isSeeking = false;
  let errorStreak = 0;
  let lastVolume = 80;

  const audio = els.audio;
  const DEFAULT_COVER = els.coverArt.getAttribute("src");

  function inferGenre(artist, genre) {
    if (genre) return String(genre);
    if (!artist) return "";
    return ARTIST_GENRE_MAP[String(artist).trim().toLowerCase()] || "";
  }

  function genreRank(g) {
    if (!g) return 999;
    return GENRE_RANK.has(g) ? GENRE_RANK.get(g) : 500;
  }

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
        const title = p.slice(p.lastIndexOf("/") + 1, dot).replace(/[_-]+/g, " ");
        newTracks.push({ title, artist: "", album: "", genre: "", cover: "", path: p, dir, url: rawUrl(branch, p) });
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
      const artist = item.artist ? String(item.artist) : "";
      t.push({
        title: String(item.title || url.slice(url.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")),
        artist: artist,
        album: item.album ? String(item.album) : "",
        genre: inferGenre(artist, item.genre),
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

  function libraryKey(t, c) {
    return JSON.stringify([t || [], [...toCoverMap(c)]]);
  }

  let loadSeq = 0;

  // 有缓存时先秒开缓存；默认仓库同时在后台拉取最新 music.json，有变化就更新
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
    const oldTracks = tracks;
    tracks = (data.tracks || []).map((t) => Object.assign({}, t, {
      genre: inferGenre(t.artist, t.genre),
    }));
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
      els.genreShelf.hidden = true;
      els.genreStage.hidden = true;
      els.emptyState.hidden = false;
      els.playlist.innerHTML = "";
      renderCount();
      return;
    }
    renderGenreShelf();
    applyFilter();
    setLoading(false);
  }

  /* ---------------- style playlists shelf ---------------- */

  function collectGenreItems() {
    const counts = new Map();
    let hasAnyGenre = false;
    tracks.forEach((t) => {
      if (t.genre) hasAnyGenre = true;
      const g = t.genre || "其他典藏";
      counts.set(g, (counts.get(g) || 0) + 1);
    });
    if (!hasAnyGenre) return [];

    const items = [
      {
        id: "all",
        name: "全部馆藏",
        sub: "八大流派完整唱片库",
        seal: "#d4a64a",
        desc: "留声机全馆典藏唱片，涵盖爵士、灵魂蓝调、独立与华语摇滚、民谣及古典沙龙。",
        count: tracks.length,
      },
    ];

    GENRE_PRESETS.forEach((p) => {
      const cnt = counts.get(p.id) || 0;
      if (cnt > 0) {
        items.push({ id: p.id, name: p.id, sub: p.sub, seal: p.seal, desc: p.desc, count: cnt });
        counts.delete(p.id);
      }
    });

    counts.forEach((cnt, id) => {
      if (cnt > 0) {
        items.push({ id: id, name: id, sub: "馆藏曲目精选", seal: "#9e7632", desc: "按曲风归档的唱片合集。", count: cnt });
      }
    });

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
      name.textContent = it.name;

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

  // forceShuffle: null=保持当前随机设置，false=顺序播放，true=随机播放
  function startGenrePlaylist(id, forceShuffle) {
    activeGenre = id || "all";
    if (els.searchInput.value) els.searchInput.value = "";
    if (forceShuffle !== null) {
      shuffle = !!forceShuffle;
      localStorage.setItem("gh-shuffle", shuffle ? "1" : "0");
      els.shuffleBtn.classList.toggle("on", shuffle);
    }
    updateGenreShelfHighlight();
    applyFilter();
    if (!filteredTracks.length) return;
    errorStreak = 0;
    buildOrder(null);
    playAt(0);
    const label = activeGenre === "all" ? "全部馆藏" : activeGenre;
    toast((shuffle ? "随机起奏：" : "正在播放歌单：") + label);
  }

  els.playGenreBtn.addEventListener("click", () => startGenrePlaylist(activeGenre, false));
  els.shuffleGenreBtn.addEventListener("click", () => startGenrePlaylist(activeGenre, true));
  els.clearGenreBtn.addEventListener("click", () => selectGenre("all"));

  /* ---------------- filtering & playlist rendering ---------------- */

  function applyFilter() {
    const q = els.searchInput.value.trim().toLowerCase();
    filteredTracks = [];
    tracks.forEach((t, i) => {
      const g = t.genre || "其他典藏";
      if (activeGenre !== "all" && g !== activeGenre) return;
      if (!q ||
        t.title.toLowerCase().indexOf(q) !== -1 ||
        t.artist.toLowerCase().indexOf(q) !== -1 ||
        t.album.toLowerCase().indexOf(q) !== -1 ||
        g.toLowerCase().indexOf(q) !== -1 ||
        t.path.toLowerCase().indexOf(q) !== -1) {
        filteredTracks.push(i);
      }
    });

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

  function renderCount() {
    if (!filteredTracks.length) {
      els.trackCount.textContent = "0 首";
      return;
    }
    if (activeGenre !== "all") {
      const artists = new Set(filteredTracks.map((i) => tracks[i].artist || "未分类"));
      els.trackCount.textContent = filteredTracks.length + " 首 · " + artists.size + " 位歌手";
    } else if (view === "genre") {
      const genres = new Set(filteredTracks.map((i) => tracks[i].genre || "其他典藏"));
      els.trackCount.textContent = filteredTracks.length + " 首 · " + genres.size + " 大风格";
    } else if (view === "artist") {
      const artists = new Set(filteredTracks.map((i) => tracks[i].artist || "未分类"));
      els.trackCount.textContent = filteredTracks.length + " 首 · " + artists.size + " 位歌手";
    } else {
      els.trackCount.textContent = filteredTracks.length + " 首";
    }
  }

  function formatItemMeta(t, mode) {
    const cleanAlbum = t.album && t.album.toLowerCase() !== "unknown album" ? t.album : "";
    if (mode === "genre") {
      return t.artist || cleanAlbum || t.dir || "/";
    }
    if (mode === "artist") {
      return cleanAlbum || t.genre || t.dir || "/";
    }
    if (t.artist && t.genre) return t.artist + " · " + t.genre;
    return t.artist || cleanAlbum || t.genre || t.dir || "/";
  }

  function makeItem(tIndex, k, mode) {
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
    meta.textContent = formatItemMeta(t, mode);

    li.append(idx, eq, name, meta);
    li.addEventListener("click", () => playTrackByIndex(tIndex));
    return li;
  }

  function renderPlaylist(scrollToActive) {
    renderCount();
    const frag = document.createDocumentFragment();
    if (view === "genre" && activeGenre === "all") {
      // 计算每个风格分组的曲目数用于标题展示
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
        frag.appendChild(makeItem(tIndex, k, "genre"));
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
        frag.appendChild(makeItem(tIndex, k, "artist"));
      });
    } else {
      const itemMode = view === "genre" ? "genre" : "flat";
      filteredTracks.forEach((tIndex, k) => {
        frag.appendChild(makeItem(tIndex, k, itemMode));
      });
    }
    els.playlist.innerHTML = "";
    els.playlist.appendChild(frag);
    if (scrollToActive) scrollActiveIntoView();
  }

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
    if (next !== "genre" && next !== "artist" && next !== "flat") next = "genre";
    view = next;
    localStorage.setItem(VIEW_KEY, view);
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

  // 按当前随机开关排列播放顺序；非随机时保持界面所见的列表顺序
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
    els.playlist.querySelectorAll(".playlist-item").forEach((el) => {
      const isCur = Number(el.dataset.index) === currentIndex;
      el.classList.toggle("playing", playing && isCur);
    });
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

  function startPlayback() {
    const t = tracks[currentIndex];
    if (!t) return;
    isSeeking = false;
    audio.src = t.url;
    els.seek.max = 0;
    els.seek.value = 0;
    syncSlider(els.seek);
    els.curTime.textContent = "0:00";
    els.durTime.textContent = "0:00";
    safePlay();
    els.trackTitle.textContent = t.title;
    const subParts = [];
    if (t.artist) subParts.push(t.artist);
    if (t.genre) subParts.push(t.genre);
    els.trackSub.textContent = subParts.length ? subParts.join(" · ") : (t.album || t.dir || "/");
    const cover = t.cover || lookupCover(t.dir);
    els.coverArt.src = cover || DEFAULT_COVER;
    highlightActive(true);
    updateMediaSession(t, cover);
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
    localStorage.setItem("gh-shuffle", shuffle ? "1" : "0");
    els.shuffleBtn.classList.toggle("on", shuffle);
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
      syncSlider(els.seek);
      els.durTime.textContent = fmt(audio.duration);
    }
  }

  audio.addEventListener("loadedmetadata", updateDuration);
  audio.addEventListener("durationchange", updateDuration);

  audio.addEventListener("timeupdate", () => {
    if (!isSeeking && isFinite(audio.duration)) {
      els.seek.value = audio.currentTime;
      syncSlider(els.seek);
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
    els.curTime.textContent = fmt(parseFloat(els.seek.value));
  });
  els.seek.addEventListener("change", () => {
    if (isFinite(audio.duration)) audio.currentTime = parseFloat(els.seek.value);
    syncSlider(els.seek);
    isSeeking = false;
  });

  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    els.volume.value = v;
    syncSlider(els.volume);
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target;
    const tag = (target.tagName || "").toLowerCase();
    if (target.isContentEditable || tag === "textarea" || tag === "select") return;
    if (tag === "input") {
      if (target.type !== "range") return;
      if (e.key.indexOf("Arrow") === 0) return;
    }
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
    setView(view);
    const v = parseInt(localStorage.getItem("gh-volume"), 10);
    if (!isNaN(v)) {
      if (v > 0) lastVolume = Math.min(100, v);
      setVolume(v);
    } else {
      syncSlider(els.volume);
    }
    syncSlider(els.seek);
    setupMediaSession();
    loadLibrary(false);
  }

  init();
})();
