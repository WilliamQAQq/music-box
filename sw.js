const VERSION = "v29";
const SHELL_CACHE = "music-box-shell-" + VERSION;
const DATA_CACHE = "music-box-data-" + VERSION;
const AUDIO_CACHE = "music-box-audio-v1";
const MAX_CACHED_AUDIO = 18;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=29",
  "./js/catalog-data.js?v=29",
  "./js/user-state.js?v=29",
  "./js/library-loader.js?v=29",
  "./js/audio-fx.js?v=29",
  "./js/lyrics.js?v=29",
  "./js/studio-ui.js?v=29",
  "./app.js?v=29",
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

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === "basic") {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
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
  if (net) return net;
  return caches.match("./index.html");
}

function buildRangeResponse(fullRes, rangeHeader) {
  return fullRes.arrayBuffer().then((buf) => {
    const total = buf.byteLength;
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || "");
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
    }
    const headers = new Headers(fullRes.headers);
    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + total);
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Accept-Ranges", "bytes");
    return new Response(buf.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers });
  });
}

async function handleAudioRequest(request) {
  const rangeHeader = request.headers.get("range");
  const cleanReq = new Request(request.url, { method: "GET" });
  const cache = await caches.open(AUDIO_CACHE);

  try {
    const netRes = await fetch(request);
    if (!rangeHeader && netRes && netRes.status === 200 && netRes.type === "basic") {
      cache.put(cleanReq, netRes.clone()).then(() => trimAudioCache(cache)).catch(() => {});
    }
    return netRes;
  } catch (err) {
    const cached = await cache.match(cleanReq);
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
        const absUrl = new URL(data.url, self.location.href).href;
        if (!absUrl.startsWith(self.location.origin)) return;
        const cache = await caches.open(AUDIO_CACHE);
        const existing = await cache.match(absUrl);
        if (!existing) {
          const res = await fetch(absUrl);
          if (res && res.ok) {
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
