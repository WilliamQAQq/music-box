const VERSION = "v49";
const SHELL_CACHE = "music-box-shell-" + VERSION;
const DATA_CACHE = "music-box-data-" + VERSION;
const AUDIO_CACHE = "music-box-audio-v3";
const AUDIO_LRU_KEY = "./__audio-lru-v1__";
const MAX_CACHED_AUDIO = 18;
const audioLruMap = new Map();
let audioLruTick = 0;
let audioLruHydrated = false;
let audioLruHydratePromise = null;
let audioLruPersistTimer = null;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./js/theme-init.js?v=49",
  "./style.css?v=49",
  "./js/catalog-data.js?v=49",
  "./js/user-state.js?v=49",
  "./js/library-loader.js?v=49",
  "./js/audio-fx.js?v=49",
  "./js/lyrics.js?v=49",
  "./js/studio-ui.js?v=49",
  "./app.js?v=49",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, AUDIO_CACHE]);
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

async function matchCacheFallback(cache, request) {
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === "navigate") {
    return cache.match("./index.html");
  }
  return null;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === "basic") {
      cache.put(request, res.clone()).catch(() => {});
      return res;
    }
    if (res && res.status >= 500) {
      const fallback = await matchCacheFallback(cache, request);
      if (fallback) return fallback;
    }
    return res;
  } catch (err) {
    const fallback = await matchCacheFallback(cache, request);
    if (fallback) return fallback;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const netRes = await fetch(request);
  if (netRes && netRes.ok && netRes.type === "basic") {
    cache.put(request, netRes.clone()).catch(() => {});
  }
  return netRes;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const netPromise = fetch(request).then((res) => {
    if (res && res.ok && res.type === "basic") {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => null);
  if (cached) {
    return cached;
  }
  const net = await netPromise;
  if (net && net.status < 500) return net;
  const fallback = await cache.match(request, { ignoreSearch: true });
  return fallback || net || Response.error();
}

function buildRangeResponse(fullRes, rangeHeader) {
  return fullRes.blob().then((blob) => {
    const total = blob.size;
    if (total <= 0) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */0" } });
    }
    const match = /^bytes=(\d*)-(\d*)$/i.exec((rangeHeader || "").trim());
    if (!match || (match[1] === "" && match[2] === "")) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
    }
    let start = 0;
    let end = total - 1;
    if (match[1] === "") {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) {
        return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
      }
      start = Math.max(0, total - suffix);
    } else {
      start = Number(match[1]);
      if (match[2] !== "") {
        end = Number(match[2]);
      }
    }
    if (!Number.isSafeInteger(start) || start < 0 || start >= total || !Number.isSafeInteger(end)) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
    }
    if (end >= total) end = total - 1;
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
    }
    const mime = blob.type || fullRes.headers.get("Content-Type") || "application/octet-stream";
    const headers = new Headers(fullRes.headers);
    headers.delete("Content-Encoding");
    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + total);
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Accept-Ranges", "bytes");
    return new Response(blob.slice(start, end + 1, mime), { status: 206, statusText: "Partial Content", headers });
  });
}

async function ensureLruHydrated() {
  if (audioLruHydrated) return;
  if (audioLruHydratePromise) return audioLruHydratePromise;
  audioLruHydratePromise = (async () => {
    try {
      const dataCache = await caches.open(DATA_CACHE);
      const res = await dataCache.match(AUDIO_LRU_KEY);
      if (res && res.ok) {
        const parsed = await res.json();
        if (parsed && Array.isArray(parsed.entries)) {
          for (const pair of parsed.entries) {
            if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "number" && isFinite(pair[1])) {
              const prev = audioLruMap.get(pair[0]) || 0;
              if (pair[1] > prev) audioLruMap.set(pair[0], pair[1]);
              if (pair[1] > audioLruTick) audioLruTick = pair[1];
            }
          }
        }
        if (typeof parsed.tick === "number" && isFinite(parsed.tick) && parsed.tick > audioLruTick) {
          audioLruTick = parsed.tick;
        }
      }
    } catch (e) { /* ignore */ }
    audioLruHydrated = true;
    audioLruHydratePromise = null;
  })();
  return audioLruHydratePromise;
}

async function persistAudioLru() {
  try {
    const dataCache = await caches.open(DATA_CACHE);
    const payload = JSON.stringify({ tick: audioLruTick, entries: Array.from(audioLruMap.entries()) });
    await dataCache.put(AUDIO_LRU_KEY, new Response(payload, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  } catch (e) { /* ignore */ }
}

function schedulePersistAudioLru() {
  if (typeof setTimeout !== "function") {
    persistAudioLru();
    return;
  }
  if (audioLruPersistTimer) clearTimeout(audioLruPersistTimer);
  audioLruPersistTimer = setTimeout(() => {
    audioLruPersistTimer = null;
    persistAudioLru();
  }, 250);
}

function touchAudioCacheEntry(reqOrUrl) {
  const keyUrl = typeof reqOrUrl === "string" ? reqOrUrl : (reqOrUrl && reqOrUrl.url) || "";
  if (keyUrl) {
    audioLruMap.set(keyUrl, ++audioLruTick);
    schedulePersistAudioLru();
  }
}

function hasCachedAudioMetadataChanged(cachedRes, headRes) {
  if (!cachedRes || !headRes || !headRes.ok) return false;
  const oldEtag = (cachedRes.headers.get("etag") || "").trim();
  const newEtag = (headRes.headers.get("etag") || "").trim();
  if (oldEtag && newEtag && oldEtag !== newEtag) return true;
  const oldLen = (cachedRes.headers.get("content-length") || "").trim();
  const newLen = (headRes.headers.get("content-length") || "").trim();
  if (oldLen && newLen && oldLen !== newLen) return true;
  const oldMod = (cachedRes.headers.get("last-modified") || "").trim();
  const newMod = (headRes.headers.get("last-modified") || "").trim();
  if (oldMod && newMod && oldMod !== newMod) return true;
  return false;
}

async function handleAudioRequest(request) {
  await ensureLruHydrated();
  const rangeHeader = request.headers.get("range");
  const cleanReq = new Request(request.url, { method: "GET" });
  const cache = await caches.open(AUDIO_CACHE);

  const cached = await cache.match(cleanReq);
  if (cached && cached.status === 200) {
    if (!rangeHeader || /^bytes=0-\d*$/i.test(rangeHeader.trim())) {
      touchAudioCacheEntry(cleanReq);
    }
    return rangeHeader ? buildRangeResponse(cached, rangeHeader) : cached;
  }

  try {
    const netRes = await fetch(request);
    if (!rangeHeader && netRes && netRes.status === 200 && netRes.type === "basic") {
      touchAudioCacheEntry(cleanReq);
      cache.put(cleanReq, netRes.clone()).then(() => trimAudioCache(cache)).catch(() => {});
    }
    return netRes;
  } catch (err) {
    if (!cached) throw err;
    return rangeHeader ? buildRangeResponse(cached, rangeHeader) : cached;
  }
}

async function trimAudioCache(cache) {
  await ensureLruHydrated();
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHED_AUDIO;
  if (excess <= 0) return;
  const ranked = keys.map((req, index) => ({
    req,
    index,
    tick: audioLruMap.get(req.url) || 0,
  }));
  ranked.sort((a, b) => (a.tick !== b.tick ? a.tick - b.tick : a.index - b.index));
  for (let i = 0; i < excess; i++) {
    const victim = ranked[i].req;
    audioLruMap.delete(victim.url);
    await cache.delete(victim);
  }
  await persistAudioLru();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(url.pathname)) {
    event.respondWith(handleAudioRequest(req));
    return;
  }
  if (url.pathname.endsWith("/music.json") || url.pathname.endsWith("/lyrics.json")) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }
  if (req.mode === "navigate" || /\.html$/i.test(url.pathname) || url.pathname.endsWith("/")) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }
  if (/\.(css|js)$/i.test(url.pathname) && url.searchParams.has("v")) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
  if (/\.(css|js|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "CACHE_TRACK" && data.url) {
    event.waitUntil((async () => {
      try {
        const parsedUrl = new URL(data.url, self.location.href);
        if (parsedUrl.origin !== self.location.origin) return;
        const absUrl = parsedUrl.href;
        const cache = await caches.open(AUDIO_CACHE);
        const existing = await cache.match(absUrl);
        if (!existing) {
          const res = await fetch(absUrl);
          if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
            touchAudioCacheEntry(absUrl);
            await cache.put(absUrl, res);
            await trimAudioCache(cache);
          }
          return;
        }
        const headRes = await fetch(absUrl, { method: "HEAD", cache: "no-cache" }).catch(() => null);
        if (headRes && (headRes.status === 404 || headRes.status === 410)) {
          audioLruMap.delete(absUrl);
          await cache.delete(absUrl);
          return;
        }
        if (hasCachedAudioMetadataChanged(existing, headRes)) {
          const freshRes = await fetch(absUrl, { cache: "no-cache" });
          if (freshRes && freshRes.status === 200 && (freshRes.type === "basic" || freshRes.type === "cors")) {
            touchAudioCacheEntry(absUrl);
            await cache.put(absUrl, freshRes);
            await trimAudioCache(cache);
          }
        } else {
          touchAudioCacheEntry(absUrl);
        }
      } catch (e) { /* ignore offline cache error */ }
    })());
  }
  if (data.type === "CLEAR_AUDIO_CACHE") {
    audioLruMap.clear();
    if (audioLruPersistTimer) {
      clearTimeout(audioLruPersistTimer);
      audioLruPersistTimer = null;
    }
    event.waitUntil(
      Promise.all([
        caches.delete(AUDIO_CACHE),
        caches.open(DATA_CACHE).then((c) => c.delete(AUDIO_LRU_KEY)).catch(() => false),
      ]).then(() => {
        if (event.ports && event.ports[0]) event.ports[0].postMessage({ cleared: true });
      })
    );
  }
  if (data.type === "GET_CACHE_STATS") {
    event.waitUntil(
      caches.open(AUDIO_CACHE).then((c) => c.keys()).then((keys) => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ audioCount: keys.length, version: VERSION });
        }
      })
    );
  }
});
