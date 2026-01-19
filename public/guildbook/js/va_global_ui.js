

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
  // ✅ ONCE-THEN-DEFAULT runner
  // ----------------------------
  // Plays a "onceJson" exactly once. After that, shows default NPC dialogue (one line)
  // from defaultdialoguenpc.json (data.defaults[npcKey]).
  async function npcRunOnceThenDefault(opts) {
    const {
      npcId,
      onceJson,
      defaultJson,
      defaultNpcKey,      // optional override; if omitted uses npcId
      runDialogueFromJson, // async (onceJsonUrl) => void
      showDialogue,        // ({speaker,text,portraitSrc,buttons,appendEl}) => void
      hideDialogue,        // () => void
      speakerFallback = "…",
      portraitFallback = ""
    } = opts || {};

    if (!npcId) throw new Error("npcRunOnceThenDefault: npcId required");
    if (typeof runDialogueFromJson !== "function") {
      throw new Error("npcRunOnceThenDefault: runDialogueFromJson required");
    }
    if (typeof showDialogue !== "function") throw new Error("npcRunOnceThenDefault: showDialogue required");
    if (typeof hideDialogue !== "function") throw new Error("npcRunOnceThenDefault: hideDialogue required");

    // First time: play the full once dialogue JSON, then mark played.
    if (!dlgHasPlayed(npcId)) {
      await runDialogueFromJson(onceJson);
      dlgMarkPlayed(npcId);
      return;
    }

    // After: show default one-liner.
const key = defaultNpcKey || npcId;

try {
  const d = await dlgGetDefault(key, defaultJson);
  showDialogue({
    speaker: d.speaker || speakerFallback,
    text: d.line || "…",
    portraitSrc: d.portrait || portraitFallback,
    buttons: [{
      label: "Close",
      onClick: () => { hideDialogue(); }
    }]
  });
} catch (e) {
  console.error("Default dialogue failed:", e);
  showDialogue({
    speaker: speakerFallback,
    text: "…",
    portraitSrc: portraitFallback,
    buttons: [{
      label: "Close",
      onClick: () => { hideDialogue(); }
    }]
  });
}
  }

  // ============================
  // GLOBAL ICON HUD (NO HAMBURGER)
  // ============================
  function ensureGlobalIcons() {
    // Prevent duplicates if a page already has its own icons
    const hasQuestBtn = !!document.getElementById("questBtn");
    const hasMeterBtn = !!document.getElementById("meterBtn");
    const hasInvBtn   = !!document.getElementById("invBtn");
    const hasMapBtn   = !!document.getElementById("mapBtn");

    // If page already built its own full HUD, do nothing
    // (You can remove this guard if you want global to always win)
    if (hasQuestBtn && hasMeterBtn && hasInvBtn && hasMapBtn) return;

    // --------- Assets / Links ----------
    const QUEST_ICON = "/guildbook/ui/quest_icon.png";
    const METER_ICON = "/guildbook/ui/metericon.png";
    const INV_ICON   = "/guildbook/ui/inventory.png";
    const MAP_ICON   = "/guildbook/scenes/maps/Veriador.png";
    const MAP_URL    = "/guildbook/scenes/maps/veriador_map.html";

    // --------- Inventory keys ----------
    const INV_UNLOCK_KEY = "va_inv_unlocked";
    const INV_ITEMS_KEY  = "va_inv_items";

    // --------- Create minimal CSS once ----------
    if (!document.getElementById("vaGlobalHudStyles")) {
      const st = document.createElement("style");
      st.id = "vaGlobalHudStyles";
      st.textContent = `
        /* ===== GLOBAL HUD ICONS ===== */
        .vaHudBtn{
          position:fixed;
          top:14px;
          width:52px;
          height:52px;
          background:transparent;
          border:none;
          cursor:pointer;
          z-index:60;
          display:block;
        }
        .vaHudBtn img{
          width:100%;
          height:100%;
          object-fit:contain;
          filter:drop-shadow(0 10px 22px rgba(0,0,0,0.75));
          opacity:.96;
          transition:transform 120ms ease;
        }
        .vaHudBtn:hover img{ transform:scale(1.05); }

        /* ===== overlays ===== */
        .vaOverlay{
          position:fixed;
          inset:0;
          background:rgba(0,0,0,.65);
          z-index:80;
          display:none;
        }
        .vaPanel{
          position:absolute;
          top:70px;
          right:18px;
          width:min(520px, calc(100vw - 36px));
          max-height:calc(100vh - 110px);
          overflow:auto;
          background:rgba(0,0,0,.92);
          border:1px solid rgba(255,255,255,.14);
          border-radius:16px;
          padding:14px;
          box-shadow:0 18px 60px rgba(0,0,0,0.7);
          text-shadow:0 1px 2px rgba(0,0,0,0.6);
          color:rgba(245,240,230,.95);
          font-family:Cinzel, serif;
        }
        .vaHeader{
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:12px;
        }
        .vaTitle{
          font-weight:900;
          letter-spacing:.06em;
          color:rgba(255,215,140,1);
        }
        .vaClose{
          width:34px;
          height:34px;
          border-radius:10px;
          font-size:20px;
          font-weight:900;
          cursor:pointer;
          background:rgba(0,0,0,.4);
          border:1px solid rgba(255,215,140,.6);
          color:rgba(255,215,140,1);
        }

        /* Quest steps */
        .vaStepRow{
          display:grid;
          grid-template-columns:22px 1fr;
          gap:10px;
          align-items:start;
          margin:8px 0;
        }
        .vaMark{
          width:22px;
          height:22px;
          border-radius:8px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:900;
          font-size:14px;
          border:1px solid rgba(255,255,255,.12);
          background:rgba(0,0,0,.35);
          user-select:none;
        }
        .vaMark.pending{ color:rgba(255,255,255,.55); }
        .vaMark.pass{
          color:rgba(165,255,190,.95);
          border-color:rgba(165,255,190,.45);
          background:rgba(40,120,65,.25);
        }
        .vaMark.fail{
          color:rgba(255,140,140,.95);
          border-color:rgba(255,140,140,.45);
          background:rgba(120,35,35,.25);
        }

        /* Inventory grid */
        .vaInvGrid{
          margin-top:12px;
          display:grid;
          grid-template-columns:repeat(4, 86px);
          gap:6px;
          justify-content:start;
        }
        .vaInvCell{
          width:86px;
          height:86px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.12);
          background:rgba(0,0,0,.35);
          display:flex;
          align-items:center;
          justify-content:center;
          overflow:hidden;
        }
        .vaInvCell img{
          width:70px;
          height:70px;
          object-fit:contain;
          filter:drop-shadow(0 10px 18px rgba(0,0,0,.65));
        }
      `;
      document.head.appendChild(st);
    }

    // Helper to make a button
    function makeBtn(id, rightPx, imgSrc, title) {
      if (document.getElementById(id)) return document.getElementById(id);
      const btn = document.createElement("button");
      btn.id = id;
      btn.className = "vaHudBtn";
      btn.style.right = rightPx + "px";
      btn.setAttribute("aria-label", title);
      btn.title = title;

      const img = document.createElement("img");
      img.src = imgSrc;
      img.alt = title;
      btn.appendChild(img);

      document.body.appendChild(btn);
      return btn;
    }

    // Helper overlay/panel
    function makeOverlay(idOverlay, idPanel, titleText) {
      let ov = document.getElementById(idOverlay);
      if (!ov) {
        ov = document.createElement("div");
        ov.id = idOverlay;
        ov.className = "vaOverlay";
        ov.setAttribute("aria-hidden", "true");

        const panel = document.createElement("div");
        panel.id = idPanel;
        panel.className = "vaPanel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", titleText);

        panel.innerHTML = `
          <div class="vaHeader">
            <div class="vaTitle">${escapeHtml(titleText)}</div>
            <button class="vaClose" data-va-close="1" aria-label="Close">✕</button>
          </div>
          <div data-va-body="1" style="margin-top:10px;"></div>
        `;

        ov.appendChild(panel);
        document.body.appendChild(ov);

        // click outside closes
        ov.addEventListener("click", (e) => {
          if (e.target === ov) closeOverlay(ov);
        });

        // close button
        panel.querySelector('[data-va-close="1"]').addEventListener("click", () => closeOverlay(ov));
      }
      return ov;
    }

    function openOverlay(ov) {
      ov.style.display = "block";
      ov.setAttribute("aria-hidden", "false");
    }
    function closeOverlay(ov) {
      ov.style.display = "none";
      ov.setAttribute("aria-hidden", "true");
    }

    // --------- Buttons positions (same as your Mead Hall layout) ----------
    // right: 14 = quest
    // meter: 74
    // inv: 134
    // map: 194
    const questBtn = makeBtn("questBtn", 14, QUEST_ICON, "Quests");
    const meterBtn = makeBtn("meterBtn", 74, METER_ICON, "Good / Evil Meter");
    const invBtn   = makeBtn("invBtn",   134, INV_ICON, "Inventory");
    const mapBtn   = makeBtn("mapBtn",   194, MAP_ICON, "World Map");

    // --------- Overlays ----------
    const questOv = makeOverlay("vaQuestOverlay", "vaQuestPanel", "QUEST");
    const meterOv = makeOverlay("vaMeterOverlay", "vaMeterPanel", "METER");
    const invOv   = makeOverlay("vaInvOverlay",   "vaInvPanel",   "INVENTORY");

    const questBody = questOv.querySelector('[data-va-body="1"]');
    const meterBody = meterOv.querySelector('[data-va-body="1"]');
    const invBody   = invOv.querySelector('[data-va-body="1"]');

    // --------- Map click ----------
    mapBtn.addEventListener("click", () => {
      window.location.href = MAP_URL;
    });

    // --------- Meter render ----------
    function meterImgPath(type, n){
      n = clamp(Number(n)||0, 0, 10);
      if (type === "good") return `/guildbook/ui/goodmeter/${n}.png`;
      return `/guildbook/ui/evilmeter/${n}.png`;
    }

    function renderMeters(){
      const g = clamp(getNum(GOOD_KEY), 0, 10);
      const e = clamp(getNum(EVIL_KEY), 0, 10);

      meterBody.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr; gap:14px;">
          <div style="border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.35); border-radius:14px; padding:10px;">
            <div style="font-weight:900; letter-spacing:.04em; opacity:.95; margin-bottom:8px;">GOOD</div>
            <img src="${escapeHtml(meterImgPath("good", g))}" alt="Good meter" style="width:100%; height:auto; display:block; object-fit:contain; filter:drop-shadow(0 10px 22px rgba(0,0,0,0.75));">
          </div>
          <div style="border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.35); border-radius:14px; padding:10px;">
            <div style="font-weight:900; letter-spacing:.04em; opacity:.95; margin-bottom:8px;">EVIL</div>
            <img src="${escapeHtml(meterImgPath("evil", e))}" alt="Evil meter" style="width:100%; height:auto; display:block; object-fit:contain; filter:drop-shadow(0 10px 22px rgba(0,0,0,0.75));">
          </div>
        </div>
      `;
    }

    meterBtn.addEventListener("click", () => {
      renderMeters();
      openOverlay(meterOv);
    });

    // --------- Inventory ----------
    function invIsUnlocked(){
      return localStorage.getItem(INV_UNLOCK_KEY) === "1";
    }
    function invGetItems(){
      try{
        const arr = JSON.parse(localStorage.getItem(INV_ITEMS_KEY) || "[]");
        return Array.isArray(arr) ? arr : [];
      }catch{
        return [];
      }
    }

    function renderInventory(){
      const items = invGetItems();
      const slots = 16;

      let html = `<div class="vaInvGrid">`;
      for (let i=0; i<slots; i++){
        const it = items[i];
        html += `<div class="vaInvCell">`;
        if (it && it.img){
          html += `<img src="${escapeHtml(it.img)}" alt="${escapeHtml(it.name || it.id || "item")}">`;
        }
        html += `</div>`;
      }
      html += `</div>`;
      invBody.innerHTML = html;
    }

    function refreshInvBtn(){
      invBtn.style.display = invIsUnlocked() ? "block" : "none";
    }

    invBtn.addEventListener("click", () => {
      renderInventory();
      openOverlay(invOv);
    });

    refreshInvBtn();

    // --------- Quest journal ----------
    async function renderQuestJournal(){
      const activeId = localStorage.getItem(QUEST_ID_KEY) || "";
      const catalogUrl = localStorage.getItem(QUEST_CAT_KEY) || DEFAULT_CATALOG_URL;

      if (!activeId){
        questBody.innerHTML = `<div style="opacity:.9">No active quest.</div>`;
        return;
      }

      let catalog;
      try{
        catalog = await loadJSON(catalogUrl);
      }catch{
        questBody.innerHTML = `
          <div style="opacity:.95; margin-bottom:8px;">Quest catalog missing / failed to load.</div>
          <div style="opacity:.8; font-size:14px;">
            ActiveId: ${escapeHtml(activeId)}<br>
            Catalog: ${escapeHtml(catalogUrl)}
          </div>`;
        return;
      }

      const q = (catalog?.quests && catalog.quests[activeId]) ? catalog.quests[activeId] : null;
      if (!q){
        questBody.innerHTML = `
          <div style="opacity:.95; margin-bottom:8px;">Quest not found.</div>
          <div style="opacity:.8; font-size:14px;">
            ActiveId: ${escapeHtml(activeId)}<br>
            Catalog: ${escapeHtml(catalogUrl)}
          </div>`;
        return;
      }

      const steps = Array.isArray(q.steps) ? q.steps : [];
      const f = getFlags();

      const stepsHtml = steps.map((s, i) => {
        const st = f[`${activeId}_step${i}`];
        const cls = st === "pass" ? "pass" : (st === "fail" ? "fail" : "pending");
        const mark = st === "pass" ? "✓" : (st === "fail" ? "✕" : "•");
        return `
          <div class="vaStepRow">
            <div class="vaMark ${cls}">${mark}</div>
            <div style="opacity:.92;">${escapeHtml(s)}</div>
          </div>
        `;
      }).join("");

      questBody.innerHTML = `
        <div style="font-size:18px; font-weight:900; color:rgba(255,215,140,1); margin:6px 0 10px;">
          ${escapeHtml(q.title || "Quest")}
        </div>

        <div style="opacity:.95; margin-bottom:10px;">
          Giver:
          <strong style="color:rgba(255,210,160,0.95)">${escapeHtml(q.giver || "Unknown")}</strong>
        </div>

        ${q.summary ? `<div style="opacity:.92; margin-bottom:12px;">${escapeHtml(q.summary)}</div>` : ""}

        <div style="margin: 8px 0 6px; opacity:.95; font-weight:800;">Objectives</div>
        <div style="opacity:.92;">
          ${stepsHtml || "<div>…</div>"}
        </div>

        ${q.reward ? `<div style="opacity:.95; margin-top:12px;"><strong>Reward:</strong> ${escapeHtml(q.reward)}</div>` : ""}
      `;
    }

    questBtn.addEventListener("click", () => {
      openOverlay(questOv);
      renderQuestJournal().catch(err => {
        console.error(err);
        questBody.innerHTML = `<div style="opacity:.9">Quest journal failed.</div>`;
      });
    });

    // --------- ESC closes overlays ----------
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        try{ closeOverlay(questOv); }catch{}
        try{ closeOverlay(meterOv); }catch{}
        try{ closeOverlay(invOv); }catch{}
      }
    });

    // Expose a tiny refresh hook (pages can call after unlocking inv, etc.)
    window.__va_refresh_icons = () => {
      try{ refreshInvBtn(); }catch{}
    };
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
      DEFAULT_DIALOGUE_URL,
      
         

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
    dlgGetDefault,
    npcRunOnceThenDefault

  };

  window.VAQ = VAQ;
  window.__vaq = VAQ;

  // Dev command
  window.__va_dev_reset_all = devResetAll;

  // ----------------------------
  // Boot (no UI)
  // ----------------------------
    document.addEventListener("DOMContentLoaded", () => {
    if (!localStorage.getItem(QUEST_CAT_KEY)) {
      localStorage.setItem(QUEST_CAT_KEY, DEFAULT_CATALOG_URL);
    }

    // ✅ icons on every page (no hamburger)
    try{ ensureGlobalIcons(); }catch(e){ console.warn("Global icons failed", e); }

    saveResumeState();
  });

})();











