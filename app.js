(function () {
  "use strict";

  const STORE_KEY = "gh-music-box-settings-v2";
  const CACHE_KEY = "gh-music-box-cache-v2";
  const VIEW_KEY = "gh-view-v2";
  const LYRICS_OPEN_KEY = "gh-lyrics-open";
  const LYRICS_TRANS_KEY = "gh-lyrics-trans";
  const LIVE_LYRICS_CACHE_KEY = "gh-lyrics-live-v1";
  const VINYL_FX_KEY = "gh-vinyl-fx";

  const AUDIO_EXTS = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "webm"];
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
  const COVER_NAMES = ["cover", "folder", "album", "albumart", "artwork", "front", "poster"];

  // 连续多少首播放失败后停止自动跳歌(防止断网时无限跳歌)
  const MAX_ERROR_STREAK = 3;

  // 十四大维多利亚风格唱片集与国歌军乐特辑定义(顺序即展示顺序)
  const GENRE_PRESETS = [
    {
      id: "黄金年代 · 爵士名伶",
      category: "salon",
      sub: "Billie Holiday · Ella · Chet Baker · Julie London",
      seal: "#c98236",
      desc: "1930–60 年代烟嗓名伶与摇摆黄金岁月，留声机最经典的温柔夜色。",
    },
    {
      id: "交响爵士 · 浪漫夜曲",
      category: "salon",
      sub: "Laufey & 冰岛交响乐团 · Anthony Lazaro",
      seal: "#b85668",
      desc: "古典管弦乐团与现代爵士女声的浪漫交织，宛如烛光音乐厅现场。",
    },
    {
      id: "蓝调之音 · 器乐爵士",
      category: "salon",
      sub: "Miles Davis · Coltrane · Ryo Fukui · Glenn Miller",
      seal: "#4d8a88",
      desc: "小号、萨克斯与钢琴三重奏的深夜即兴，兼具冷爵士与大乐队摇摆。",
    },
    {
      id: "灵魂低吟 · 节奏蓝调",
      category: "salon",
      sub: "Bill Withers · Etta James · Sam Cooke · 陶喆",
      seal: "#bc6039",
      desc: "深情滚烫的灵魂乐与节奏布鲁斯经典，直抵人心的律动与嘶吼。",
    },
    {
      id: "先锋浪潮 · 独立摇滚",
      category: "salon",
      sub: "万能青年旅店 · 草东 · 刺猬 · 惘闻 · 回春丹",
      seal: "#5d8b67",
      desc: "当代华语独立乐队、后摇器乐与合成器浪潮，锋利诗意的新声。",
    },
    {
      id: "赤焰岁月 · 华语摇滚",
      category: "salon",
      sub: "崔健 · 唐朝 · 窦唯 · 黑豹 · 二手玫瑰 · 罗大佑",
      seal: "#a8333a",
      desc: "华语摇滚开山火种与时代呐喊，粗粝炽热的经典现场记忆。",
    },
    {
      id: "街巷叙事 · 民谣流行",
      category: "salon",
      sub: "暗杠 · 一杯陈豆浆 · 任浩铭",
      seal: "#b89a58",
      desc: "温润质朴的城市民谣与华语金曲，适合静夜独酌的街巷故事。",
    },
    {
      id: "古典沙龙 · 剧场礼乐",
      category: "salon",
      sub: "Erik Satie · 肖邦/德彪西/贝多芬 · 卡鲁索/帕瓦罗蒂 · 红军合唱团",
      seal: "#88507c",
      desc: "大提琴钢琴室内乐、旧日俄式及阿根廷探戈、恢弘合唱与庄重礼乐，重现沙龙风华。",
    },
    {
      id: "国歌军乐 · 中国",
      category: "military",
      flag: "🇨🇳",
      sub: "义勇军进行曲 · 歌唱祖国 · 保卫黄河 · 游击队歌",
      seal: "#de2910",
      desc: "巍巍华夏，赤旗飘扬。庄严雄壮的国家颂歌、波澜壮阔的黄河大合唱与嘹亮铿锵的军旅进行曲。",
    },
    {
      id: "国歌军乐 · 美国",
      category: "military",
      flag: "🇺🇸",
      sub: "星条旗之歌 · 星条旗永不落 · 共和国战歌 · 战车向前进",
      seal: "#1e3a8a",
      desc: "雄壮军乐铜管与合唱经典，苏萨经典进行曲与行进战歌，重现历史仪仗风采。",
    },
    {
      id: "国歌军乐 · 俄罗斯",
      category: "military",
      flag: "🇷🇺",
      sub: "牢不可破的联盟 · 神圣的战争 · 告别斯拉夫少女 · 草原啊草原",
      seal: "#991b1b",
      desc: "红旗歌舞团恢弘深沉的男声合唱，二战伟大战火记忆与铜管军礼典范。",
    },
    {
      id: "国歌军乐 · 法国",
      category: "military",
      flag: "🇫🇷",
      sub: "马赛曲 · 游击队之歌 · 洛林进行曲 · 桑布尔与默兹",
      seal: "#1d4ed8",
      desc: "法兰西大革命与反法西斯抵抗运动传世军歌，激昂号角与革命卫队合唱。",
    },
    {
      id: "国歌军乐 · 德国",
      category: "military",
      flag: "🇩🇪",
      sub: "德意志之歌 · 普鲁士荣誉 · 旧友进行曲 · 霍亨弗里德贝格",
      seal: "#4b5563",
      desc: "古典欧洲军乐体系代表作，海顿国歌旋律与严谨宏大的经典步骑兵仪仗军乐。",
    },
    {
      id: "国歌军乐 · 日本",
      category: "military",
      flag: "🇯🇵",
      sub: "君之代 · 军舰进行曲 · 敷岛舰进行曲 · 拔刀队",
      seal: "#b45309",
      desc: "明治与昭和初期黑胶唱片经典行进军乐与雅乐国歌，历史留声机原声重现。",
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
    "feodor chaliapin": "古典沙龙 · 剧场礼乐",
    "enrico caruso": "古典沙龙 · 剧场礼乐",
    "enrico caruso, alma gluck": "古典沙龙 · 剧场礼乐",
    "luciano pavarotti": "古典沙龙 · 剧场礼乐",
    "arthur rubinstein": "古典沙龙 · 剧场礼乐",
    "claude debussy": "古典沙龙 · 剧场礼乐",
    "ludwig van beethoven": "古典沙龙 · 剧场礼乐",
    "antonio vivaldi": "古典沙龙 · 剧场礼乐",
    "中国人民解放军军乐团": "国歌军乐 · 中国",
    "中央乐团合唱团": "国歌军乐 · 中国",
    "中国人民解放军总政歌舞团": "国歌军乐 · 中国",
    "the united states military ensemble": "国歌军乐 · 美国",
    "john philip sousa": "国歌军乐 · 美国",
    "the sandpiper chorus": "国歌军乐 · 美国",
    "le choeur des enfants de montmartre": "国歌军乐 · 法国",
    "germaine sablon": "国歌军乐 · 法国",
    "michel nowak ensemble": "国歌军乐 · 德国",
    "berliner harmonie orchester": "国歌军乐 · 德国",
    "carl teike": "国歌军乐 · 德国",
    "trompeterkorps des kavallerie-regiments 6": "国歌军乐 · 德国",
    "josef franz wagner": "国歌军乐 · 德国",
    "日本典礼合唱团": "国歌军乐 · 日本",
    "濑户口藤吉": "国歌军乐 · 日本",
    "夏尔·勒鲁": "国歌军乐 · 日本",
    "imperial ensemble": "国歌军乐 · 日本",
  };

  // 同名/共享歌手曲目的文件名级风格映射(确保本地旧缓存与 GitHub API 兜底时 100% 精确归类)
  const FILENAME_GENRE_MAP = {
    "The Red Army Choir - State Anthem of the Soviet Union.mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - The Sacred War (Священная война).mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - Farewell of Slavianka.mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - Polyushko-polye.mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - Along the Vales and Hills.mp3": "国歌军乐 · 俄罗斯",
    "United States Military Ensemble - The Star-Spangled Banner.mp3": "国歌军乐 · 美国",
  };

  const GENRE_RANK = new Map(GENRE_PRESETS.map((g, idx) => [g.id, idx]));
  const GENRE_META = new Map(GENRE_PRESETS.map((g) => [g.id, g]));
  const DEFAULT_DOC_TITLE = document.title || "GitHub 音乐盒 · 维多利亚留声机";

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
  let order = [];          // 当前播放上下文(tracks 下标)
  let pos = -1;            // 当前曲目在 order 中的位置
  let filteredTracks = []; // 歌单筛选+搜索后按当前视图排序的 tracks 下标
  let currentIndex = -1;   // 当前曲目在 tracks[] 中的下标
  let activeGenre = "all"; // 当前选中的风格歌单("all" 表示全部馆藏)
  let shelfCategory = "all"; // 当前专区分组 ("all" | "salon" | "military")
  let lastModalTrigger = null;

  let shuffle = localStorage.getItem("gh-shuffle") === "1";
  let repeat = localStorage.getItem("gh-repeat") || "none";
  let view = localStorage.getItem(VIEW_KEY) || "genre";
  let desktopLyricsOpen = localStorage.getItem(LYRICS_OPEN_KEY) !== "0";
  let mobileLyricsOpen = false;
  let showTrans = localStorage.getItem(LYRICS_TRANS_KEY) !== "0";
  let isSeeking = false;
  let errorStreak = 0;
  let lastVolume = 80;

  // 滚动歌词状态
  let lyricsCatalog = {};          // url -> { type, lrc, tlyric }
  let liveLyricsCache = {};        // 外部仓库在线兜底缓存
  let currentLyricState = null;    // { type: "none"|"instrumental"|"synced"|"plain", lines: [], hasTrans: false }
  let activeLyricIndex = -1;
  let userScrolling = false;
  let isPointerTouchingLyrics = false;
  let userScrollResumeTimer = null;
  let lyricsScrollSeq = 0;
  let programmaticScrollDepth = 0;
  let programmaticScrollGuardUntil = 0;
  const USER_SCROLL_RESUME_MS = 5500;

  // 模拟黑胶留声机音效引擎状态
  let vinylFxEnabled = localStorage.getItem(VINYL_FX_KEY) === "1";
  let audioCtx = null;
  let vinylNodes = null;
  let audioSuspendTimer = null;
  const BASE_VINYL_NOISE_GAIN = 0.048;

  const audio = els.audio;
  const DEFAULT_COVER = els.coverArt.getAttribute("src");

  function inferGenre(artist, genre, pathOrUrl) {
    if (pathOrUrl) {
      const fname = String(pathOrUrl).slice(String(pathOrUrl).lastIndexOf("/") + 1);
      if (FILENAME_GENRE_MAP[fname]) return FILENAME_GENRE_MAP[fname];
    }
    if (genre) return String(genre);
    if (!artist) return "";
    return ARTIST_GENRE_MAP[String(artist).trim().toLowerCase()] || "";
  }

  function genreRank(g) {
    if (!g) return 999;
    return GENRE_RANK.has(g) ? GENRE_RANK.get(g) : 500;
  }

  function genreCategory(g) {
    const meta = GENRE_META.get(g);
    return meta ? meta.category : "salon";
  }

  function buildSearchKey(t) {
    return [
      t.title || "",
      t.artist || "",
      t.album || "",
      t.genre || "其他典藏",
      t.path || "",
    ].join("\n").toLowerCase();
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

  function setBackgroundInert(isInert) {
    [els.topbar, els.content, els.player].forEach((el) => {
      if (!el) return;
      if (isInert) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  function openSettings() {
    lastModalTrigger = document.activeElement;
    fillSettingsForm();
    els.formError.textContent = "";
    els.settingsModal.hidden = false;
    setBackgroundInert(true);
    els.setOwner.focus();
  }

  function closeSettings() {
    els.settingsModal.hidden = true;
    setBackgroundInert(false);
    if (lastModalTrigger && typeof lastModalTrigger.focus === "function") {
      lastModalTrigger.focus();
      lastModalTrigger = null;
    }
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
      const cat = btn.dataset.category;
      if (cat === "all") btn.textContent = "全部专区 (" + totalGenres + ")";
      else if (cat === "salon") btn.textContent = "\uD83C\uDFB7 沙龙流派 (" + salonGenres + ")";
      else if (cat === "military") btn.textContent = "\uD83C\uDFBA 国歌军乐 (" + militaryGenres + ")";
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
        sub: "中 · 美 · 俄 · 法 · 德 · 日 六国军礼典藏",
        seal: "#b91c1c",
        desc: "汇集中国、美国、俄罗斯、法国、德国与日本六国庄严国歌与历史经典行进军乐。",
        count: militaryTrackCount,
      };
    } else {
      summaryItem = {
        id: "all",
        category: "all",
        name: "全部馆藏",
        sub: "十四大专区完整唱片库",
        seal: "#d4a64a",
        desc: "留声机全馆典藏唱片，涵盖爵士、灵魂蓝调、独立与华语摇滚、古典沙龙及六国国歌军乐特辑。",
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

  // forceShuffle: null=保持当前随机设置，false=顺序播放，true=随机播放
  function startGenrePlaylist(id, forceShuffle) {
    activeGenre = id || "all";
    if (els.searchInput.value) els.searchInput.value = "";
    if (forceShuffle !== null) {
      shuffle = !!forceShuffle;
      localStorage.setItem("gh-shuffle", shuffle ? "1" : "0");
      els.shuffleBtn.classList.toggle("on", shuffle);
      els.shuffleBtn.setAttribute("aria-pressed", shuffle ? "true" : "false");
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
    const q = els.searchInput.value.trim().toLowerCase();
    filteredTracks = [];
    tracks.forEach((t, i) => {
      const g = t.genre || "其他典藏";
      if (activeGenre !== "all") {
        if (g !== activeGenre) return;
      } else if (shelfCategory !== "all") {
        if (genreCategory(g) !== shelfCategory) return;
      }
      if (!q || (t._searchKey ? t._searchKey.indexOf(q) !== -1 : buildSearchKey(t).indexOf(q) !== -1)) {
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
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.searchInput.value) {
      e.stopPropagation();
      els.searchInput.value = "";
      applyFilter();
    }
  });

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
    li.tabIndex = 0;
    if (tIndex === currentIndex) li.classList.add("active");
    if (tIndex === currentIndex && !audio.paused) li.classList.add("playing");

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

    li.append(idx, eq, name, meta);
    return li;
  }

  // 播放列表事件委托(避免每次渲染绑定 130+ 个独立闭包监听器，并支持键盘无障碍操作)
  els.playlist.addEventListener("click", (e) => {
    const li = e.target.closest(".playlist-item");
    if (!li) return;
    const tIndex = Number(li.dataset.index);
    if (!isNaN(tIndex)) playTrackByIndex(tIndex);
  });

  els.playlist.addEventListener("keydown", (e) => {
    const li = e.target.closest(".playlist-item");
    if (!li) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const tIndex = Number(li.dataset.index);
      if (!isNaN(tIndex)) playTrackByIndex(tIndex);
    } else if (e.key === " ") {
      e.preventDefault();
    }
  });

  els.playlist.addEventListener("keyup", (e) => {
    if (e.key !== " ") return;
    const li = e.target.closest(".playlist-item");
    if (!li) return;
    const tIndex = Number(li.dataset.index);
    if (!isNaN(tIndex)) playTrackByIndex(tIndex);
  });

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
    els.playlist.querySelectorAll(".playlist-item.active, .playlist-item.playing").forEach((li) => {
      li.classList.remove("active", "playing");
    });
    if (currentIndex !== -1) {
      const curEl = els.playlist.querySelector('.playlist-item[data-index="' + currentIndex + '"]');
      if (curEl) {
        curEl.classList.add("active");
        if (!audio.paused) curEl.classList.add("playing");
      }
    }
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
    els.playlist.querySelectorAll(".playlist-item.playing").forEach((el) => {
      if (!playing || Number(el.dataset.index) !== currentIndex) {
        el.classList.remove("playing");
      }
    });
    if (playing && currentIndex !== -1) {
      const curEl = els.playlist.querySelector('.playlist-item[data-index="' + currentIndex + '"]');
      if (curEl) curEl.classList.add("playing");
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
    els.trackSub.textContent = defaultTrackSub(t);
    const cover = t.cover || lookupCover(t.dir);
    els.coverArt.src = cover || DEFAULT_COVER;
    highlightActive(true);
    updateMediaSession(t, cover);
    loadTrackLyrics(t);
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
    activeLyricIndex = -1;
    exitUserScrollMode(true);
    syncLyricsToTime(0, true);
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
    els.shuffleBtn.setAttribute("aria-pressed", shuffle ? "true" : "false");
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
    if (!isSeeking) {
      syncLyricsToTime(audio.currentTime, false);
    }
  });

  audio.addEventListener("seeked", () => {
    syncLyricsToTime(audio.currentTime, false);
  });

  audio.addEventListener("play", () => {
    setPlayingUI(true);
    if (vinylFxEnabled) initVinylAudioEngine();
    ensureAudioContextResumed();
    updateVinylAudioGraph(false);
  });

  audio.addEventListener("playing", () => {
    errorStreak = 0;
    ensureAudioContextResumed();
    updateVinylAudioGraph(false);
  });

  audio.addEventListener("pause", () => {
    setPlayingUI(false);
    updateVinylAudioGraph(false);
    scheduleAudioContextSuspend();
    if (currentIndex !== -1 && tracks[currentIndex]) {
      els.trackSub.textContent = defaultTrackSub(tracks[currentIndex]);
    }
  });

  audio.addEventListener("ended", () => {
    updateVinylAudioGraph(false);
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
    const v = parseFloat(els.seek.value);
    els.curTime.textContent = fmt(v);
    syncLyricsToTime(v, true);
  });
  els.seek.addEventListener("change", () => {
    const v = parseFloat(els.seek.value);
    if (isFinite(audio.duration)) audio.currentTime = v;
    syncSlider(els.seek);
    isSeeking = false;
    syncLyricsToTime(v, false);
  });

  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    els.volume.value = v;
    syncSlider(els.volume);
    audio.volume = v / 100;
    localStorage.setItem("gh-volume", v);
    if (v > 0) lastVolume = v;
    els.muteBtn.classList.toggle("on", v === 0);
    els.muteBtn.setAttribute("aria-pressed", v === 0 ? "true" : "false");
    updateVinylAudioGraph(false);
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

  /* ---------------- vinyl record emulation engine (Web Audio DSP) ---------------- */

  function createVinylNoiseBuffer(ctx) {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 8; // 8 秒双声道无缝循环
    const buffer = ctx.createBuffer(2, length, sampleRate);
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);

    // 1. 唱片纹路摩擦与针底噪声(粉红/布朗过滤噪声)
    let b0_0 = 0, b1_0 = 0, b2_0 = 0;
    let b0_1 = 0, b1_1 = 0, b2_1 = 0;
    const rpmPeriod = sampleRate * (60 / 33.333); // 约 1.8 秒一转(33.3 RPM)

    for (let i = 0; i < length; i++) {
      const w0 = Math.random() * 2 - 1;
      const w1 = Math.random() * 2 - 1;

      b0_0 = 0.992 * b0_0 + w0 * 0.055;
      b1_0 = 0.96 * b1_0 + w0 * 0.075;
      b2_0 = 0.85 * b2_0 + w0 * 0.15;
      const p0 = (b0_0 + b1_0 + b2_0) * 0.055;

      b0_1 = 0.992 * b0_1 + w1 * 0.055;
      b1_1 = 0.96 * b1_1 + w1 * 0.075;
      b2_1 = 0.85 * b2_1 + w1 * 0.15;
      const p1 = (b0_1 + b1_1 + b2_1) * 0.055;

      const rotPhase = (i % rpmPeriod) / rpmPeriod;
      const rotMod = 1 + 0.22 * Math.sin(rotPhase * Math.PI * 2);

      ch0[i] = p0 * rotMod * 0.16;
      ch1[i] = p1 * rotMod * 0.16;
    }

    // 2. 真实随机尘粒爆音与黑胶炒豆声(不同强度的瞬态脉冲)
    const numClicks = Math.floor(length * (5.5 / sampleRate));
    for (let c = 0; c < numClicks; c++) {
      const clickPos = Math.floor(Math.random() * (length - 400));
      const isPop = Math.random() < 0.16;
      const strength = isPop ? (0.16 + Math.random() * 0.26) : (0.035 + Math.random() * 0.08);
      const sign = Math.random() > 0.5 ? 1 : -1;
      const pan = Math.random();
      const decaySamples = isPop ? 45 : 18;

      for (let j = 0; j < decaySamples; j++) {
        const env = Math.exp(-j / (decaySamples * 0.26));
        const val = sign * strength * env * (Math.random() * 0.5 + 0.5);
        ch0[clickPos + j] += val * (1 - pan);
        ch1[clickPos + j] += val * pan;
      }
    }

    // 3. 周期性转盘微弱微划痕
    const scratchPhase = Math.floor(sampleRate * 0.38);
    for (let r = 0; r < Math.floor(length / rpmPeriod); r++) {
      const pos = Math.floor(r * rpmPeriod + scratchPhase);
      if (pos + 60 < length) {
        for (let j = 0; j < 30; j++) {
          const env = Math.exp(-j / 8);
          const val = 0.09 * env * (Math.random() * 0.5 + 0.5);
          ch0[pos + j] += val;
          ch1[pos + j] += val * 0.65;
        }
      }
    }

    return buffer;
  }

  function makeVinylSaturationCurve() {
    const n = 4096;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(x * 1.25) / Math.tanh(1.25);
    }
    return curve;
  }

  function initVinylAudioEngine() {
    if (vinylNodes) return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      if (!audioCtx) audioCtx = new AudioContextClass();

      const source = audioCtx.createMediaElementSource(audio);

      // 原声直通(dry)
      const dryGain = audioCtx.createGain();
      dryGain.gain.value = vinylFxEnabled ? 0 : 1;
      source.connect(dryGain);
      dryGain.connect(audioCtx.destination);

      // 黑胶音效链(wet)
      const wetGain = audioCtx.createGain();
      wetGain.gain.value = vinylFxEnabled ? 1 : 0;

      // 1. 高通滤波: 削减超低频隆隆声
      const hp = audioCtx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 52;
      hp.Q.value = 0.7;

      // 2. 温暖低频垫底(lowshelf)
      const warmShelf = audioCtx.createBiquadFilter();
      warmShelf.type = "lowshelf";
      warmShelf.frequency.value = 180;
      warmShelf.gain.value = 2.2;

      // 3. 唱针与号角中频共鸣峰(peaking)
      const midRes = audioCtx.createBiquadFilter();
      midRes.type = "peaking";
      midRes.frequency.value = 2200;
      midRes.gain.value = 1.6;
      midRes.Q.value = 1.0;

      // 4. 复古高频滚降(低通滤波，削弱数码刺耳感)
      const lp = audioCtx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6800;
      lp.Q.value = 1.0;

      // 5. 胆管/磁带唱针软饱和(Waveshaper)
      const shaper = audioCtx.createWaveShaper();
      shaper.curve = makeVinylSaturationCurve();
      shaper.oversample = "2x";

      // 6. 抖晃与唱盘微颤(Wow & Flutter)
      const delay = audioCtx.createDelay();
      delay.delayTime.value = 0.015;

      const wowOsc = audioCtx.createOscillator();
      wowOsc.frequency.value = 0.555; // 33.3 RPM 转速周期
      const wowGain = audioCtx.createGain();
      wowGain.gain.value = 0.00028;
      wowOsc.connect(wowGain);
      wowGain.connect(delay.delayTime);
      wowOsc.start();

      const flutterOsc = audioCtx.createOscillator();
      flutterOsc.frequency.value = 4.8;
      flutterOsc.type = "triangle";
      const flutterGain = audioCtx.createGain();
      flutterGain.gain.value = 0.00006;
      flutterOsc.connect(flutterGain);
      flutterGain.connect(delay.delayTime);
      flutterOsc.start();

      // 连接黑胶音乐处理链
      source.connect(hp);
      hp.connect(warmShelf);
      warmShelf.connect(midRes);
      midRes.connect(lp);
      lp.connect(shaper);
      shaper.connect(delay);
      delay.connect(wetGain);
      wetGain.connect(audioCtx.destination);

      // 7. 真实唱针底噪与炒豆声发生器
      const noiseBuffer = createVinylNoiseBuffer(audioCtx);
      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const noiseHp = audioCtx.createBiquadFilter();
      noiseHp.type = "highpass";
      noiseHp.frequency.value = 140;

      const noiseLp = audioCtx.createBiquadFilter();
      noiseLp.type = "lowpass";
      noiseLp.frequency.value = 2800;

      const noiseGain = audioCtx.createGain();
      noiseGain.gain.value = 0; // 初始静音，起播时淡入

      noiseSource.connect(noiseHp);
      noiseHp.connect(noiseLp);
      noiseLp.connect(noiseGain);
      noiseGain.connect(audioCtx.destination);
      noiseSource.start();

      vinylNodes = {
        dryGain,
        wetGain,
        noiseGain,
      };

      updateVinylAudioGraph(true);
      return true;
    } catch (e) {
      console.warn("Vinyl audio emulation unavailable:", e);
      return false;
    }
  }

  function getTargetNoiseGain() {
    if (!vinylFxEnabled || audio.paused || audio.volume <= 0) return 0;
    return BASE_VINYL_NOISE_GAIN * Math.min(1, Math.max(0, audio.volume));
  }

  function updateVinylAudioGraph(immediate) {
    if (!vinylNodes || !audioCtx) return;
    const time = audioCtx.currentTime;
    const rampTime = immediate ? 0.005 : 0.04;
    const targetDry = vinylFxEnabled ? 0 : 1;
    const targetWet = vinylFxEnabled ? 1 : 0;
    const targetNoise = getTargetNoiseGain();

    vinylNodes.dryGain.gain.setTargetAtTime(targetDry, time, rampTime);
    vinylNodes.wetGain.gain.setTargetAtTime(targetWet, time, rampTime);
    vinylNodes.noiseGain.gain.setTargetAtTime(targetNoise, time, rampTime);
  }

  function ensureAudioContextResumed() {
    clearTimeout(audioSuspendTimer);
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  }

  function scheduleAudioContextSuspend() {
    clearTimeout(audioSuspendTimer);
    if (!audioCtx) return;
    audioSuspendTimer = setTimeout(() => {
      if (audio.paused && audioCtx && audioCtx.state === "running") {
        audioCtx.suspend().catch(() => {});
      }
    }, 300);
  }

  function updateVinylUI() {
    if (els.vinylFxBtn) {
      els.vinylFxBtn.classList.toggle("on", vinylFxEnabled);
      els.vinylFxBtn.setAttribute("aria-pressed", vinylFxEnabled ? "true" : "false");
    }
    document.body.classList.toggle("vinyl-fx-active", vinylFxEnabled);
  }

  function toggleVinylFx() {
    vinylFxEnabled = !vinylFxEnabled;
    localStorage.setItem(VINYL_FX_KEY, vinylFxEnabled ? "1" : "0");
    if (vinylFxEnabled) {
      initVinylAudioEngine();
    }
    ensureAudioContextResumed();
    updateVinylAudioGraph(false);
    updateVinylUI();
    toast(vinylFxEnabled ? "已开启黑胶唱片音效 · 温暖模拟与唱针底噪" : "已关闭黑胶音效 · 还原数码原声");
  }

  /* ---------------- scrolling lyrics engine ---------------- */

  function isMobileLyricsViewport() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 980px)").matches);
  }

  function isLyricsPanelVisible() {
    return isMobileLyricsViewport() ? mobileLyricsOpen : desktopLyricsOpen;
  }

  function updateLyricsPanelUI() {
    const visible = isLyricsPanelVisible();
    document.body.classList.toggle("lyrics-closed", !desktopLyricsOpen);
    document.body.classList.toggle("mobile-lyrics-open", mobileLyricsOpen);
    els.lyricsToggleBtn.classList.toggle("on", visible);
    els.lyricsToggleBtn.setAttribute("aria-pressed", visible ? "true" : "false");
    els.lyricsPanel.classList.toggle("hide-trans", !showTrans);
    els.lyricsTransBtn.classList.toggle("on", showTrans);
    els.lyricsTransBtn.setAttribute("aria-pressed", showTrans ? "true" : "false");
    if (visible) {
      if (currentIndex !== -1 && tracks[currentIndex]) {
        els.trackSub.textContent = defaultTrackSub(tracks[currentIndex]);
      }
      requestAnimationFrame(() => centerActiveLyric(true));
    }
  }

  function toggleLyricsPanel() {
    if (isMobileLyricsViewport()) {
      mobileLyricsOpen = !mobileLyricsOpen;
    } else {
      desktopLyricsOpen = !desktopLyricsOpen;
      localStorage.setItem(LYRICS_OPEN_KEY, desktopLyricsOpen ? "1" : "0");
    }
    updateLyricsPanelUI();
  }

  els.lyricsToggleBtn.addEventListener("click", toggleLyricsPanel);
  els.lyricsCloseBtn.addEventListener("click", () => {
    if (isMobileLyricsViewport()) {
      mobileLyricsOpen = false;
    } else {
      desktopLyricsOpen = false;
      localStorage.setItem(LYRICS_OPEN_KEY, "0");
    }
    updateLyricsPanelUI();
  });

  els.lyricsTransBtn.addEventListener("click", () => {
    showTrans = !showTrans;
    localStorage.setItem(LYRICS_TRANS_KEY, showTrans ? "1" : "0");
    updateLyricsPanelUI();
    centerActiveLyric(false);
  });

  if (els.playerTrack) {
    els.playerTrack.addEventListener("click", () => {
      if (isMobileLyricsViewport()) toggleLyricsPanel();
    });
  }

  window.addEventListener("resize", () => {
    const visible = isLyricsPanelVisible();
    els.lyricsToggleBtn.classList.toggle("on", visible);
    els.lyricsToggleBtn.setAttribute("aria-pressed", visible ? "true" : "false");
  });

  function loadLiveLyricsCache() {
    try {
      const raw = localStorage.getItem(LIVE_LYRICS_CACHE_KEY);
      if (raw) liveLyricsCache = JSON.parse(raw) || {};
    } catch (e) { liveLyricsCache = {}; }
  }

  function saveLiveLyricsCache() {
    try {
      localStorage.setItem(LIVE_LYRICS_CACHE_KEY, JSON.stringify(liveLyricsCache));
    } catch (e) { /* ignore quota */ }
  }

  async function loadLyricsCatalog() {
    loadLiveLyricsCache();
    try {
      const res = await fetch("lyrics.json", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === "object") {
        lyricsCatalog = data;
        if (currentIndex !== -1 && tracks[currentIndex]) {
          loadTrackLyrics(tracks[currentIndex]);
        }
      }
    } catch (e) { /* 若缺失则走在线兜底 */ }
  }

  function parseTimedLines(rawText) {
    if (!rawText) return { offsetSec: 0, timed: [], plain: [] };
    let offsetSec = 0;
    const offMatch = rawText.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offMatch) offsetSec = (parseInt(offMatch[1], 10) || 0) / 1000;

    const timed = [];
    const plain = [];
    const tagRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    rawText.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      if (/^\[(id|ar|ti|al|by|hash|sign|qq|total|re|ve|offset):/i.test(line)) return;

      const stamps = [];
      let m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(line)) !== null) {
        const mins = parseInt(m[1], 10) || 0;
        const secs = parseInt(m[2], 10) || 0;
        const frac = m[3] ? Number("0." + m[3]) : 0;
        stamps.push(Math.max(0, mins * 60 + secs + frac - offsetSec));
      }
      const text = line.replace(tagRe, "").trim();
      if (!stamps.length) {
        if (text) plain.push(text);
        return;
      }
      if (!text) return;
      stamps.forEach((t) => timed.push({ time: t, text: text }));
    });

    timed.sort((a, b) => a.time - b.time);
    return { offsetSec, timed, plain };
  }

  function parseLrcBundle(entry) {
    if (!entry) return { type: "none", lines: [], hasTrans: false };
    if (entry.type === "instrumental") {
      return { type: "instrumental", lines: [], hasTrans: false };
    }

    const main = parseTimedLines(entry.lrc || "");
    if (!main.timed.length) {
      if (main.plain.length) {
        return {
          type: "plain",
          lines: main.plain.map((txt) => ({ time: null, text: txt, trans: "" })),
          hasTrans: false,
        };
      }
      return { type: "none", lines: [], hasTrans: false };
    }

    const transParsed = parseTimedLines(entry.tlyric || "");
    let hasTrans = false;
    const lines = main.timed.map((item) => ({
      time: item.time,
      text: item.text,
      trans: "",
    }));

    if (transParsed.timed.length) {
      let ti = 0;
      for (let i = 0; i < lines.length; i++) {
        const target = lines[i].time;
        while (
          ti + 1 < transParsed.timed.length &&
          Math.abs(transParsed.timed[ti + 1].time - target) <= Math.abs(transParsed.timed[ti].time - target)
        ) {
          ti++;
        }
        if (Math.abs(transParsed.timed[ti].time - target) <= 0.85) {
          const trText = transParsed.timed[ti].text;
          if (trText && trText !== "//" && trText !== lines[i].text) {
            lines[i].trans = trText;
            hasTrans = true;
          }
        }
      }
    }

    return { type: "synced", lines, hasTrans };
  }

  async function fetchLiveLyricsFallback(track) {
    const params = new URLSearchParams({ title: track.title || "" });
    if (track.artist) params.set("artist", track.artist);
    if (track.album && track.album.toLowerCase() !== "unknown album") {
      params.set("album", track.album);
    }
    try {
      const res = await fetch("https://api.lrc.cx/lyrics?" + params.toString());
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || !text.trim()) return null;
      if (/纯音乐，请欣赏|此歌曲为没有填词的纯音乐/.test(text)) {
        return { type: "instrumental" };
      }
      return { type: "synced", lrc: text };
    } catch (e) {
      return null;
    }
  }

  async function loadTrackLyrics(track) {
    if (!track) return;
    exitUserScrollMode(true);
    activeLyricIndex = -1;
    els.lyricsTrackName.textContent = track.artist ? (track.title + " · " + track.artist) : track.title;

    let entry = lyricsCatalog[track.url] || liveLyricsCache[track.url] || null;
    if (!entry) {
      els.lyricsTransBtn.hidden = true;
      els.lyricsList.innerHTML = '<li class="lyric-empty">正在检索唱词…</li>';
      const fetched = await fetchLiveLyricsFallback(track);
      if (tracks[currentIndex] !== track) return;
      if (fetched) {
        liveLyricsCache[track.url] = fetched;
        saveLiveLyricsCache();
        entry = fetched;
      }
    }

    currentLyricState = parseLrcBundle(entry);
    renderLyricsView(track);
    syncLyricsToTime(audio.currentTime || 0, true);
  }

  function renderLyricsView(track) {
    const st = currentLyricState;
    els.lyricsList.innerHTML = "";
    programmaticScrollGuardUntil = Date.now() + 180;
    els.lyricsScroll.scrollTop = 0;

    if (!st || st.type === "none") {
      els.lyricsTransBtn.hidden = true;
      const li = document.createElement("li");
      li.className = "lyric-empty";
      li.textContent = "馆藏暂未收录此曲唱词";
      els.lyricsList.appendChild(li);
      return;
    }

    if (st.type === "instrumental") {
      els.lyricsTransBtn.hidden = true;
      const li = document.createElement("li");
      li.className = "lyric-instrumental";
      const badge = document.createElement("div");
      badge.className = "lyric-inst-badge";
      badge.textContent = "\u2726 INSTRUMENTAL · 纯器乐曲 \u2726";
      const msg = document.createElement("p");
      msg.textContent = "此曲为器乐演奏曲目，无唱词，敬请静心聆听留声旋律。";
      li.append(badge, msg);
      els.lyricsList.appendChild(li);
      return;
    }

    els.lyricsTransBtn.hidden = !st.hasTrans;
    const frag = document.createDocumentFragment();

    st.lines.forEach((ln, idx) => {
      const li = document.createElement("li");
      li.className = "lyric-line" + (ln.time !== null ? " timed" : "");
      li.dataset.idx = idx;

      const mainSpan = document.createElement("span");
      mainSpan.className = "lyric-main";
      mainSpan.textContent = ln.text;
      li.appendChild(mainSpan);

      if (ln.trans) {
        const trSpan = document.createElement("span");
        trSpan.className = "lyric-trans";
        trSpan.textContent = ln.trans;
        li.appendChild(trSpan);
      }

      if (ln.time !== null) {
        const tmSpan = document.createElement("span");
        tmSpan.className = "lyric-time";
        tmSpan.textContent = fmt(ln.time);
        li.appendChild(tmSpan);
      }

      frag.appendChild(li);
    });

    els.lyricsList.appendChild(frag);
  }

  // 歌词列表事件委托(点击任意带时间戳的唱词行跳转进度)
  els.lyricsList.addEventListener("click", (e) => {
    const li = e.target.closest(".lyric-line.timed");
    if (!li || !currentLyricState || !currentLyricState.lines) return;
    const idx = Number(li.dataset.idx);
    const ln = currentLyricState.lines[idx];
    if (!ln || ln.time === null) return;
    if (isFinite(audio.duration) || audio.readyState >= 1) {
      audio.currentTime = ln.time;
    }
    exitUserScrollMode(true);
    syncLyricsToTime(ln.time, false);
    if (audio.paused && currentIndex !== -1 && tracks[currentIndex]) safePlay();
  });

  function findActiveLyricIndex(timeSec) {
    const st = currentLyricState;
    if (!st || !st.lines.length) return -1;
    if (st.type === "plain") {
      if (!isFinite(audio.duration) || audio.duration <= 0) return 0;
      const ratio = Math.min(0.999, Math.max(0, timeSec / audio.duration));
      return Math.floor(ratio * st.lines.length);
    }
    if (st.type !== "synced") return -1;

    const target = timeSec + 0.12;
    const lines = st.lines;
    if (target < lines[0].time) return -1;

    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= target) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi;
  }

  function syncLyricsToTime(timeSec, immediate) {
    const st = currentLyricState;
    if (!st || (st.type !== "synced" && st.type !== "plain")) return;

    const nextIdx = findActiveLyricIndex(timeSec);
    if (nextIdx === activeLyricIndex && !immediate) return;
    activeLyricIndex = nextIdx;

    const items = els.lyricsList.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", i === activeLyricIndex);
      items[i].classList.toggle("past", activeLyricIndex > i);
    }

    if (
      activeLyricIndex >= 0 &&
      st.lines[activeLyricIndex] &&
      !audio.paused &&
      !isLyricsPanelVisible()
    ) {
      els.trackSub.textContent = "\u266A " + st.lines[activeLyricIndex].text;
    }

    if (activeLyricIndex >= 0 && !userScrolling) {
      centerActiveLyric(immediate);
    }
  }

  // 程序化滚动 Promise 封装(原生支持时直接返回 Promise，旧浏览器回退到 scrollend + 空闲计时)
  function scrollToAsync(scroller, options) {
    const result = scroller.scrollTo(options);
    if (result instanceof Promise) {
      return result;
    }
    return new Promise((resolve) => {
      let timeoutId;
      const finish = () => {
        clearTimeout(timeoutId);
        scroller.removeEventListener("scrollend", finish);
        scroller.removeEventListener("scroll", onScroll);
        resolve();
      };
      const onScroll = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(finish, 100);
      };
      scroller.addEventListener("scrollend", finish, { once: true });
      scroller.addEventListener("scroll", onScroll, { passive: true });
      timeoutId = setTimeout(finish, 100);
    });
  }

  async function centerActiveLyric(immediate) {
    if (userScrolling || !isLyricsPanelVisible()) return;
    const scroller = els.lyricsScroll;
    const activeEl = els.lyricsList.querySelector(".lyric-line.active");
    if (!scroller || !activeEl) return;

    const targetTop = Math.max(
      0,
      activeEl.offsetTop - scroller.clientHeight / 2 + activeEl.offsetHeight / 2
    );
    if (Math.abs(scroller.scrollTop - targetTop) < 2) return;

    const seq = ++lyricsScrollSeq;
    const preferReduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const behavior = immediate || preferReduced ? "instant" : "smooth";

    programmaticScrollDepth++;
    programmaticScrollGuardUntil = Date.now() + 180;
    try {
      await scrollToAsync(scroller, { top: targetTop, behavior: behavior });
    } finally {
      programmaticScrollDepth = Math.max(0, programmaticScrollDepth - 1);
      programmaticScrollGuardUntil = Date.now() + 180;
    }
    if (seq !== lyricsScrollSeq) return;
  }

  function scheduleAutoFollowResume() {
    clearTimeout(userScrollResumeTimer);
    if (!userScrolling || isPointerTouchingLyrics) return;
    userScrollResumeTimer = setTimeout(() => {
      exitUserScrollMode(false);
    }, USER_SCROLL_RESUME_MS);
  }

  function enterUserScrollMode() {
    userScrolling = true;
    lyricsScrollSeq++;
    els.lyricsFollowBtn.hidden = false;
    scheduleAutoFollowResume();
  }

  function exitUserScrollMode(silent) {
    userScrolling = false;
    isPointerTouchingLyrics = false;
    clearTimeout(userScrollResumeTimer);
    els.lyricsFollowBtn.hidden = true;
    if (!silent && activeLyricIndex >= 0) {
      centerActiveLyric(false);
    }
  }

  els.lyricsFollowBtn.addEventListener("click", () => exitUserScrollMode(false));

  els.lyricsScroll.addEventListener("wheel", () => {
    enterUserScrollMode();
  }, { passive: true });

  els.lyricsScroll.addEventListener("touchstart", () => {
    isPointerTouchingLyrics = true;
    clearTimeout(userScrollResumeTimer);
  }, { passive: true });

  els.lyricsScroll.addEventListener("touchmove", () => {
    enterUserScrollMode();
  }, { passive: true });

  els.lyricsScroll.addEventListener("touchend", () => {
    isPointerTouchingLyrics = false;
    scheduleAutoFollowResume();
  }, { passive: true });

  els.lyricsScroll.addEventListener("touchcancel", () => {
    isPointerTouchingLyrics = false;
    scheduleAutoFollowResume();
  }, { passive: true });

  els.lyricsScroll.addEventListener("pointerdown", (e) => {
    const rect = els.lyricsScroll.getBoundingClientRect();
    // 拖拽滚动条滑块时进入用户手动滚动模式
    if (e.clientX >= rect.right - 18) {
      isPointerTouchingLyrics = true;
      enterUserScrollMode();
    }
  });

  window.addEventListener("pointerup", () => {
    if (isPointerTouchingLyrics) {
      isPointerTouchingLyrics = false;
      scheduleAutoFollowResume();
    }
  });

  els.lyricsScroll.addEventListener("scroll", () => {
    if (userScrolling) {
      scheduleAutoFollowResume();
    } else if (programmaticScrollDepth === 0 && Date.now() > programmaticScrollGuardUntil) {
      enterUserScrollMode();
    }
  }, { passive: true });

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
    if (e.key === "Escape" && mobileLyricsOpen) {
      mobileLyricsOpen = false;
      updateLyricsPanelUI();
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
    // 播放列表条目自带 Enter/Space 选曲处理，避免与全局空格播放/暂停重复触发
    if (target.closest && target.closest(".playlist-item") && (e.key === " " || e.key === "Enter")) return;
    if (
      target.closest &&
      target.closest("#lyricsScroll") &&
      (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown" || e.key === "Home" || e.key === "End")
    ) {
      enterUserScrollMode();
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
      case "l": case "L": toggleLyricsPanel(); break;
      case "v": case "V": toggleVinylFx(); break;
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
    if (!tabWrap) return;
    const tabs = Array.from(tabWrap.querySelectorAll(".shelf-tab"));

    function activateShelfTab(cat, focusTab) {
      if (cat !== shelfCategory) {
        shelfCategory = cat;
        if (activeGenre !== "all" && shelfCategory !== "all" && genreCategory(activeGenre) !== shelfCategory) {
          activeGenre = "all";
        }
        renderGenreShelf();
        applyFilter();
      }
      tabs.forEach((b) => {
        const on = b.dataset.category === shelfCategory;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
        if (on && focusTab) b.focus();
      });
    }

    tabs.forEach((btn, idx) => {
      const on = btn.dataset.category === shelfCategory;
      btn.tabIndex = on ? 0 : -1;
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
  }

  /* ---------------- init ---------------- */

  function init() {
    loadSettings();
    updateRepeatUI();
    els.shuffleBtn.classList.toggle("on", shuffle);
    els.shuffleBtn.setAttribute("aria-pressed", shuffle ? "true" : "false");
    setView(view);
    initShelfTabs();
    const v = parseInt(localStorage.getItem("gh-volume"), 10);
    if (!isNaN(v)) {
      if (v > 0) lastVolume = Math.min(100, v);
      setVolume(v);
    } else {
      syncSlider(els.volume);
    }
    syncSlider(els.seek);
    updateLyricsPanelUI();
    updateVinylUI();
    if (els.vinylFxBtn) {
      els.vinylFxBtn.addEventListener("click", toggleVinylFx);
    }
    setupMediaSession();
    loadLyricsCatalog();
    loadLibrary(false);
  }

  init();
})();
