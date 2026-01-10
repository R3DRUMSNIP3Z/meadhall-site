// /guildbook/js/va_global_ui.js
(() => {
  // ----------------------------
  // Keys (global)
  // ----------------------------
  const QUEST_ID_KEY  = "vaq_activeQuestId";
  const QUEST_CAT_KEY = "vaq_activeQuestCatalog";

  const GOOD_KEY  = "va_good";
  const EVIL_KEY  = "va_evil";

  // Defaults (safe fallbacks)
  const DEFAULT_QUEST_CATALOG = "/guildbook/quests/dreadheim_quests.json";

  // Meter images
  const EVIL_PATH = (n) => `/guildbook/ui/evilmeter/${n}.png`;
  const GOOD_PATH = (n) => `/guildbook/ui/goodmeter/${n}.png`;

  // ----------------------------
  // Tiny helpers
  // ----------------------------
  const clamp010 = (n) => {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 10) return 10;
    return Math.round(n);
  };

  const getNum = (key) => {
    const v = Number(localStorage.getItem(key) || "0");
    return Number.isFinite(v) ? v : 0;
  };

  const loadJSON = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    return await res.json();
  };

  const escapeHtml = (s) => String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

  // ----------------------------
  // Inject UI (Quest + Meter) if missing
  // ----------------------------
  function ensureUI(){
    // QUEST button
    if (!document.getElementById("questBtn")){
      const b = document.createElement("button");
      b.id = "questBtn";
      b.setAttribute("aria-label", "Open quest journal");
      b.innerHTML = `<img src="/guildbook/ui/quest_icon.png" alt="Quest">`;
      document.body.appendChild(b);
    }

    // METER button
    if (!document.getElementById("meterBtn")){
      const b = document.createElement("button");
      b.id = "meterBtn";
      b.setAttribute("aria-label", "Open alignment meters");
      b.innerHTML = `<img src="/guildbook/ui/metericon.png" alt="Meters">`;
      document.body.appendChild(b);
    }

    // QUEST overlay
    if (!document.getElementById("questOverlay")){
      const wrap = document.createElement("div");
      wrap.id = "questOverlay";
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = `
        <div id="questPanel" role="dialog" aria-label="Quest journal">
          <div class="qHeader">
            <div class="qTitle">QUEST</div>
            <button id="questClose" aria-label="Close quest journal">✕</button>
          </div>
          <div id="questContent"></div>
        </div>
      `;
      document.body.appendChild(wrap);
    }

    // METER overlay
    if (!document.getElementById("meterOverlay")){
      const wrap = document.createElement("div");
      wrap.id = "meterOverlay";
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = `
        <div id="meterPanel" role="dialog" aria-label="Alignment meters">
          <div class="mHeader">
            <div class="mTitle">ALIGNMENT</div>
            <button id="meterClose" aria-label="Close meters">✕</button>
          </div>

          <div class="mRow">
            <div>
              <div class="mLabel">EVIL</div>
              <img id="evilMeterImg" class="mImg" src="/guildbook/ui/evilmeter/0.png" alt="Evil meter">
            </div>

            <div>
              <div class="mLabel">GOOD</div>
              <img id="goodMeterImg" class="mImg" src="/guildbook/ui/goodmeter/0.png" alt="Good meter">
            </div>
          </div>

          <div id="meterDebug" class="mSmall"></div>
        </div>
      `;
      document.body.appendChild(wrap);
    }
  }

  // ----------------------------
  // Inject CSS if missing
  // ----------------------------
  function ensureCSS(){
    if (document.getElementById("vaGlobalUiCSS")) return;

    const css = document.createElement("style");
    css.id = "vaGlobalUiCSS";
    css.textContent = `
/* ===== VA GLOBAL UI ===== */
#questBtn, #meterBtn{
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
#questBtn{ right:14px; }
#meterBtn{ right:74px; }

#questBtn img, #meterBtn img{
  width:100%;
  height:100%;
  object-fit:contain;
  filter:drop-shadow(0 10px 22px rgba(0,0,0,0.75));
  opacity:.96;
  transition:transform 120ms ease;
}
#questBtn:hover img, #meterBtn:hover img{ transform:scale(1.05); }

/* Quest overlay */
#questOverlay{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.65);
  z-index:70;
  display:none;
}
#questPanel{
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
}
#questPanel, #questPanel *{ color:rgba(245,240,230,.95); }
.qHeader{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
}
.qTitle{
  font-weight:800;
  letter-spacing:.06em;
  color:rgba(255,215,140,1);
}
#questClose{
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
#questContent{
  margin-top:10px;
  font-size:16px;
  line-height:1.35;
  opacity:.96;
}

/* Meter overlay */
#meterOverlay{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.65);
  z-index:80;
  display:none;
}
#meterPanel{
  position:absolute;
  top:70px;
  right:18px;
  width:min(520px, calc(100vw - 36px));
  background:rgba(0,0,0,.92);
  border:1px solid rgba(255,255,255,.14);
  border-radius:16px;
  padding:14px;
  box-shadow:0 18px 60px rgba(0,0,0,0.7);
  text-shadow:0 1px 2px rgba(0,0,0,0.6);
}
#meterPanel, #meterPanel *{ color:rgba(245,240,230,.95); }
.mHeader{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
}
.mTitle{
  font-weight:800;
  letter-spacing:.06em;
  color:rgba(255,215,140,1);
}
#meterClose{
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
.mRow{ display:grid; grid-template-columns:1fr; gap:10px; margin-top:12px; }
.mLabel{ font-weight:900; opacity:.95; margin:4px 0 6px; }
.mImg{
  width:100%;
  height:auto;
  display:block;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.10);
  box-shadow:0 10px 28px rgba(0,0,0,.55);
}
.mSmall{ font-size:13px; opacity:.75; margin-top:10px; }
    `;
    document.head.appendChild(css);
  }

  // ----------------------------
  // Quest render
  // ----------------------------
  async function renderQuestJournal(){
    const questContent = document.getElementById("questContent");
    if (!questContent) return;

    const activeId = localStorage.getItem(QUEST_ID_KEY) || "";
    const catalogUrl = localStorage.getItem(QUEST_CAT_KEY) || DEFAULT_QUEST_CATALOG;

    if (!activeId){
      questContent.innerHTML = `<div style="opacity:.9">No active quest.</div>`;
      return;
    }

    let catalog;
    try{
      catalog = await loadJSON(catalogUrl);
    }catch{
      questContent.innerHTML = `
        <div style="opacity:.95; margin-bottom:8px;">Quest catalog missing / failed to load.</div>
        <div style="opacity:.8; font-size:14px;">
          ActiveId: ${escapeHtml(activeId)}<br>
          Catalog: ${escapeHtml(catalogUrl)}
        </div>`;
      return;
    }

    const q = (catalog?.quests && catalog.quests[activeId]) ? catalog.quests[activeId] : null;
    if (!q){
      questContent.innerHTML = `
        <div style="opacity:.95; margin-bottom:8px;">Quest not found.</div>
        <div style="opacity:.8; font-size:14px;">
          ActiveId: ${escapeHtml(activeId)}<br>
          Catalog: ${escapeHtml(catalogUrl)}
        </div>`;
      return;
    }

    const steps = Array.isArray(q.steps) ? q.steps : [];
    const stepsHtml = steps.map(s => `<li style="margin:6px 0;">${escapeHtml(s)}</li>`).join("");

    questContent.innerHTML = `
      <div style="font-size:18px; font-weight:900; color:rgba(255,215,140,1); margin:6px 0 10px;">
        ${escapeHtml(q.title || "Quest")}
      </div>
      <div style="opacity:.95; margin-bottom:10px;">
        Giver: <strong style="color:rgba(255,210,160,0.95)">${escapeHtml(q.giver || "Unknown")}</strong>
      </div>
      ${q.summary ? `<div style="opacity:.92; margin-bottom:12px;">${escapeHtml(q.summary)}</div>` : ""}
      <div style="margin: 8px 0 6px; opacity:.95; font-weight:800;">Objectives</div>
      <ol style="margin:0 0 12px 18px; padding:0; opacity:.92;">
        ${stepsHtml || "<li>…</li>"}
      </ol>
      ${q.reward ? `<div style="opacity:.95;"><strong>Reward:</strong> ${escapeHtml(q.reward)}</div>` : ""}
    `;
  }

  // ----------------------------
  // Meters render
  // ----------------------------
  function renderMeters(){
    const evilImg = document.getElementById("evilMeterImg");
    const goodImg = document.getElementById("goodMeterImg");
    const dbg = document.getElementById("meterDebug");

    if (!evilImg || !goodImg) return;

    const evil = clamp010(getNum(EVIL_KEY));
    const good = clamp010(getNum(GOOD_KEY));

    evilImg.src = EVIL_PATH(evil);
    goodImg.src = GOOD_PATH(good);

    if (dbg) dbg.textContent = `Evil: ${evil}/10 • Good: ${good}/10`;
  }

  // ----------------------------
  // Open/close wiring
  // ----------------------------
  function wireEvents(){
    const questBtn = document.getElementById("questBtn");
    const questOverlay = document.getElementById("questOverlay");
    const questClose = document.getElementById("questClose");

    const meterBtn = document.getElementById("meterBtn");
    const meterOverlay = document.getElementById("meterOverlay");
    const meterClose = document.getElementById("meterClose");

    const openQuest = () => {
      questOverlay.style.display = "block";
      questOverlay.setAttribute("aria-hidden","false");
      renderQuestJournal().catch(console.error);
    };
    const closeQuest = () => {
      questOverlay.style.display = "none";
      questOverlay.setAttribute("aria-hidden","true");
    };

    const openMeters = () => {
      renderMeters();
      meterOverlay.style.display = "block";
      meterOverlay.setAttribute("aria-hidden","false");
    };
    const closeMeters = () => {
      meterOverlay.style.display = "none";
      meterOverlay.setAttribute("aria-hidden","true");
    };

    questBtn?.addEventListener("click", openQuest);
    questClose?.addEventListener("click", closeQuest);
    questOverlay?.addEventListener("click", (e) => {
      if (e.target === questOverlay) closeQuest();
    });

    meterBtn?.addEventListener("click", openMeters);
    meterClose?.addEventListener("click", closeMeters);
    meterOverlay?.addEventListener("click", (e) => {
      if (e.target === meterOverlay) closeMeters();
    });

    // ESC closes overlays (global)
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape"){
        closeQuest();
        closeMeters();
      }
    });

    // Expose a small global refresh hook for your dialogue scripts:
    // call: window.VA_UI.refreshMeters()
    window.VA_UI = window.VA_UI || {};
    window.VA_UI.refreshMeters = renderMeters;
    window.VA_UI.refreshQuest = () => renderQuestJournal().catch(console.error);
  }

  // ----------------------------
  // Boot
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    ensureCSS();
    ensureUI();
    wireEvents();
  });
})();
