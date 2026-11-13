(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const { KEYS, storageGet, storageSet } = ns.catalog;

  const MAX_RECENT = 45;
  const RESUME_THROTTLE_MS = 3500;
  const SLEEP_FADEOUT_SEC = 10;

  function safeParseJson(raw, fallback) {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  /**
   * 集中管理收藏、最近聆听、断点续播、睡眠定时淡出与 A-B 复读状态的轻量化协调器。
   */
  function createUserStateController(options) {
    const opts = options || {};
    const listeners = new Map();

    let favoriteList = [];
    const favoriteSet = new Set();
    let recentList = [];
    let lastResumeWriteAt = 0;

    // 睡眠定时状态
    let sleepMode = "off"; // "off" | "track_end" | "countdown"
    let sleepEndAt = 0;
    let sleepTicker = null;

    // A-B 段落复读状态
    let loopA = null;
    let loopB = null;
    let loopActive = false;

    function emit(topic, payload) {
      const set = listeners.get(topic);
      if (!set) return;
      set.forEach((fn) => {
        try { fn(payload); } catch (e) { /* listener guard */ }
      });
    }

    function subscribe(topic, fn) {
      if (!listeners.has(topic)) listeners.set(topic, new Set());
      listeners.get(topic).add(fn);
      return () => {
        const set = listeners.get(topic);
        if (set) set.delete(fn);
      };
    }

    function loadPersistedLists() {
      const favRaw = safeParseJson(storageGet(KEYS.FAVORITES, ""), []);
      if (Array.isArray(favRaw)) {
        favoriteList = favRaw.filter((u) => typeof u === "string" && u);
        favoriteSet.clear();
        favoriteList.forEach((u) => favoriteSet.add(u));
      }
      const recRaw = safeParseJson(storageGet(KEYS.RECENT, ""), []);
      if (Array.isArray(recRaw)) {
        recentList = recRaw.filter((u) => typeof u === "string" && u).slice(0, MAX_RECENT);
      }
    }

    function persistFavorites() {
      storageSet(KEYS.FAVORITES, JSON.stringify(favoriteList));
    }

    function persistRecent() {
      storageSet(KEYS.RECENT, JSON.stringify(recentList));
    }

    function isFavorite(url) {
      return !!(url && favoriteSet.has(url));
    }

    function toggleFavorite(url) {
      if (!url) return false;
      let added;
      if (favoriteSet.has(url)) {
        favoriteSet.delete(url);
        favoriteList = favoriteList.filter((u) => u !== url);
        added = false;
      } else {
        favoriteSet.add(url);
        favoriteList.unshift(url);
        added = true;
      }
      persistFavorites();
      emit("favorites", { url, added, count: favoriteList.length });
      return added;
    }

    function pruneByAvailableUrls(validSet) {
      if (!validSet || !validSet.size) return;
      const prevFav = favoriteList.length;
      favoriteList = favoriteList.filter((u) => validSet.has(u));
      if (favoriteList.length !== prevFav) {
        favoriteSet.clear();
        favoriteList.forEach((u) => favoriteSet.add(u));
        persistFavorites();
      }
      const prevRec = recentList.length;
      recentList = recentList.filter((u) => validSet.has(u));
      if (recentList.length !== prevRec) persistRecent();
    }

    function recordRecent(url) {
      if (!url) return;
      recentList = [url].concat(recentList.filter((u) => u !== url)).slice(0, MAX_RECENT);
      persistRecent();
      emit("recent", { url, count: recentList.length });
    }

    function getRecentRankMap() {
      const m = new Map();
      recentList.forEach((u, idx) => m.set(u, idx));
      return m;
    }

    function clearRecent() {
      recentList = [];
      persistRecent();
      emit("recent", { url: "", count: 0 });
    }

    function saveResume(url, timeSec, title, force) {
      if (!url) return;
      const t = Math.max(0, Math.floor(Number(timeSec) || 0));
      const now = Date.now();
      if (!force && now - lastResumeWriteAt < RESUME_THROTTLE_MS) return;
      lastResumeWriteAt = now;
      storageSet(KEYS.RESUME, JSON.stringify({ url, time: t, title: title || "", savedAt: now }));
    }

    function getResume() {
      const data = safeParseJson(storageGet(KEYS.RESUME, ""), null);
      if (!data || typeof data.url !== "string" || !data.url) return null;
      return {
        url: data.url,
        time: isFinite(data.time) && data.time >= 0 ? Number(data.time) : 0,
        title: typeof data.title === "string" ? data.title : "",
        savedAt: Number(data.savedAt) || 0,
      };
    }

    function clearResume() {
      try {
        if (global.localStorage) global.localStorage.removeItem(KEYS.RESUME);
      } catch (e) { /* ignore */ }
      emit("resume", null);
    }

    function setSleepFade(factor) {
      if (typeof opts.onSleepFade === "function") opts.onSleepFade(factor);
    }

    function stopSleepTicker() {
      clearInterval(sleepTicker);
      sleepTicker = null;
    }

    function getSleepSnapshot() {
      const remMs = sleepMode === "countdown" ? Math.max(0, sleepEndAt - Date.now()) : 0;
      return {
        mode: sleepMode,
        remainingMs: remMs,
        remainingSec: Math.ceil(remMs / 1000),
      };
    }

    function setSleepTimer(minutesOrMode) {
      stopSleepTicker();
      setSleepFade(1);

      if (!minutesOrMode || minutesOrMode === "off") {
        sleepMode = "off";
        sleepEndAt = 0;
        emit("sleep", getSleepSnapshot());
        return;
      }

      if (minutesOrMode === "track_end") {
        sleepMode = "track_end";
        sleepEndAt = 0;
        emit("sleep", getSleepSnapshot());
        return;
      }

      const mins = Math.max(1, Number(minutesOrMode) || 15);
      sleepMode = "countdown";
      sleepEndAt = Date.now() + mins * 60 * 1000;
      sleepTicker = setInterval(() => {
        const remMs = sleepEndAt - Date.now();
        if (remMs <= 0) {
          stopSleepTicker();
          sleepMode = "off";
          sleepEndAt = 0;
          if (typeof opts.onSleepExpire === "function") opts.onSleepExpire();
          setSleepFade(1);
          emit("sleep", getSleepSnapshot());
          return;
        }
        const remSec = remMs / 1000;
        if (remSec <= SLEEP_FADEOUT_SEC) {
          setSleepFade(Math.max(0.02, remSec / SLEEP_FADEOUT_SEC));
        } else {
          setSleepFade(1);
        }
        emit("sleep", getSleepSnapshot());
      }, 500);
      emit("sleep", getSleepSnapshot());
    }

    function notifyTrackEndedForSleep() {
      if (sleepMode !== "track_end") return false;
      sleepMode = "off";
      sleepEndAt = 0;
      setSleepFade(1);
      emit("sleep", getSleepSnapshot());
      return true;
    }

    function getAbLoopState() {
      return { a: loopA, b: loopB, active: loopActive };
    }

    function setAbPointA(sec) {
      const t = Math.max(0, Number(sec) || 0);
      loopA = t;
      if (loopB !== null && loopB <= loopA + 0.4) {
        loopB = null;
        loopActive = false;
      } else if (loopB !== null) {
        loopActive = true;
      }
      emit("abloop", getAbLoopState());
      return getAbLoopState();
    }

    function setAbPointB(sec) {
      const t = Math.max(0, Number(sec) || 0);
      if (loopA === null) loopA = 0;
      if (t <= loopA + 0.4) {
        return { error: "B 点须晚于 A 点至少 0.5 秒", state: getAbLoopState() };
      }
      loopB = t;
      loopActive = true;
      emit("abloop", getAbLoopState());
      return { state: getAbLoopState() };
    }

    function toggleAbLoop() {
      if (loopA === null || loopB === null || loopB <= loopA + 0.4) return false;
      loopActive = !loopActive;
      emit("abloop", getAbLoopState());
      return loopActive;
    }

    function clearAbLoop() {
      loopA = null;
      loopB = null;
      loopActive = false;
      emit("abloop", getAbLoopState());
    }

    function getAbJumpTarget(currentTime) {
      if (!loopActive || loopA === null || loopB === null) return null;
      if (currentTime >= loopB || currentTime < Math.max(0, loopA - 0.8)) {
        return loopA;
      }
      return null;
    }

    loadPersistedLists();

    return {
      subscribe,
      isFavorite,
      toggleFavorite,
      getFavoritesCount: () => favoriteList.length,
      getFavoriteUrls: () => favoriteList.slice(),
      pruneByAvailableUrls,
      recordRecent,
      getRecentUrls: () => recentList.slice(),
      getRecentCount: () => recentList.length,
      getRecentRankMap,
      clearRecent,
      saveResume,
      getResume,
      clearResume,
      setSleepTimer,
      getSleepSnapshot,
      notifyTrackEndedForSleep,
      getAbLoopState,
      setAbPointA,
      setAbPointB,
      toggleAbLoop,
      clearAbLoop,
      getAbJumpTarget,
    };
  }

  ns.createUserStateController = createUserStateController;
})(window);
