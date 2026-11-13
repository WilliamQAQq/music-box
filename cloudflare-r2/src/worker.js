/**
 * Music Box Cloudflare R2 Read-Only Gateway Worker
 *
 * Security model:
 * - Strictly read-only (GET / HEAD / OPTIONS only); never calls bucket.put/delete/list.
 * - Strict Origin / Referer allowlist (no wildcard CORS) to block third-party hotlinking & scraping.
 * - Extension + path whitelist on /media/* prevents traversal, hidden files, or non-media reads.
 * - Full HTTP Byte-Range (206 Partial Content) + ETag support for <audio crossorigin="anonymous"> & Web Audio DSP.
 * - Optional ACCESS_KEY secret mode enables X-Music-Key protection and HMAC-SHA256 expiring media URLs.
 */

const MEDIA_MIME = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  flac: "audio/flac",
  webm: "audio/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const MAX_SIGNED_TTL_SEC = 6 * 3600;

function parseAllowedOrigins(env) {
  const raw = String((env && env.ALLOWED_ORIGINS) || "https://williamqaqq.github.io");
  const list = raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set(list);
}

function isLocalOrigin(origin) {
  try {
    const u = new URL(origin);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function resolveAllowedOrigin(request, env) {
  const allowedSet = parseAllowedOrigins(env);
  const allowLocal = String((env && env.ALLOW_LOCALHOST) || "0") === "1";
  const allowMissing = String((env && env.ALLOW_DIRECT_MEDIA) || "0") === "1";

  const checkOrigin = (candidate) => {
    if (!candidate) return null;
    const norm = candidate.trim().replace(/\/+$/, "");
    if (allowedSet.has(norm)) return norm;
    if (allowLocal && isLocalOrigin(norm)) return norm;
    return null;
  };

  const reqOrigin = request.headers.get("origin");
  if (reqOrigin) {
    const matched = checkOrigin(reqOrigin);
    return { allowed: !!matched, corsOrigin: matched || "" };
  }

  const reqReferer = request.headers.get("referer");
  if (reqReferer) {
    try {
      const refOrigin = new URL(reqReferer).origin;
      const matched = checkOrigin(refOrigin);
      return { allowed: !!matched, corsOrigin: matched || "" };
    } catch {
      return { allowed: false, corsOrigin: "" };
    }
  }

  // Fallback for missing Origin & Referer (direct curl/hotlink blocked unless explicitly allowed)
  return { allowed: allowMissing, corsOrigin: "" };
}

function applySecurityHeaders(headers, corsOrigin) {
  if (corsOrigin) {
    headers.set("Access-Control-Allow-Origin", corsOrigin);
  }
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Range, If-None-Match, If-Modified-Since, X-Music-Key, Authorization"
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length, ETag"
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
}

function sanitizeMediaKey(rawEncodedPath) {
  if (!rawEncodedPath || rawEncodedPath.length > 512) return null;
  const decodedSegments = [];
  for (const seg of rawEncodedPath.split("/")) {
    if (!seg) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.startsWith(".") ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      /[\x00-\x1f\x7f]/.test(decoded)
    ) {
      return null;
    }
    decodedSegments.push(decoded);
  }
  if (!decodedSegments.length) return null;
  const fullKey = decodedSegments.join("/");
  const dot = fullKey.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = fullKey.slice(dot + 1).toLowerCase();
  const mime = MEDIA_MIME[ext];
  if (!mime) return null;
  return { key: fullKey, mime };
}

function parseByteRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader) return { kind: "none" };
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return { kind: "invalid" };
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === "" && endRaw === "") return { kind: "invalid" };

  if (totalSize <= 0) return { kind: "unsatisfiable" };

  let start;
  let end;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: "invalid" };
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? totalSize - 1 : Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      return { kind: "invalid" };
    }
    if (start >= totalSize) return { kind: "unsatisfiable" };
    end = Math.min(end, totalSize - 1);
  }
  return { kind: "valid", offset: start, length: end - start + 1, end };
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(buf);
}

async function signMediaPayload(secret, key, expSec) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${key}\n${expSec}`)
  );
  return toHex(sigBuf);
}

function extractRequestKey(request) {
  const direct = request.headers.get("x-music-key");
  if (direct) return direct.trim();
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

async function verifyOptionalAccessKey(request, env) {
  const secret = String((env && env.ACCESS_KEY) || "");
  if (!secret) return true;
  const supplied = extractRequestKey(request);
  if (!supplied) return false;
  const [a, b] = await Promise.all([sha256Hex(secret), sha256Hex(supplied)]);
  return constantTimeEqualHex(a, b);
}

async function verifySignedMediaOrKey(request, url, key, env) {
  const secret = String((env && env.ACCESS_KEY) || "");
  if (!secret) return true;

  const expStr = url.searchParams.get("exp");
  const sigStr = url.searchParams.get("sig");
  if (expStr && sigStr) {
    const expSec = Number(expStr);
    const nowSec = Math.floor(Date.now() / 1000);
    if (Number.isFinite(expSec) && expSec >= nowSec && expSec <= nowSec + MAX_SIGNED_TTL_SEC + 300) {
      const expectedSig = await signMediaPayload(secret, key, expSec);
      if (constantTimeEqualHex(sigStr.toLowerCase(), expectedSig)) {
        return true;
      }
    }
    return false;
  }

  return verifyOptionalAccessKey(request, env);
}

function encodeR2Path(key) {
  return String(key || "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

async function attachSignedUrlsToManifest(list, originBase, secret) {
  const expSec = Math.floor(Date.now() / 1000) + MAX_SIGNED_TTL_SEC;
  return Promise.all(
    list.map(async (item) => {
      if (!item || typeof item !== "object") return item;
      const next = Object.assign({}, item);
      const rawPath = String(item.path || item.url || "").replace(/^\/+/, "");
      if (rawPath && !/^https?:\/\//i.test(rawPath)) {
        const sig = await signMediaPayload(secret, rawPath, expSec);
        next.path = rawPath;
        next.url = `${originBase}/media/${encodeR2Path(rawPath)}?exp=${expSec}&sig=${sig}`;
      }
      const rawCover = String(item.cover || "").replace(/^\/+/, "");
      if (rawCover && !/^https?:\/\//i.test(rawCover)) {
        const coverSig = await signMediaPayload(secret, rawCover, expSec);
        next.cover = `${originBase}/media/${encodeR2Path(rawCover)}?exp=${expSec}&sig=${coverSig}`;
      }
      return next;
    })
  );
}

function jsonResponse(data, status, corsOrigin, cacheControl = "no-store") {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
  });
  applySecurityHeaders(headers, corsOrigin);
  return new Response(JSON.stringify(data), { status, headers });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const originState = resolveAllowedOrigin(request, env);

  if (url.pathname === "/health") {
    return jsonResponse(
      { ok: true, service: "music-box-r2-gateway", protected: !!(env && env.ACCESS_KEY) },
      200,
      originState.corsOrigin,
      "no-store"
    );
  }

  if (method === "OPTIONS") {
    if (!originState.allowed || !originState.corsOrigin) {
      return new Response(null, { status: 403 });
    }
    const headers = new Headers({ "Access-Control-Max-Age": "86400" });
    applySecurityHeaders(headers, originState.corsOrigin);
    return new Response(null, { status: 204, headers });
  }

  if (method !== "GET" && method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed" }, 405, originState.corsOrigin);
  }

  if (!env || !env.MUSIC_BUCKET) {
    return jsonResponse({ error: "R2 bucket binding missing" }, 500, originState.corsOrigin);
  }

  const secret = String(env.ACCESS_KEY || "");
  if (url.pathname.startsWith("/media/")) {
    const mediaSpec = sanitizeMediaKey(url.pathname.slice("/media/".length));
    if (!mediaSpec) {
      return jsonResponse({ error: "Invalid media key" }, 400, originState.corsOrigin);
    }

    const hasValidSignedToken =
      secret && url.searchParams.has("sig") && (await verifySignedMediaOrKey(request, url, mediaSpec.key, env));
    if (!originState.allowed && !hasValidSignedToken) {
      return jsonResponse({ error: "Forbidden origin" }, 403, originState.corsOrigin);
    }
    if (secret && !hasValidSignedToken && !(await verifyOptionalAccessKey(request, env))) {
      return jsonResponse({ error: "Unauthorized" }, 401, originState.corsOrigin);
    }

    const headObj = await env.MUSIC_BUCKET.head(mediaSpec.key);
    if (!headObj) {
      return jsonResponse({ error: "Not found" }, 404, originState.corsOrigin);
    }

    const headers = new Headers();
    if (typeof headObj.writeHttpMetadata === "function") {
      headObj.writeHttpMetadata(headers);
    }
    if (!headers.get("content-type")) headers.set("Content-Type", mediaSpec.mime);
    if (headObj.httpEtag) headers.set("ETag", headObj.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", secret ? "private, max-age=3600" : "public, max-age=86400");
    applySecurityHeaders(headers, originState.corsOrigin);

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && headObj.httpEtag && ifNoneMatch === headObj.httpEtag) {
      return new Response(null, { status: 304, headers });
    }

    const rangeHeader = request.headers.get("range");
    const parsedRange = parseByteRangeHeader(rangeHeader, headObj.size);
    if (parsedRange.kind === "invalid" || parsedRange.kind === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${headObj.size}`);
      return new Response(null, { status: 416, headers });
    }

    if (method === "HEAD") {
      headers.set("Content-Length", String(parsedRange.kind === "valid" ? parsedRange.length : headObj.size));
      if (parsedRange.kind === "valid") {
        headers.set("Content-Range", `bytes ${parsedRange.offset}-${parsedRange.end}/${headObj.size}`);
        return new Response(null, { status: 206, headers });
      }
      return new Response(null, { status: 200, headers });
    }

    const getOpts = parsedRange.kind === "valid"
      ? { range: { offset: parsedRange.offset, length: parsedRange.length } }
      : {};
    const obj = await env.MUSIC_BUCKET.get(mediaSpec.key, getOpts);
    if (!obj || !obj.body) {
      return jsonResponse({ error: "Not found" }, 404, originState.corsOrigin);
    }

    if (parsedRange.kind === "valid") {
      headers.set("Content-Range", `bytes ${parsedRange.offset}-${parsedRange.end}/${headObj.size}`);
      headers.set("Content-Length", String(parsedRange.length));
      return new Response(obj.body, { status: 206, headers });
    }

    headers.set("Content-Length", String(headObj.size));
    return new Response(obj.body, { status: 200, headers });
  }

  if (!originState.allowed) {
    return jsonResponse({ error: "Forbidden origin" }, 403, originState.corsOrigin);
  }
  if (secret && !(await verifyOptionalAccessKey(request, env))) {
    return jsonResponse({ error: "Unauthorized" }, 401, originState.corsOrigin);
  }

  if (url.pathname === "/manifest.json" || url.pathname === "/music.json") {
    const obj = await env.MUSIC_BUCKET.get("manifest.json");
    if (!obj) {
      return jsonResponse([], 200, originState.corsOrigin, "public, max-age=30");
    }
    if (!secret && method === "HEAD") {
      const headers = new Headers({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      });
      if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
      applySecurityHeaders(headers, originState.corsOrigin);
      return new Response(null, { status: 200, headers });
    }
    const data = await obj.json();
    if (secret && Array.isArray(data)) {
      const signed = await attachSignedUrlsToManifest(data, url.origin, secret);
      return jsonResponse(signed, 200, originState.corsOrigin, "private, no-store");
    }
    return jsonResponse(data, 200, originState.corsOrigin, "public, max-age=60");
  }

  if (url.pathname === "/lyrics.json") {
    const obj = await env.MUSIC_BUCKET.get("lyrics.json");
    if (!obj || !obj.body) {
      return jsonResponse({}, 200, originState.corsOrigin, "public, max-age=60");
    }
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": secret ? "private, max-age=120" : "public, max-age=120",
    });
    if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
    applySecurityHeaders(headers, originState.corsOrigin);
    if (method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(obj.body, { status: 200, headers });
  }

  return jsonResponse({ error: "Not found" }, 404, originState.corsOrigin);
}

export default {
  fetch: handleRequest,
};
