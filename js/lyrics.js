(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const { KEYS, fmtTime, storageGet, storageSet, setPressedButtonState } = ns.catalog;

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
    const onBeforeMobileOpen = options.onBeforeMobileOpen;

    let desktopLyricsOpen = storageGet(KEYS.LYRICS_OPEN, "1") !== "0";
    let mobileLyricsOpen = false;
    let showTrans = storageGet(KEYS.LYRICS_TRANS, "1") !== "0";

    let lyricsCatalog = {};
    let lyricsCatalogLoaded = false;
    let lyricsCatalogPromise = null;
    let lyricsReqSeq = 0;
    let liveLyricsCache = {};
    let currentLyricState = null;
    let lyricLineEls = [];
    let activeLyricIndex = -1;

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

    async function loadCatalog() {
      loadLiveCache();
      if (lyricsCatalogPromise) return lyricsCatalogPromise;
      lyricsCatalogPromise = (async () => {
        try {
          const res = await fetch("lyrics.json", { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (data && typeof data === "object") {
            lyricsCatalog = data;
            const cur = getCurrentTrack();
            if (cur) loadForTrack(cur);
          }
        } catch (e) { /* 若缺失则走在线兜底 */ } finally {
          lyricsCatalogLoaded = true;
        }
      })();
      return lyricsCatalogPromise;
    }

    function renderLyricsView() {
      const st = currentLyricState;
      els.lyricsList.innerHTML = "";
      lyricLineEls = [];
      programmaticScrollGuardUntil = Date.now() + 180;
      els.lyricsScroll.scrollTop = 0;

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

      if (prevIdx >= 0 && prevIdx < lyricLineEls.length && prevIdx !== nextIdx) {
        lyricLineEls[prevIdx].classList.remove("active");
      }
      for (let i = 0; i < lyricLineEls.length; i++) {
        lyricLineEls[i].classList.toggle("active", i === nextIdx);
        lyricLineEls[i].classList.toggle("past", nextIdx > i);
      }

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

      let entry = lyricsCatalog[track.url] || liveLyricsCache[track.url] || null;
      if (!entry && !lyricsCatalogLoaded && lyricsCatalogPromise) {
        els.lyricsTransBtn.hidden = true;
        els.lyricsList.innerHTML = '<li class="lyric-empty">正在加载唱词库…</li>';
        lyricLineEls = [];
        await lyricsCatalogPromise;
        if (reqSeq !== lyricsReqSeq || getCurrentTrack() !== track) return;
        entry = lyricsCatalog[track.url] || liveLyricsCache[track.url] || null;
      }
      if (!entry) {
        els.lyricsTransBtn.hidden = true;
        els.lyricsList.innerHTML = '<li class="lyric-empty">正在检索唱词…</li>';
        lyricLineEls = [];
        const fetched = await fetchLiveLyricsFallback(track);
        if (reqSeq !== lyricsReqSeq || getCurrentTrack() !== track) return;
        if (fetched) {
          liveLyricsCache[track.url] = fetched;
          saveLiveCache();
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
        return loadCatalog();
      },
      loadForTrack,
      syncToTime,
      resetPosition,
      togglePanel,
      closeMobile,
      isMobileOpen: () => mobileLyricsOpen,
      isVisible,
      updatePanelUI,
      updateCollapsedSubtitle,
      enterUserScrollMode,
    };
  }

  ns.createLyricsController = createLyricsController;
})(window);
