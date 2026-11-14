(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const {
    KEYS,
    fmtTime,
    storageGet,
    storageSet,
    setPressedButtonState,
    buildTrackShareUrl,
    copyTextToClipboard,
  } = ns.catalog;

  const SPEED_OPTIONS = [0.75, 0.9, 1.0, 1.15, 1.25, 1.5];
  const CROSSFADE_OPTIONS = [0, 2, 4, 6];

  /**
   * 留声机调音与工具台控制器：
   * 管理实时频谱可视化（支持 contentvisibilityautostatechange 自动节能）、
   * 3 段复古 EQ、效果强度、播放倍速、Crossfade、A-B 复读、睡眠定时及分享/缓存操作。
   */
  function createStudioController(options) {
    const audio = options.audio;
    const els = options.els;
    const audioFx = options.audioFx;
    const userState = options.userState;
    const getCurrentTrack = options.getCurrentTrack;
    const syncSlider = options.syncSlider;
    const toast = options.toast;
    const onBeforeOpen = options.onBeforeOpen;
    const onCrossfadeChange = options.onCrossfadeChange;

    const hasNativePopover = Object.hasOwn(HTMLElement.prototype, "popover");
    let studioOpen = false;
    let spectrumEnabled = storageGet(KEYS.SPECTRUM, "1") !== "0";
    let playbackSpeed = Math.max(0.5, Math.min(2, Number(storageGet(KEYS.SPEED, "1")) || 1));
    let crossfadeSec = Math.max(0, Math.min(8, parseInt(storageGet(KEYS.CROSSFADE, "0"), 10) || 0));

    let isSpectrumSkipped = false;
    let rafId = null;
    let freqBuf = null;
    let peakHeights = null;
    let shareFeedbackTimer = null;
    let lastAnnouncement = "";

    function applyPlaybackSpeed(rate, showToast) {
      const safeRate = Math.max(0.5, Math.min(2, Number(rate) || 1));
      playbackSpeed = safeRate;
      storageSet(KEYS.SPEED, String(safeRate));
      audio.playbackRate = safeRate;
      if ("preservesPitch" in audio) audio.preservesPitch = true;
      if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = true;
      if (els.speedBtns) {
        els.speedBtns.forEach((btn) => {
          setPressedButtonState(btn, Math.abs(Number(btn.dataset.speed) - safeRate) < 0.01);
        });
      }
      syncStudioBadge();
      if (showToast && toast) toast("播放倍速：" + safeRate + "x");
    }

    function applyCrossfadeSec(sec, showToast) {
      const safeSec = Math.max(0, Math.min(8, parseInt(sec, 10) || 0));
      crossfadeSec = safeSec;
      storageSet(KEYS.CROSSFADE, String(safeSec));
      if (els.crossfadeBtns) {
        els.crossfadeBtns.forEach((btn) => {
          setPressedButtonState(btn, Number(btn.dataset.xfade) === safeSec);
        });
      }
      if (onCrossfadeChange) onCrossfadeChange(safeSec);
      syncStudioBadge();
      if (showToast && toast) toast(safeSec > 0 ? "已开启曲间平滑过渡：" + safeSec + " 秒" : "已关闭曲间交叉淡入淡出");
    }

    function syncStudioBadge() {
      if (!els.studioBtn) return;
      const eq = audioFx.getEqState();
      const sleep = userState.getSleepSnapshot();
      const ab = userState.getAbLoopState();
      const hasCustom = eq.active || Math.abs(playbackSpeed - 1) >= 0.01 || crossfadeSec > 0 || sleep.mode !== "off" || ab.active;
      els.studioBtn.classList.toggle("has-active-fx", hasCustom);
      if (els.studioBadgeDot) els.studioBadgeDot.hidden = !hasCustom;
    }

    function syncEqUI() {
      const st = audioFx.getEqState();
      const pairs = [
        { slider: els.eqBass, readout: els.eqBassVal, val: st.bass },
        { slider: els.eqMid, readout: els.eqMidVal, val: st.mid },
        { slider: els.eqTreble, readout: els.eqTrebleVal, val: st.treble },
      ];
      pairs.forEach(({ slider, readout, val }) => {
        if (!slider) return;
        slider.value = val;
        slider.setAttribute("aria-valuetext", (val > 0 ? "+" : "") + val + " dB");
        syncSlider(slider);
        if (readout) readout.textContent = (val > 0 ? "+" : "") + val.toFixed(1).replace(/\.0$/, "") + " dB";
      });
      if (els.eqPresetBtns) {
        Object.keys(audioFx.EQ_PRESETS).forEach((pid) => {
          const p = audioFx.EQ_PRESETS[pid];
          const match = Math.abs(st.bass - p.bass) < 0.05 && Math.abs(st.mid - p.mid) < 0.05 && Math.abs(st.treble - p.treble) < 0.05;
          const btn = els.eqPresetBtns.find((b) => b.dataset.preset === pid);
          if (btn) setPressedButtonState(btn, match);
        });
      }
      syncStudioBadge();
    }

    function syncMixUI() {
      const mix = audioFx.getFxMix();
      const items = [
        { slider: els.vinylMixRange, readout: els.vinylMixVal, val: Math.round(mix.vinyl * 100) },
        { slider: els.synthMixRange, readout: els.synthMixVal, val: Math.round(mix.synth * 100) },
      ];
      items.forEach(({ slider, readout, val }) => {
        if (!slider) return;
        slider.value = val;
        slider.setAttribute("aria-valuetext", val + "%");
        syncSlider(slider);
        if (readout) readout.textContent = val + "%";
      });
    }

    function syncSleepUI(snap) {
      const st = snap || userState.getSleepSnapshot();
      if (els.sleepBtns) {
        els.sleepBtns.forEach((btn) => {
          const m = btn.dataset.sleep;
          const active = st.mode === "off"
            ? m === "off"
            : st.mode === "track_end"
              ? m === "track_end"
              : (st.mode === "countdown" && Number(m) > 0 && (
                st.targetMinutes
                  ? Number(m) === st.targetMinutes
                  : (st.remainingSec <= Number(m) * 60 && st.remainingSec > (Number(m) === 15 ? 0 : Number(m) === 30 ? 15 * 60 : 30 * 60))
              ));
          setPressedButtonState(btn, active);
        });
      }
      if (els.sleepStatusText) {
        if (st.mode === "off") els.sleepStatusText.textContent = "未开启";
        else if (st.mode === "track_end") els.sleepStatusText.textContent = "播完当前曲目后柔和停止";
        else els.sleepStatusText.textContent = "剩余 " + fmtTime(st.remainingSec) + "（最后 10 秒渐弱）";
      }
      syncStudioBadge();
    }

    function syncAbLoopUI(abState) {
      const st = abState || userState.getAbLoopState();
      if (els.abReadout) {
        if (st.a === null && st.b === null) els.abReadout.textContent = "未设定区间";
        else els.abReadout.textContent = "A " + (st.a !== null ? fmtTime(st.a) : "--:--") + " ↔ B " + (st.b !== null ? fmtTime(st.b) : "--:--") + (st.active ? " · 复读中" : "");
      }
      if (els.abToggleBtn) {
        els.abToggleBtn.disabled = st.a === null || st.b === null;
        setPressedButtonState(els.abToggleBtn, !!st.active);
      }
      if (els.abClearBtn) {
        els.abClearBtn.disabled = st.a === null && st.b === null;
      }
      syncStudioBadge();
    }

    function drawIdleSpectrum() {
      const canvas = els.spectrumCanvas;
      if (!canvas) return;
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 78;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // 基线黄铜刻度线
      ctx.fillStyle = "rgba(212, 166, 74, 0.2)";
      ctx.fillRect(0, h - 8, w, 1);
      const bars = 36;
      const step = w / bars;
      for (let i = 0; i < bars; i++) {
        ctx.fillStyle = "rgba(212, 166, 74, 0.16)";
        ctx.fillRect(i * step + 1, h - 13, Math.max(2, step - 3), 3);
      }
    }

    function renderSpectrumFrame() {
      rafId = null;
      if (!canAnimateSpectrum()) {
        drawIdleSpectrum();
        return;
      }
      const canvas = els.spectrumCanvas;
      const binCount = audioFx.getFrequencyBinCount();
      if (!freqBuf || freqBuf.length !== binCount) {
        freqBuf = new Uint8Array(binCount);
        peakHeights = new Float32Array(36);
      }

      const ok = audioFx.readFrequencyData(freqBuf);
      if (!ok) {
        drawIdleSpectrum();
        return;
      }

      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 78;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const bars = 36;
      const gap = 3;
      const barW = Math.max(2, (w - gap * (bars - 1)) / bars);
      const maxBarH = h - 12;
      const grad = ctx.createLinearGradient(0, h, 0, 6);
      grad.addColorStop(0, "#7f2328");
      grad.addColorStop(0.55, "#c99438");
      grad.addColorStop(1, "#f6dd97");

      for (let i = 0; i < bars; i++) {
        const binIdx = Math.min(binCount - 1, Math.floor((i / bars) * (binCount * 0.72)));
        const raw = freqBuf[binIdx] / 255;
        const barH = Math.max(3, raw * maxBarH);
        const x = i * (barW + gap);
        const y = h - 6 - barH;

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);

        if (barH >= peakHeights[i]) peakHeights[i] = barH;
        else peakHeights[i] = Math.max(3, peakHeights[i] - 0.85);
        const peakY = h - 8 - peakHeights[i];
        ctx.fillStyle = "rgba(255, 240, 184, 0.85)";
        ctx.fillRect(x, peakY, barW, 2);
      }

      rafId = global.requestAnimationFrame(renderSpectrumFrame);
    }

    function canAnimateSpectrum() {
      const reduced = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
      return !!(
        studioOpen &&
        spectrumEnabled &&
        !isSpectrumSkipped &&
        !document.hidden &&
        !audio.paused &&
        !reduced
      );
    }

    function syncSpectrumRunState() {
      const wantAnalyser = !!(studioOpen && spectrumEnabled && !isSpectrumSkipped && !document.hidden);
      audioFx.setAnalyserActive(wantAnalyser);
      if (canAnimateSpectrum()) {
        if (!rafId) rafId = global.requestAnimationFrame(renderSpectrumFrame);
      } else {
        if (rafId) {
          global.cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (studioOpen) drawIdleSpectrum();
      }
    }

    function applyFallbackStudioState(open, restoreFocus) {
      studioOpen = open;
      els.studioPanel.classList.toggle(":popover-open", open);
      els.studioPanel.classList.toggle("studio-open", open);
      setPressedButtonState(els.studioBtn, open);
      syncSpectrumRunState();
      if (open) {
        refreshSwCacheStats();
      } else if (restoreFocus && els.studioBtn) {
        els.studioBtn.focus();
      }
    }

    function openStudio(triggerEl) {
      if (!els.studioPanel) return;
      if (onBeforeOpen) onBeforeOpen();
      let openedNatively = false;
      if (hasNativePopover) {
        try {
          if (!els.studioPanel.matches(":popover-open")) els.studioPanel.showPopover();
          openedNatively = els.studioPanel.matches(":popover-open");
        } catch (e) { openedNatively = false; }
      }
      if (!openedNatively) applyFallbackStudioState(true, false);
      if (triggerEl) els.studioPanel.dataset.lastTriggerId = triggerEl.id || "";
    }

    function closeStudio(restoreFocus) {
      if (!els.studioPanel) return;
      if (hasNativePopover) {
        try {
          if (els.studioPanel.matches(":popover-open")) els.studioPanel.hidePopover();
        } catch (e) { /* ignore */ }
      }
      if (studioOpen || els.studioPanel.classList.contains("studio-open") || els.studioPanel.classList.contains(":popover-open")) {
        applyFallbackStudioState(false, restoreFocus);
      }
    }

    function toggleStudio(triggerEl) {
      if (studioOpen) closeStudio(true);
      else openStudio(triggerEl);
    }

    async function handleShareClick() {
      const track = getCurrentTrack();
      if (!track) {
        if (toast) toast("请先选择一首正在播放的曲目再分享", true);
        return;
      }
      const shareUrl = buildTrackShareUrl(track.url, audio.currentTime || 0);
      const ok = await copyTextToClipboard(shareUrl);
      const btn = els.shareTrackBtn;
      const tip = els.shareStatus;
      clearTimeout(shareFeedbackTimer);
      if (btn) {
        btn.removeAttribute("data-copied");
        btn.removeAttribute("data-failed");
        void btn.offsetWidth;
        btn.setAttribute(ok ? "data-copied" : "data-failed", "");
      }
      if (tip) {
        let msg = ok ? "已复制带当前进度的分享直链" : "复制失败，请手动复制地址栏链接";
        if (msg === lastAnnouncement) msg += "\u00A0";
        lastAnnouncement = msg;
        tip.textContent = msg;
      }
      if (toast) toast(ok ? "已复制分享直链：" + track.title : "剪贴板访问受限，未能复制", !ok);
      shareFeedbackTimer = setTimeout(() => {
        if (btn) {
          btn.removeAttribute("data-copied");
          btn.removeAttribute("data-failed");
        }
        if (tip) tip.textContent = "";
      }, 2200);
    }

    function refreshSwCacheStats() {
      if (!els.swCacheInfo || !("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
        if (els.swCacheInfo) els.swCacheInfo.textContent = (global.location && global.location.protocol === "file:") ? "本地文件模式（不启用离线缓存）" : "缓存就绪";
        return;
      }
      const mc = new MessageChannel();
      mc.port1.onmessage = (e) => {
        const d = e.data || {};
        if (els.swCacheInfo) els.swCacheInfo.textContent = "已离线缓存 " + (d.audioCount || 0) + " 首音轨";
      };
      navigator.serviceWorker.controller.postMessage({ type: "GET_CACHE_STATS" }, [mc.port2]);
    }

    function bindEvents() {
      if (els.studioBtn) {
        if (hasNativePopover && els.studioPanel) {
          els.studioBtn.setAttribute("popovertarget", "studioPanel");
          els.studioBtn.setAttribute("popovertargetaction", "toggle");
        } else {
          els.studioBtn.addEventListener("click", () => toggleStudio(els.studioBtn));
        }
      }

      if (els.studioCloseBtn) {
        els.studioCloseBtn.addEventListener("click", () => closeStudio(true));
      }

      if (hasNativePopover && els.studioPanel) {
        els.studioPanel.addEventListener("toggle", (e) => {
          studioOpen = e.newState === "open";
          if (studioOpen && onBeforeOpen) onBeforeOpen();
          setPressedButtonState(els.studioBtn, studioOpen);
          syncSpectrumRunState();
          if (studioOpen) refreshSwCacheStats();
        });
      } else {
        document.addEventListener("pointerdown", (e) => {
          if (!studioOpen || !els.studioPanel) return;
          if (!els.studioPanel.contains(e.target) && (!els.studioBtn || !els.studioBtn.contains(e.target))) {
            closeStudio(false);
          }
        });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && studioOpen) {
            e.preventDefault();
            closeStudio(true);
          }
        });
      }

      if (els.spectrumToggleBtn) {
        setPressedButtonState(els.spectrumToggleBtn, spectrumEnabled);
        els.spectrumToggleBtn.textContent = spectrumEnabled ? "频谱开启" : "频谱关闭";
        els.spectrumToggleBtn.addEventListener("click", () => {
          spectrumEnabled = !spectrumEnabled;
          storageSet(KEYS.SPECTRUM, spectrumEnabled ? "1" : "0");
          setPressedButtonState(els.spectrumToggleBtn, spectrumEnabled);
          els.spectrumToggleBtn.textContent = spectrumEnabled ? "频谱开启" : "频谱关闭";
          syncSpectrumRunState();
        });
      }

      // 遵循 efficient-background-processing：直接在带 content-visibility: auto 的容器监听，并附带 IO 降级
      if (els.spectrumBox) {
        els.spectrumBox.addEventListener("contentvisibilityautostatechange", (e) => {
          isSpectrumSkipped = !!e.skipped;
          syncSpectrumRunState();
        });
        if (!("contentVisibility" in document.documentElement.style) && "IntersectionObserver" in global) {
          const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              isSpectrumSkipped = !entry.isIntersecting;
              syncSpectrumRunState();
            });
          }, { rootMargin: "120px" });
          io.observe(els.spectrumBox);
        }
      }

      document.addEventListener("visibilitychange", syncSpectrumRunState);
      audio.addEventListener("play", syncSpectrumRunState);
      audio.addEventListener("playing", syncSpectrumRunState);
      audio.addEventListener("pause", syncSpectrumRunState);
      audio.addEventListener("ended", syncSpectrumRunState);

      [
        { el: els.eqBass, band: "bass" },
        { el: els.eqMid, band: "mid" },
        { el: els.eqTreble, band: "treble" },
      ].forEach(({ el, band }) => {
        if (!el) return;
        el.addEventListener("input", () => {
          audioFx.setEqBand(band, parseFloat(el.value));
          syncEqUI();
        });
      });

      if (els.eqPresetBtns) {
        els.eqPresetBtns.forEach((btn) => {
          btn.addEventListener("click", () => {
            audioFx.applyEqPreset(btn.dataset.preset);
            syncEqUI();
          });
        });
      }

      if (els.vinylMixRange) {
        els.vinylMixRange.addEventListener("input", () => {
          audioFx.setFxMix("vinyl", (parseFloat(els.vinylMixRange.value) || 100) / 100);
          syncMixUI();
        });
      }
      if (els.synthMixRange) {
        els.synthMixRange.addEventListener("input", () => {
          audioFx.setFxMix("synth", (parseFloat(els.synthMixRange.value) || 100) / 100);
          syncMixUI();
        });
      }

      if (els.speedBtns) {
        els.speedBtns.forEach((btn) => {
          btn.addEventListener("click", () => applyPlaybackSpeed(parseFloat(btn.dataset.speed), true));
        });
      }
      if (els.crossfadeBtns) {
        els.crossfadeBtns.forEach((btn) => {
          btn.addEventListener("click", () => applyCrossfadeSec(parseInt(btn.dataset.xfade, 10), true));
        });
      }
      if (els.sleepBtns) {
        els.sleepBtns.forEach((btn) => {
          btn.addEventListener("click", () => {
            const val = btn.dataset.sleep;
            userState.setSleepTimer(val === "off" || val === "track_end" ? val : parseInt(val, 10));
            if (toast) {
              toast(val === "off" ? "已取消睡眠定时" : val === "track_end" ? "将在本曲播完后柔和暂停" : "已设定 " + val + " 分钟后渐弱停止");
            }
          });
        });
      }

      if (els.abSetABtn) {
        els.abSetABtn.addEventListener("click", () => {
          if (!getCurrentTrack()) { if (toast) toast("请先播放曲目", true); return; }
          const st = userState.setAbPointA(audio.currentTime || 0);
          if (toast) toast("已设定复读起点 A：" + fmtTime(st.a));
        });
      }
      if (els.abSetBBtn) {
        els.abSetBBtn.addEventListener("click", () => {
          if (!getCurrentTrack()) { if (toast) toast("请先播放曲目", true); return; }
          const res = userState.setAbPointB(audio.currentTime || 0);
          if (res.error) { if (toast) toast(res.error, true); return; }
          if (toast) toast("已设定复读终点 B：" + fmtTime(res.state.b) + "（开始复读）");
        });
      }
      if (els.abToggleBtn) {
        els.abToggleBtn.addEventListener("click", () => {
          const on = userState.toggleAbLoop();
          if (toast) toast(on ? "已恢复 A-B 区间复读" : "已暂停 A-B 区间复读");
        });
      }
      if (els.abClearBtn) {
        els.abClearBtn.addEventListener("click", () => {
          userState.clearAbLoop();
          if (toast) toast("已清除 A-B 复读区间");
        });
      }

      if (els.shareTrackBtn) {
        els.shareTrackBtn.addEventListener("click", handleShareClick);
      }
      if (els.clearAudioCacheBtn) {
        els.clearAudioCacheBtn.addEventListener("click", () => {
          if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
            if (toast) toast("当前无可清理的离线音轨缓存");
            return;
          }
          const mc = new MessageChannel();
          mc.port1.onmessage = () => {
            refreshSwCacheStats();
            if (toast) toast("已清理本地离线音频缓存");
          };
          navigator.serviceWorker.controller.postMessage({ type: "CLEAR_AUDIO_CACHE" }, [mc.port2]);
        });
      }

      userState.subscribe("sleep", syncSleepUI);
      userState.subscribe("abloop", syncAbLoopUI);
    }

    function init() {
      bindEvents();
      syncEqUI();
      syncMixUI();
      applyPlaybackSpeed(playbackSpeed, false);
      applyCrossfadeSec(crossfadeSec, false);
      syncSleepUI();
      syncAbLoopUI();
      drawIdleSpectrum();
    }

    return {
      init,
      openStudio,
      closeStudio,
      toggleStudio,
      isOpen: () => studioOpen,
      getCrossfadeSec: () => crossfadeSec,
      applyPlaybackSpeed,
      handleShareClick,
      syncStudioBadge,
    };
  }

  ns.createStudioController = createStudioController;
})(window);
