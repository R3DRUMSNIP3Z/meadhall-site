js
/* /public/guildbook/js/va_global_ui.js
   Veriador (VA) Global UI + Quest Helpers
   - Safe to include on ANY page (it will create HUD only if needed)
   - Does NOT auto-open dialogue boxes (page scripts control that)
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

  // HUD DOM ids/classes
  const HUD_ID = "vaqHud";
  const HUD_BADGE_ID = "vaqHudBadge";
  const HUD_TITLE_ID = "vaqHudTitle";
  const HUD_TEXT_ID  = "vaqHudText";

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
    qHudRender().catch(() => {});
  }

  function qClearActive() {
    localStorage.removeItem(QUEST_ID_KEY);
    qHudRender().catch(() => {});
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
    qHudRender().catch(() => {});
  }

  // ----------------------------
  // HUD UI (bottom-left)
  // ----------------------------
  function ensureHudStyles() {
    if (document.getElementById("__vaqHudStyles")) return;

    const css = `
#${HUD_ID}{
  position:fixed;
  left:14px;
  bottom:14px;
  z-index:55;
  width:min(420px, calc(100vw - 28px));
  background:rgba(0,0,0,0.72);
  border:1px solid rgba(255,255,255,0.14);
  border-radius:16px;
  box-shadow:0 18px 50px rgba(0,0,0,0.65);
  padding:10px 12px;
  color:rgba(245,240,230,0.95);
  text-shadow:0 1px 2px rgba(0,0,0,0.6);
  font-family:inherit;
  display:none; /* shown only if quest active */
}
#${HUD_ID}.show{ display:block; }

#${HUD_ID} .row{
  display:flex;
  align-items:flex-start;
  gap:10px;
}
#${HUD_BADGE_ID}{
  width:34px;
  height:34px;
  border-radius:12px;
  border:1px solid rgba(255,215,140,0.22);
  background:rgba(0,0,0,0.35);
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight:900;
  color:rgba(255,215,140,1);
  flex:0 0 auto;
  user-select:none;
}
#${HUD_TITLE_ID}{
  font-weight:900;
  letter-spacing:.04em;
  color:rgba(255,215,140,1);
  font-size:14px;
  margin:0;
}
#${HUD_TEXT_ID}{
  margin-top:4px;
  font-size:13px;
  line-height:1.35;
  opacity:.96;
}

#${HUD_ID} .meta{
  margin-top:8px;
  display:flex;
  gap:10px;
  flex-wrap:wrap;
  opacity:.8;
  font-size:12px;
}
#${HUD_ID} .pill{
  padding:4px 8px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,0.12);
  background:rgba(0,0,0,0.28);
}
    `.trim();

    const style = document.createElement("style");
    style.id = "__vaqHudStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureHudDom() {
    let hud = document.getElementById(HUD_ID);
    if (hud) return hud;

    ensureHudStyles();

    hud = document.createElement("div");
    hud.id = HUD_ID;

    hud.innerHTML = `
      <div class="row">
        <div id="${HUD_BADGE_ID}">Q</div>
        <div style="min-width:0;">
          <div id="${HUD_TITLE_ID}"></div>
          <div id="${HUD_TEXT_ID}"></div>
          <div class="meta" id="vaqHudMeta"></div>
        </div>
      </div>
    `;

    document.body.appendChild(hud);

    // Clicking HUD opens quest journal if the page has #questBtn
    hud.addEventListener("click", () => {
      const qb = document.getElementById("questBtn");
      if (qb) qb.click();
    });

    return hud;
  }

  async function qHudRender() {
    const activeId = qGetActiveId();
    const hud = ensureHudDom();

    if (!activeId) {
      hud.classList.remove("show");
      return;
    }

    const titleEl = document.getElementById(HUD_TITLE_ID);
    const textEl  = document.getElementById(HUD_TEXT_ID);
    const metaEl  = document.getElementById("vaqHudMeta");

    titleEl.textContent = "ACTIVE QUEST";
    textEl.textContent = "…";
    metaEl.innerHTML = "";

    const catalogUrl = qGetCatalogUrl();

    try {
      const catalog = await loadJSON(catalogUrl);
      const q = (catalog?.quests && catalog.quests[activeId]) ? catalog.quests[activeId] : null;

      if (!q) {
        titleEl.textContent = "ACTIVE QUEST";
        textEl.innerHTML = `Not found: <span style="opacity:.9">${escapeHtml(activeId)}</span>`;
      } else {
        titleEl.textContent = String(q.title || "Quest");
        // show next objective: first step not marked pass/fail
        const steps = Array.isArray(q.steps) ? q.steps : [];
        const f = getFlags();

        let nextStep = "";
        for (let i = 0; i < steps.length; i++) {
          const st = f[`${activeId}_step${i}`];
          if (st !== "pass" && st !== "fail") { nextStep = steps[i]; break; }
        }

        const giver = q.giver ? `Giver: ${q.giver}` : "";
        const summary = q.summary ? txt(q.summary) : "";
        const line = nextStep ? txt(nextStep) : (summary || "Continue your quest.");

        textEl.textContent = line;

        const g = clamp(getNum(GOOD_KEY), 0, 10);
        const e = clamp(getNum(EVIL_KEY), 0, 10);

        metaEl.innerHTML = `
          ${giver ? `<div class="pill">${escapeHtml(giver)}</div>` : ""}
          <div class="pill">GOOD ${g}/10</div>
          <div class="pill">EVIL ${e}/10</div>
        `;
      }
    } catch (err) {
      // If catalog can't load, still show something
      titleEl.textContent = "ACTIVE QUEST";
      textEl.innerHTML = `Quest: <span style="opacity:.9">${escapeHtml(activeId)}</span>`;
      metaEl.innerHTML = `<div class="pill">Catalog error</div>`;
    }

    hud.classList.add("show");
  }

  // ----------------------------
  // Global binder: keeps HUD updated
  // ----------------------------
  function bindGlobalObservers() {
    // Update HUD when storage changes (other tabs)
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if ([QUEST_ID_KEY, QUEST_CAT_KEY, FLAGS_KEY, GOOD_KEY, EVIL_KEY, NAME_KEY].includes(e.key)) {
        qHudRender().catch(() => {});
      }
    });

    // Update HUD after any click that might change quest flags
    document.addEventListener("click", () => {
      // cheap debounce
      clearTimeout(bindGlobalObservers.__t);
      bindGlobalObservers.__t = setTimeout(() => qHudRender().catch(() => {}), 60);
    }, true);
  }

  // ----------------------------
  // Dev Helpers (console)
  // ----------------------------
  function devResetAll() {
    localStorage.removeItem(QUEST_ID_KEY);
    localStorage.removeItem(QUEST_CAT_KEY);
    localStorage.removeItem(FLAGS_KEY);
    // optional stats
    // localStorage.removeItem(GOOD_KEY);
    // localStorage.removeItem(EVIL_KEY);
    qHudRender().catch(() => {});
  }

  // ----------------------------
  // Expose public API
  // ----------------------------
  const VAQ = {
    keys: { QUEST_ID_KEY, QUEST_CAT_KEY, FLAGS_KEY },
    getFlags,
    setFlags,
    qGetActiveId,
    qGetCatalogUrl,
    qSetCatalog,
    qSetActive,
    qClearActive,
    qComplete,
    qSetStepStatus,
    qHudRender,
    txt,
    escapeHtml
  };

  // Keep backwards compatibility with your older naming patterns if you used them
  window.VAQ = VAQ;
  window.__vaq = VAQ;

  // Dev command
  window.__va_dev_reset_all = devResetAll;

  // ----------------------------
  // Boot
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // Ensure page has a catalog set (page can override later)
    if (!localStorage.getItem(QUEST_CAT_KEY)) {
      localStorage.setItem(QUEST_CAT_KEY, DEFAULT_CATALOG_URL);
    }
    bindGlobalObservers();
    qHudRender().catch(() => {});
  });
})();





