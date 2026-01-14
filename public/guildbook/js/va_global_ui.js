

(() => {
  "use strict";

  // ----------------------------
  // Storage Keys (canonical)
  // ----------------------------
  const QUEST_ID_KEY  = "vaq_activeQuestId";
  const QUEST_CAT_KEY = "vaq_activeQuestCatalog";
  const FLAGS_KEY     = "va_flags";

  // Optional/common keys
  const NAME_KEY = "va_player_name";
  const GOOD_KEY = "va_good";
  const EVIL_KEY = "va_evil";

  // Default catalog (page can override by setting localStorage[QUEST_CAT_KEY])
  const DEFAULT_CATALOG_URL = "/guildbook/quests/dreadheim_quests.json";

  // ----------------------------
  // Resume (global "return where I left off")
  // ----------------------------
  const RESUME_KEY = "va_resume_state";

  // ----------------------------
  // Once-only dialogue + default dialogue
  // ----------------------------
  const DIALOGUE_ONCE_KEY = "va_dialogue_once"; // object map { [dialogueId]: true }
  const DEFAULT_DIALOGUE_URL = "/data/episodes/volume1_ep1/defaultdialoguenpc.json";

  // ----------------------------
  // Utilities
  // ----------------------------
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function getNum(key) {
    const v = Number(localStorage.getItem(key) || "0");
    return Number.isFinite(v) ? v : 0;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getName() {
    return (localStorage.getItem(NAME_KEY) || "").trim() || "Traveler";
  }

  function txt(t) {
    return String(t ?? "").replaceAll("{name}", getName());
  }

  function getFlags() {
    try { return JSON.parse(localStorage.getItem(FLAGS_KEY) || "{}"); }
    catch { return {}; }
  }

  function setFlags(obj) {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(obj || {}));
  }

  async function loadJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    return await res.json();
  }

  // ----------------------------
  // Resume System (GLOBAL)
  // ----------------------------
  function saveResumeState(extra = {}) {
    try {
      const state = {
        url: window.location.pathname + window.location.search,
        time: Date.now(),
        ...extra
      };
      localStorage.setItem(RESUME_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Resume save failed", e);
    }
  }

  function getResumeState() {
    try { return JSON.parse(localStorage.getItem(RESUME_KEY) || "null"); }
    catch { return null; }
  }

  function clearResumeState() {
    localStorage.removeItem(RESUME_KEY);
  }

  // ----------------------------
  // Once-only Dialogue Helpers
  // ----------------------------
  function _getOnceMap() {
    try {
      const m = JSON.parse(localStorage.getItem(DIALOGUE_ONCE_KEY) || "{}");
      return (m && typeof m === "object") ? m : {};
    } catch {
      return {};
    }
  }

  function _setOnceMap(m) {
    localStorage.setItem(DIALOGUE_ONCE_KEY, JSON.stringify(m || {}));
  }

  // Example dialogueId: "hel_meadhall", "loki_room", "cutscene_dreadheim_scene1"
  function dlgHasPlayed(dialogueId) {
    if (!dialogueId) return false;
    const m = _getOnceMap();
    return !!m[String(dialogueId)];
  }

  function dlgMarkPlayed(dialogueId) {
    if (!dialogueId) return;
    const m = _getOnceMap();
    m[String(dialogueId)] = true;
    _setOnceMap(m);
  }

  // Allow dev/testing resets for one dialogue only
  function dlgUnmarkPlayed(dialogueId) {
    if (!dialogueId) return;
    const m = _getOnceMap();
    delete m[String(dialogueId)];
    _setOnceMap(m);
  }

  // Default dialogue cache
  let __defaultDialogueCache = null;
  let __defaultDialogueCacheUrl = DEFAULT_DIALOGUE_URL;

  function dlgSetDefaultUrl(url) {
    if (!url) return;
    __defaultDialogueCacheUrl = String(url);
    __defaultDialogueCache = null; // reset cache
  }

  async function dlgLoadDefaults(url) {
    const u = url ? String(url) : __defaultDialogueCacheUrl;
    if (__defaultDialogueCache && __defaultDialogueCache.__url === u) return __defaultDialogueCache.data;

    const data = await loadJSON(u);
    __defaultDialogueCache = { __url: u, data };
    return data;
  }

  // Returns {speaker, portrait, line} for a given npcKey from defaultdialoguenpc.json
  // npcKey examples must match your JSON defaults keys:
  // "hel_meadhall", "loki_room", etc.
  async function dlgGetDefault(npcKey, url) {
    const data = await dlgLoadDefaults(url);
    const defaults = data?.defaults || {};
    const entry = defaults?.[npcKey];

    if (!entry) {
      return {
        speaker: "…",
        portrait: "/guildbook/npcs/placeholder.png",
        line: "…"
      };
    }

    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    const line = lines.length
      ? lines[Math.floor(Math.random() * lines.length)]
      : "…";

    return {
      speaker: entry.speaker || "…",
      portrait: entry.portrait || "/guildbook/npcs/placeholder.png",
      line: txt(line)
    };
  }

  // ----------------------------
  // Quest Helpers (VAQ)
  // ----------------------------
  function qGetActiveId() {
    return localStorage.getItem(QUEST_ID_KEY) || "";
  }

  function qGetCatalogUrl() {
    return localStorage.getItem(QUEST_CAT_KEY) || DEFAULT_CATALOG_URL;
  }

  function qSetCatalog(url) {
    if (!url) return;
    localStorage.setItem(QUEST_CAT_KEY, String(url));
  }

  function qSetActive(id, catalogUrl) {
    if (!id) return;
    localStorage.setItem(QUEST_ID_KEY, String(id));
    if (catalogUrl) qSetCatalog(catalogUrl);
  }

  function qClearActive() {
    localStorage.removeItem(QUEST_ID_KEY);
  }

  // Simple quest completion marker (you can use in catalog rules elsewhere)
  function qComplete(id) {
    if (!id) id = qGetActiveId();
    if (!id) return;
    const f = getFlags();
    f[`q_${id}_complete`] = true;
    setFlags(f);
    qClearActive();
  }

  // Mark a step pass/fail (matches your journal logic)
  function qSetStepStatus(questId, stepIndex, status /* "pass"|"fail" */) {
    if (!questId && qGetActiveId()) questId = qGetActiveId();
    if (!questId) return;
    const idx = Number(stepIndex);
    if (!Number.isFinite(idx)) return;
    if (status !== "pass" && status !== "fail") return;

    const f = getFlags();
    f[`${questId}_step${idx}`] = status;
    setFlags(f);
  }

  // Convenience: read a quest from current catalog
  async function qGetActiveQuest() {
    const activeId = qGetActiveId();
    if (!activeId) return null;
    const catalogUrl = qGetCatalogUrl();
    const catalog = await loadJSON(catalogUrl);
    const q = (catalog?.quests && catalog.quests[activeId]) ? catalog.quests[activeId] : null;
    return q ? { id: activeId, ...q } : null;
  }

  // ----------------------------
  // Dev Helpers (console)
  // ----------------------------
  function devResetAll() {
    localStorage.removeItem(QUEST_ID_KEY);
    localStorage.removeItem(QUEST_CAT_KEY);
    localStorage.removeItem(FLAGS_KEY);
    localStorage.removeItem(RESUME_KEY);
    localStorage.removeItem(DIALOGUE_ONCE_KEY);
    // optional stats:
    // localStorage.removeItem(GOOD_KEY);
    // localStorage.removeItem(EVIL_KEY);
  }

  // ----------------------------
  // Expose public API
  // ----------------------------
  const VAQ = {
    keys: {
      QUEST_ID_KEY, QUEST_CAT_KEY, FLAGS_KEY,
      NAME_KEY, GOOD_KEY, EVIL_KEY,
      RESUME_KEY,
      DIALOGUE_ONCE_KEY,
      DEFAULT_DIALOGUE_URL
    },

    // utils
    clamp,
    getNum,
    escapeHtml,
    txt,
    getFlags,
    setFlags,
    loadJSON,

    // quests
    qGetActiveId,
    qGetCatalogUrl,
    qSetCatalog,
    qSetActive,
    qClearActive,
    qComplete,
    qSetStepStatus,
    qGetActiveQuest,

    // resume
    saveResumeState,
    getResumeState,
    clearResumeState,

    // dialogue once + defaults
    dlgHasPlayed,
    dlgMarkPlayed,
    dlgUnmarkPlayed,
    dlgSetDefaultUrl,
    dlgLoadDefaults,
    dlgGetDefault
  };

  window.VAQ = VAQ;
  window.__vaq = VAQ;

  // Dev command
  window.__va_dev_reset_all = devResetAll;

  // ----------------------------
  // Boot (no UI)
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // Ensure a default catalog is set (pages can override later)
    if (!localStorage.getItem(QUEST_CAT_KEY)) {
      localStorage.setItem(QUEST_CAT_KEY, DEFAULT_CATALOG_URL);
    }

    // Auto-save resume location on every page load
    saveResumeState();
  });
})();











