(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const { KEYS, fmtTime, storageGet, storageSet, setPressedButtonState, formatLrcExport, debounce, canonicalTrackKey } = ns.catalog;

  const USER_SCROLL_RESUME_MS = 5500;

  function parseTimedLines(rawText) {
    if (!rawText) return { offsetSec: 0, timed: [], plain: [] };
    let offsetSec = 0;
    const offMatch = rawText.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offMatch) offsetSec = (parseInt(offMatch[1], 10) || 0) / 1000;

    const timed = [];
    const plain = [];
    const tagRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    rawText.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      if (/^\[(id|ar|ti|al|by|hash|sign|qq|total|re|ve|offset):/i.test(line)) return;

      const stamps = [];
      let m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(line)) !== null) {
        const mins = parseInt(m[1], 10) || 0;
        const secs = parseInt(m[2], 10) || 0;
        const frac = m[3] ? Number("0." + m[3]) : 0;
        stamps.push(Math.max(0, mins * 60 + secs + frac - offsetSec));
      }
      const text = line.replace(tagRe, "").trim();
      if (!stamps.length) {
        if (text) plain.push(text);
        return;
      }
      if (!text) return;
      stamps.forEach((t) => timed.push({ time: t, text: text }));
    });

    timed.sort((a, b) => a.time - b.time);
    return { offsetSec, timed, plain };
  }

  function parseLrcBundle(entry) {
    if (!entry) return { type: "none", lines: [], hasTrans: false };
    if (entry.type === "instrumental") {
      return { type: "instrumental", lines: [], hasTrans: false };
    }

    const main = parseTimedLines(entry.lrc || "");
    if (!main.timed.length) {
      if (main.plain.length) {
        return {
          type: "plain",
          lines: main.plain.map((txt) => ({ time: null, text: txt, trans: "" })),
          hasTrans: false,
        };
      }
      return { type: "none", lines: [], hasTrans: false };
    }

    const transParsed = parseTimedLines(entry.tlyric || "");
    let hasTrans = false;
    const lines = main.timed.map((item) => ({
      time: item.time,
      text: item.text,
      trans: "",
    }));

    if (transParsed.timed.length) {
      let ti = 0;
      for (let i = 0; i < lines.length; i++) {
        const target = lines[i].time;
        while (
          ti + 1 < transParsed.timed.length &&
          Math.abs(transParsed.timed[ti + 1].time - target) <= Math.abs(transParsed.timed[ti].time - target)
        ) {
          ti++;
        }
        if (Math.abs(transParsed.timed[ti].time - target) <= 0.85) {
          const trText = transParsed.timed[ti].text;
          if (trText && trText !== "//" && trText !== lines[i].text) {
            lines[i].trans = trText;
            hasTrans = true;
          }
        }
      }
    }

    return { type: "synced", lines, hasTrans };
  }

  async function fetchLiveLyricsFallback(track) {
    const params = new URLSearchParams({ title: track.title || "" });
    if (track.artist) params.set("artist", track.artist);
    if (track.album && track.album.toLowerCase() !== "unknown album") {
      params.set("album", track.album);
    }
    try {
      const res = await fetch("https://api.lrc.cx/lyrics?" + params.toString());
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || !text.trim()) return null;
      if (/纯音乐，请欣赏|此歌曲为没有填词的纯音乐/.test(text)) {
        return { type: "instrumental" };
      }
      return { type: "synced", lrc: text };
    } catch (e) {
      return null;
    }
  }

  function scrollToAsync(scroller, options) {
    const result = scroller.scrollTo(options);
    if (result instanceof Promise) return result;
    return new Promise((resolve) => {
      let timeoutId;
      const finish = () => {
        clearTimeout(timeoutId);
        scroller.removeEventListener("scrollend", finish);
        scroller.removeEventListener("scroll", onScroll);
        resolve();
      };
      const onScroll = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(finish, 100);
      };
      scroller.addEventListener("scrollend", finish, { once: true });
      scroller.addEventListener("scroll", onScroll, { passive: true });
      timeoutId = setTimeout(finish, 100);
    });
  }

  function createLyricsController(options) {
    const audio = options.audio;
    const els = options.els;
    const getCurrentTrack = options.getCurrentTrack;
    const defaultTrackSub = options.defaultTrackSub;
    const safePlay = options.safePlay;
    const toast = options.toast;
    const onBeforeMobileOpen = options.onBeforeMobileOpen;

    let desktopLyricsOpen = storageGet(KEYS.LYRICS_OPEN, "1") !== "0";
    let mobileLyricsOpen = false;
    let showTrans = storageGet(KEYS.LYRICS_TRANS, "1") !== "0";

    let lyricsCatalog = {};
    let lyricsCatalogLoaded = false;
    let lyricsCatalogPromise = null;
    let externalLyricsUrl = "";
    let externalLyricsKey = "";
    let externalSourceMode = "hybrid";
    let lyricsReqSeq = 0;
    let liveLyricsCache = {};
    let liveCacheLoaded = false;
    let currentLyricState = null;
    let lyricLineEls = [];
    let activeLyricIndex = -1;
    let lastStyledActive = -1;
    let lastStyledPastEnd = 0;
    let lyricSearchQuery = "";

    let userScrolling = false;
    let isPointerTouchingLyrics = false;
    let userScrollResumeTimer = null;
    let lyricsScrollSeq = 0;
    let programmaticScrollDepth = 0;
    let programmaticScrollGuardUntil = 0;

    function isMobileViewport() {
      return !!(global.matchMedia && global.matchMedia("(max-width: 980px)").matches);
    }

    function isVisible() {
      return isMobileViewport() ? mobileLyricsOpen : desktopLyricsOpen;
    }

    function updateCollapsedSubtitle() {
      const tr = getCurrentTrack();
      if (!tr) return;
      if (
        !audio.paused &&
        !isVisible() &&
        currentLyricState &&
        currentLyricState.type === "synced" &&
        activeLyricIndex >= 0 &&
        currentLyricState.lines[activeLyricIndex] &&
        currentLyricState.lines[activeLyricIndex].text
      ) {
        els.trackSub.textContent = "\u266A " + currentLyricState.lines[activeLyricIndex].text;
      } else {
        els.trackSub.textContent = defaultTrackSub(tr);
      }
    }

    function updatePanelUI() {
      const visible = isVisible();
      document.body.classList.toggle("lyrics-closed", !desktopLyricsOpen);
      document.body.classList.toggle("mobile-lyrics-open", mobileLyricsOpen);
      setPressedButtonState(els.lyricsToggleBtn, visible);
      els.lyricsPanel.classList.toggle("hide-trans", !showTrans);
      setPressedButtonState(els.lyricsTransBtn, showTrans);
      if (visible) {
        requestAnimationFrame(() => centerActiveLyric(true));
      }
      updateCollapsedSubtitle();
    }

    function closeMobile(restoreFocus) {
      if (!mobileLyricsOpen) return;
      mobileLyricsOpen = false;
      updatePanelUI();
      if (restoreFocus && els.lyricsToggleBtn && typeof els.lyricsToggleBtn.focus === "function") {
        els.lyricsToggleBtn.focus();
      }
    }

    function togglePanel() {
      if (isMobileViewport()) {
        mobileLyricsOpen = !mobileLyricsOpen;
        if (mobileLyricsOpen && onBeforeMobileOpen) onBeforeMobileOpen();
      } else {
        desktopLyricsOpen = !desktopLyricsOpen;
        storageSet(KEYS.LYRICS_OPEN, desktopLyricsOpen ? "1" : "0");
      }
      updatePanelUI();
    }

    function loadLiveCache() {
      if (liveCacheLoaded) return;
      liveCacheLoaded = true;
      try {
        const raw = storageGet(KEYS.LIVE_LYRICS, "");
        if (raw) liveLyricsCache = JSON.parse(raw) || {};
      } catch (e) { liveLyricsCache = {}; }
    }

    function saveLiveCache() {
      try {
        storageSet(KEYS.LIVE_LYRICS, JSON.stringify(liveLyricsCache));
      } catch (e) { /* ignore quota */ }
    }

    function lookupTrackLyrics(track) {
      if (!track) return null;
      const keys = [];
      const canonUrl = track.url ? canonicalTrackKey(track.url) : "";
      if (canonUrl) keys.push(canonUrl);
      if (track.url && track.url !== canonUrl) keys.push(track.url);
      if (track.path && !keys.includes(track.path)) keys.push(track.path);
      if (track.path) {
        const musicPrefixed = "music/" + String(track.path).replace(/^\/+/, "");
        if (!keys.includes(musicPrefixed)) keys.push(musicPrefixed);
      }
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (lyricsCatalog[k]) return lyricsCatalog[k];
        if (liveLyricsCache[k]) return liveLyricsCache[k];
      }
      return null;
    }

    function setExternalLyricsSource(r2BaseUrl, r2Key, sourceMode) {
      const nextUrl = ns.catalog.normalizeR2BaseUrl
        ? ns.catalog.normalizeR2BaseUrl(r2BaseUrl)
        : String(r2BaseUrl || "").trim().replace(/\/+$/, "");
      const nextKey = String(r2Key || "").trim();
      const nextMode = sourceMode || "hybrid";
      if (nextUrl === externalLyricsUrl && nextKey === externalLyricsKey && nextMode === externalSourceMode) {
        return;
      }
      externalLyricsUrl = nextUrl;
      externalLyricsKey = nextKey;
      externalSourceMode = nextMode;
      lyricsCatalog = {};
      lyricsCatalogLoaded = false;
      lyricsCatalogPromise = null;
    }

    // 真正按需延迟拉取 lyrics.json（不再阻碍首屏渲染与冷启动带宽，并允许 304 协商缓存，同时叠加 R2 /lyrics.json）
    async function loadCatalog(force) {
      loadLiveCache();
      if (force) {
        lyricsCatalogPromise = null;
        lyricsCatalogLoaded = false;
      }
      if (lyricsCatalogPromise) return lyricsCatalogPromise;
      lyricsCatalogPromise = (async () => {
        const cacheMode = force ? "no-store" : "no-cache";
        const tasks = [];

        if (externalSourceMode !== "r2") {
          tasks.push(
            fetch("lyrics.json", { cache: cacheMode })
              .then(async (res) => (res.ok ? { ok: true, data: await res.json() } : { ok: false, data: null }))
              .catch(() => ({ ok: false, data: null }))
          );
        } else {
          tasks.push(Promise.resolve({ ok: false, data: null }));
        }

        if (externalLyricsUrl && externalSourceMode !== "github") {
          const headers = {};
          if (externalLyricsKey) headers["X-Music-Key"] = externalLyricsKey;
          tasks.push(
            fetch(externalLyricsUrl + "/lyrics.json", { cache: cacheMode, headers })
              .then(async (res) => (res.ok ? { ok: true, data: await res.json() } : { ok: false, data: null }))
              .catch(() => ({ ok: false, data: null }))
          );
        } else {
          tasks.push(Promise.resolve({ ok: false, data: null }));
        }

        let anyOk = false;
        try {
          const [localRes, r2Res] = await Promise.all(tasks);
          const merged = {};
          if (localRes && localRes.ok) {
            anyOk = true;
            if (localRes.data && typeof localRes.data === "object") Object.assign(merged, localRes.data);
          }
          if (r2Res && r2Res.ok) {
            anyOk = true;
            if (r2Res.data && typeof r2Res.data === "object") Object.assign(merged, r2Res.data);
          }
          lyricsCatalog = merged;
        } catch (e) { /* 若缺失则走在线兜底 */ } finally {
          lyricsCatalogLoaded = anyOk;
          if (!anyOk) lyricsCatalogPromise = null;
        }
      })();
      return lyricsCatalogPromise;
    }

    function applyLyricSearchFilter() {
      const q = String(lyricSearchQuery || "").trim().toLowerCase();
      if (!els.lyricsSearchCount) return;
      if (!lyricLineEls.length || !currentLyricState || !currentLyricState.lines) {
        els.lyricsSearchCount.textContent = "";
        return;
      }
      if (!q) {
        for (let i = 0; i < lyricLineEls.length; i++) {
          lyricLineEls[i].classList.remove("lyric-match", "lyric-dim");
        }
        els.lyricsSearchCount.textContent = "";
        return;
      }
      let firstMatchIdx = -1;
      let matchCount = 0;
      for (let i = 0; i < lyricLineEls.length; i++) {
        const ln = currentLyricState.lines[i];
        const hay = ((ln ? ln.text : "") + "\n" + (ln && ln.trans ? ln.trans : "")).toLowerCase();
        const hit = hay.indexOf(q) !== -1;
        lyricLineEls[i].classList.toggle("lyric-match", hit);
        lyricLineEls[i].classList.toggle("lyric-dim", !hit);
        if (hit) {
          matchCount++;
          if (firstMatchIdx === -1) firstMatchIdx = i;
        }
      }
      els.lyricsSearchCount.textContent = matchCount ? matchCount + " 处匹配" : "无匹配";
      if (firstMatchIdx !== -1 && lyricLineEls[firstMatchIdx]) {
        enterUserScrollMode();
        lyricLineEls[firstMatchIdx].scrollIntoView({ block: "center", behavior: "auto" });
      }
    }

    const debouncedLyricSearch = debounce(applyLyricSearchFilter, 80);

    function toggleLyricSearchBar(forceOpen) {
      if (!els.lyricsSearchBar || !els.lyricsSearchBtn) return;
      const open = typeof forceOpen === "boolean" ? forceOpen : els.lyricsSearchBar.hidden;
      els.lyricsSearchBar.hidden = !open;
      setPressedButtonState(els.lyricsSearchBtn, open);
      if (open && els.lyricsSearchInput) {
        els.lyricsSearchInput.focus();
      } else if (!open && els.lyricsSearchInput) {
        els.lyricsSearchInput.value = "";
        lyricSearchQuery = "";
        applyLyricSearchFilter();
      }
    }

    function exportCurrentLrc() {
      const track = getCurrentTrack();
      if (!track || !currentLyricState || !currentLyricState.lines || !currentLyricState.lines.length) {
        if (toast) toast("当前曲目暂无可导出的唱词文本", true);
        return false;
      }
      const lrcText = formatLrcExport(track, currentLyricState, showTrans && currentLyricState.hasTrans);
      if (!lrcText) return false;
      const safeName = (track.title || "lyrics").replace(/[\\/:*?"<>|]/g, "_") + ".lrc";
      const blob = new Blob([lrcText], { type: "text/plain;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = safeName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      if (toast) toast("已导出唱词文件：" + safeName);
      return true;
    }

    function renderLyricsView() {
      const st = currentLyricState;
      els.lyricsList.innerHTML = "";
      lyricLineEls = [];
      lastStyledActive = -1;
      lastStyledPastEnd = 0;
      programmaticScrollGuardUntil = Date.now() + 180;
      els.lyricsScroll.scrollTop = 0;

      const hasLines = !!(st && st.lines && st.lines.length);
      if (els.lyricsExportBtn) els.lyricsExportBtn.hidden = !hasLines;
      if (els.lyricsSearchBtn) {
        els.lyricsSearchBtn.hidden = !hasLines;
        if (!hasLines && els.lyricsSearchBar && !els.lyricsSearchBar.hidden) {
          toggleLyricSearchBar(false);
        }
      }

      if (!st || st.type === "none") {
        els.lyricsTransBtn.hidden = true;
        const li = document.createElement("li");
        li.className = "lyric-empty";
        li.textContent = "馆藏暂未收录此曲唱词";
        els.lyricsList.appendChild(li);
        return;
      }

      if (st.type === "instrumental") {
        els.lyricsTransBtn.hidden = true;
        const li = document.createElement("li");
        li.className = "lyric-instrumental";
        const badge = document.createElement("div");
        badge.className = "lyric-inst-badge";
        badge.textContent = "\u2726 INSTRUMENTAL · 纯器乐曲 \u2726";
        const msg = document.createElement("p");
        msg.textContent = "此曲为器乐演奏曲目，无唱词，敬请静心聆听留声旋律。";
        li.append(badge, msg);
        els.lyricsList.appendChild(li);
        return;
      }

      els.lyricsTransBtn.hidden = !st.hasTrans;
      const frag = document.createDocumentFragment();

      st.lines.forEach((ln, idx) => {
        const li = document.createElement("li");
        li.className = "lyric-line" + (ln.time !== null ? " timed" : "");
        li.dataset.idx = idx;

        const mainSpan = document.createElement("span");
        mainSpan.className = "lyric-main";
        mainSpan.textContent = ln.text;
        li.appendChild(mainSpan);

        if (ln.trans) {
          const trSpan = document.createElement("span");
          trSpan.className = "lyric-trans";
          trSpan.textContent = ln.trans;
          li.appendChild(trSpan);
        }

        if (ln.time !== null) {
          const tmSpan = document.createElement("span");
          tmSpan.className = "lyric-time";
          tmSpan.textContent = fmtTime(ln.time);
          li.appendChild(tmSpan);
        }

        lyricLineEls.push(li);
        frag.appendChild(li);
      });

      els.lyricsList.appendChild(frag);
      if (lyricSearchQuery) applyLyricSearchFilter();
    }

    function findActiveIndex(timeSec) {
      const st = currentLyricState;
      if (!st || !st.lines.length) return -1;
      if (st.type === "plain") {
        if (!isFinite(audio.duration) || audio.duration <= 0) return 0;
        const ratio = Math.min(0.999, Math.max(0, timeSec / audio.duration));
        return Math.floor(ratio * st.lines.length);
      }
      if (st.type !== "synced") return -1;

      const target = timeSec + 0.12;
      const lines = st.lines;
      if (target < lines[0].time) return -1;

      let lo = 0;
      let hi = lines.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].time <= target) lo = mid + 1;
        else hi = mid - 1;
      }
      return hi;
    }

    async function centerActiveLyric(immediate) {
      if (userScrolling || !isVisible()) return;
      const scroller = els.lyricsScroll;
      const activeEl = activeLyricIndex >= 0 ? lyricLineEls[activeLyricIndex] : null;
      if (!scroller || !activeEl) return;

      const targetTop = Math.max(
        0,
        activeEl.offsetTop - scroller.clientHeight / 2 + activeEl.offsetHeight / 2
      );
      if (Math.abs(scroller.scrollTop - targetTop) < 2) return;

      const seq = ++lyricsScrollSeq;
      const preferReduced = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
      const behavior = immediate || preferReduced ? "instant" : "smooth";

      programmaticScrollDepth++;
      programmaticScrollGuardUntil = Date.now() + 180;
      try {
        await scrollToAsync(scroller, { top: targetTop, behavior: behavior });
      } finally {
        programmaticScrollDepth = Math.max(0, programmaticScrollDepth - 1);
        programmaticScrollGuardUntil = Date.now() + 180;
      }
      if (seq !== lyricsScrollSeq) return;
    }

    function scheduleAutoFollowResume() {
      clearTimeout(userScrollResumeTimer);
      if (!userScrolling || isPointerTouchingLyrics) return;
      userScrollResumeTimer = setTimeout(() => {
        exitUserScrollMode(false);
      }, USER_SCROLL_RESUME_MS);
    }

    function enterUserScrollMode() {
      userScrolling = true;
      lyricsScrollSeq++;
      els.lyricsFollowBtn.hidden = false;
      scheduleAutoFollowResume();
    }

    function exitUserScrollMode(silent) {
      userScrolling = false;
      isPointerTouchingLyrics = false;
      clearTimeout(userScrollResumeTimer);
      els.lyricsFollowBtn.hidden = true;
      if (!silent && activeLyricIndex >= 0) {
        centerActiveLyric(false);
      }
    }

    function syncToTime(timeSec, immediate) {
      const st = currentLyricState;
      if (!st || (st.type !== "synced" && st.type !== "plain")) return;

      const prevIdx = activeLyricIndex;
      const nextIdx = findActiveIndex(timeSec);
      if (nextIdx === prevIdx && !immediate) return;
      activeLyricIndex = nextIdx;

      const len = lyricLineEls.length;
      if (lastStyledActive >= 0 && lastStyledActive < len && lastStyledActive !== nextIdx) {
        lyricLineEls[lastStyledActive].classList.remove("active");
      }
      const nextPastEnd = Math.max(0, Math.min(len, nextIdx));
      if (nextPastEnd > lastStyledPastEnd) {
        for (let i = lastStyledPastEnd; i < nextPastEnd; i++) {
          lyricLineEls[i].classList.add("past");
        }
      } else if (nextPastEnd < lastStyledPastEnd) {
        for (let i = nextPastEnd; i < lastStyledPastEnd; i++) {
          lyricLineEls[i].classList.remove("past");
        }
      }
      lastStyledPastEnd = nextPastEnd;
      if (nextIdx >= 0 && nextIdx < len) {
        lyricLineEls[nextIdx].classList.add("active");
        lyricLineEls[nextIdx].classList.remove("past");
      }
      lastStyledActive = nextIdx;

      updateCollapsedSubtitle();

      if (nextIdx >= 0 && !userScrolling) {
        centerActiveLyric(immediate);
      }
    }

    async function loadForTrack(track) {
      if (!track) return;
      const reqSeq = ++lyricsReqSeq;
      exitUserScrollMode(true);
      activeLyricIndex = -1;
      els.lyricsTrackName.textContent = track.artist ? (track.title + " · " + track.artist) : track.title;

      loadLiveCache();
      let entry = lookupTrackLyrics(track);
      if (!entry && !lyricsCatalogLoaded) {
        els.lyricsTransBtn.hidden = true;
        if (els.lyricsExportBtn) els.lyricsExportBtn.hidden = true;
        if (els.lyricsSearchBtn) els.lyricsSearchBtn.hidden = true;
        els.lyricsList.innerHTML = '<li class="lyric-empty">正在加载唱词库…</li>';
        lyricLineEls = [];
        await loadCatalog(false);
        if (reqSeq !== lyricsReqSeq || getCurrentTrack() !== track) return;
        entry = lookupTrackLyrics(track);
      }
      if (!entry) {
        els.lyricsTransBtn.hidden = true;
        els.lyricsList.innerHTML = '<li class="lyric-empty">正在检索唱词…</li>';
        lyricLineEls = [];
        const fetched = await fetchLiveLyricsFallback(track);
        if (reqSeq !== lyricsReqSeq || getCurrentTrack() !== track) return;
        if (fetched) {
          const cacheKey = track.path || canonicalTrackKey(track.url);
          if (cacheKey) {
            liveLyricsCache[cacheKey] = fetched;
            saveLiveCache();
          }
          entry = fetched;
        }
      }

      currentLyricState = parseLrcBundle(entry);
      renderLyricsView();
      syncToTime(audio.currentTime || 0, true);
      updateCollapsedSubtitle();
    }

    function resetPosition() {
      activeLyricIndex = -1;
      exitUserScrollMode(true);
      syncToTime(0, true);
      updateCollapsedSubtitle();
    }

    function bindEvents() {
      els.lyricsToggleBtn.addEventListener("click", togglePanel);
      els.lyricsCloseBtn.addEventListener("click", () => {
        if (isMobileViewport()) {
          closeMobile(true);
        } else {
          desktopLyricsOpen = false;
          storageSet(KEYS.LYRICS_OPEN, "0");
          updatePanelUI();
        }
      });

      els.lyricsTransBtn.addEventListener("click", () => {
        showTrans = !showTrans;
        storageSet(KEYS.LYRICS_TRANS, showTrans ? "1" : "0");
        updatePanelUI();
        centerActiveLyric(false);
      });

      if (els.lyricsSearchBtn) {
        els.lyricsSearchBtn.addEventListener("click", () => toggleLyricSearchBar());
      }
      if (els.lyricsSearchInput) {
        els.lyricsSearchInput.addEventListener("input", () => {
          lyricSearchQuery = els.lyricsSearchInput.value;
          debouncedLyricSearch();
        });
        els.lyricsSearchInput.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (els.lyricsSearchInput.value) {
              els.lyricsSearchInput.value = "";
              lyricSearchQuery = "";
              applyLyricSearchFilter();
            } else {
              toggleLyricSearchBar(false);
            }
          }
        });
      }
      if (els.lyricsSearchClearBtn) {
        els.lyricsSearchClearBtn.addEventListener("click", () => {
          if (!els.lyricsSearchInput) return;
          els.lyricsSearchInput.value = "";
          lyricSearchQuery = "";
          applyLyricSearchFilter();
          els.lyricsSearchInput.focus();
        });
      }
      if (els.lyricsExportBtn) {
        els.lyricsExportBtn.addEventListener("click", exportCurrentLrc);
      }

      if (els.playerTrack) {
        els.playerTrack.addEventListener("click", () => {
          if (isMobileViewport()) togglePanel();
        });
      }

      global.addEventListener("resize", () => {
        setPressedButtonState(els.lyricsToggleBtn, isVisible());
      });

      els.lyricsList.addEventListener("click", (e) => {
        const li = e.target.closest(".lyric-line.timed");
        if (!li || !currentLyricState || !currentLyricState.lines) return;
        const idx = Number(li.dataset.idx);
        const ln = currentLyricState.lines[idx];
        if (!ln || ln.time === null) return;
        if (isFinite(audio.duration) || audio.readyState >= 1) {
          audio.currentTime = ln.time;
        }
        exitUserScrollMode(true);
        syncToTime(ln.time, false);
        if (audio.paused && getCurrentTrack()) safePlay();
      });

      els.lyricsFollowBtn.addEventListener("click", () => exitUserScrollMode(false));

      els.lyricsScroll.addEventListener("wheel", () => {
        enterUserScrollMode();
      }, { passive: true });

      els.lyricsScroll.addEventListener("touchstart", () => {
        isPointerTouchingLyrics = true;
        clearTimeout(userScrollResumeTimer);
      }, { passive: true });

      els.lyricsScroll.addEventListener("touchmove", () => {
        enterUserScrollMode();
      }, { passive: true });

      els.lyricsScroll.addEventListener("touchend", () => {
        isPointerTouchingLyrics = false;
        scheduleAutoFollowResume();
      }, { passive: true });

      els.lyricsScroll.addEventListener("touchcancel", () => {
        isPointerTouchingLyrics = false;
        scheduleAutoFollowResume();
      }, { passive: true });

      els.lyricsScroll.addEventListener("pointerdown", (e) => {
        const rect = els.lyricsScroll.getBoundingClientRect();
        if (e.clientX >= rect.right - 18) {
          isPointerTouchingLyrics = true;
          enterUserScrollMode();
        }
      });

      global.addEventListener("pointerup", () => {
        if (isPointerTouchingLyrics) {
          isPointerTouchingLyrics = false;
          scheduleAutoFollowResume();
        }
      });

      els.lyricsScroll.addEventListener("scroll", () => {
        if (userScrolling) {
          scheduleAutoFollowResume();
        } else if (programmaticScrollDepth === 0 && Date.now() > programmaticScrollGuardUntil) {
          enterUserScrollMode();
        }
      }, { passive: true });
    }

    return {
      init() {
        bindEvents();
        updatePanelUI();
      },
      reloadCatalog: () => loadCatalog(true),
      setExternalLyricsSource,
      loadForTrack,
      syncToTime,
      resetPosition,
      togglePanel,
      closeMobile,
      exportCurrentLrc,
      isMobileOpen: () => mobileLyricsOpen,
      isVisible,
      updatePanelUI,
      updateCollapsedSubtitle,
      enterUserScrollMode,
    };
  }

  ns.createLyricsController = createLyricsController;
})(window);
