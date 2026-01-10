/* /public/guildbook/js/va_global_ui.js
   Veriador (VA) Global Helpers ONLY (NO HUD)
   - Safe to include on ANY page
   - Exposes window.VAQ helpers for quests/flags/text
   - Does NOT create any UI
*/

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
    // optional stats:
    // localStorage.removeItem(GOOD_KEY);
    // localStorage.removeItem(EVIL_KEY);
  }

  // ----------------------------
  // Expose public API
  // ----------------------------
  const VAQ = {
    keys: { QUEST_ID_KEY, QUEST_CAT_KEY, FLAGS_KEY, NAME_KEY, GOOD_KEY, EVIL_KEY },
    clamp,
    getNum,
    escapeHtml,
    txt,
    getFlags,
    setFlags,
    loadJSON,

    qGetActiveId,
    qGetCatalogUrl,
    qSetCatalog,
    qSetActive,
    qClearActive,
    qComplete,
    qSetStepStatus,
    qGetActiveQuest
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
  });
})();






