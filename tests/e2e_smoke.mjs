import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { handleRequest } from "../cloudflare-r2/src/worker.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadPlaywright() {
  const candidates = [
    "playwright",
    "playwright-core",
    "C:/Users/chatt/miniconda3/Lib/site-packages/playwright/driver/package",
  ];
  for (const mod of candidates) {
    try {
      const pw = require(mod);
      if (pw && pw.chromium) return pw;
    } catch { /* try next */ }
  }
  throw new Error("Could not load playwright or playwright-core");
}

function findBrowserExecutable() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [];
  if (localAppData) {
    const msPw = path.join(localAppData, "ms-playwright");
    if (fs.existsSync(msPw)) {
      for (const entry of fs.readdirSync(msPw)) {
        if (entry.startsWith("chromium-")) {
          const exe = path.join(msPw, entry, "chrome-win64", "chrome.exe");
          if (fs.existsSync(exe)) candidates.push(exe);
          const exeAlt = path.join(msPw, entry, "chrome-win", "chrome.exe");
          if (fs.existsSync(exeAlt)) candidates.push(exeAlt);
        }
      }
    }
  }
  candidates.push(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  );
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

const MIME_MAP = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = cleanUrl === "/" ? "index.html" : cleanUrl.replace(/^\/+/, "");
      const filePath = path.resolve(ROOT, rel);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_MAP[ext] || "application/octet-stream";
      const stat = fs.statSync(filePath);
      const total = stat.size;
      const range = req.headers.range;

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m && m[1] ? parseInt(m[1], 10) : 0;
        const end = m && m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
        res.writeHead(206, {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Content-Length": total,
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function startMockR2GatewayServer(baseOrigin) {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "music.json"), "utf8"));
  const sampleTrack = catalog[0];
  const sampleAudioBytes = fs.readFileSync(path.join(ROOT, sampleTrack.url));
  const r2Key = "私藏精选/R2 E2E Track.mp3";
  const objects = {
    "manifest.json": {
      contentType: "application/json; charset=utf-8",
      etag: '"r2m1"',
      bytes: Buffer.from(
        JSON.stringify([
          {
            name: "R2 E2E Track.mp3",
            title: "R2 Streamed Sonata",
            artist: "Cloudflare R2 Trio",
            album: "Edge Vault",
            genre: "黄金年代 · 爵士名伶",
            path: r2Key,
            url: r2Key,
          },
        ])
      ),
    },
    "lyrics.json": {
      contentType: "application/json; charset=utf-8",
      etag: '"r2l1"',
      bytes: Buffer.from(
        JSON.stringify({
          [r2Key]: {
            type: "synced",
            lrc: "[00:00.50]From Cloudflare R2 Edge\n[00:04.00]Streaming cleanly with Range",
          },
        })
      ),
    },
    [r2Key]: {
      contentType: "audio/mpeg",
      etag: '"r2a1"',
      bytes: sampleAudioBytes,
    },
  };

  const env = {
    ALLOWED_ORIGINS: baseOrigin,
    ALLOW_LOCALHOST: "1",
    MUSIC_BUCKET: {
      async head(key) {
        const o = objects[key];
        if (!o) return null;
        return {
          key,
          size: o.bytes.byteLength,
          httpEtag: o.etag,
          writeHttpMetadata(h) {
            h.set("Content-Type", o.contentType);
          },
        };
      },
      async get(key, opts = {}) {
        const o = objects[key];
        if (!o) return null;
        if (opts && opts.onlyIf instanceof Headers) {
          const ifNoneMatch = opts.onlyIf.get("if-none-match");
          if (ifNoneMatch && ifNoneMatch === o.etag) {
            return {
              key,
              size: o.bytes.byteLength,
              httpEtag: o.etag,
              body: null,
              writeHttpMetadata(h) {
                h.set("Content-Type", o.contentType);
              },
            };
          }
        }
        let slice = o.bytes;
        let rangeMeta;
        if (opts && opts.range) {
          let offset = 0;
          let length = o.bytes.byteLength;
          if (opts.range instanceof Headers) {
            const rh = opts.range.get("range");
            if (rh) {
              const m = /^bytes=(\d*)-(\d*)$/i.exec(rh.trim());
              if (!m) throw new Error("10039 Invalid range");
              if (m[1] === "") {
                const suffix = Number(m[2]);
                offset = Math.max(0, o.bytes.byteLength - suffix);
                length = o.bytes.byteLength - offset;
              } else {
                offset = Number(m[1]);
                const end = m[2] === "" ? o.bytes.byteLength - 1 : Math.min(Number(m[2]), o.bytes.byteLength - 1);
                if (offset >= o.bytes.byteLength) {
                  return {
                    key,
                    size: o.bytes.byteLength,
                    httpEtag: o.etag,
                    range: { offset, length: 0 },
                    body: null,
                    writeHttpMetadata(h) {
                      h.set("Content-Type", o.contentType);
                    },
                  };
                }
                length = end - offset + 1;
              }
            }
          } else if (Number.isFinite(opts.range.offset)) {
            offset = opts.range.offset;
            length = Number.isFinite(opts.range.length) ? opts.range.length : o.bytes.byteLength - offset;
          }
          slice = o.bytes.subarray(offset, offset + length);
          rangeMeta = { offset, length, end: offset + length - 1 };
        }
        return {
          key,
          size: o.bytes.byteLength,
          httpEtag: o.etag,
          range: rangeMeta,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(slice));
              controller.close();
            },
          }),
          async json() {
            return JSON.parse(o.bytes.toString("utf8"));
          },
          writeHttpMetadata(h) {
            h.set("Content-Type", o.contentType);
          },
        };
      },
    },
  };

  return new Promise((resolve) => {
    let gwUrl = "";
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = `${gwUrl}${req.url || "/"}`;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        }
        const workerRes = await handleRequest(new Request(reqUrl, { method: req.method, headers }), env);
        const outHeaders = {};
        workerRes.headers.forEach((v, k) => {
          outHeaders[k] = v;
        });
        res.writeHead(workerRes.status, outHeaders);
        if (workerRes.body && req.method !== "HEAD") {
          const buf = Buffer.from(await workerRes.arrayBuffer());
          res.end(buf);
        } else {
          res.end();
        }
      } catch (err) {
        res.writeHead(500);
        res.end(String(err && err.message ? err.message : err));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      gwUrl = `http://127.0.0.1:${addr.port}`;
      resolve({ server, url: gwUrl, sampleCount: catalog.length });
    });
  });
}

async function run() {
  const pw = loadPlaywright();
  const exePath = findBrowserExecutable();
  const { server, url: baseUrl } = await startStaticServer();
  const r2Gateway = await startMockR2GatewayServer(baseUrl);
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: exePath,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

  try {
    // -------------------- 1. DESKTOP SMOKE (1280x800) --------------------
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ["clipboard-read", "clipboard-write"],
      acceptDownloads: true,
    });
    const page = await context.newPage();

    const errors = [];
    let lyricsRequestCount = 0;
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.stack || err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });
    page.on("request", (req) => {
      if (req.url().includes("lyrics.json")) lyricsRequestCount++;
    });
    page.on("response", (res) => {
      if (res.url().startsWith(baseUrl) && res.status() >= 400) {
        errors.push(`HTTP ${res.status()} on ${res.url()}`);
      }
    });

    await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
    await page.waitForSelector(".playlist-item");

    // Verify lazy lyrics.json: 0 requests before any track starts playing
    assert.equal(lyricsRequestCount, 0, "lyrics.json must NOT be fetched eagerly on cold boot");

    // Verify SW registration resolves cleanly on HTTP
    const swRegistered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((res) => setTimeout(() => res(null), 4000)),
      ]);
      return !!(reg && reg.active);
    });
    assert.equal(swRegistered, true, "Service Worker sw.js must activate on HTTP");

    // Find a track that actually has lyrics in lyrics.json for realistic test
    const lyricsSampleTitle = await page.evaluate(async () => {
      const mRes = await fetch("music.json");
      const list = await mRes.json();
      const lRes = await fetch("lyrics.json");
      const lMap = await lRes.json();
      for (const item of list) {
        const entry = lMap[item.url];
        if (entry && entry.lrc && entry.lrc.length > 80) return item.title;
      }
      return list[0].title;
    });
    // Reset counter after helper eval fetch
    lyricsRequestCount = 0;

    // Filter via search box to test real multi-stage interaction without mutating cold test before play
    await page.fill("#searchInput", lyricsSampleTitle);
    await page.waitForTimeout(160);
    await page.locator(".playlist-item").first().click();

    // Wait for audio metadata + lazy lyrics render
    await page.waitForFunction(() => document.querySelectorAll(".lyric-line").length > 0, { timeout: 8000 });
    assert.ok(lyricsRequestCount >= 1, "lyrics.json should load on demand when playing a track");

    // Test in-panel lyrics search + clear
    await page.click("#lyricsSearchBtn");
    await page.waitForSelector("#lyricsSearchBar:not([hidden])");
    const firstLyricWord = await page.evaluate(() => {
      const el = document.querySelector(".lyric-line .lyric-orig, .lyric-line");
      return (el ? el.textContent : "").trim().split(/\s+/)[0].slice(0, 3);
    });
    if (firstLyricWord) {
      await page.fill("#lyricsSearchInput", firstLyricWord);
      await page.waitForTimeout(150);
      const matchCount = await page.locator(".lyric-line.lyric-match").count();
      assert.ok(matchCount > 0, "Lyrics in-panel search should highlight matches");
    }
    await page.click("#lyricsSearchClearBtn");
    await page.click("#lyricsSearchBtn"); // collapse search bar

    // Test .lrc export triggers download
    const downloadPromise = page.waitForEvent("download");
    await page.click("#lyricsExportBtn");
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith(".lrc"), "Export filename should end with .lrc");

    // Clear search and test Keyed DOM Reuse in Playlist + Queue
    await page.click("#searchClearBtn");
    await page.waitForFunction(() => document.querySelectorAll(".playlist-item").length > 20);

    // Mark second row as favorite & confirm row element itself is reused without replacement
    const favReuseOk = await page.evaluate(() => {
      const items = document.querySelectorAll(".playlist-item");
      const targetRow = items[1];
      const favBtn = targetRow.querySelector(".playlist-fav-btn");
      favBtn.click();
      const afterRow = document.querySelectorAll(".playlist-item")[1];
      return targetRow === afterRow && afterRow.querySelector(".playlist-fav-btn").classList.contains("is-fav");
    });
    assert.equal(favReuseOk, true, "Toggling favorite must reuse exact playlist row DOM node without rebuild");

    // Enqueue 2 items and open Queue drawer, test Keyed DOM reuse on reorder
    await page.locator(".playlist-item").nth(2).locator(".playlist-enqueue-btn").click();
    await page.locator(".playlist-item").nth(3).locator(".playlist-enqueue-btn").click();
    await page.click("#queueToggleBtn");
    await page.waitForSelector("#queueDrawer:not([hidden])");

    const queueKeyedOk = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".queue-item"));
      const moveTarget = rows[rows.length - 1];
      const upBtn = moveTarget.querySelector(".queue-act-next");
      if (!upBtn || upBtn.hidden) return false;
      upBtn.click();
      return Array.from(document.querySelectorAll(".queue-item")).includes(moveTarget) && document.body.contains(moveTarget);
    });
    assert.equal(queueKeyedOk, true, "Queue Drawer move must preserve and reuse existing DOM <li> element");
    await page.click("#queueCloseBtn");

    // Personal collections tab: verify Favorite + Recent counts and filtering
    await page.click('.shelf-tab[data-category="personal"]');
    await page.locator('.genre-card[data-genre="__favorites__"] .genre-card-main').click();
    assert.equal(await page.locator(".playlist-item").count(), 1, "Favorites collection should show 1 favorited track");
    await page.locator('.genre-card[data-genre="__recent__"] .genre-card-main').click();
    assert.ok((await page.locator(".playlist-item").count()) >= 1, "Recent collection should list played track");
    await page.click('.shelf-tab[data-category="all"]');
    await page.click("#clearGenreBtn");

    // Toggle Vinyl & Synth DSP branches during active track
    await page.click("#vinylFxBtn");
    await page.click("#synthFxBtn");
    assert.equal(await page.locator("#vinylFxBtn.on").count(), 1, "Vinyl FX button should be active");
    assert.equal(await page.locator("#synthFxBtn.on").count(), 1, "Synth FX button should be active");

    // Open Phonograph Studio Popover & test Spectrum / EQ / FX Mix / Speed / Crossfade / Sleep / A-B Loop / Share
    await page.click("#studioBtn");
    const popoverOpen = await page.evaluate(() => {
      const d = document.getElementById("studioPanel");
      return d.matches(":popover-open") || d.classList.contains(":popover-open");
    });
    assert.equal(popoverOpen, true, "Studio popover should open in top-layer / popover state");

    const canvasSized = await page.evaluate(() => {
      const c = document.getElementById("spectrumCanvas");
      return c.width > 0 && c.height > 0;
    });
    assert.equal(canvasSized, true, "Spectrum canvas should have non-zero pixel dimensions when studio is open");

    await page.click('.eq-preset-btn[data-preset="warm"]');
    await page.locator("#eqBass").fill("6");
    await page.locator("#eqBass").dispatchEvent("input");
    assert.equal(await page.textContent("#eqBassVal"), "+6 dB");
    await page.click('.eq-preset-btn[data-preset="warm"]');

    await page.click('.studio-pill-btn[data-speed="1.25"]');
    await page.click('.studio-pill-btn[data-xfade="4"]');
    await page.click('.studio-pill-btn[data-sleep="15"]');
    const studioState = await page.evaluate(() => ({
      rate: document.getElementById("audio").playbackRate,
      badgeDotVisible: !document.getElementById("studioBadgeDot").hidden,
      sleepText: document.getElementById("sleepStatusText").textContent,
    }));
    assert.equal(studioState.rate, 1.25);
    assert.equal(studioState.badgeDotVisible, true);
    assert.ok(studioState.sleepText.includes("剩余"));
    await page.click('.studio-pill-btn[data-sleep="off"]');

    // Clicking outside popover="auto" (e.g. disabling DSP branches) triggers light-dismiss & dynamic bypass disconnect
    await page.click("#vinylFxBtn");
    const dismissedByOutsideClick = await page.evaluate(() => !document.getElementById("studioPanel").matches(":popover-open"));
    assert.equal(dismissedByOutsideClick, true, "popover=\"auto\" must light-dismiss on outside click");
    await page.click("#synthFxBtn");
    await page.waitForTimeout(200);

    // Re-open studio panel for A-B loop & Share Copy verification
    await page.click("#studioBtn");

    // Test A-B loop buttons & Share Copy button (must NOT disable on copied feedback)
    await page.evaluate(() => {
      const a = document.getElementById("audio");
      a.pause();
      if (isFinite(a.duration) && a.duration > 15) a.currentTime = 5;
    });
    await page.click("#abSetABtn");
    await page.evaluate(() => {
      const a = document.getElementById("audio");
      if (isFinite(a.duration) && a.duration > 15) a.currentTime = 12;
    });
    await page.click("#abSetBBtn");
    assert.ok((await page.textContent("#abReadout")).includes("复读中"));
    await page.click("#abClearBtn");

    await page.click("#shareTrackBtn");
    await page.waitForFunction(() => document.getElementById("shareTrackBtn").hasAttribute("data-copied"));
    const copyCheck = await page.evaluate(async () => ({
      disabled: document.getElementById("shareTrackBtn").disabled,
      statusText: document.getElementById("shareStatus").textContent,
      clip: await navigator.clipboard.readText().catch(() => ""),
    }));
    assert.equal(copyCheck.disabled, false, "Share copy button must NOT be disabled while showing feedback");
    assert.ok(copyCheck.statusText.includes("已复制"), "Status bubble should confirm copy");
    assert.ok(copyCheck.clip.includes("#track="), "Clipboard should contain share hash #track=");

    await page.click("#studioCloseBtn");

    // Verify Resume Bar across page reload & test clicking Resume Play triggers playback + seeks
    await page.evaluate(() => {
      const a = document.getElementById("audio");
      a.currentTime = 36;
      a.pause();
    });
    await page.waitForTimeout(100);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#resumeBar:not([hidden])");
    assert.ok((await page.textContent("#resumeText")).includes("0:36"), "Resume bar should display saved timestamp");
    await page.click("#resumePlayBtn");
    assert.equal(await page.locator("#resumeBar").isHidden(), true, "Clicking resume play should hide bar and load track");
    await page.waitForFunction(() => Math.floor(document.getElementById("audio").currentTime) >= 34, { timeout: 6000 });
    await page.evaluate(() => document.getElementById("audio").pause());

    // Verify deep link #track=...&t=... loads exact track directly
    const shareHashUrl = await page.evaluate(async () => {
      const list = await (await fetch("music.json")).json();
      const target = list[5];
      return {
        title: target.title,
        hash: "#track=" + encodeURIComponent(target.url) + "&t=25",
      };
    });
    await page.goto(`${baseUrl}/index.html${shareHashUrl.hash}`, { waitUntil: "networkidle" });
    await page.waitForFunction((t) => document.getElementById("trackTitle").textContent === t, shareHashUrl.title);
    assert.equal(await page.locator("#resumeBar").isHidden(), true, "Resume bar stays hidden when opening a share deep link");

    assert.deepEqual(errors, [], `Desktop E2E hit unexpected errors: ${errors.join(" | ")}`);
    await context.close();

    // -------------------- 2. MOBILE VIEWPORT SMOKE (375x812 touch) --------------------
    const mobileCtx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
    });
    const mPage = await mobileCtx.newPage();
    const mobileErrors = [];
    mPage.on("pageerror", (err) => mobileErrors.push(`pageerror: ${err.message}`));
    mPage.on("console", (msg) => {
      if (msg.type() === "error") mobileErrors.push(`console.error: ${msg.text()}`);
    });

    await mPage.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
    await mPage.waitForSelector(".playlist-item");

    const mobileMetrics = await mPage.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      const titleRect = document.getElementById("trackTitle").getBoundingClientRect();
      const playerRect = document.getElementById("player").getBoundingClientRect();
      return { overflow, titleWidth: titleRect.width, playerTop: playerRect.top };
    });
    assert.equal(mobileMetrics.overflow, false, "Mobile 375px must have zero horizontal overflow");
    assert.ok(mobileMetrics.titleWidth >= 140, `Mobile trackTitle crushed (${mobileMetrics.titleWidth}px)`);

    // Check Queue & Lyrics drawer clearance above mobile player bar
    await mPage.click("#queueToggleBtn");
    await mPage.waitForSelector("#queueDrawer:not([hidden])");
    const qClearance = await mPage.evaluate(() => ({
      qBottom: document.getElementById("queueDrawer").getBoundingClientRect().bottom,
      pTop: document.getElementById("player").getBoundingClientRect().top,
    }));
    assert.ok(qClearance.qBottom <= qClearance.pTop + 1, `Queue drawer overlaps mobile player (${qClearance.qBottom} > ${qClearance.pTop})`);
    await mPage.click("#queueCloseBtn");

    await mPage.click("#lyricsToggleBtn");
    await mPage.waitForSelector("body.mobile-lyrics-open .lyrics-panel");
    const lClearance = await mPage.evaluate(() => ({
      lBottom: document.getElementById("lyricsPanel").getBoundingClientRect().bottom,
      pTop: document.getElementById("player").getBoundingClientRect().top,
    }));
    assert.ok(lClearance.lBottom <= lClearance.pTop + 1, `Lyrics panel overlaps mobile player (${lClearance.lBottom} > ${lClearance.pTop})`);

    assert.deepEqual(mobileErrors, [], `Mobile E2E hit unexpected errors: ${mobileErrors.join(" | ")}`);
    await mobileCtx.close();

    // -------------------- 3. IPAD PORTRAIT & LANDSCAPE TOUCH TESTS --------------------
    for (const tabletSpec of [
      { name: "iPad Portrait 820x1180", width: 820, height: 1180, expectSideLyrics: false },
      { name: "iPad Landscape 1024x768", width: 1024, height: 768, expectSideLyrics: true },
    ]) {
      const tabCtx = await browser.newContext({
        viewport: { width: tabletSpec.width, height: tabletSpec.height },
        hasTouch: true,
        isMobile: false,
      });
      const tPage = await tabCtx.newPage();
      const tabErrors = [];
      tPage.on("pageerror", (err) => tabErrors.push(`pageerror: ${err.message}`));
      tPage.on("console", (msg) => {
        if (msg.type() === "error") tabErrors.push(`console.error: ${msg.text()}`);
      });

      await tPage.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
      await tPage.waitForSelector(".playlist-item");

      const tabletMetrics = await tPage.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const overflow = document.documentElement.scrollWidth > vw;
        const playerRect = document.getElementById("player").getBoundingClientRect();
        const rightControls = ["#vinylFxBtn", "#synthFxBtn", "#studioBtn", "#lyricsToggleBtn", "#queueToggleBtn", "#muteBtn", "#volume"]
          .map((sel) => {
            const el = document.querySelector(sel);
            const r = el.getBoundingClientRect();
            return { sel, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
          });
        const favOpacity = parseFloat(getComputedStyle(document.querySelector(".playlist-fav-btn")).opacity);
        const enqOpacity = parseFloat(getComputedStyle(document.querySelector(".playlist-enqueue-btn")).opacity);
        const lyricsRect = document.getElementById("lyricsPanel").getBoundingClientRect();
        return { vw, vh, overflow, playerRect, rightControls, favOpacity, enqOpacity, lyricsRect };
      });

      assert.equal(tabletMetrics.overflow, false, `${tabletSpec.name} must have zero horizontal overflow`);
      assert.ok(tabletMetrics.favOpacity >= 0.8, `${tabletSpec.name}: fav button should stay visible on touch (${tabletMetrics.favOpacity})`);
      assert.ok(tabletMetrics.enqOpacity >= 0.8, `${tabletSpec.name}: enqueue button should stay visible on touch (${tabletMetrics.enqOpacity})`);

      for (const ctrl of tabletMetrics.rightControls) {
        assert.ok(ctrl.left >= 0 && ctrl.right <= tabletMetrics.vw + 0.5, `${tabletSpec.name}: ${ctrl.sel} clipped horizontally (${ctrl.left}..${ctrl.right} vs vw=${tabletMetrics.vw})`);
        assert.ok(ctrl.bottom <= tabletMetrics.vh + 0.5 && ctrl.top >= tabletMetrics.playerRect.top - 1, `${tabletSpec.name}: ${ctrl.sel} outside player vertical bounds`);
        assert.ok(ctrl.w >= 34 && ctrl.h >= 20, `${tabletSpec.name}: ${ctrl.sel} crushed (${ctrl.w}x${ctrl.h})`);
      }

      if (tabletSpec.expectSideLyrics) {
        assert.ok(tabletMetrics.lyricsRect.height > 250, `${tabletSpec.name}: side lyrics panel should be visible`);
        assert.ok(tabletMetrics.lyricsRect.bottom <= tabletMetrics.playerRect.top + 2, `${tabletSpec.name}: side lyrics (${tabletMetrics.lyricsRect.bottom}) overlaps player (${tabletMetrics.playerRect.top})`);
      } else {
        await tPage.tap("#lyricsToggleBtn");
        await tPage.waitForSelector("body.mobile-lyrics-open .lyrics-panel");
        const lClear = await tPage.evaluate(() => ({
          lBottom: document.getElementById("lyricsPanel").getBoundingClientRect().bottom,
          pTop: document.getElementById("player").getBoundingClientRect().top,
        }));
        assert.ok(lClear.lBottom <= lClear.pTop + 2, `${tabletSpec.name}: lyrics overlay (${lClear.lBottom}) overlaps player (${lClear.pTop})`);
        await tPage.tap("#lyricsCloseBtn");
      }

      // Open Studio panel via touch tap and verify positioning & non-overlap
      await tPage.tap("#studioBtn");
      const studioBox = await tPage.evaluate(() => {
        const d = document.getElementById("studioPanel");
        const isOpen = d.matches(":popover-open") || d.classList.contains(":popover-open") || d.classList.contains("studio-open");
        const r = d.getBoundingClientRect();
        const p = document.getElementById("player").getBoundingClientRect();
        const eqCtrl = document.getElementById("eqBass").getBoundingClientRect();
        return {
          isOpen,
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          vw: window.innerWidth,
          playerTop: p.top,
          eqW: eqCtrl.width,
        };
      });
      assert.equal(studioBox.isOpen, true, `${tabletSpec.name}: tapping #studioBtn must open Studio panel`);
      assert.ok(studioBox.top >= 0 && studioBox.left >= 0 && studioBox.right <= studioBox.vw + 0.5, `${tabletSpec.name}: Studio panel must fit inside viewport`);
      assert.ok(studioBox.bottom <= studioBox.playerTop + 2, `${tabletSpec.name}: Studio panel (${studioBox.bottom}) must stay above player (${studioBox.playerTop})`);
      assert.ok(studioBox.eqW > 80, `${tabletSpec.name}: EQ slider inside Studio must be visible and usable`);

      await tPage.tap("#studioCloseBtn");
      assert.deepEqual(tabErrors, [], `${tabletSpec.name} hit unexpected errors: ${tabErrors.join(" | ")}`);
      await tabCtx.close();
    }

    // -------------------- 4. CLOUDFLARE R2 GATEWAY + HYBRID MODE E2E --------------------
    const r2Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const r2Page = await r2Ctx.newPage();
    const r2Errors = [];
    r2Page.on("pageerror", (err) => r2Errors.push(`pageerror: ${err.message}`));
    r2Page.on("console", (msg) => {
      if (msg.type() === "error") r2Errors.push(`console.error: ${msg.text()}`);
    });

    await r2Page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
    await r2Page.waitForSelector(".playlist-item");

    // Open Settings and validate R2 URL inline feedback before submission
    await r2Page.click("#settingsBtn");
    await r2Page.waitForSelector("#settingsModal:not([hidden])");
    await r2Page.click('input[name="sourceMode"][value="r2"]');
    await r2Page.fill("#setR2Url", "not-a-valid-url");
    await r2Page.click('#settingsForm button[type="submit"]');

    const validationState = await r2Page.evaluate(() => {
      const inp = document.getElementById("setR2Url");
      const err = document.getElementById("r2UrlError");
      return {
        modalOpen: !document.getElementById("settingsModal").hidden,
        ariaInvalid: inp.getAttribute("aria-invalid"),
        describedBy: inp.getAttribute("aria-describedby") || "",
        errorVisible: !err.hidden,
        focused: document.activeElement === inp,
      };
    });
    assert.equal(validationState.modalOpen, true, "Invalid R2 URL must keep settings modal open");
    assert.equal(validationState.ariaInvalid, "true");
    assert.ok(validationState.describedBy.includes("r2UrlError"));
    assert.equal(validationState.errorVisible, true);
    assert.equal(validationState.focused, true);

    // Save valid local Worker R2 URL and inspect live in-app R2 /quota telemetry before submitting
    await r2Page.fill("#setR2Url", r2Gateway.url);
    await r2Page.click("#r2QuotaDetails .r2-quota-toggle");
    await r2Page.waitForFunction(() => {
      const badge = document.getElementById("r2QuotaBadge");
      const grid = document.getElementById("r2QuotaGrid");
      return badge && badge.textContent === "安全运行" && grid && !grid.hidden;
    }, { timeout: 6000 });
    const quotaWidget = await r2Page.evaluate(() => ({
      summary: document.getElementById("r2QuotaSummary").textContent,
      daily: document.getElementById("quotaDailyVal").textContent,
      storage: document.getElementById("quotaStorageVal").textContent,
    }));
    assert.ok(quotaWidget.daily.includes("/ 80,000 次"), "Quota widget must render daily req limit");
    assert.ok(quotaWidget.storage.includes("/ 8.00 GiB"), "Quota widget must render 8.00 GiB storage cap");

    await r2Page.click('#settingsForm button[type="submit"]');
    await r2Page.waitForFunction(() => document.getElementById("settingsModal").hidden);
    await r2Page.waitForFunction(() => document.querySelectorAll(".playlist-item").length === 1);

    // Favorite the R2 track, play it + verify R2 /lyrics.json timed lyrics
    await r2Page.click(".playlist-item .playlist-fav-btn");
    await r2Page.click(".playlist-item");
    await r2Page.waitForFunction(() => {
      const a = document.getElementById("audio");
      const txt = document.getElementById("lyricsList").textContent;
      return !a.paused && a.currentTime > 0.05 && txt.includes("From Cloudflare R2 Edge");
    }, { timeout: 6000 });
    await r2Page.evaluate(() => document.getElementById("audio").pause());

    // Temporarily switch to GitHub-only mode, then back to Hybrid: R2 favorite must survive source switching!
    await r2Page.click("#settingsBtn");
    await r2Page.click('input[name="sourceMode"][value="github"]');
    await r2Page.click('#settingsForm button[type="submit"]');
    await r2Page.waitForFunction(
      (expectedGhCount) => document.querySelectorAll(".playlist-item").length === expectedGhCount,
      r2Gateway.sampleCount
    );

    // Switch back to Hybrid mode and verify merged GitHub + R2 library & preserved R2 favorite
    await r2Page.click("#settingsBtn");
    await r2Page.click('input[name="sourceMode"][value="hybrid"]');
    await r2Page.click('#settingsForm button[type="submit"]');
    await r2Page.waitForFunction(
      (expectedTotal) => document.querySelectorAll(".playlist-item").length === expectedTotal,
      r2Gateway.sampleCount + 1
    );
    const favPreserved = await r2Page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".playlist-item"));
      const r2Row = rows.find((el) => el.textContent.includes("R2 Streamed Sonata"));
      return !!(r2Row && r2Row.querySelector(".playlist-fav-btn.is-fav"));
    });
    assert.equal(favPreserved, true, "R2 favorite must remain preserved across temporary GitHub-only source switch");

    assert.deepEqual(r2Errors, [], `R2 E2E hit unexpected errors: ${r2Errors.join(" | ")}`);
    await r2Ctx.close();

    console.log("E2E SMOKE PASS: desktop + mobile (375px) + iPad + Cloudflare R2 gateway & hybrid mode verified");
  } finally {
    await browser.close();
    server.close();
    r2Gateway.server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
