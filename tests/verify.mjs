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

test("HTML/SW/CSS structural invariants & asset version v30", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

  const expectedScripts = [
    "js/catalog-data.js?v=30",
    "js/user-state.js?v=30",
    "js/library-loader.js?v=30",
    "js/audio-fx.js?v=30",
    "js/lyrics.js?v=30",
    "js/studio-ui.js?v=30",
    "app.js?v=30",
  ];

  let lastPos = -1;
  for (const src of expectedScripts) {
    const idx = html.indexOf(`src="${src}"`);
    assert.ok(idx > lastPos, `Script ${src} missing or out of defer order in index.html`);
    lastPos = idx;
    assert.ok(sw.includes(src), `sw.js SHELL_ASSETS missing ${src}`);
  }
  assert.ok(html.includes('href="style.css?v=30"'), "index.html missing style.css?v=30");
  assert.ok(html.includes('rel="manifest" href="manifest.webmanifest"'), "index.html missing manifest link");
  assert.ok(html.includes('<dialog id="studioPanel" class="studio-popover" popover="auto"'), "Missing <dialog popover=\"auto\">");
  assert.ok(html.includes('<fieldset class="source-mode-group">'), "Missing sourceMode radio fieldset");
  assert.ok(html.includes('id="setR2Url"'), "Missing #setR2Url input");
  assert.ok(html.includes('id="r2QuotaDetails"'), "Missing #r2QuotaDetails monitor panel");
  assert.ok(html.includes('id="quotaDailyBar"'), "Missing #quotaDailyBar <progress> meter");
  assert.ok(sw.includes('const VERSION = "v30";'), "sw.js VERSION must match v30");
  assert.ok(sw.includes("networkFirst(req, SHELL_CACHE)"), "sw.js must use networkFirst for HTML document navigation");
  assert.ok(css.includes("[hidden] { display: none !important; }"), "style.css must preserve [hidden] override");
  assert.ok(css.includes(".studio-popover:is(:popover-open, .\\:popover-open, .studio-open)"), "Dialog display must be scoped to open state");
  assert.ok(css.includes("content-visibility: auto"), "Spectrum box must use content-visibility: auto");
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

  // inferGenre should decode URL-encoded filenames and strip query params
  assert.equal(
    cat.inferGenre("", "", "https://gw.example.workers.dev/media/" + encodeURIComponent("LBI利比 - 跳楼机.mp3") + "?exp=123&sig=abc"),
    "流金热浪 · 时代新声"
  );
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
});
