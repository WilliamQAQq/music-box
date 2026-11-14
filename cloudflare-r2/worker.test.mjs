import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, handleScheduled } from "./src/worker.js";

function makeMockKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const stats = { gets: 0, puts: 0 };
  return {
    stats,
    store,
    async get(key) {
      stats.gets++;
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, val) {
      stats.puts++;
      store.set(key, String(val));
    },
  };
}

function makeMockBucket(objects) {
  const store = new Map(Object.entries(objects || {}));
  const ops = { heads: 0, gets: 0 };

  function materialize(entry) {
    return entry.body instanceof Uint8Array
      ? entry.body
      : new TextEncoder().encode(
          typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body)
        );
  }

  return {
    ops,
    async head(key) {
      ops.heads++;
      const entry = store.get(key);
      if (!entry) return null;
      const bytes = materialize(entry);
      return {
        key,
        size: bytes.byteLength,
        httpEtag: entry.etag || `"etag-${key}"`,
        writeHttpMetadata(headers) {
          if (entry.contentType) headers.set("Content-Type", entry.contentType);
        },
      };
    },
    async get(key, opts = {}) {
      ops.gets++;
      const entry = store.get(key);
      if (!entry) return null;
      const bytes = materialize(entry);
      const etag = entry.etag || `"etag-${key}"`;

      // Emulate Cloudflare R2 `onlyIf: Headers`
      if (opts && opts.onlyIf instanceof Headers) {
        const ifNoneMatch = opts.onlyIf.get("if-none-match");
        if (ifNoneMatch && ifNoneMatch === etag) {
          return {
            key,
            size: bytes.byteLength,
            httpEtag: etag,
            body: null,
            writeHttpMetadata(headers) {
              if (entry.contentType) headers.set("Content-Type", entry.contentType);
            },
          };
        }
      }

      let slice = bytes;
      let rangeMeta;
      if (opts && opts.range) {
        let offset = 0;
        let length = bytes.byteLength;
        if (opts.range instanceof Headers) {
          const rh = opts.range.get("range");
          if (rh) {
            const m = /^bytes=(\d*)-(\d*)$/i.exec(rh.trim());
            if (!m) throw new Error("10039 Invalid range header");
            if (m[1] === "") {
              const suffix = Number(m[2]);
              offset = Math.max(0, bytes.byteLength - suffix);
              length = bytes.byteLength - offset;
            } else {
              offset = Number(m[1]);
              const end = m[2] === "" ? bytes.byteLength - 1 : Math.min(Number(m[2]), bytes.byteLength - 1);
              if (offset >= bytes.byteLength) {
                return {
                  key,
                  size: bytes.byteLength,
                  httpEtag: etag,
                  range: { offset, length: 0 },
                  body: null,
                  writeHttpMetadata(headers) {
                    if (entry.contentType) headers.set("Content-Type", entry.contentType);
                  },
                };
              }
              length = end - offset + 1;
            }
          }
        } else if (Number.isFinite(opts.range.offset)) {
          offset = opts.range.offset;
          length = Number.isFinite(opts.range.length) ? opts.range.length : bytes.byteLength - offset;
        }
        slice = bytes.subarray(offset, offset + length);
        rangeMeta = { offset, length, end: offset + length - 1 };
      }

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        },
      });
      return {
        key,
        size: bytes.byteLength,
        httpEtag: etag,
        range: rangeMeta,
        body: stream,
        async json() {
          return JSON.parse(new TextDecoder().decode(bytes));
        },
        writeHttpMetadata(headers) {
          if (entry.contentType) headers.set("Content-Type", entry.contentType);
        },
      };
    },
  };
}

function makeEnv(extra = {}) {
  const sampleAudio = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const sampleManifest = [
    {
      name: "Test Track.mp3",
      title: "Test Track",
      artist: "Tester",
      genre: "民谣诗篇",
      path: "民谣诗篇/Test Track.mp3",
      url: "民谣诗篇/Test Track.mp3",
      cover: "民谣诗篇/cover.jpg",
    },
  ];
  const sampleLyrics = {
    "民谣诗篇/Test Track.mp3": {
      type: "lrc",
      lrc: "[00:01.00]Hello R2",
    },
  };
  return Object.assign(
    {
      ALLOWED_ORIGINS: "https://williamqaqq.github.io",
      ALLOW_LOCALHOST: "1",
      MUSIC_BUCKET: makeMockBucket({
        "manifest.json": { body: sampleManifest, contentType: "application/json", etag: '"m1"' },
        "lyrics.json": { body: sampleLyrics, contentType: "application/json", etag: '"l1"' },
        "民谣诗篇/Test Track.mp3": { body: sampleAudio, contentType: "audio/mpeg", etag: '"a1"' },
        "民谣诗篇/cover.jpg": {
          body: new Uint8Array([255, 216, 255, 217]),
          contentType: "image/jpeg",
          etag: '"c1"',
        },
      }),
    },
    extra
  );
}

test("/health reports public or protected mode", async () => {
  const resPublic = await handleRequest(new Request("https://worker.example/health"), makeEnv());
  assert.equal(resPublic.status, 200);
  assert.deepEqual(await resPublic.json(), {
    ok: true,
    service: "music-box-r2-gateway",
    protected: false,
    shielded: false,
    reason: null,
  });

  const resProt = await handleRequest(
    new Request("https://worker.example/health"),
    makeEnv({ ACCESS_KEY: "secret-key" })
  );
  assert.equal((await resProt.json()).protected, true);
});

test("rejects disallowed methods and disallowed or missing origins", async () => {
  const env = makeEnv();

  const postRes = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      method: "POST",
      headers: { Origin: "https://williamqaqq.github.io" },
    }),
    env
  );
  assert.equal(postRes.status, 405);

  const evilRes = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      headers: { Origin: "https://evil-hotlink.example" },
    }),
    env
  );
  assert.equal(evilRes.status, 403);

  const noOriginRes = await handleRequest(new Request("https://worker.example/manifest.json"), env);
  assert.equal(noOriginRes.status, 403);

  const evilPreflight = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      method: "OPTIONS",
      headers: { Origin: "https://evil-hotlink.example" },
    }),
    env
  );
  assert.equal(evilPreflight.status, 403);

  const okPreflight = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      method: "OPTIONS",
      headers: { Origin: "https://williamqaqq.github.io" },
    }),
    env
  );
  assert.equal(okPreflight.status, 204);
  assert.equal(okPreflight.headers.get("Access-Control-Allow-Origin"), "https://williamqaqq.github.io");
});

test("allows Referer fallback and configured localhost origins", async () => {
  const env = makeEnv();
  const refRes = await handleRequest(
    new Request("https://worker.example/lyrics.json", {
      headers: { Referer: "https://williamqaqq.github.io/music-box/" },
    }),
    env
  );
  assert.equal(refRes.status, 200);
  const lyrics = await refRes.json();
  assert.equal(lyrics["民谣诗篇/Test Track.mp3"].lrc, "[00:01.00]Hello R2");

  const localRes = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      headers: { Origin: "http://127.0.0.1:8765" },
    }),
    env
  );
  assert.equal(localRes.status, 200);
  assert.equal(localRes.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8765");

  const localDenied = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      headers: { Origin: "http://127.0.0.1:8765" },
    }),
    makeEnv({ ALLOW_LOCALHOST: "0" })
  );
  assert.equal(localDenied.status, 403);
});

test("sanitizes /media/ paths against traversal, hidden files, and unsupported extensions", async () => {
  const env = makeEnv();
  const headers = { Origin: "https://williamqaqq.github.io" };

  // WHATWG URL resolves unencoded / encoded dot segments out of /media/ -> 404 catch-all
  for (const resolvedAway of ["/media/../secret.txt", "/media/%2e%2e/secret.mp3"]) {
    const res = await handleRequest(new Request(`https://worker.example${resolvedAway}`, { headers }), env);
    assert.equal(res.status, 404, `Expected 404 for ${resolvedAway}, got ${res.status}`);
  }

  for (const badPath of [
    "/media/folder%2f..%2fsecret.mp3",
    "/media/%2e/manifest.json",
    "/media/.r2-sync-state.json",
    "/media/notes.txt",
    "/media/sub%5cevil.mp3",
    "/media/",
  ]) {
    const res = await handleRequest(new Request(`https://worker.example${badPath}`, { headers }), env);
    assert.equal(res.status, 400, `Expected 400 for ${badPath}, got ${res.status}`);
  }
});

test("serves full GET, Byte-Range 206, 416, 304 ETag, and HEAD for media", async () => {
  const env = makeEnv();
  const mediaUrl =
    "https://worker.example/media/" + encodeURIComponent("民谣诗篇") + "/" + encodeURIComponent("Test Track.mp3");
  const originHeaders = { Origin: "https://williamqaqq.github.io" };

  const fullRes = await handleRequest(new Request(mediaUrl, { headers: originHeaders }), env);
  assert.equal(fullRes.status, 200);
  assert.equal(fullRes.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(fullRes.headers.get("Accept-Ranges"), "bytes");
  assert.equal(fullRes.headers.get("Content-Length"), "10");
  assert.equal(fullRes.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal(fullRes.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(Array.from(new Uint8Array(await fullRes.arrayBuffer())), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const rangeRes = await handleRequest(
    new Request(mediaUrl, { headers: { ...originHeaders, Range: "bytes=2-5" } }),
    env
  );
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get("Content-Range"), "bytes 2-5/10");
  assert.equal(rangeRes.headers.get("Content-Length"), "4");
  assert.deepEqual(Array.from(new Uint8Array(await rangeRes.arrayBuffer())), [2, 3, 4, 5]);

  const badRangeRes = await handleRequest(
    new Request(mediaUrl, { headers: { ...originHeaders, Range: "bytes=50-99" } }),
    env
  );
  assert.equal(badRangeRes.status, 416);
  assert.equal(badRangeRes.headers.get("Content-Range"), "bytes */10");

  const notModRes = await handleRequest(
    new Request(mediaUrl, { headers: { ...originHeaders, "If-None-Match": '"a1"' } }),
    env
  );
  assert.equal(notModRes.status, 304);

  const headRes = await handleRequest(
    new Request(mediaUrl, { method: "HEAD", headers: { ...originHeaders, Range: "bytes=0-3" } }),
    env
  );
  assert.equal(headRes.status, 206);
  assert.equal(headRes.headers.get("Content-Range"), "bytes 0-3/10");
});

test("enforces optional ACCESS_KEY and verifies HMAC-SHA256 signed media URLs", async () => {
  const env = makeEnv({ ACCESS_KEY: "super-secret-passphrase" });
  const originHeaders = { Origin: "https://williamqaqq.github.io" };

  const noKeyManifest = await handleRequest(
    new Request("https://worker.example/manifest.json", { headers: originHeaders }),
    env
  );
  assert.equal(noKeyManifest.status, 401);

  const wrongKeyManifest = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      headers: { ...originHeaders, "X-Music-Key": "wrong" },
    }),
    env
  );
  assert.equal(wrongKeyManifest.status, 401);

  const signedManifestRes = await handleRequest(
    new Request("https://worker.example/manifest.json", {
      headers: { ...originHeaders, "X-Music-Key": "super-secret-passphrase" },
    }),
    env
  );
  assert.equal(signedManifestRes.status, 200);
  const signedList = await signedManifestRes.json();
  assert.equal(signedList.length, 1);
  assert.match(signedList[0].url, /^https:\/\/worker\.example\/media\/.*\?exp=\d+&sig=[0-9a-f]{64}$/);
  assert.match(signedList[0].cover, /^https:\/\/worker\.example\/media\/.*\?exp=\d+&sig=[0-9a-f]{64}$/);

  // Browser <audio> can stream signed media URL cleanly
  const signedAudioRes = await handleRequest(
    new Request(signedList[0].url, { headers: originHeaders }),
    env
  );
  assert.equal(signedAudioRes.status, 200);
  assert.equal(signedAudioRes.headers.get("Cache-Control"), "private, max-age=3600");

  // Tampered signature rejected
  const tamperedUrl = signedList[0].url.replace(/sig=([0-9a-f]{4})/, "sig=0000");
  const tamperedRes = await handleRequest(
    new Request(tamperedUrl === signedList[0].url ? `${signedList[0].url}0` : tamperedUrl, {
      headers: originHeaders,
    }),
    env
  );
  assert.equal(tamperedRes.status, 401);

  // Unsigned direct media access without key rejected
  const unsignedMediaRes = await handleRequest(
    new Request(
      "https://worker.example/media/" + encodeURIComponent("民谣诗篇") + "/" + encodeURIComponent("Test Track.mp3"),
      { headers: originHeaders }
    ),
    env
  );
  assert.equal(unsignedMediaRes.status, 401);
});

test("single atomic GET halves R2 Class B ops & 80% quota shield trips at limit cleanly", async () => {
  const originHeaders = { Origin: "https://williamqaqq.github.io" };
  const kv = makeMockKv();
  const env = makeEnv({
    MUSIC_QUOTA_KV: kv,
    MAX_DAILY_REQUESTS: "3",
    MAX_MONTHLY_CLASS_B: "8000000",
    MAX_STORAGE_BYTES: "8589934592",
    QUOTA_FLUSH_EVERY: "100",
  });
  const mediaUrl =
    "https://worker.example/media/" + encodeURIComponent("民谣诗篇") + "/" + encodeURIComponent("Test Track.mp3");

  // 1st + 2nd + 3rd requests succeed with ONLY 1 R2 .get() per GET and 0 .head() calls
  for (let i = 0; i < 3; i++) {
    const res = await handleRequest(new Request(mediaUrl, { headers: originHeaders }), env);
    assert.equal(res.status, 200);
  }
  assert.equal(env.MUSIC_BUCKET.ops.heads, 0, "GET /media/* must not call bucket.head()");
  assert.equal(env.MUSIC_BUCKET.ops.gets, 3, "Each GET /media/* uses exactly 1 R2 Class B get()");

  // 4th request must hit the 80% circuit breaker (503) BEFORE touching R2!
  const blockedRes = await handleRequest(new Request(mediaUrl, { headers: originHeaders }), env);
  assert.equal(blockedRes.status, 503);
  const blockedBody = await blockedRes.json();
  assert.equal(blockedBody.shielded, true);
  assert.equal(blockedBody.reason, "daily_requests");
  assert.equal(env.MUSIC_BUCKET.ops.gets, 3, "Bucket must NOT be touched after quota shield trips");
  assert.equal(blockedRes.headers.get("Access-Control-Allow-Origin"), "https://williamqaqq.github.io");

  // /quota endpoint stays accessible and reports 100% of cap reached
  const quotaRes = await handleRequest(
    new Request("https://worker.example/quota", { headers: originHeaders }),
    env
  );
  assert.equal(quotaRes.status, 200);
  const quotaInfo = await quotaRes.json();
  assert.equal(quotaInfo.shielded, true);
  assert.equal(quotaInfo.reason, "daily_requests");
  assert.equal(quotaInfo.usage.dailyReqs, 3);
});

test("trips 80% shield on storage limit, manual pause, and monthly Class B GraphQL cron sync", async () => {
  const originHeaders = { Origin: "https://williamqaqq.github.io" };

  // Manual kill-switch blocks immediately with 0 R2 ops
  const pausedEnv = makeEnv({ GATEWAY_PAUSED: "1" });
  const pausedRes = await handleRequest(
    new Request("https://worker.example/manifest.json", { headers: originHeaders }),
    pausedEnv
  );
  assert.equal(pausedRes.status, 503);
  assert.equal((await pausedRes.json()).reason, "manual_pause");
  assert.equal(pausedEnv.MUSIC_BUCKET.ops.gets, 0);

  // Storage cap via quota:storage:v1 KV key blocks when >= 8.0 GiB (custom threshold for unit test)
  const storageKv = makeMockKv({
    "quota:storage:v1": JSON.stringify({ bytes: 900 }),
  });
  const storageEnv = makeEnv({
    MUSIC_QUOTA_KV: storageKv,
    MAX_STORAGE_BYTES: "800",
  });
  const storageRes = await handleRequest(
    new Request("https://worker.example/manifest.json", { headers: originHeaders }),
    storageEnv
  );
  assert.equal(storageRes.status, 503);
  assert.equal((await storageRes.json()).reason, "storage_limit");
  assert.equal(storageEnv.MUSIC_BUCKET.ops.gets, 0);

  // Scheduled cron sync reconciles Cloudflare GraphQL telemetry & trips monthly Class B >= 80%
  const cronKv = makeMockKv();
  const cronEnv = makeEnv({
    MUSIC_QUOTA_KV: cronKv,
    CF_ANALYTICS_TOKEN: "dummy-analytics-token",
    CF_ACCOUNT_ID: "acct-123",
    MAX_MONTHLY_CLASS_B: "8000000",
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.cloudflare.com/client/v4/graphql");
    return new Response(
      JSON.stringify({
        data: {
          viewer: {
            accounts: [
              {
                r2OperationsAdaptiveGroups: [
                  { dimensions: { actionType: "GetObject" }, sum: { requests: 8000500 } },
                  { dimensions: { actionType: "PutObject" }, sum: { requests: 250 } },
                ],
                r2StorageAdaptiveGroups: [
                  { dimensions: { bucketName: "music-box-audio" }, max: { payloadSize: 5000000, metadataSize: 1024 } },
                ],
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  try {
    await handleScheduled({}, cronEnv, {});
  } finally {
    globalThis.fetch = origFetch;
  }

  const afterCronRes = await handleRequest(
    new Request("https://worker.example/manifest.json", { headers: originHeaders }),
    cronEnv
  );
  assert.equal(afterCronRes.status, 503);
  const body = await afterCronRes.json();
  assert.equal(body.reason, "monthly_class_b");
  assert.equal(body.usage.monthlyClassB, 8000500);
  assert.equal(cronEnv.MUSIC_BUCKET.ops.gets, 0);
});

test("auto-clears storage_limit trip after pruning and survives transient KV write errors", async () => {
  const originHeaders = { Origin: "https://williamqaqq.github.io" };

  // Start with latched storage_limit trip from prior overload, then simulate --prune reducing bytes below cap
  const kv = makeMockKv({
    "quota:state:v1": JSON.stringify({
      day: new Date().toISOString().slice(0, 10),
      month: new Date().toISOString().slice(0, 7),
      dailyReqs: 5,
      dailyKvWrites: 1,
      monthlyClassB: 5,
      monthlyClassA: 0,
      storageBytes: 950,
      analyticsSyncedAt: "2026-11-01T00:00:00.000Z",
      tripped: true,
      reason: "storage_limit",
      trippedAt: "2026-11-01T00:00:00.000Z",
    }),
    "quota:storage:v1": JSON.stringify({
      bytes: 400,
      updatedAt: "2026-11-10T00:00:00.000Z",
    }),
  });
  const env = makeEnv({
    MUSIC_QUOTA_KV: kv,
    MAX_STORAGE_BYTES: "800",
    QUOTA_CACHE_MS: "0",
  });

  const healedRes = await handleRequest(
    new Request("https://worker.example/manifest.json", { headers: originHeaders }),
    env
  );
  assert.equal(healedRes.status, 200, "Pruning storage below 80% cap must auto-clear tripped storage_limit");

  // Transient KV put failure must NOT crash media playback with 500
  const flakyKv = makeMockKv();
  flakyKv.put = async () => {
    throw new Error("KV temporary unavailable");
  };
  const flakyEnv = makeEnv({
    MUSIC_QUOTA_KV: flakyKv,
    QUOTA_FLUSH_EVERY: "1",
  });
  const playRes = await handleRequest(
    new Request("https://worker.example/media/%E6%B0%91%E8%B0%A3%E8%AF%97%E7%AF%87/Test%20Track.mp3", {
      headers: originHeaders,
    }),
    flakyEnv
  );
  assert.equal(playRes.status, 200);

  // Direct /quota visit without Origin returns 403 with helpful hint
  const directQuotaRes = await handleRequest(new Request("https://worker.example/quota"), makeEnv());
  assert.equal(directQuotaRes.status, 403);
  const directBody = await directQuotaRes.json();
  assert.equal(directBody.error, "Forbidden origin");
  assert.ok(typeof directBody.hint === "string" && directBody.hint.length > 0);
});

test("monotonic quota merge prevents lagging KV from rolling counters backward and shields 403 before 503", async () => {
  const originHeaders = { Origin: "https://williamqaqq.github.io" };
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);

  // Simulate KV capped at MAX_DAILY_KV_WRITES so subsequent flushes read an older KV state (dailyReqs: 2)
  const kv = makeMockKv({
    "quota:state:v1": JSON.stringify({
      day: today,
      month,
      dailyReqs: 2,
      dailyKvWrites: 850,
      monthlyClassB: 2,
      monthlyClassA: 0,
      storageBytes: 100,
      tripped: false,
      reason: "",
    }),
  });
  const env = makeEnv({
    MUSIC_QUOTA_KV: kv,
    MAX_DAILY_REQUESTS: "5",
    QUOTA_FLUSH_EVERY: "1",
    QUOTA_CACHE_MS: "0",
  });

  // Requests 3, 4, 5 succeed; even though KV writes are capped at 850 and KV still returns dailyReqs=2,
  // in-memory monotonic merge must keep advancing (3 -> 4 -> 5) and trip at request 6!
  for (let i = 0; i < 3; i++) {
    const okRes = await handleRequest(
      new Request("https://worker.example/manifest.json", { headers: originHeaders }),
      env
    );
    assert.equal(okRes.status, 200);
    assert.ok(okRes.headers.get("etag"), "/manifest.json should include ETag header in public mode");
  }

  const shieldRes = await handleRequest(
    new Request("https://worker.example/manifest.json", { headers: originHeaders }),
    env
  );
  assert.equal(shieldRes.status, 503, "Monotonic counter merge must trip 503 even when KV reads lag behind");

  // Unauthenticated caller without allowed Origin must still receive 403 Forbidden origin (no 503 telemetry leak)
  const unauthDuringShield = await handleRequest(
    new Request("https://worker.example/manifest.json", { headers: { Origin: "https://evil.example" } }),
    env
  );
  assert.equal(unauthDuringShield.status, 403, "Disallowed origin must receive 403 even while quota shield is active");

  // Stale KV remoteState with storageBytes: 0 must not erase newer GraphQL storageBytes cached in isolate
  const origFetch = globalThis.fetch;
  try {
    const cronKv = makeMockKv({
      "quota:state:v1": JSON.stringify({
        day: today,
        month,
        dailyReqs: 1,
        dailyKvWrites: 1,
        monthlyClassB: 1,
        monthlyClassA: 0,
        storageBytes: 0,
        analyticsSyncedAt: "",
        updatedAt: "2026-01-01T00:00:00.000Z",
        tripped: false,
        reason: "",
      }),
    });
    const cronEnv = makeEnv({
      MUSIC_QUOTA_KV: cronKv,
      CF_ANALYTICS_TOKEN: "tok",
      CF_ACCOUNT_ID: "acct",
      QUOTA_CACHE_MS: "0",
    });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            viewer: {
              accounts: [
                {
                  r2OperationsAdaptiveGroups: [],
                  r2StorageAdaptiveGroups: [{ dimensions: { bucketName: "music-box-audio" }, max: { payloadSize: 500000, metadataSize: 123 } }],
                },
              ],
            },
          },
        }),
        { status: 200 }
      );
    await handleScheduled({}, cronEnv);
    // Simulate a lagging edge KV read returning the old 0-byte snapshot while isolate holds 500123
    cronKv.store.set(
      "quota:state:v1",
      JSON.stringify({
        day: today,
        month,
        dailyReqs: 1,
        dailyKvWrites: 1,
        monthlyClassB: 1,
        monthlyClassA: 0,
        storageBytes: 0,
        analyticsSyncedAt: "",
        updatedAt: "2026-01-01T00:00:00.000Z",
        tripped: false,
        reason: "",
      })
    );
    const quotaAfterLagRes = await handleRequest(
      new Request("https://worker.example/quota", { headers: originHeaders }),
      cronEnv
    );
    const quotaAfterLag = await quotaAfterLagRes.json();
    assert.equal(quotaAfterLag.usage.storageBytes, 500123, "Stale KV snapshot must not erase newer GraphQL storageBytes");

    // Suffix Range (bytes=-4) must return valid 206 Content-Range even if R2 object.range only carries suffix
    const suffixBucket = {
      async get(key, opts) {
        if (key === "Test.mp3" && opts && opts.range) {
          return {
            size: 10,
            etag: "etag-10",
            httpEtag: '"etag-10"',
            range: { suffix: 4 },
            body: "6789",
            writeHttpMetadata() {},
          };
        }
        return null;
      },
    };
    const suffixEnv = makeEnv({ MUSIC_BUCKET: suffixBucket });
    const suffixRes = await handleRequest(
      new Request("https://worker.example/media/Test.mp3", {
        headers: { ...originHeaders, Range: "bytes=-4" },
      }),
      suffixEnv
    );
    assert.equal(suffixRes.status, 206);
    assert.equal(suffixRes.headers.get("Content-Range"), "bytes 6-9/10");
    assert.equal(suffixRes.headers.get("Content-Length"), "4");
  } finally {
    globalThis.fetch = origFetch;
  }
});
