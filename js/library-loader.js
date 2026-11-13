(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const {
    KEYS,
    AUDIO_EXTS,
    IMAGE_EXTS,
    COVER_NAMES,
    inferGenre,
    hashLibrarySignature,
    storageGet,
    storageSet,
  } = ns.catalog;

  const DEFAULT_SETTINGS = {
    owner: "WilliamQAQq",
    repo: "music-box",
    branch: "",
    path: "music",
    token: "",
  };

  /**
   * 负责曲库清单加载（本地 music.json / localStorage 指纹缓存 / GitHub API 兜底）及唱片柜设置弹窗管理。
   */
  function createLibraryLoader(options) {
    const els = options.els;
    const toast = options.toast;
    const onApplyLibrary = options.onApplyLibrary;
    const onLoadingChange = options.onLoadingChange;
    const onBannerChange = options.onBannerChange;
    const onBeforeModalOpen = options.onBeforeModalOpen;
    const onSettingsResetFilter = options.onSettingsResetFilter;

    let settings = Object.assign({}, DEFAULT_SETTINGS);
    let lastModalTrigger = null;
    let loadSeq = 0;

    function loadSettings() {
      try {
        const raw = storageGet(KEYS.STORE, "");
        if (raw) Object.assign(settings, JSON.parse(raw));
      } catch (e) { /* ignore */ }
    }

    function saveSettings() {
      storageSet(KEYS.STORE, JSON.stringify(settings));
    }

    function fillSettingsForm() {
      els.setOwner.value = settings.owner;
      els.setRepo.value = settings.repo;
      els.setBranch.value = settings.branch;
      els.setPath.value = settings.path;
      els.setToken.value = settings.token;
    }

    function setBackgroundInert(isInert) {
      [els.topbar, els.content, els.player, els.queueDrawer, els.studioPanel].forEach((el) => {
        if (!el) return;
        if (isInert) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
      });
    }

    function openSettings(triggerEl) {
      if (onBeforeModalOpen) onBeforeModalOpen();
      const active = document.activeElement;
      lastModalTrigger = (triggerEl && triggerEl.nodeType === 1)
        ? triggerEl
        : (active && active !== document.body ? active : els.settingsBtn);
      fillSettingsForm();
      els.formError.textContent = "";
      els.settingsModal.hidden = false;
      setBackgroundInert(true);
      els.setOwner.focus();
    }

    function closeSettings() {
      if (els.settingsModal.hidden) return;
      els.settingsModal.hidden = true;
      setBackgroundInert(false);
      const target = (lastModalTrigger && lastModalTrigger !== document.body && !lastModalTrigger.hidden)
        ? lastModalTrigger
        : els.settingsBtn;
      lastModalTrigger = null;
      if (target && typeof target.focus === "function") {
        target.focus();
      }
    }

    function ghHeaders() {
      const h = { Accept: "application/vnd.github+json" };
      if (settings.token) h.Authorization = "token " + settings.token;
      return h;
    }

    async function ghFetch(url) {
      const res = await fetch(url, { headers: ghHeaders() });
      if (!res.ok) {
        let msg = "HTTP " + res.status;
        if (res.status === 401) msg = "令牌无效或已过期";
        if (res.status === 403) msg = "访问被拒绝(私有仓库需令牌，或触发 API 限流)";
        if (res.status === 404) msg = "仓库或路径不存在";
        if (res.status === 429) msg = "GitHub API 限流，请稍后重试或填入令牌";
        throw new Error(msg);
      }
      return res.json();
    }

    async function getDefaultBranch() {
      if (settings.branch) return settings.branch;
      const info = await ghFetch(
        "https://api.github.com/repos/" + encodeURIComponent(settings.owner) + "/" + encodeURIComponent(settings.repo)
      );
      return info.default_branch || "main";
    }

    function rawUrl(branch, path) {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      return "https://raw.githubusercontent.com/" +
        encodeURIComponent(settings.owner) + "/" +
        encodeURIComponent(settings.repo) + "/" +
        encodeURIComponent(branch) + "/" +
        encodedPath;
    }

    async function fetchTracks(branch) {
      const tree = await ghFetch(
        "https://api.github.com/repos/" +
        encodeURIComponent(settings.owner) + "/" +
        encodeURIComponent(settings.repo) + "/git/trees/" +
        encodeURIComponent(branch) + "?recursive=1"
      );
      if (tree.truncated) toast("仓库较大，文件列表可能不完整", true);

      const items = tree.tree || [];
      const prefix = settings.path ? settings.path.replace(/\/+$/, "") + "/" : "";

      const newTracks = [];
      const coverMap = new Map();

      for (const it of items) {
        if (it.type !== "blob") continue;
        const p = it.path || "";
        if (prefix && p.indexOf(prefix) !== 0) continue;

        const lower = p.toLowerCase();
        const dot = lower.lastIndexOf(".");
        if (dot === -1) continue;
        const ext = lower.slice(dot + 1);
        const baseName = lower.slice(lower.lastIndexOf("/") + 1, dot);
        const dir = p.slice(0, p.lastIndexOf("/"));

        if (AUDIO_EXTS.indexOf(ext) !== -1) {
          const rawStem = p.slice(p.lastIndexOf("/") + 1, dot)
            .replace(/(_|\s)+spotdown\.org$/i, "")
            .replace(/\s*\(SPOTISAVER\)$/i, "");
          let artist = "";
          let title = rawStem;
          const dashIdx = rawStem.indexOf(" - ");
          if (dashIdx > 0) {
            artist = rawStem.slice(0, dashIdx).trim();
            title = rawStem.slice(dashIdx + 3).trim();
          }
          title = title.replace(/[_-]+/g, " ").trim();
          const genre = inferGenre(artist, "", p);
          newTracks.push({ title, artist, album: "", genre, cover: "", path: p, dir, url: rawUrl(branch, p) });
        } else if (IMAGE_EXTS.indexOf(ext) !== -1) {
          if (!coverMap.has(dir) || COVER_NAMES.indexOf(baseName) !== -1) {
            coverMap.set(dir, rawUrl(branch, p));
          }
        }
      }

      newTracks.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
      return { tracks: newTracks, covers: coverMap };
    }

    async function loadFromMusicJson(force) {
      // 普通启动用 no-cache 允许 304 协商节省流量，强制刷新用 no-store
      const res = await fetch("music.json", { cache: force ? "no-store" : "no-cache" });
      if (!res.ok) throw new Error("no music.json");
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error("bad music.json");
      const t = [];
      const c = new Map();
      list.forEach((item) => {
        if (!item || !item.url) return;
        const url = String(item.url);
        const dir = item.dir || (url.indexOf("/") !== -1 ? url.slice(0, url.lastIndexOf("/")) : "");
        const artist = item.artist ? String(item.artist) : "";
        t.push({
          title: String(item.title || url.slice(url.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")),
          artist: artist,
          album: item.album ? String(item.album) : "",
          genre: inferGenre(artist, item.genre, url),
          cover: item.cover ? String(item.cover) : "",
          url: url,
          path: url,
          dir: dir,
        });
        if (item.cover && !c.has(dir)) c.set(dir, String(item.cover));
      });
      return { tracks: t, covers: c };
    }

    function canUseLocalManifest() {
      if (settings.owner.toLowerCase() !== DEFAULT_SETTINGS.owner.toLowerCase()) return false;
      if (settings.repo.toLowerCase() !== DEFAULT_SETTINGS.repo.toLowerCase()) return false;
      if (settings.branch) return false;
      const p = settings.path;
      return !p || p === DEFAULT_SETTINGS.path || p.indexOf(DEFAULT_SETTINGS.path + "/") === 0;
    }

    function filterLocalManifest(data) {
      const p = settings.path;
      if (!p || p === DEFAULT_SETTINGS.path) return data;
      const prefix = p.replace(/\/+$/, "") + "/";
      return {
        tracks: data.tracks.filter((t) => t.path.indexOf(prefix) === 0),
        covers: data.covers,
      };
    }

    function toCoverMap(c) {
      return c instanceof Map ? c : new Map(c || []);
    }

    function loadCache() {
      try {
        const raw = storageGet(KEYS.CACHE, "");
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (c && c.covers) c.covers = new Map(c.covers);
        return c;
      } catch (e) { return null; }
    }

    function saveCache(c) {
      try {
        storageSet(KEYS.CACHE, JSON.stringify(c));
      } catch (e) { /* ignore quota */ }
    }

    async function loadLibrary(force) {
      if (!settings.owner || !settings.repo) {
        onBannerChange(true, settings);
        return;
      }

      const seq = ++loadSeq;
      const useLocal = canUseLocalManifest();
      const cache = force ? null : loadCache();
      const useCache = !!(cache &&
        cache.owner === settings.owner &&
        cache.repo === settings.repo &&
        (cache.branch || "") === settings.branch &&
        (cache.path === undefined ? DEFAULT_SETTINGS.path : cache.path) === settings.path &&
        Array.isArray(cache.tracks) && cache.tracks.length);

      let cacheSig = "";
      if (useCache) {
        cacheSig = cache.sig || hashLibrarySignature(cache.tracks, cache.covers);
        onApplyLibrary(cache);
        onBannerChange(false, settings);
        if (!useLocal) return;
      } else {
        onLoadingChange(true);
      }

      try {
        let data = null;
        if (useLocal) {
          try {
            data = filterLocalManifest(await loadFromMusicJson(force));
          } catch (e) { /* music.json 不存在时回退到 GitHub API */ }
        }
        if (!data || !data.tracks.length) {
          if (useCache) return;
          const branch = await getDefaultBranch();
          data = await fetchTracks(branch);
        }
        if (seq !== loadSeq) return;

        const newCovers = toCoverMap(data.covers);
        const nextSig = hashLibrarySignature(data.tracks, newCovers);
        const changed = !useCache || nextSig !== cacheSig;
        if (changed || (cache && !cache.sig)) {
          saveCache({
            owner: settings.owner,
            repo: settings.repo,
            branch: settings.branch,
            path: settings.path,
            sig: nextSig,
            tracks: data.tracks,
            covers: [...newCovers],
          });
        }
        if (changed) {
          onApplyLibrary({ tracks: data.tracks, covers: newCovers });
          toast((useCache ? "歌单已更新，共 " : "已加载 ") + data.tracks.length + " 首音乐");
        }
        onBannerChange(false, settings);
      } catch (err) {
        if (seq !== loadSeq || useCache) return;
        onLoadingChange(false);
        els.trackCount.textContent = "";
        onBannerChange(true, settings);
        toast("加载失败：" + err.message, true);
      }
    }

    function bindEvents() {
      els.reloadBtn.addEventListener("click", () => {
        if (!settings.owner || !settings.repo) { openSettings(els.reloadBtn); return; }
        loadLibrary(true);
      });
      els.settingsBtn.addEventListener("click", () => openSettings(els.settingsBtn));
      els.bannerCta.addEventListener("click", () => {
        if (settings.owner && settings.repo) loadLibrary(true);
        else openSettings(els.bannerCta);
      });
      els.closeModalBtn.addEventListener("click", closeSettings);
      els.settingsModal.addEventListener("click", (e) => {
        if (e.target === els.settingsModal) closeSettings();
      });

      els.settingsForm.addEventListener("submit", (e) => {
        e.preventDefault();
        settings.owner = els.setOwner.value.trim();
        settings.repo = els.setRepo.value.trim();
        settings.branch = els.setBranch.value.trim();
        settings.path = els.setPath.value.trim().replace(/^\/+|\/+$/g, "");
        settings.token = els.setToken.value.trim();
        if (onSettingsResetFilter) onSettingsResetFilter();
        saveSettings();
        closeSettings();
        loadLibrary(true);
      });

      if (els.resetSettingsBtn) {
        els.resetSettingsBtn.addEventListener("click", () => {
          settings = Object.assign({}, DEFAULT_SETTINGS);
          if (onSettingsResetFilter) onSettingsResetFilter();
          saveSettings();
          fillSettingsForm();
          closeSettings();
          loadLibrary(true);
        });
      }
    }

    loadSettings();
    bindEvents();

    return {
      getSettings: () => settings,
      openSettings,
      closeSettings,
      isModalOpen: () => !els.settingsModal.hidden,
      loadLibrary,
      lookupCover(coversMap, dir) {
        let d = dir;
        while (true) {
          if (coversMap.has(d)) return coversMap.get(d);
          if (!d) break;
          const i = d.lastIndexOf("/");
          if (i === -1) d = "";
          else d = d.slice(0, i);
        }
        return null;
      },
    };
  }

  ns.createLibraryLoader = createLibraryLoader;
})(window);
