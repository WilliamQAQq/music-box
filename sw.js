const VERSION = "v36";
const SHELL_CACHE = "music-box-shell-" + VERSION;
const DATA_CACHE = "music-box-data-" + VERSION;
const AUDIO_CACHE = "music-box-audio-v2";
const MAX_CACHED_AUDIO = 18;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=36",
  "./js/catalog-data.js?v=36",
  "./js/user-state.js?v=36",
  "./js/library-loader.js?v=36",
  "./js/audio-fx.js?v=36",
  "./js/lyrics.js?v=36",
  "./js/studio-ui.js?v=36",
  "./app.js?v=36",
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
    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + total);
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Accept-Ranges", "bytes");
    return new Response(blob.slice(start, end + 1, mime), { status: 206, statusText: "Partial Content", headers });
  });
}

async function handleAudioRequest(request) {
  const rangeHeader = request.headers.get("range");
  const cleanReq = new Request(request.url, { method: "GET" });
  const cache = await caches.open(AUDIO_CACHE);

  const cached = await cache.match(cleanReq);
  if (cached && cached.status === 200) {
    return rangeHeader ? buildRangeResponse(cached, rangeHeader) : cached;
  }

  try {
    const netRes = await fetch(request);
    if (!rangeHeader && netRes && netRes.status === 200 && netRes.type === "basic") {
      cache.put(cleanReq, netRes.clone()).then(() => trimAudioCache(cache)).catch(() => {});
    }
    return netRes;
  } catch (err) {
    if (!cached) throw err;
    return rangeHeader ? buildRangeResponse(cached, rangeHeader) : cached;
  }
}

async function trimAudioCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHED_AUDIO;
  if (excess <= 0) return;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
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
            await cache.put(absUrl, res);
            await trimAudioCache(cache);
          }
        }
      } catch (e) { /* ignore offline cache error */ }
    })());
  }
  if (data.type === "CLEAR_AUDIO_CACHE") {
    event.waitUntil(
      caches.delete(AUDIO_CACHE).then(() => {
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
