/**
 * Music Box Cloudflare R2 Read-Only Gateway Worker + 80% Free-Tier Quota Shield
 *
 * Security & Zero-Overage model:
 * - Strictly read-only (GET / HEAD / OPTIONS only); never calls bucket.put/delete/list.
 * - Strict Origin / Referer allowlist (no wildcard CORS) to block third-party hotlinking & scraping.
 * - Extension + path whitelist on /media/* prevents traversal, hidden files, or non-media reads.
 * - Single-operation R2 reads (`bucket.get` with `range` + `onlyIf` headers) cut Class B ops by 50%.
 * - Autonomous 80% Free-Tier Circuit Breaker (`MUSIC_QUOTA_KV` + optional GraphQL billing sync):
 *   stops ALL R2 access (`503 Quota Shield Active`) before hitting free limits:
 *   * Daily Worker requests >= 80,000 (80% of 100,000/day Workers Free cap)
 *   * Monthly R2 Class B reads >= 8,000,000 (80% of 10,000,000/month free tier)
 *   * Monthly R2 Class A writes >= 800,000 (80% of 1,000,000/month free tier)
 *   * R2 Storage >= 8.0 GiB (80% of 10 GiB-month free tier)
 *   * Or manual kill-switch `GATEWAY_PAUSED === "1"`
 * - KV reads cached in isolate memory (15s) and batched on flush (<= ~550 writes/day) so KV itself stays well inside Free Tier (100k reads / 1k writes per day).
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
const QUOTA_STATE_KEY = "quota:state:v1";
const QUOTA_STORAGE_KEY = "quota:storage:v1";
const DEFAULT_QUOTA_CACHE_MS = 15000;
const DEFAULT_FLUSH_EVERY = 150;
const DEFAULT_FLUSH_INTERVAL_MS = 60000;
const MAX_DAILY_KV_WRITES = 850; // Stay safely under KV Free Tier 1,000 writes/day hard limit

const DEFAULT_LIMITS = {
  maxDailyRequests: 80000,
  maxMonthlyClassB: 8000000,
  maxMonthlyClassA: 800000,
  maxStorageBytes: 8 * 1024 * 1024 * 1024, // 8.0 GiB (80% of 10 GiB)
};

const R2_CLASS_B_ACTIONS = new Set([
  "GetObject",
  "HeadObject",
  "HeadBucket",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
  "GetBucketPolicy",
  "UsageSummary",
]);

const isolateTrackers = new WeakMap();

function parsePositiveInt(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getQuotaLimits(env) {
  return {
    maxDailyRequests: parsePositiveInt(env && env.MAX_DAILY_REQUESTS, DEFAULT_LIMITS.maxDailyRequests),
    maxMonthlyClassB: parsePositiveInt(env && env.MAX_MONTHLY_CLASS_B, DEFAULT_LIMITS.maxMonthlyClassB),
    maxMonthlyClassA: parsePositiveInt(env && env.MAX_MONTHLY_CLASS_A, DEFAULT_LIMITS.maxMonthlyClassA),
    maxStorageBytes: parsePositiveInt(env && env.MAX_STORAGE_BYTES, DEFAULT_LIMITS.maxStorageBytes),
  };
}

function currentUtcPeriods(now = new Date()) {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7), iso };
}

function createEmptyQuotaState(periods) {
  return {
    day: periods.day,
    month: periods.month,
    dailyReqs: 0,
    dailyKvWrites: 0,
    monthlyClassB: 0,
    monthlyClassA: 0,
    storageBytes: 0,
    tripped: false,
    reason: "",
    trippedAt: "",
    updatedAt: periods.iso,
    analyticsSyncedAt: "",
  };
}

function rollQuotaPeriods(state, now = new Date()) {
  const periods = currentUtcPeriods(now);
  const next = Object.assign(createEmptyQuotaState(periods), state || {});
  if (next.day !== periods.day) {
    next.day = periods.day;
    next.dailyReqs = 0;
    next.dailyKvWrites = 0;
    if (next.tripped && next.reason === "daily_requests") {
      next.tripped = false;
      next.reason = "";
      next.trippedAt = "";
    }
  }
  if (next.month !== periods.month) {
    next.month = periods.month;
    next.monthlyClassB = 0;
    next.monthlyClassA = 0;
    if (next.tripped && (next.reason === "monthly_class_b" || next.reason === "monthly_class_a")) {
      next.tripped = false;
      next.reason = "";
      next.trippedAt = "";
    }
  }
  return next;
}

function reconcileQuotaState(state, env, now = new Date()) {
  const next = rollQuotaPeriods(state, now);
  const limits = getQuotaLimits(env);
  if (next.tripped) {
    const stillOver =
      (next.reason === "storage_limit" && (next.storageBytes || 0) >= limits.maxStorageBytes) ||
      (next.reason === "daily_requests" && (next.dailyReqs || 0) >= limits.maxDailyRequests) ||
      (next.reason === "monthly_class_b" && (next.monthlyClassB || 0) >= limits.maxMonthlyClassB) ||
      (next.reason === "monthly_class_a" && (next.monthlyClassA || 0) >= limits.maxMonthlyClassA);
    if (!stillOver) {
      next.tripped = false;
      next.reason = "";
      next.trippedAt = "";
    }
  }
  return next;
}

function applyRemoteStorageRecord(base, remoteStorage) {
  if (!remoteStorage || !Number.isFinite(Number(remoteStorage.bytes))) return base;
  const syncBytes = Math.max(0, Number(remoteStorage.bytes));
  const syncTs = String(remoteStorage.updatedAt || "");
  const analyticsTs = String(base.analyticsSyncedAt || "");
  if (!analyticsTs || (syncTs && syncTs >= analyticsTs)) {
    base.storageBytes = syncBytes;
  } else {
    base.storageBytes = Math.max(base.storageBytes || 0, syncBytes);
  }
  return base;
}

function getIsolateTracker(env) {
  const key = (env && env.MUSIC_QUOTA_KV) || env;
  if (!key || typeof key !== "object") {
    return {
      loadedAt: 0,
      state: null,
      pendingReqs: 0,
      pendingClassB: 0,
      dirtySince: 0,
      flushing: null,
    };
  }
  let tracker = isolateTrackers.get(key);
  if (!tracker) {
    tracker = {
      loadedAt: 0,
      state: null,
      pendingReqs: 0,
      pendingClassB: 0,
      dirtySince: 0,
      flushing: null,
    };
    isolateTrackers.set(key, tracker);
  }
  return tracker;
}

async function readKvJson(kv, key) {
  if (!kv || typeof kv.get !== "function") return null;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw);
    if (typeof raw === "object") return raw;
    return null;
  } catch {
    return null;
  }
}

async function loadQuotaSnapshot(env, now = new Date()) {
  const tracker = getIsolateTracker(env);
  const cacheMs = env && env.QUOTA_CACHE_MS !== undefined
    ? Math.max(0, Number(env.QUOTA_CACHE_MS) || 0)
    : DEFAULT_QUOTA_CACHE_MS;
  const nowMs = now.getTime();
  const kv = env && env.MUSIC_QUOTA_KV;

  if (!tracker.state || nowMs - tracker.loadedAt >= cacheMs) {
    let base = createEmptyQuotaState(currentUtcPeriods(now));
    if (kv) {
      const [remoteState, remoteStorage] = await Promise.all([
        readKvJson(kv, QUOTA_STATE_KEY),
        readKvJson(kv, QUOTA_STORAGE_KEY),
      ]);
      if (remoteState && typeof remoteState === "object") {
        base = Object.assign(base, remoteState);
      }
      applyRemoteStorageRecord(base, remoteStorage);
    }
    tracker.state = reconcileQuotaState(base, env, now);
    tracker.loadedAt = nowMs;
  } else {
    tracker.state = reconcileQuotaState(tracker.state, env, now);
  }
  return tracker;
}

function evaluateQuotaShield(tracker, env) {
  const limits = getQuotaLimits(env);
  const s = tracker.state;
  const effectiveDailyReqs = (s.dailyReqs || 0) + (tracker.pendingReqs || 0);
  const effectiveClassB = (s.monthlyClassB || 0) + (tracker.pendingClassB || 0);
  const effectiveClassA = s.monthlyClassA || 0;
  const storageBytes = s.storageBytes || 0;

  let reason = "";
  if (String((env && env.GATEWAY_PAUSED) || "0") === "1") {
    reason = "manual_pause";
  } else if (s.tripped && s.reason) {
    reason = s.reason;
  } else if (storageBytes >= limits.maxStorageBytes) {
    reason = "storage_limit";
  } else if (effectiveClassB >= limits.maxMonthlyClassB) {
    reason = "monthly_class_b";
  } else if (effectiveClassA >= limits.maxMonthlyClassA) {
    reason = "monthly_class_a";
  } else if (effectiveDailyReqs >= limits.maxDailyRequests) {
    reason = "daily_requests";
  }

  return {
    shielded: !!reason,
    reason,
    limits,
    usage: {
      dailyReqs: effectiveDailyReqs,
      monthlyClassB: effectiveClassB,
      monthlyClassA: effectiveClassA,
      storageBytes,
    },
    percent: {
      dailyRequests: Number(((effectiveDailyReqs / limits.maxDailyRequests) * 100).toFixed(2)),
      monthlyClassB: Number(((effectiveClassB / limits.maxMonthlyClassB) * 100).toFixed(2)),
      monthlyClassA: Number(((effectiveClassA / limits.maxMonthlyClassA) * 100).toFixed(2)),
      storage: Number(((storageBytes / limits.maxStorageBytes) * 100).toFixed(2)),
    },
  };
}

async function flushQuotaTracker(env, tracker, forceTripReason = "", now = new Date()) {
  const kv = env && env.MUSIC_QUOTA_KV;
  if (!kv || typeof kv.put !== "function") return;
  if (tracker.flushing) {
    await tracker.flushing;
  }

  const doFlush = async () => {
    const addReqs = tracker.pendingReqs;
    const addClassB = tracker.pendingClassB;
    if (!forceTripReason && addReqs === 0 && addClassB === 0) return;

    const periods = currentUtcPeriods(now);
    const [latestRemote, latestStorage] = await Promise.all([
      readKvJson(kv, QUOTA_STATE_KEY),
      readKvJson(kv, QUOTA_STORAGE_KEY),
    ]);
    const baseState = Object.assign({}, tracker.state || createEmptyQuotaState(periods), latestRemote || {});
    applyRemoteStorageRecord(baseState, latestStorage);
    const merged = reconcileQuotaState(baseState, env, now);

    merged.dailyReqs += addReqs;
    merged.monthlyClassB += addClassB;
    merged.updatedAt = periods.iso;
    if (forceTripReason) {
      merged.tripped = true;
      merged.reason = forceTripReason;
      merged.trippedAt = merged.trippedAt || periods.iso;
    }

    tracker.pendingReqs = Math.max(0, tracker.pendingReqs - addReqs);
    tracker.pendingClassB = Math.max(0, tracker.pendingClassB - addClassB);
    tracker.dirtySince = tracker.pendingReqs > 0 ? now.getTime() : 0;

    if ((merged.dailyKvWrites || 0) < MAX_DAILY_KV_WRITES) {
      merged.dailyKvWrites = (merged.dailyKvWrites || 0) + 1;
      try {
        await kv.put(QUOTA_STATE_KEY, JSON.stringify(merged));
      } catch (err) {
        console.warn("KV quota write failed:", err);
      }
    }
    tracker.state = merged;
    tracker.loadedAt = now.getTime();
  };

  tracker.flushing = doFlush().finally(() => {
    tracker.flushing = null;
  });
  await tracker.flushing;
}

function scheduleOrAwaitFlush(env, ctx, tracker, reqDelta, classBDelta, now = new Date()) {
  tracker.pendingReqs += reqDelta;
  tracker.pendingClassB += classBDelta;
  if (!tracker.dirtySince && (tracker.pendingReqs > 0 || tracker.pendingClassB > 0)) {
    tracker.dirtySince = now.getTime();
  }

  const evaluation = evaluateQuotaShield(tracker, env);
  const flushEvery = parsePositiveInt(env && env.QUOTA_FLUSH_EVERY, DEFAULT_FLUSH_EVERY);
  const flushIntervalMs = parsePositiveInt(env && env.QUOTA_FLUSH_INTERVAL_MS, DEFAULT_FLUSH_INTERVAL_MS);
  const dirtyAge = tracker.dirtySince ? now.getTime() - tracker.dirtySince : 0;

  if (
    evaluation.shielded ||
    tracker.pendingReqs >= flushEvery ||
    (dirtyAge >= flushIntervalMs && tracker.pendingReqs > 0)
  ) {
    const tripReason = evaluation.shielded && !tracker.state.tripped && evaluation.reason !== "manual_pause"
      ? evaluation.reason
      : "";
    const p = flushQuotaTracker(env, tracker, tripReason, now);
    if (ctx && typeof ctx.waitUntil === "function" && !tripReason) {
      ctx.waitUntil(p);
      return Promise.resolve();
    }
    return p;
  }
  return Promise.resolve();
}

function quotaShieldResponse(evaluation, corsOrigin, now = new Date()) {
  const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  const retryAfterSec = evaluation.reason === "daily_requests"
    ? Math.max(60, Math.ceil((nextUtcMidnight - now.getTime()) / 1000))
    : 3600;
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": String(retryAfterSec),
  });
  applySecurityHeaders(headers, corsOrigin);
  return new Response(
    JSON.stringify({
      error: "Quota shield active (>=80% free tier limit reached)",
      shielded: true,
      reason: evaluation.reason,
      usage: evaluation.usage,
      limits: evaluation.limits,
      percent: evaluation.percent,
      retryAfterSec,
    }),
    { status: 503, headers }
  );
}

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

function isRangeHeaderSyntacticallyValid(rangeHeader) {
  if (!rangeHeader) return true;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return false;
  if (m[1] === "" && m[2] === "") return false;
  if (m[1] !== "" && m[2] !== "" && Number(m[1]) > Number(m[2])) return false;
  if (m[1] === "" && Number(m[2]) <= 0) return false;
  return true;
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

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const originState = resolveAllowedOrigin(request, env);
  const now = new Date();

  if (url.pathname === "/health") {
    const tracker = await loadQuotaSnapshot(env, now);
    const evaluation = evaluateQuotaShield(tracker, env);
    return jsonResponse(
      {
        ok: !evaluation.shielded,
        service: "music-box-r2-gateway",
        protected: !!(env && env.ACCESS_KEY),
        shielded: evaluation.shielded,
        reason: evaluation.reason || null,
      },
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

  const secret = String((env && env.ACCESS_KEY) || "");

  if (url.pathname === "/quota") {
    if (!originState.allowed) {
      const hasOriginContext = !!(request.headers.get("origin") || request.headers.get("referer"));
      const payload = hasOriginContext
        ? { error: "Forbidden origin" }
        : {
            error: "Forbidden origin",
            hint: "Direct browser visits send no Origin header. Check live quota inside Music Box Settings or send an allowed Origin header.",
          };
      return jsonResponse(payload, 403, originState.corsOrigin);
    }
    if (secret && !(await verifyOptionalAccessKey(request, env))) {
      return jsonResponse({ error: "Unauthorized" }, 401, originState.corsOrigin);
    }
    const tracker = await loadQuotaSnapshot(env, now);
    const evaluation = evaluateQuotaShield(tracker, env);
    return jsonResponse(
      {
        ok: !evaluation.shielded,
        shielded: evaluation.shielded,
        reason: evaluation.reason || null,
        day: tracker.state.day,
        month: tracker.state.month,
        limits: evaluation.limits,
        usage: evaluation.usage,
        percent: evaluation.percent,
        analyticsSyncedAt: tracker.state.analyticsSyncedAt || null,
      },
      200,
      originState.corsOrigin,
      "no-store"
    );
  }

  if (!env || !env.MUSIC_BUCKET) {
    return jsonResponse({ error: "R2 bucket binding missing" }, 500, originState.corsOrigin);
  }

  // Evaluate 80% Free-Tier Quota Shield BEFORE touching MUSIC_BUCKET
  const tracker = await loadQuotaSnapshot(env, now);
  const preEval = evaluateQuotaShield(tracker, env);
  if (preEval.shielded) {
    if (!tracker.state.tripped && preEval.reason !== "manual_pause") {
      await flushQuotaTracker(env, tracker, preEval.reason, now);
    }
    return quotaShieldResponse(preEval, originState.corsOrigin, now);
  }

  if (url.pathname.startsWith("/media/")) {
    const mediaSpec = sanitizeMediaKey(url.pathname.slice("/media/".length));
    if (!mediaSpec) {
      await scheduleOrAwaitFlush(env, ctx, tracker, 1, 0, now);
      return jsonResponse({ error: "Invalid media key" }, 400, originState.corsOrigin);
    }

    const hasValidSignedToken =
      secret && url.searchParams.has("sig") && (await verifySignedMediaOrKey(request, url, mediaSpec.key, env));
    if (!originState.allowed && !hasValidSignedToken) {
      await scheduleOrAwaitFlush(env, ctx, tracker, 1, 0, now);
      return jsonResponse({ error: "Forbidden origin" }, 403, originState.corsOrigin);
    }
    if (secret && !hasValidSignedToken && !(await verifyOptionalAccessKey(request, env))) {
      await scheduleOrAwaitFlush(env, ctx, tracker, 1, 0, now);
      return jsonResponse({ error: "Unauthorized" }, 401, originState.corsOrigin);
    }

    const rangeHeader = request.headers.get("range");
    if (!isRangeHeaderSyntacticallyValid(rangeHeader)) {
      await scheduleOrAwaitFlush(env, ctx, tracker, 1, 0, now);
      const badHeaders = new Headers();
      applySecurityHeaders(badHeaders, originState.corsOrigin);
      return new Response(null, { status: 416, headers: badHeaders });
    }

    if (method === "HEAD") {
      await scheduleOrAwaitFlush(env, ctx, tracker, 1, 1, now);
      const headObj = await env.MUSIC_BUCKET.head(mediaSpec.key);
      if (!headObj) {
        return jsonResponse({ error: "Not found" }, 404, originState.corsOrigin);
      }
      const headers = new Headers();
      if (typeof headObj.writeHttpMetadata === "function") headObj.writeHttpMetadata(headers);
      if (!headers.get("content-type")) headers.set("Content-Type", mediaSpec.mime);
      if (headObj.httpEtag) headers.set("ETag", headObj.httpEtag);
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", secret ? "private, max-age=3600" : "public, max-age=86400");
      applySecurityHeaders(headers, originState.corsOrigin);

      const parsedRange = parseByteRangeHeader(rangeHeader, headObj.size);
      if (parsedRange.kind === "invalid" || parsedRange.kind === "unsatisfiable") {
        headers.set("Content-Range", `bytes */${headObj.size}`);
        return new Response(null, { status: 416, headers });
      }
      if (parsedRange.kind === "valid") {
        headers.set("Content-Range", `bytes ${parsedRange.offset}-${parsedRange.end}/${headObj.size}`);
        headers.set("Content-Length", String(parsedRange.length));
        return new Response(null, { status: 206, headers });
      }
      headers.set("Content-Length", String(headObj.size));
      return new Response(null, { status: 200, headers });
    }

    // Single atomic R2 Class B get() with Range + If-None-Match headers (halves R2 Class B usage!)
    await scheduleOrAwaitFlush(env, ctx, tracker, 1, 1, now);
    let obj;
    try {
      const getOpts = { onlyIf: request.headers };
      if (rangeHeader) getOpts.range = request.headers;
      obj = await env.MUSIC_BUCKET.get(mediaSpec.key, getOpts);
    } catch (err) {
      const errMsg = String((err && err.message) || err || "");
      if (/10039|range|satisfiable/i.test(errMsg)) {
        const badHeaders = new Headers();
        applySecurityHeaders(badHeaders, originState.corsOrigin);
        return new Response(null, { status: 416, headers: badHeaders });
      }
      throw err;
    }

    if (!obj) {
      return jsonResponse({ error: "Not found" }, 404, originState.corsOrigin);
    }

    const headers = new Headers();
    if (typeof obj.writeHttpMetadata === "function") {
      obj.writeHttpMetadata(headers);
    }
    if (!headers.get("content-type")) headers.set("Content-Type", mediaSpec.mime);
    if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", secret ? "private, max-age=3600" : "public, max-age=86400");
    applySecurityHeaders(headers, originState.corsOrigin);

    if (rangeHeader && obj.range && (obj.range.offset >= obj.size || obj.range.length <= 0)) {
      headers.set("Content-Range", `bytes */${obj.size}`);
      return new Response(null, { status: 416, headers });
    }

    if (!obj.body) {
      return new Response(null, { status: 304, headers });
    }

    if (rangeHeader && obj.range) {
      const endByte = obj.range.end !== undefined
        ? obj.range.end
        : obj.range.offset + obj.range.length - 1;
      headers.set("Content-Range", `bytes ${obj.range.offset}-${endByte}/${obj.size}`);
      headers.set("Content-Length", String(obj.range.length));
      return new Response(obj.body, { status: 206, headers });
    }

    headers.set("Content-Length", String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  }

  if (!originState.allowed) {
    await scheduleOrAwaitFlush(env, ctx, tracker, 1, 0, now);
    return jsonResponse({ error: "Forbidden origin" }, 403, originState.corsOrigin);
  }
  if (secret && !(await verifyOptionalAccessKey(request, env))) {
    await scheduleOrAwaitFlush(env, ctx, tracker, 1, 0, now);
    return jsonResponse({ error: "Unauthorized" }, 401, originState.corsOrigin);
  }

  if (url.pathname === "/manifest.json" || url.pathname === "/music.json") {
    await scheduleOrAwaitFlush(env, ctx, tracker, 1, 1, now);
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
    await scheduleOrAwaitFlush(env, ctx, tracker, 1, 1, now);
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

  await scheduleOrAwaitFlush(env, ctx, tracker, 1, 0, now);
  return jsonResponse({ error: "Not found" }, 404, originState.corsOrigin);
}

async function fetchCloudflareR2Telemetry(env, now = new Date()) {
  const token = String((env && env.CF_ANALYTICS_TOKEN) || "").trim();
  const accountId = String((env && env.CF_ACCOUNT_ID) || "").trim();
  if (!token || !accountId) return null;

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
  const storageSince = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const query = `
    query R2QuotaSync($accountTag: String!, $monthStart: Time!, $storageSince: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            filter: { datetime_geq: $monthStart }
            limit: 1000
          ) {
            dimensions { actionType }
            sum { requests }
          }
          r2StorageAdaptiveGroups(
            filter: { datetime_geq: $storageSince }
            limit: 100
          ) {
            dimensions { bucketName }
            max { payloadSize metadataSize }
          }
        }
      }
    }
  `;
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { accountTag: accountId, monthStart, storageSince },
    }),
  });
  if (!res.ok) return null;
  const payload = await res.json();
  const acct = payload && payload.data && payload.data.viewer && payload.data.viewer.accounts && payload.data.viewer.accounts[0];
  if (!acct) return null;

  let classA = 0;
  let classB = 0;
  for (const row of acct.r2OperationsAdaptiveGroups || []) {
    const action = row && row.dimensions && row.dimensions.actionType;
    const reqs = Number((row && row.sum && row.sum.requests) || 0);
    if (!action || !Number.isFinite(reqs)) continue;
    if (R2_CLASS_B_ACTIONS.has(action)) classB += reqs;
    else classA += reqs;
  }

  const targetBucket = String((env && env.R2_BUCKET_NAME) || "").trim();
  let storageBytes = 0;
  const bucketSeen = new Map();
  for (const row of acct.r2StorageAdaptiveGroups || []) {
    const bName = (row && row.dimensions && row.dimensions.bucketName) || "_default";
    if (targetBucket && bName !== targetBucket) continue;
    const total = Number((row && row.max && row.max.payloadSize) || 0) +
      Number((row && row.max && row.max.metadataSize) || 0);
    if (total > (bucketSeen.get(bName) || 0)) bucketSeen.set(bName, total);
  }
  for (const val of bucketSeen.values()) storageBytes += val;

  return { classA, classB, storageBytes, syncedAt: now.toISOString() };
}

export async function handleScheduled(event, env, ctx) {
  const now = new Date();
  const kv = env && env.MUSIC_QUOTA_KV;
  if (!kv || typeof kv.put !== "function") return;

  const tracker = await loadQuotaSnapshot(env, now);
  tracker.loadedAt = 0; // Force fresh remote read during cron reconciliation
  await loadQuotaSnapshot(env, now);

  const [telemetry, remoteStorage] = await Promise.all([
    fetchCloudflareR2Telemetry(env, now),
    readKvJson(kv, QUOTA_STORAGE_KEY),
  ]);
  const periods = currentUtcPeriods(now);
  let next = rollQuotaPeriods(tracker.state, now);

  if (telemetry) {
    next.monthlyClassB = Math.max(next.monthlyClassB || 0, telemetry.classB);
    next.monthlyClassA = Math.max(next.monthlyClassA || 0, telemetry.classA);
    next.storageBytes = telemetry.storageBytes;
    next.analyticsSyncedAt = telemetry.syncedAt;
  }
  applyRemoteStorageRecord(next, remoteStorage);
  next = reconcileQuotaState(next, env, now);
  next.updatedAt = periods.iso;

  tracker.state = next;
  const evalResult = evaluateQuotaShield(tracker, env);
  if (evalResult.shielded && evalResult.reason !== "manual_pause") {
    next.tripped = true;
    next.reason = evalResult.reason;
    next.trippedAt = next.trippedAt || periods.iso;
  }

  if ((next.dailyKvWrites || 0) < MAX_DAILY_KV_WRITES + 50) {
    next.dailyKvWrites = (next.dailyKvWrites || 0) + 1;
    try {
      await kv.put(QUOTA_STATE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("KV cron quota write failed:", err);
    }
  }
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};
