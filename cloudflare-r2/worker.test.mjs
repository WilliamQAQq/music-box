import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "./src/worker.js";

function makeMockBucket(objects) {
  const store = new Map(Object.entries(objects || {}));
  return {
    async head(key) {
      const entry = store.get(key);
      if (!entry) return null;
      const bytes =
        entry.body instanceof Uint8Array
          ? entry.body
          : new TextEncoder().encode(
              typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body)
            );
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
      const entry = store.get(key);
      if (!entry) return null;
      const bytes =
        entry.body instanceof Uint8Array
          ? entry.body
          : new TextEncoder().encode(
              typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body)
            );
      let slice = bytes;
      if (opts && opts.range && Number.isFinite(opts.range.offset)) {
        const start = opts.range.offset;
        const len = Number.isFinite(opts.range.length) ? opts.range.length : bytes.byteLength - start;
        slice = bytes.subarray(start, start + len);
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
        httpEtag: entry.etag || `"etag-${key}"`,
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
