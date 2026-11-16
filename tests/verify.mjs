import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function createBrowserSandbox(initialStorage = {}) {
  const store = new Map(Object.entries(initialStorage));
  const windowObj = {
    location: {
      href: "https://williamqaqq.github.io/music-box/index.html#foo=1",
      protocol: "https:",
      origin: "https://williamqaqq.github.io",
      hash: "",
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: null,
    navigator: {},
    URLSearchParams,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  windowObj.window = windowObj;
  windowObj.globalThis = windowObj;
  return { sandbox: vm.createContext(windowObj), store };
}

function loadScriptIntoSandbox(sandbox, relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  vm.runInContext(code, sandbox, { filename: relPath });
}

test("HTML/SW/CSS structural invariants & asset version v35", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
  const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

  const expectedScripts = [
    "js/catalog-data.js?v=35",
    "js/user-state.js?v=35",
    "js/library-loader.js?v=35",
    "js/audio-fx.js?v=35",
    "js/lyrics.js?v=35",
    "js/studio-ui.js?v=35",
    "app.js?v=35",
  ];

  let lastPos = -1;
  for (const src of expectedScripts) {
    const idx = html.indexOf(`src="${src}"`);
    assert.ok(idx > lastPos, `Script ${src} missing or out of defer order in index.html`);
    lastPos = idx;
    assert.ok(sw.includes(src), `sw.js SHELL_ASSETS missing ${src}`);
  }
  assert.ok(
    html.includes('<link rel="preconnect" href="https://music-box-r2-gateway.chattsun268.workers.dev" crossorigin>'),
    "index.html missing R2 gateway preconnect hint"
  );
  assert.ok(html.includes('href="style.css?v=35"'), "index.html missing style.css?v=35");
  assert.ok(html.includes('http-equiv="Content-Security-Policy"'), "index.html missing Content-Security-Policy meta");
  assert.ok(html.includes("script-src 'self'"), "CSP must restrict script-src to 'self'");
  assert.ok(html.includes('name="referrer" content="strict-origin-when-cross-origin"'), "index.html missing referrer policy meta");
  assert.ok(html.includes('rel="manifest" href="manifest.webmanifest"'), "index.html missing manifest link");
  assert.ok(html.includes('<dialog id="studioPanel" class="studio-popover" popover="auto"'), "Missing <dialog popover=\"auto\">");
  assert.ok(html.includes('<fieldset class="source-mode-group">'), "Missing sourceMode radio fieldset");
  assert.ok(html.includes('id="setR2Url"'), "Missing #setR2Url input");
  assert.ok(html.includes('id="r2QuotaDetails"'), "Missing #r2QuotaDetails monitor panel");
  assert.ok(html.includes('id="quotaDailyBar"'), "Missing #quotaDailyBar <progress> meter");
  assert.ok(sw.includes('const VERSION = "v35";'), "sw.js VERSION must match v35");
  assert.ok(sw.includes("networkFirst(req, SHELL_CACHE)"), "sw.js must use networkFirst for HTML document navigation");
  assert.ok(!sw.includes('return caches.match("./index.html");\n}'), "staleWhileRevalidate must not fall back to HTML for JS/CSS assets");
  assert.ok(css.includes("[hidden] { display: none !important; }"), "style.css must preserve [hidden] override");
  assert.ok(css.includes(".studio-popover:is(:popover-open, .\\:popover-open, .studio-open)"), "Dialog display must be scoped to open state");
  assert.ok(css.includes("content-visibility: auto"), "Spectrum box must use content-visibility: auto");
  assert.equal(css.includes("background-attachment: fixed"), false, "style.css must not use paint-heavy background-attachment: fixed");
  assert.ok(css.includes("body::before") && css.includes("contain: strict"), "style.css must isolate fixed backdrop on body::before");
  assert.ok(css.includes(".queue-item") && css.includes("@supports not (content-visibility: auto)"), "style.css must gate queue item content-visibility cleanly");
  assert.ok(appJs.includes("ZH_COLLATOR") && appJs.includes("next._canonKey") && appJs.includes("next._genreRank"), "app.js must precompute lookup keys and genre sort metadata");
  assert.ok(css.includes('[aria-invalid="true"]'), "style.css must style aria-invalid form inputs");
  assert.ok(
    css.includes(".r2-quota-bar::-webkit-progress-value") && css.includes(".r2-quota-bar::-moz-progress-bar"),
    "style.css must define separate WebKit and Firefox progress bar rules"
  );
  assert.equal(
    /::-webkit-progress-value\s*,\s*[^\n]*::-moz-progress-bar/.test(css),
    false,
    "style.css must NOT group -webkit- and -moz- progress pseudo-elements"
  );
});

test("catalog-data: share hash, LRC export, signature, search matching", () => {
  const { sandbox } = createBrowserSandbox();
  loadScriptIntoSandbox(sandbox, "js/catalog-data.js");
  const cat = sandbox.__MusicBox.catalog;

  const built = cat.buildTrackShareUrl("music/01.爵士/曲目 1.mp3", 94.8);
  assert.ok(built.includes("#track="), "Should encode #track=");
  const hashPart = built.slice(built.indexOf("#"));
  const parsed = cat.parseTrackShareHash(hashPart);
  assert.deepEqual({ url: parsed.url, time: parsed.time }, { url: "music/01.爵士/曲目 1.mp3", time: 94 });
  assert.equal(cat.parseTrackShareHash("#other=1"), null);

  const lrcText = cat.formatLrcExport(
    { title: "Test Song", artist: "Tester", album: "Salon" },
    {
      type: "synced",
      lines: [
        { time: 5.5, text: "Line One", trans: "第一行" },
        { time: 65.25, text: "Line Two", trans: "" },
      ],
    },
    true
  );
  assert.ok(lrcText.includes("[ti:Test Song]"));
  assert.ok(lrcText.includes("[00:05.50]Line One / 第一行"));
  assert.ok(lrcText.includes("[01:05.25]Line Two"));

  const sig1 = cat.hashLibrarySignature([{ url: "a.mp3", title: "A", artist: "X", album: "", genre: "Jazz" }], new Map());
  const sig2 = cat.hashLibrarySignature([{ url: "a.mp3", title: "A", artist: "X", album: "", genre: "Jazz" }], new Map());
  const sig3 = cat.hashLibrarySignature([{ url: "b.mp3", title: "A", artist: "X", album: "", genre: "Jazz" }], new Map());
  assert.equal(sig1, sig2);
  assert.notEqual(sig1, sig3);

  const key = cat.buildSearchKey({ title: "Катюша", artist: "红旗歌舞团", genre: "俄罗斯军歌" });
  assert.equal(cat.matchesSearchTokens(key, cat.tokenizeQuery("红旗 军歌")), true);
  assert.equal(cat.matchesSearchTokens(key, cat.tokenizeQuery("红旗 爵士")), false);

  assert.equal(
    cat.normalizeR2BaseUrl("https://music-box-r2-gateway.demo.workers.dev///?foo=1#bar"),
    "https://music-box-r2-gateway.demo.workers.dev"
  );
  assert.ok(cat.DEFAULT_R2_GATEWAY.startsWith("https://"), "DEFAULT_R2_GATEWAY should point to deployed HTTPS gateway");
  assert.equal(cat.normalizeR2BaseUrl("javascript:alert(1)"), "");
  assert.equal(cat.normalizeR2BaseUrl("not a url"), "");

  const r2Unsigned = cat.resolveR2Track(
    {
      name: "Song A.mp3",
      title: "Song A",
      artist: "Tester",
      genre: "民谣诗篇",
      path: "民谣/Song A.mp3",
      url: "民谣/Song A.mp3",
      cover: "民谣/cover.jpg",
    },
    "https://gw.example.workers.dev/"
  );
  assert.equal(
    r2Unsigned.url,
    "https://gw.example.workers.dev/media/%E6%B0%91%E8%B0%A3/Song%20A.mp3"
  );
  assert.equal(
    r2Unsigned.cover,
    "https://gw.example.workers.dev/media/%E6%B0%91%E8%B0%A3/cover.jpg"
  );
  assert.equal(r2Unsigned.source, "r2");

  const r2Signed = cat.resolveR2Track(
    {
      title: "Signed Song",
      artist: "Tester",
      path: "Private/Signed.mp3",
      url: "https://gw.example.workers.dev/media/Private/Signed.mp3?exp=1999999999&sig=abcd",
    },
    "https://gw.example.workers.dev"
  );
  assert.equal(
    r2Signed.url,
    "https://gw.example.workers.dev/media/Private/Signed.mp3?exp=1999999999&sig=abcd"
  );
  assert.equal(r2Signed.path, "Private/Signed.mp3");

  assert.equal(
    cat.canonicalTrackKey("https://gw.example.workers.dev/media/Private/Signed.mp3?exp=1999999999&sig=abcd"),
    "https://gw.example.workers.dev/media/Private/Signed.mp3"
  );
  const signedShareUrl = cat.buildTrackShareUrl(
    "https://gw.example.workers.dev/media/Private/Signed.mp3?exp=1999999999&sig=abcd",
    42
  );
  const parsedSignedShare = cat.parseTrackShareHash(signedShareUrl.slice(signedShareUrl.indexOf("#")));
  assert.equal(parsedSignedShare.url, "https://gw.example.workers.dev/media/Private/Signed.mp3");
  assert.equal(parsedSignedShare.time, 42);

  // Rotating exp/sig query params should not alter hashLibrarySignature
  const sigSignedA = cat.hashLibrarySignature(
    [{ url: "https://gw.example.workers.dev/media/A.mp3?exp=1000&sig=111", title: "A", artist: "X", album: "", genre: "Jazz", cover: "https://gw.example.workers.dev/media/c.jpg?exp=1000&sig=111" }],
    new Map([["dir", "https://gw.example.workers.dev/media/c.jpg?exp=1000&sig=111"]])
  );
  const sigSignedB = cat.hashLibrarySignature(
    [{ url: "https://gw.example.workers.dev/media/A.mp3?exp=2000&sig=222", title: "A", artist: "X", album: "", genre: "Jazz", cover: "https://gw.example.workers.dev/media/c.jpg?exp=2000&sig=222" }],
    new Map([["dir", "https://gw.example.workers.dev/media/c.jpg?exp=2000&sig=222"]])
  );
  assert.equal(sigSignedA, sigSignedB, "Rotating HMAC exp/sig should not change catalog content signature");

  // inferGenre should handle unencoded fast-path, URL-encoded filenames, and malformed % escapes cleanly
  assert.equal(
    cat.inferGenre("", "", "music/LBI利比 - 跳楼机.mp3?exp=123#top"),
    "流金热浪 · 时代新声"
  );
  assert.equal(
    cat.inferGenre("", "", "https://gw.example.workers.dev/media/" + encodeURIComponent("LBI利比 - 跳楼机.mp3") + "?exp=123&sig=abc"),
    "流金热浪 · 时代新声"
  );
  assert.equal(
    cat.inferGenre("Unknown", "古典沙龙 · 剧场礼乐", "music/%ZZ_broken.mp3?v=1#t=2"),
    "古典沙龙 · 剧场礼乐"
  );

  // isSafeMediaUrl & parseTrackShareHash reject dangerous schemes (javascript:, data:, //)
  assert.equal(cat.isSafeMediaUrl("music/01.爵士/A.mp3"), true);
  assert.equal(cat.isSafeMediaUrl("https://gw.example.workers.dev/media/A.mp3"), true);
  assert.equal(cat.isSafeMediaUrl("javascript:alert(1)"), false);
  assert.equal(cat.isSafeMediaUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(cat.isSafeMediaUrl("//evil.example/a.mp3"), false);
  assert.equal(cat.parseTrackShareHash("#track=javascript:alert(1)&t=10"), null);
  assert.equal(cat.resolveR2Track({ url: "javascript:alert(1)" }, "https://gw.example.workers.dev"), null);
});

test("user-state: favorites, recent deduplication/cap, resume & A-B loop", () => {
  const { sandbox } = createBrowserSandbox();
  loadScriptIntoSandbox(sandbox, "js/catalog-data.js");
  loadScriptIntoSandbox(sandbox, "js/user-state.js");

  let lastSleepFade = 1;
  let sleepExpired = false;
  const ctrl = sandbox.__MusicBox.createUserStateController({
    onSleepFade: (f) => { lastSleepFade = f; },
    onSleepExpire: () => { sleepExpired = true; },
  });

  const events = [];
  const unsub = ctrl.subscribe("favorites", (p) => events.push(p));
  assert.equal(ctrl.toggleFavorite("t1.mp3"), true);
  assert.equal(ctrl.toggleFavorite("t2.mp3"), true);
  assert.equal(ctrl.isFavorite("t1.mp3"), true);
  assert.deepEqual(Array.from(ctrl.getFavoriteUrls()), ["t2.mp3", "t1.mp3"]);
  assert.equal(events.length, 2);
  assert.equal(ctrl.toggleFavorite("t1.mp3"), false);
  unsub();

  for (let i = 0; i < 50; i++) {
    ctrl.recordRecent(`song-${i}.mp3`);
  }
  assert.equal(ctrl.getRecentCount(), 45);
  assert.equal(ctrl.getRecentUrls()[0], "song-49.mp3");
  ctrl.recordRecent("song-40.mp3");
  assert.equal(ctrl.getRecentUrls()[0], "song-40.mp3");
  assert.equal(ctrl.getRecentCount(), 45);

  ctrl.saveResume("song-40.mp3", 77, "Song 40", true);
  const res = ctrl.getResume();
  assert.equal(res.url, "song-40.mp3");
  assert.equal(res.time, 77);

  ctrl.setAbPointA(12);
  const badB = ctrl.setAbPointB(12.2);
  assert.ok(badB.error, "Should reject B <= A + 0.4s");
  const goodB = ctrl.setAbPointB(24);
  assert.equal(goodB.state.active, true);
  assert.equal(ctrl.getAbJumpTarget(15), null);
  assert.equal(ctrl.getAbJumpTarget(24.1), 12);
  assert.equal(ctrl.getAbJumpTarget(5), 12);
  ctrl.clearAbLoop();
  assert.equal(ctrl.getAbLoopState().active, false);

  ctrl.setSleepTimer(60);
  assert.equal(ctrl.getSleepSnapshot().mode, "countdown");
  assert.equal(ctrl.getSleepSnapshot().targetMinutes, 60);
  ctrl.setSleepTimer("track_end");
  assert.equal(ctrl.getSleepSnapshot().targetMinutes, 0);
  assert.equal(ctrl.notifyTrackEndedForSleep(), true);
  assert.equal(ctrl.notifyTrackEndedForSleep(), false);
  assert.equal(lastSleepFade, 1);
  assert.equal(sleepExpired, false);

  // Signed R2 URLs with rotating exp/sig share the same canonical identity across refreshes
  assert.equal(ctrl.toggleFavorite("https://gw.example.workers.dev/media/Private/A.mp3?exp=1000&sig=old"), true);
  assert.equal(ctrl.isFavorite("https://gw.example.workers.dev/media/Private/A.mp3?exp=2000&sig=new"), true);
  ctrl.recordRecent("https://gw.example.workers.dev/media/Private/A.mp3?exp=1000&sig=old");
  assert.equal(ctrl.getRecentUrls()[0], "https://gw.example.workers.dev/media/Private/A.mp3");
  ctrl.saveResume("https://gw.example.workers.dev/media/Private/A.mp3?exp=2000&sig=new", 55, "Signed A", true);
  assert.equal(ctrl.getResume().url, "https://gw.example.workers.dev/media/Private/A.mp3");
});

test("music.json & lyrics.json integrity on disk", () => {
  const musicList = JSON.parse(fs.readFileSync(path.join(ROOT, "music.json"), "utf8"));
  assert.ok(Array.isArray(musicList) && musicList.length >= 190, "music.json should contain 190+ tracks");
  let missingAudio = 0;
  for (const item of musicList) {
    assert.ok(item.url && item.title, "Track must have url and title");
    if (!fs.existsSync(path.join(ROOT, item.url))) missingAudio++;
  }
  assert.equal(missingAudio, 0, "All music.json audio files must exist under repo root");

  const lyricsMap = JSON.parse(fs.readFileSync(path.join(ROOT, "lyrics.json"), "utf8"));
  assert.equal(typeof lyricsMap, "object");
  assert.ok(Object.keys(lyricsMap).length > 50, "lyrics.json must contain catalog entries");

  const swanKey = "music/Tchaikovsky Swan Lake Suite, Op. 20a I. Scene Swan Theme. Moderato - Berliner Philharmoniker.mp3";
  const swanTrack = musicList.find((t) => t.url === swanKey);
  assert.ok(swanTrack, "Swan Lake Suite track must exist in music.json");
  assert.equal(swanTrack.genre, "古典沙龙 · 剧场礼乐");
  assert.equal(swanTrack.artist, "Pyotr Ilyich Tchaikovsky, Berliner Philharmoniker");
  assert.equal(swanTrack.title, "Swan Lake Suite, Op. 20a: I. Scene (Swan Theme. Moderato)");
  assert.deepEqual(lyricsMap[swanKey], { type: "instrumental" });

  const gstkKey = "music/Band of the Grenadier Guards - God Save the King (天佑吾王 - 英国国歌).mp3";
  const gstkTrack = musicList.find((t) => t.url === gstkKey);
  assert.ok(gstkTrack, "God Save the King track must exist in music.json");
  assert.equal(gstkTrack.genre, "国歌军乐 · 英国");
  assert.equal(gstkTrack.artist, "Royal Philharmonic Orchestra, City of London Choir");
  assert.equal(lyricsMap[gstkKey].type, "synced");
  assert.ok(lyricsMap[gstkKey].lrc.includes("God save our gracious King"));
  assert.ok(lyricsMap[gstkKey].tlyric.includes("天佑吾王"));
});

test("sw.js: Blob Range slicing (206/416) & networkFirst 5xx cache fallback", async () => {
  const swCode = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const mockCacheStore = new Map();
  const mockCache = {
    async match(req) {
      const k = typeof req === "string" ? req : req.url;
      return mockCacheStore.get(k) || mockCacheStore.get("./index.html") || undefined;
    },
    async put(req, res) {
      const k = typeof req === "string" ? req : req.url;
      mockCacheStore.set(k, res);
    },
  };
  mockCacheStore.set("https://williamqaqq.github.io/music-box/", new Response("<html>cached-shell</html>", { status: 200 }));

  const swCtx = {
    location: { origin: "https://williamqaqq.github.io", href: "https://williamqaqq.github.io/music-box/sw.js" },
    addEventListener: () => {},
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    caches: { open: async () => mockCache, keys: async () => [], delete: async () => true },
    fetch: async () => new Response("Upstream Bad Gateway", { status: 502 }),
    Request,
    Response,
    Headers,
    Blob,
    URL,
    Promise,
  };
  swCtx.self = swCtx;
  vm.createContext(swCtx);
  vm.runInContext(swCode, swCtx, { filename: "sw.js" });

  // Range via Blob slice
  const fullAudio = new Response(new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
  const partRes = await swCtx.buildRangeResponse(fullAudio, "bytes=2-5");
  assert.equal(partRes.status, 206);
  assert.equal(partRes.headers.get("Content-Range"), "bytes 2-5/10");
  assert.equal(partRes.headers.get("Content-Length"), "4");
  assert.deepEqual(Array.from(new Uint8Array(await partRes.arrayBuffer())), [12, 13, 14, 15]);

  const suffixRes = await swCtx.buildRangeResponse(
    new Response(new Uint8Array([0, 1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }),
    "bytes=-2"
  );
  assert.equal(suffixRes.status, 206);
  assert.equal(suffixRes.headers.get("Content-Range"), "bytes 3-4/5");
  assert.deepEqual(Array.from(new Uint8Array(await suffixRes.arrayBuffer())), [3, 4]);

  const badRange = await swCtx.buildRangeResponse(
    new Response(new Uint8Array([0, 1, 2]), { status: 200 }),
    "bytes=99-"
  );
  assert.equal(badRange.status, 416);

  // networkFirst falls back to cached response when upstream returns >= 500
  const navReq = new Request("https://williamqaqq.github.io/music-box/");
  const fallbackRes = await swCtx.networkFirst(navReq, "music-box-shell-v35");
  assert.equal(fallbackRes.status, 200);
  assert.equal(await fallbackRes.text(), "<html>cached-shell</html>");
});

test("audio-fx: EQ bypass delays disconnect until gain ramp finishes", async () => {
  const { sandbox } = createBrowserSandbox();
  const makeParam = (initVal = 0) => ({
    value: initVal,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
  });
  const makeNode = () => ({
    connect() {},
    disconnect() {},
    gain: makeParam(0),
    frequency: makeParam(440),
    Q: makeParam(1),
    delayTime: makeParam(0),
    type: "",
  });
  class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = makeNode();
    }
    createGain() { return makeNode(); }
    createBiquadFilter() { return makeNode(); }
    createMediaElementSource() { return makeNode(); }
    createAnalyser() { return { ...makeNode(), frequencyBinCount: 64, getByteFrequencyData() {} }; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  sandbox.AudioContext = MockAudioContext;
  sandbox.document = { body: { classList: { toggle() {} } } };
  loadScriptIntoSandbox(sandbox, "js/catalog-data.js");
  loadScriptIntoSandbox(sandbox, "js/audio-fx.js");

  const mockAudio = {
    paused: false,
    volume: 0.8,
    addEventListener() {},
  };
  const fx = sandbox.__MusicBox.createAudioFxController({
    audio: mockAudio,
    vinylBtn: { classList: { toggle() {} }, setAttribute() {} },
    synthBtn: { classList: { toggle() {} }, setAttribute() {} },
  });

  fx.setEqBand("bass", 4);
  assert.equal(fx.isEqConnected(), true);
  fx.applyEqPreset("flat");
  assert.equal(fx.isEqConnected(), true, "EQ must stay connected briefly while ramping down to prevent click");
  await new Promise((r) => setTimeout(r, 190));
  assert.equal(fx.isEqConnected(), false, "EQ disconnects cleanly after BYPASS_DISCONNECT_DELAY_MS");
});
