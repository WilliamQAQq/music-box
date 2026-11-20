(function (global) {
  "use strict";

  var THEME_KEY = "gh-theme-mode-v1";
  var VALID_MODES = { system: 1, light: 1, dark: 1, eyecare: 1 };
  var THEME_COLORS = {
    light: "#ebe0ca",
    dark: "#190f0a",
    eyecare: "#131210",
  };

  function getStoredThemeMode() {
    try {
      var raw = global.localStorage ? global.localStorage.getItem(THEME_KEY) : null;
      return raw && VALID_MODES[raw] && raw !== "system" ? raw : "system";
    } catch (e) {
      return "system";
    }
  }

  function getSystemScheme() {
    try {
      if (global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
    } catch (e) { /* ignore */ }
    return "light";
  }

  function resolveEffectiveTheme(mode) {
    if (mode === "eyecare") return "eyecare";
    if (mode === "dark") return "dark";
    if (mode === "light") return "light";
    return getSystemScheme();
  }

  function applyThemeToDocument(mode) {
    var safeMode = VALID_MODES[mode] ? mode : "system";
    var doc = global.document;
    if (!doc) return safeMode;

    var metaScheme = doc.querySelector('meta[name="color-scheme"]');
    var metaThemeColor = doc.querySelector('meta[name="theme-color"]');
    var root = doc.documentElement;

    var schemeContent = safeMode === "light" ? "light" : (safeMode === "dark" || safeMode === "eyecare" ? "dark" : "light dark");
    if (metaScheme) metaScheme.content = schemeContent;

    if (root) {
      if (safeMode === "eyecare") {
        root.setAttribute("data-eye-care", "1");
      } else {
        root.removeAttribute("data-eye-care");
      }
    }

    var effective = resolveEffectiveTheme(safeMode);
    if (metaThemeColor) {
      metaThemeColor.content = THEME_COLORS[effective] || THEME_COLORS.dark;
    }
    return safeMode;
  }

  var currentMode = applyThemeToDocument(getStoredThemeMode());
  var listeners = [];

  function notifyListeners() {
    var snapshot = getThemeSnapshot();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](snapshot); } catch (e) { /* ignore */ }
    }
  }

  function setThemeMode(mode) {
    var next = VALID_MODES[mode] ? mode : "system";
    currentMode = applyThemeToDocument(next);
    try {
      if (global.localStorage) {
        if (currentMode === "system") global.localStorage.removeItem(THEME_KEY);
        else global.localStorage.setItem(THEME_KEY, currentMode);
      }
    } catch (e) { /* ignore storage quota/privacy block */ }
    notifyListeners();
    return getThemeSnapshot();
  }

  function toggleEyeCareDark() {
    var next = currentMode === "eyecare" ? "system" : "eyecare";
    return setThemeMode(next);
  }

  function getThemeSnapshot() {
    var sys = getSystemScheme();
    var eff = resolveEffectiveTheme(currentMode);
    return {
      mode: currentMode,
      systemScheme: sys,
      effective: eff,
      isEyeCare: currentMode === "eyecare",
    };
  }

  function subscribeTheme(fn) {
    if (typeof fn === "function") listeners.push(fn);
    return function () {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  // Keep OS preference display & theme-color synchronized without ever deleting pinned user overrides
  try {
    if (global.matchMedia) {
      var mql = global.matchMedia("(prefers-color-scheme: dark)");
      var onSchemeChange = function () {
        applyThemeToDocument(currentMode);
        notifyListeners();
      };
      if (typeof mql.addEventListener === "function") mql.addEventListener("change", onSchemeChange);
      else if (typeof mql.addListener === "function") mql.addListener(onSchemeChange);
    }
  } catch (e) { /* ignore */ }

  // Sync manual theme overrides across open tabs
  if (typeof global.addEventListener === "function") {
    global.addEventListener("storage", function (e) {
      if (!e || e.key === null || e.key === THEME_KEY) {
        currentMode = applyThemeToDocument(getStoredThemeMode());
        notifyListeners();
      }
    });
  }

  var ns = global.__MusicBox || (global.__MusicBox = {});
  ns.theme = {
    KEY: THEME_KEY,
    getSnapshot: getThemeSnapshot,
    setMode: setThemeMode,
    toggleEyeCareDark: toggleEyeCareDark,
    subscribe: subscribeTheme,
  };
})(window);
