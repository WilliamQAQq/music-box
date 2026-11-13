(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const {
    KEYS,
    AUDIO_EXTS,
    IMAGE_EXTS,
    COVER_NAMES,
    DEFAULT_R2_GATEWAY,
    inferGenre,
    hashLibrarySignature,
    storageGet,
    storageSet,
    normalizeR2BaseUrl,
    resolveR2Track,
  } = ns.catalog;

  const VALID_SOURCE_MODES = { hybrid: 1, r2: 1, github: 1 };

  const DEFAULT_SETTINGS = {
    sourceMode: "hybrid",
    r2Url: DEFAULT_R2_GATEWAY || "",
    r2Key: "",
    owner: "WilliamQAQq",
    repo: "music-box",
    branch: "",
    path: "music",
    token: "",
  };

  /**
   * 负责曲库清单加载（本地 music.json / localStorage 指纹缓存 / GitHub API 兜底 / Cloudflare R2 网关）及设置弹窗管理。
   */
  function createLibraryLoader(options) {
    const els = options.els;
    const toast = options.toast;
    const onApplyLibrary = options.onApplyLibrary;
    const onLoadingChange = options.onLoadingChange;
    const onBannerChange = options.onBannerChange;
    const onBeforeModalOpen = options.onBeforeModalOpen;
    const onSettingsResetFilter = options.onSettingsResetFilter;
    const onExternalLyricsChange = options.onExternalLyricsChange;

    let settings = Object.assign({}, DEFAULT_SETTINGS);
    let lastModalTrigger = null;
    let loadSeq = 0;

    function normalizeSourceMode(mode) {
      return VALID_SOURCE_MODES[mode] ? mode : "hybrid";
    }

    function notifyExternalLyricsSource() {
      if (typeof onExternalLyricsChange === "function") {
        onExternalLyricsChange({
          r2Url: normalizeR2BaseUrl(settings.r2Url),
          r2Key: settings.r2Key || "",
          sourceMode: normalizeSourceMode(settings.sourceMode),
        });
      }
    }

    function loadSettings() {
      let hasExplicitR2Url = false;
      try {
        const raw = storageGet(KEYS.STORE, "");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            hasExplicitR2Url = Object.prototype.hasOwnProperty.call(parsed, "r2Url");
            Object.assign(settings, parsed);
          }
        }
      } catch (e) { /* ignore */ }
      settings.sourceMode = normalizeSourceMode(settings.sourceMode);
      settings.r2Url = normalizeR2BaseUrl(
        hasExplicitR2Url ? settings.r2Url : (DEFAULT_R2_GATEWAY || "")
      );
      settings.r2Key = String(settings.r2Key || "").trim();
      notifyExternalLyricsSource();
    }

    function saveSettings() {
      storageSet(KEYS.STORE, JSON.stringify(settings));
    }

    function getModeRadios() {
      return els.settingsForm
        ? Array.from(els.settingsForm.querySelectorAll('input[name="sourceMode"]'))
        : [];
    }

    function getSelectedSourceMode() {
      const checked = els.settingsForm && els.settingsForm.querySelector('input[name="sourceMode"]:checked');
      return normalizeSourceMode(checked ? checked.value : settings.sourceMode);
    }

    function clearFieldValidation(field) {
      if (!field) return;
      field.setCustomValidity("");
      field.removeAttribute("aria-invalid");
      const errId = field.dataset && field.dataset.error;
      if (errId) {
        const errEl = document.getElementById(errId);
        if (errEl) errEl.hidden = true;
        const baseDesc = (field.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter((id) => id && id !== errId);
        if (baseDesc.length) field.setAttribute("aria-describedby", baseDesc.join(" "));
        else field.removeAttribute("aria-describedby");
      }
    }

    function syncSourceModeUI(mode) {
      const m = normalizeSourceMode(mode);
      const showR2 = m === "hybrid" || m === "r2";
      const showGh = m === "hybrid" || m === "github";
      if (els.r2FieldsWrap) els.r2FieldsWrap.hidden = !showR2;
      if (els.githubFieldsWrap) els.githubFieldsWrap.hidden = !showGh;
      if (els.setR2Url) els.setR2Url.required = m === "r2";
      if (els.setOwner) els.setOwner.required = m === "github";
      if (els.setRepo) els.setRepo.required = m === "github";
      if (!showR2) clearFieldValidation(els.setR2Url);
      if (!showGh) {
        clearFieldValidation(els.setOwner);
        clearFieldValidation(els.setRepo);
      }
    }

    function syncFieldAria(field) {
      if (!field) return true;
      const errId = field.dataset && field.dataset.error;
      const errEl = errId ? document.getElementById(errId) : null;
      const isHiddenGroup = !!(field.closest && field.closest("[hidden]"));
      let msg = "";

      if (!field.disabled && !isHiddenGroup) {
        const mode = getSelectedSourceMode();
        if (field === els.setR2Url) {
          const raw = field.value.trim();
          if (mode === "r2" && !raw) {
            msg = "仅 Cloudflare R2 模式下请填写 Worker 网关地址";
          } else if (raw && !normalizeR2BaseUrl(raw)) {
            msg = "请输入有效的 http:// 或 https:// Worker 网关地址";
          }
        } else {
          field.setCustomValidity("");
          if (!field.checkValidity()) {
            msg = field === els.setOwner ? "请填写 GitHub 仓库所有者" : "请填写 GitHub 仓库名称";
          }
        }
      }

      field.setCustomValidity(msg);
      const invalid = !!msg;
      field.setAttribute("aria-invalid", invalid ? "true" : "false");
      if (errEl) {
        if (msg) errEl.textContent = msg;
        errEl.hidden = !invalid;
        const baseDesc = (field.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter((id) => id && id !== errId);
        if (invalid) baseDesc.push(errId);
        if (baseDesc.length) field.setAttribute("aria-describedby", baseDesc.join(" "));
        else field.removeAttribute("aria-describedby");
      }
      return !invalid;
    }

    function fillSettingsForm() {
      const mode = normalizeSourceMode(settings.sourceMode);
      getModeRadios().forEach((radio) => {
        radio.checked = radio.value === mode;
      });
      if (els.setR2Url) els.setR2Url.value = settings.r2Url || "";
      if (els.setR2Key) els.setR2Key.value = settings.r2Key || "";
      els.setOwner.value = settings.owner;
      els.setRepo.value = settings.repo;
      els.setBranch.value = settings.branch;
      els.setPath.value = settings.path;
      els.setToken.value = settings.token;
      syncSourceModeUI(mode);
      [els.setR2Url, els.setOwner, els.setRepo].forEach(clearFieldValidation);
      if (els.r2QuotaDetails) els.r2QuotaDetails.open = false;
      resetQuotaDisplay();
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
      const focusTarget = settings.sourceMode === "github" || !els.setR2Url
        ? els.setOwner
        : els.setR2Url;
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
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

    async function loadFromR2(r2Base, r2Key, force) {
      const base = normalizeR2BaseUrl(r2Base);
      if (!base) throw new Error("Cloudflare R2 网关地址无效");
      const headers = {};
      if (r2Key) headers["X-Music-Key"] = r2Key;
      const res = await fetch(base + "/manifest.json", {
        cache: force ? "no-store" : "no-cache",
        headers,
      });
      if (!res.ok) {
        let msg = "R2 HTTP " + res.status;
        if (res.status === 401) msg = "R2 访问口令无效或缺失";
        else if (res.status === 403) msg = "R2 来源受限（请检查 Worker 白名单 ALLOWED_ORIGINS）";
        else if (res.status === 404) msg = "R2 未找到 manifest.json";
        else if (res.status === 503) {
          let reason = "";
          try {
            const body = await res.json();
            reason = (body && body.reason) || "";
          } catch (e) { /* ignore */ }
          const reasonMap = {
            manual_pause: "管理员已手动暂停网关",
            storage_limit: "存储已达 80%（8 GiB）上限",
            monthly_class_b: "本月读取次数已达 80%（800 万次）上限",
            monthly_class_a: "本月写入操作已达 80%（80 万次）上限",
            daily_requests: "今日网关请求已达 80%（8 万次）上限",
          };
          msg = "已触发 R2 80% 免费额度熔断保护（" + (reasonMap[reason] || "零超额扣费保护生效中") + "）";
        }
        throw new Error(msg);
      }
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error("R2 manifest.json 格式异常");
      const r2Tracks = [];
      const r2Covers = new Map();
      list.forEach((item) => {
        const track = resolveR2Track(item, base);
        if (!track) return;
        r2Tracks.push(track);
        if (track.cover && !r2Covers.has(track.dir)) {
          r2Covers.set(track.dir, track.cover);
        }
      });
      return { tracks: r2Tracks, covers: r2Covers };
    }

    function canonicalMergeKey(track) {
      return String((track && (track.path || track.url)) || "")
        .replace(/^\/+/, "")
        .replace(/^music\//i, "")
        .toLowerCase();
    }

    function mergeLibraryData(ghData, r2Data) {
      const byKey = new Map();
      const ordered = [];
      const mergedCovers = new Map(ghData ? ghData.covers : []);
      if (r2Data && r2Data.covers) {
        r2Data.covers.forEach((val, key) => mergedCovers.set(key, val));
      }

      if (ghData && Array.isArray(ghData.tracks)) {
        ghData.tracks.forEach((t) => {
          const key = canonicalMergeKey(t);
          if (key && !byKey.has(key)) {
            byKey.set(key, ordered.length);
            ordered.push(t);
          }
        });
      }
      if (r2Data && Array.isArray(r2Data.tracks)) {
        r2Data.tracks.forEach((t) => {
          const key = canonicalMergeKey(t);
          if (key && byKey.has(key)) {
            ordered[byKey.get(key)] = t;
          } else {
            if (key) byKey.set(key, ordered.length);
            ordered.push(t);
          }
        });
      }

      ordered.sort((a, b) => {
        const al = String(a.artist || "").toLowerCase();
        const bl = String(b.artist || "").toLowerCase();
        if (al !== bl) return al < bl ? -1 : 1;
        return String(a.title || "").localeCompare(String(b.title || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
      return { tracks: ordered, covers: mergedCovers };
    }

    function getActiveSourceState() {
      const mode = normalizeSourceMode(settings.sourceMode);
      const r2Base = normalizeR2BaseUrl(settings.r2Url);
      const wantR2 = (mode === "r2" || mode === "hybrid") && !!r2Base;
      const wantGh = (mode === "github" || mode === "hybrid") && !!(settings.owner && settings.repo);
      return { mode, r2Base, wantR2, wantGh };
    }

    function isCacheMatching(cache) {
      if (!cache || !Array.isArray(cache.tracks) || !cache.tracks.length) return false;
      const mode = normalizeSourceMode(settings.sourceMode);
      const r2Base = normalizeR2BaseUrl(settings.r2Url);
      if ((cache.sourceMode || "hybrid") !== mode) return false;
      if ((cache.r2Url || "") !== r2Base) return false;
      if (!!cache.hasR2Key !== !!settings.r2Key) return false;
      if (mode === "r2") return true;
      return (
        cache.owner === settings.owner &&
        cache.repo === settings.repo &&
        (cache.branch || "") === settings.branch &&
        (cache.path === undefined ? DEFAULT_SETTINGS.path : cache.path) === settings.path
      );
    }

    async function loadLibrary(force) {
      const { mode, r2Base, wantR2, wantGh } = getActiveSourceState();
      if (!wantR2 && !wantGh) {
        onLoadingChange(false);
        onBannerChange(true, settings);
        return;
      }

      const seq = ++loadSeq;
      const useLocal = wantGh && canUseLocalManifest();
      const cache = force ? null : loadCache();
      const useCache = isCacheMatching(cache);

      let cacheSig = "";
      const shouldRevalidate = useLocal || wantR2;
      if (useCache) {
        cacheSig = cache.sig || hashLibrarySignature(cache.tracks, cache.covers);
        onApplyLibrary(cache);
        onBannerChange(false, settings);
        if (!shouldRevalidate) return;
      } else {
        onLoadingChange(true);
      }

      const fetchGitHubSource = async () => {
        let ghData = null;
        if (useLocal) {
          try {
            ghData = filterLocalManifest(await loadFromMusicJson(force));
          } catch (e) { /* music.json 不存在时回退到 GitHub API */ }
        }
        if (!ghData || !ghData.tracks.length) {
          if (useCache && !wantR2) return null;
          const branch = await getDefaultBranch();
          ghData = await fetchTracks(branch);
        }
        return ghData;
      };

      try {
        let data = null;
        let partialWarning = "";
        let isPartialDegraded = false;
        if (wantGh && wantR2) {
          const [ghRes, r2Res] = await Promise.allSettled([
            fetchGitHubSource(),
            loadFromR2(r2Base, settings.r2Key, force),
          ]);
          if (seq !== loadSeq) return;

          const ghOk = ghRes.status === "fulfilled" && ghRes.value;
          const r2Ok = r2Res.status === "fulfilled" && r2Res.value;
          if (!ghOk && !r2Ok) {
            throw (r2Res.reason || ghRes.reason || new Error("全部数据源加载失败"));
          }
          if (!r2Ok) {
            isPartialDegraded = true;
            const errMsg = (r2Res.reason && r2Res.reason.message) || "网络或权限异常";
            const cacheHasR2 = !!(useCache && Array.isArray(cache.tracks) && cache.tracks.some((t) => t && t.source === "r2"));
            if (!useCache || force || cacheHasR2) {
              partialWarning = "R2 网关暂不可用（" + errMsg + "），当前显示 GitHub 曲库";
            }
            data = ghRes.value;
          } else if (!ghOk) {
            isPartialDegraded = true;
            const errMsg = (ghRes.reason && ghRes.reason.message) || "加载失败";
            const r2Tracks = (r2Res.value && Array.isArray(r2Res.value.tracks)) ? r2Res.value.tracks : [];
            if (useCache && r2Tracks.length === 0) {
              toast("GitHub 曲库刷新失败（" + errMsg + "），当前显示缓存歌单", true);
              onBannerChange(false, settings);
              return;
            }
            partialWarning = "GitHub 曲库加载失败（" + errMsg + "），已加载 R2 曲库";
            data = r2Res.value;
          } else {
            data = mergeLibraryData(ghRes.value, r2Res.value);
          }
        } else if (wantR2) {
          data = await loadFromR2(r2Base, settings.r2Key, force);
        } else {
          data = await fetchGitHubSource();
          if (!data) return;
        }

        if (seq !== loadSeq) return;

        const newCovers = toCoverMap(data.covers);
        const nextSig = hashLibrarySignature(data.tracks, newCovers);
        const changed = !useCache || nextSig !== cacheSig;
        if (!isPartialDegraded && (changed || (cache && !cache.sig))) {
          saveCache({
            sourceMode: mode,
            r2Url: r2Base,
            hasR2Key: !!settings.r2Key,
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
          if (!partialWarning) {
            toast((useCache ? "歌单已更新，共 " : "已加载 ") + data.tracks.length + " 首音乐");
          }
        }
        if (partialWarning) {
          toast(partialWarning, true);
        }
        onBannerChange(false, settings);
      } catch (err) {
        if (seq !== loadSeq) return;
        if (useCache) {
          const msg = String((err && err.message) || "");
          if (/熔断|口令|受限/.test(msg)) {
            toast(msg + "（当前暂播本地缓存曲目）", true);
          }
          return;
        }
        onLoadingChange(false);
        els.trackCount.textContent = "";
        onBannerChange(true, settings);
        toast("加载失败：" + err.message, true);
      }
    }

    const SHIELD_REASON_TEXT = {
      manual_pause: "管理员已手动暂停",
      storage_limit: "存储已达 80% 上限",
      monthly_class_b: "本月读取已达 80% 上限",
      monthly_class_a: "本月写入已达 80% 上限",
      daily_requests: "今日请求已达 80% 上限",
    };

    function formatQuotaBytes(bytes) {
      const n = Math.max(0, Number(bytes) || 0);
      if (n >= 1024 ** 3) return (n / (1024 ** 3)).toFixed(2) + " GiB";
      if (n >= 1024 ** 2) return (n / (1024 ** 2)).toFixed(1) + " MiB";
      if (n >= 1024) return (n / 1024).toFixed(1) + " KiB";
      return n + " B";
    }

    function setQuotaBarRow(barEl, valEl, pct, labelText) {
      if (barEl) {
        const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
        barEl.value = clamped;
        if (clamped >= 95) barEl.setAttribute("data-level", "danger");
        else if (clamped >= 75) barEl.setAttribute("data-level", "warn");
        else barEl.removeAttribute("data-level");
      }
      if (valEl) valEl.textContent = labelText;
    }

    function resetQuotaDisplay(message) {
      if (els.r2QuotaGrid) els.r2QuotaGrid.hidden = true;
      if (els.r2QuotaBadge) {
        els.r2QuotaBadge.textContent = "待查询";
        els.r2QuotaBadge.setAttribute("data-state", "idle");
      }
      if (els.r2QuotaSummary) {
        els.r2QuotaSummary.textContent = message || "展开后将通过当前页面 Origin 鉴权查询 /quota";
      }
    }

    let quotaReqSeq = 0;
    let lastQuotaFetchStartMs = 0;

    async function refreshR2Quota() {
      const reqSeq = ++quotaReqSeq;
      lastQuotaFetchStartMs = Date.now();
      const r2Base = normalizeR2BaseUrl(els.setR2Url ? els.setR2Url.value : settings.r2Url);
      if (!r2Base) {
        resetQuotaDisplay("请先填写有效的 Cloudflare R2 Worker 网关地址");
        return;
      }
      const r2Key = els.setR2Key ? els.setR2Key.value.trim() : settings.r2Key;
      const headers = {};
      if (r2Key) headers["X-Music-Key"] = r2Key;
      if (els.refreshR2QuotaBtn) els.refreshR2QuotaBtn.setAttribute("aria-busy", "true");
      if (els.r2QuotaBadge) {
        els.r2QuotaBadge.textContent = "查询中…";
        els.r2QuotaBadge.setAttribute("data-state", "idle");
      }
      if (els.r2QuotaSummary) els.r2QuotaSummary.textContent = "正在通过当前页面 Origin 向网关请求额度状态…";

      try {
        const res = await fetch(r2Base + "/quota", { cache: "no-store", headers });
        if (reqSeq !== quotaReqSeq) return;
        if (!res.ok) {
          let errMsg = "HTTP " + res.status;
          if (res.status === 401) errMsg = "需要填写正确 R2 访问口令";
          else if (res.status === 403) errMsg = "当前页面 Origin 不在网关白名单中";
          throw new Error(errMsg);
        }
        const q = await res.json();
        if (reqSeq !== quotaReqSeq) return;
        const usage = q.usage || {};
        const limits = q.limits || {};
        const percent = q.percent || {};

        setQuotaBarRow(
          els.quotaDailyBar,
          els.quotaDailyVal,
          percent.dailyRequests,
          Number(usage.dailyReqs || 0).toLocaleString("zh-CN") +
            " / " + Number(limits.maxDailyRequests || 80000).toLocaleString("zh-CN") +
            " 次 (" + (percent.dailyRequests || 0) + "%)"
        );
        setQuotaBarRow(
          els.quotaClassBBar,
          els.quotaClassBVal,
          percent.monthlyClassB,
          Number(usage.monthlyClassB || 0).toLocaleString("zh-CN") +
            " / " + Number(limits.maxMonthlyClassB || 8000000).toLocaleString("zh-CN") +
            " 次 (" + (percent.monthlyClassB || 0) + "%)"
        );
        setQuotaBarRow(
          els.quotaClassABar,
          els.quotaClassAVal,
          percent.monthlyClassA,
          Number(usage.monthlyClassA || 0).toLocaleString("zh-CN") +
            " / " + Number(limits.maxMonthlyClassA || 800000).toLocaleString("zh-CN") +
            " 次 (" + (percent.monthlyClassA || 0) + "%)"
        );
        setQuotaBarRow(
          els.quotaStorageBar,
          els.quotaStorageVal,
          percent.storage,
          formatQuotaBytes(usage.storageBytes || 0) +
            " / " + formatQuotaBytes(limits.maxStorageBytes || 8 * 1024 ** 3) +
            " (" + (percent.storage || 0) + "%)"
        );

        if (els.r2QuotaGrid) els.r2QuotaGrid.hidden = false;
        const maxPct = Math.max(
          Number(percent.dailyRequests) || 0,
          Number(percent.monthlyClassB) || 0,
          Number(percent.monthlyClassA) || 0,
          Number(percent.storage) || 0
        );
        if (els.r2QuotaBadge) {
          if (q.shielded) {
            els.r2QuotaBadge.textContent = "已熔断";
            els.r2QuotaBadge.setAttribute("data-state", "shielded");
          } else if (maxPct >= 75) {
            els.r2QuotaBadge.textContent = "接近阈值";
            els.r2QuotaBadge.setAttribute("data-state", "warn");
          } else {
            els.r2QuotaBadge.textContent = "安全运行";
            els.r2QuotaBadge.setAttribute("data-state", "ok");
          }
        }
        if (els.r2QuotaSummary) {
          els.r2QuotaSummary.textContent = q.shielded
            ? "已触发 80% 零超额熔断：" + (SHIELD_REASON_TEXT[q.reason] || q.reason || "受保护中")
            : "当前各项占用均低于 80% 免费安全线 · 周期 " + (q.day || "");
        }
      } catch (err) {
        if (reqSeq !== quotaReqSeq) return;
        if (els.r2QuotaGrid) els.r2QuotaGrid.hidden = true;
        if (els.r2QuotaBadge) {
          els.r2QuotaBadge.textContent = "查询受限";
          els.r2QuotaBadge.setAttribute("data-state", "warn");
        }
        if (els.r2QuotaSummary) {
          els.r2QuotaSummary.textContent = "额度查询失败：" + ((err && err.message) || "网络异常");
        }
      } finally {
        if (reqSeq === quotaReqSeq && els.refreshR2QuotaBtn) {
          els.refreshR2QuotaBtn.removeAttribute("aria-busy");
        }
      }
    }

    function bindEvents() {
      els.reloadBtn.addEventListener("click", () => {
        const { wantR2, wantGh } = getActiveSourceState();
        if (!wantR2 && !wantGh) { openSettings(els.reloadBtn); return; }
        loadLibrary(true);
      });
      els.settingsBtn.addEventListener("click", () => openSettings(els.settingsBtn));
      els.bannerCta.addEventListener("click", () => {
        const { wantR2, wantGh } = getActiveSourceState();
        if (wantR2 || wantGh) loadLibrary(true);
        else openSettings(els.bannerCta);
      });
      els.closeModalBtn.addEventListener("click", closeSettings);
      els.settingsModal.addEventListener("click", (e) => {
        if (e.target === els.settingsModal) closeSettings();
      });

      getModeRadios().forEach((radio) => {
        radio.addEventListener("change", () => {
          syncSourceModeUI(getSelectedSourceMode());
          els.formError.textContent = "";
        });
      });

      if (els.r2QuotaDetails) {
        els.r2QuotaDetails.addEventListener("toggle", () => {
          if (els.r2QuotaDetails.open && Date.now() - lastQuotaFetchStartMs > 80) {
            refreshR2Quota();
          }
        });
      }
      if (els.refreshR2QuotaBtn) {
        els.refreshR2QuotaBtn.addEventListener("click", () => {
          if (els.r2QuotaDetails && !els.r2QuotaDetails.open) els.r2QuotaDetails.open = true;
          refreshR2Quota();
        });
      }
      if (els.setR2Url) {
        els.setR2Url.addEventListener("input", () => {
          resetQuotaDisplay("地址已修改，请点击「刷新额度」或先保存设置");
        });
      }

      [els.setR2Url, els.setOwner, els.setRepo].forEach((field) => {
        if (!field) return;
        field.addEventListener("blur", () => syncFieldAria(field));
        field.addEventListener("input", () => {
          els.formError.textContent = "";
          if (field.getAttribute("aria-invalid") === "true") {
            syncFieldAria(field);
          } else {
            field.setCustomValidity("");
          }
        });
      });

      els.settingsForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const mode = getSelectedSourceMode();
        const validated = [els.setR2Url, els.setOwner, els.setRepo];
        let firstInvalid = null;
        validated.forEach((field) => {
          if (!syncFieldAria(field) && !firstInvalid) {
            firstInvalid = field;
          }
        });
        if (firstInvalid) {
          els.formError.textContent = "请修正标红的必填或格式有误字段";
          firstInvalid.focus();
          return;
        }

        const nextR2Url = normalizeR2BaseUrl(els.setR2Url ? els.setR2Url.value : "");
        const nextR2Key = els.setR2Key ? els.setR2Key.value.trim() : "";
        const nextOwner = els.setOwner.value.trim();
        const nextRepo = els.setRepo.value.trim();
        if (mode === "hybrid" && !nextR2Url && (!nextOwner || !nextRepo)) {
          els.formError.textContent = "混排模式下请至少填写 GitHub 仓库或 Cloudflare R2 网关地址";
          if (els.setR2Url) els.setR2Url.focus();
          return;
        }

        settings.sourceMode = mode;
        settings.r2Url = nextR2Url;
        settings.r2Key = nextR2Key;
        settings.owner = nextOwner;
        settings.repo = nextRepo;
        settings.branch = els.setBranch.value.trim();
        settings.path = els.setPath.value.trim().replace(/^\/+|\/+$/g, "");
        settings.token = els.setToken.value.trim();
        notifyExternalLyricsSource();
        if (onSettingsResetFilter) onSettingsResetFilter();
        saveSettings();
        closeSettings();
        loadLibrary(true);
      });

      if (els.resetSettingsBtn) {
        els.resetSettingsBtn.addEventListener("click", () => {
          settings = Object.assign({}, DEFAULT_SETTINGS);
          notifyExternalLyricsSource();
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
