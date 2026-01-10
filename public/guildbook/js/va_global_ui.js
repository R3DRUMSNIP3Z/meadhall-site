js
/*  /guildbook/js/va_global_ui.js
    =============================
    VERIADOR • GLOBAL UI (JS ONLY)
    Load this on EVERY page to get:
    - Quest icon + Quest Journal overlay (✅/❌ per step)
    - Meter icon + Good/Evil overlay (auto images 0–10)
    - Alignment overflow rule (if meter is 10 and gains +1 → removes 1 from opposite)
    - Inventory icon (hidden until unlocked)
    - Hel’s Amulet popup → “stole successfully” → “inventory unlocked” → auto-open inventory
    - GLOBAL Loki kickout: when GOOD reaches 10, Loki appears and sends player to helheim_wasteland.html

    Put this in every HTML (near the bottom, before </body>):
    <script src="/guildbook/js/va_global_ui.js"></script>
*/

(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    // =============================
    // STORAGE KEYS
    // =============================
    const NAME_KEY = "va_player_name";
    const GOOD_KEY = "va_good";
    const EVIL_KEY = "va_evil";
    const FLAGS_KEY = "va_flags";

    const QUEST_ID_KEY = "vaq_activeQuestId";
    const QUEST_CAT_KEY = "vaq_activeQuestCatalog";

    const INVENTORY_UNLOCK_KEY = "va_inventory_unlocked";
    const AMULET_POP_SEEN_KEY = "va_amulet_popup_seen";

    const LOKI_KICKED_FLAG = "va_loki_kicked_out"; // boolean in flags

    // =============================
    // ASSETS / JSONS
    // =============================
    const QUEST_ICON_SRC = "/guildbook/ui/quest_icon.png";
    const METER_ICON_SRC = "/guildbook/ui/metericon.png";
    const INVENTORY_ICON_SRC = "/guildbook/ui/inventory.png";

    const GOOD_METER_BASE = "/guildbook/ui/goodmeter/"; // 0.png..10.png
    const EVIL_METER_BASE = "/guildbook/ui/evilmeter/"; // 0.png..10.png

    const DEFAULT_QUEST_CATALOG_URL = "/guildbook/quests/dreadheim_quests.json";

    const KICKED_JSON = "/data/episodes/volume1_ep1/kickedoutbyloki.json";
    const HELHEIM_TARGET_PATH = "/helheim_wasteland.html";

    const HELS_AMULET_IMG = "/guildbook/props/helsamulet/helsamulet.png";

    // =============================
    // UTILS
    // =============================
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const qs = (id) => document.getElementById(id);

    function escapeHtml(s) {
      return String(s)
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

    function getNum(key) {
      const v = Number(localStorage.getItem(key) || "0");
      return Number.isFinite(v) ? v : 0;
    }

    function setNum(key, n) {
      localStorage.setItem(key, String(n));
    }

    function getFlags() {
      try {
        return JSON.parse(localStorage.getItem(FLAGS_KEY) || "{}");
      } catch {
        return {};
      }
    }

    function setFlags(obj) {
      localStorage.setItem(FLAGS_KEY, JSON.stringify(obj || {}));
    }

    async function loadJSON(url) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
      return await res.json();
    }

    // =============================
    // ALIGNMENT LOGIC (overflow rule)
    // =============================
    function addAlignment(kind, delta) {
      delta = Number(delta) || 0;
      if (!delta) return;

      const steps = Math.abs(delta);
      const sign = delta > 0 ? 1 : -1;

      for (let i = 0; i < steps; i++) {
        let g = clamp(getNum(GOOD_KEY), 0, 10);
        let e = clamp(getNum(EVIL_KEY), 0, 10);

        if (kind === "good") {
          if (sign > 0) {
            if (g >= 10) {
              if (e > 0) e -= 1; // overflow steals from evil
            } else {
              g += 1;
            }
          } else {
            if (g > 0) g -= 1;
          }
        } else {
          if (sign > 0) {
            if (e >= 10) {
              if (g > 0) g -= 1; // overflow steals from good
            } else {
              e += 1;
            }
          } else {
            if (e > 0) e -= 1;
          }
        }

        setNum(GOOD_KEY, g);
        setNum(EVIL_KEY, e);
      }

      refreshMeterUI();
      checkGlobalLokiKickout(); // global check any time alignment changes
    }

    // =============================
    // DIALOGUE UI (inject if missing)
    // =============================
    function ensureDialogueUI() {
      let dlg = qs("dlg");
      if (dlg) return dlg;

      // Inject minimal dialogue UI (does NOT require your page HTML)
      dlg = document.createElement("div");
      dlg.id = "dlg";
      dlg.className = "hidden";
      dlg.style.position = "fixed";
      dlg.style.left = "50%";
      dlg.style.bottom = "14px";
      dlg.style.transform = "translateX(-50%)";
      dlg.style.width = "min(1200px, calc(100vw - 24px))";
      dlg.style.height = "190px";
      dlg.style.zIndex = "9999";
      dlg.style.display = "grid";
      dlg.style.gridTemplateColumns = "240px 1fr";
      dlg.style.borderRadius = "18px";
      dlg.style.overflow = "hidden";
      dlg.style.background = "linear-gradient(90deg, rgba(35,20,10,.95), rgba(15,10,8,.88))";
      dlg.style.border = "1px solid rgba(255,208,120,.2)";
      dlg.style.boxShadow = "0 18px 55px rgba(0,0,0,.6)";

      const portrait = document.createElement("img");
      portrait.id = "dlgPortrait";
      portrait.alt = "Portrait";
      portrait.style.width = "240px";
      portrait.style.height = "190px";
      portrait.style.objectFit = "contain";
      portrait.style.alignSelf = "end";
      portrait.style.filter = "drop-shadow(0 12px 22px rgba(0,0,0,0.65))";

      const panel = document.createElement("div");
      panel.id = "dlgPanel";
      panel.style.padding = "16px 18px";
      panel.style.display = "grid";
      panel.style.gridTemplateRows = "auto 1fr auto";
      panel.style.gap = "10px";

      const name = document.createElement("div");
      name.id = "dlgName";
      name.style.fontSize = "28px";
      name.style.fontWeight = "900";
      name.style.color = "rgba(255,225,170,.95)";

      const text = document.createElement("div");
      text.id = "dlgText";
      text.style.fontSize = "20px";
      text.style.lineHeight = "1.35";
      text.style.color = "rgba(255,255,255,.95)";

      const btns = document.createElement("div");
      btns.id = "dlgBtns";
      btns.style.display = "flex";
      btns.style.justifyContent = "flex-end";
      btns.style.gap = "10px";
      btns.style.flexWrap = "wrap";

      panel.appendChild(name);
      panel.appendChild(text);
      panel.appendChild(btns);

      dlg.appendChild(portrait);
      dlg.appendChild(panel);

      // .hidden behavior
      const style = document.createElement("style");
      style.textContent = `
        #dlg.hidden{ display:none !important; }
        .dlgBtn{
          padding:10px 16px; border-radius:12px; cursor:pointer;
          border:1px solid rgba(255,208,120,.28);
          background:rgba(120,60,25,.45);
          color:rgba(255,245,230,.95);
          font-weight:800;
        }
        .dlgBtn:hover{ filter:brightness(1.1); }
      `;
      document.head.appendChild(style);

      document.body.appendChild(dlg);
      return dlg;
    }

    function showDialogue({ speaker, text, portraitSrc, buttons = [] }) {
      ensureDialogueUI();

      const dlg = qs("dlg");
      const dlgName = qs("dlgName");
      const dlgText = qs("dlgText");
      const dlgBtns = qs("dlgBtns");
      const dlgPortrait = qs("dlgPortrait");

      dlgName.textContent = speaker || "";
      dlgText.textContent = typeof text === "string" ? text : String(text ?? "");
      dlgBtns.innerHTML = "";
      if (portraitSrc) dlgPortrait.src = portraitSrc;

      dlg.classList.remove("hidden");

      buttons.forEach((b) => {
        const btn = document.createElement("button");
        btn.className = "dlgBtn";
        btn.type = "button";
        btn.textContent = b.label;

        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof b.onClick === "function") b.onClick();
        });

        dlgBtns.appendChild(btn);
      });
    }

    function hideDialogue() {
      const dlg = qs("dlg");
      if (!dlg) return;
      dlg.classList.add("hidden");
      const dlgName = qs("dlgName");
      const dlgText = qs("dlgText");
      const dlgBtns = qs("dlgBtns");
      if (dlgName) dlgName.textContent = "";
      if (dlgText) dlgText.textContent = "";
      if (dlgBtns) dlgBtns.innerHTML = "";
    }

    // =============================
    // QUEST STEP STATUS (✅/❌)
    // Store as flags: `${questId}_step${index}` = "pass"|"fail"
    // If an EVIL quest step fails, add +1 GOOD once per quest (default), or use failAdds if present.
    // =============================
    function setQuestStepStatus(questId, stepIndex, status) {
      const f = getFlags();
      const key = `${questId}_step${stepIndex}`;
      f[key] = status; // "pass" | "fail"
      setFlags(f);

      // apply fail reward once per quest if fail
      if (status === "fail") {
        const rewardKey = `${questId}_fail_rewarded`;
        if (!f[rewardKey]) {
          f[rewardKey] = true;
          setFlags(f);

          // default rule: evil quest fail adds +1 good
          addAlignment("good", 1);
        }
      }
    }

    // =============================
    // GLOBAL REWARD APPLY (for dialogue JSONs)
    // =============================
    function applyReward(reward) {
      if (!reward) return;

      if (reward.good) addAlignment("good", Number(reward.good));
      if (reward.evil) addAlignment("evil", Number(reward.evil));

      if (reward.set && typeof reward.set === "object") {
        for (const k of Object.keys(reward.set)) {
          localStorage.setItem(k, String(reward.set[k]));
        }
      }

      if (reward.flags && typeof reward.flags === "object") {
        const f = getFlags();
        for (const k of Object.keys(reward.flags)) f[k] = reward.flags[k];
        setFlags(f);
      }

      // optional quest step stamping from dialogue:
      // reward.questSteps: { "dq_001": { "0":"pass", "1":"fail" } }
      if (reward.questSteps && typeof reward.questSteps === "object") {
        for (const qid of Object.keys(reward.questSteps)) {
          const stepsObj = reward.questSteps[qid];
          if (stepsObj && typeof stepsObj === "object") {
            for (const idxStr of Object.keys(stepsObj)) {
              const st = stepsObj[idxStr];
              const idx = Number(idxStr);
              if (Number.isFinite(idx) && (st === "pass" || st === "fail")) {
                setQuestStepStatus(qid, idx, st);
              }
            }
          }
        }
      }

      // Set active quest
      if (reward.setQuest?.id) {
        localStorage.setItem(QUEST_ID_KEY, reward.setQuest.id);
        if (reward.setQuest.catalog) localStorage.setItem(QUEST_CAT_KEY, reward.setQuest.catalog);
      }

      // --- Hel's amulet trigger (flag must be set in your dialogue JSON)
      const f = getFlags();
      if (f.stoleHelsAmulet === true && localStorage.getItem(AMULET_POP_SEEN_KEY) !== "true") {
        localStorage.setItem(AMULET_POP_SEEN_KEY, "true");
        showAmuletThenUnlockInventory();
      }
    }

    // =============================
    // DIALOGUE RUNNER (generic JSON)
    // =============================
    async function runDialogueFromJson(url) {
      const data = await loadJSON(url);
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const map = new Map(nodes.map((n) => [n.id, n]));

      const portraitDefault = data?.meta?.portrait || "";
      const speakerDefault = data?.meta?.speakerDefault || "…";
      const startId = data?.start || nodes[0]?.id || "__close";

      function showNode(id) {
        if (id === "__close") {
          hideDialogue();
          if (data?.meta?.gotoOnEnd) {
            window.location.href = data.meta.gotoOnEnd;
          }
          return;
        }

        const node = map.get(id);
        if (!node) {
          showDialogue({
            speaker: speakerDefault,
            text: "…",
            portraitSrc: portraitDefault,
            buttons: [{ label: "Close", onClick: hideDialogue }],
          });
          return;
        }

        applyReward(node.reward);

        const speaker = node.speaker || speakerDefault;
        const text = txt(node.text || "…");
        const portrait = node.portrait || portraitDefault;

        const choices = Array.isArray(node.choices) ? node.choices : [];
        const btns = choices.length
          ? choices.map((c) => ({
              label: c.label || "Continue",
              onClick: () => showNode(c.to || "__close"),
            }))
          : [{ label: "Close", onClick: hideDialogue }];

        showDialogue({ speaker, text, portraitSrc: portrait, buttons: btns });
      }

      showNode(startId);
    }

    // =============================
    // GLOBAL LOKI KICKOUT (GOOD >= 10 anywhere)
    // =============================
    async function checkGlobalLokiKickout() {
      // don't kick out if already on the destination page
      if (window.location.pathname === HELHEIM_TARGET_PATH) return;

      const good = clamp(getNum(GOOD_KEY), 0, 10);
      if (good < 10) return;

      const f = getFlags();
      if (f[LOKI_KICKED_FLAG]) return;

      f[LOKI_KICKED_FLAG] = true;
      setFlags(f);

      try {
        await runDialogueFromJson(KICKED_JSON);
      } catch (err) {
        console.error(err);
      }
    }

    // =============================
    // ICONS + OVERLAYS (inject if missing)
    // =============================
    function ensureIconButton(id, imgSrc, title, rightPx) {
      let btn = qs(id);
      if (!btn) {
        btn = document.createElement("button");
        btn.id = id;
        btn.type = "button";
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.style.position = "fixed";
        btn.style.top = "14px";
        btn.style.right = `${rightPx}px`;
        btn.style.width = "52px";
        btn.style.height = "52px";
        btn.style.background = "transparent";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.zIndex = "60";
        btn.style.padding = "0";

        const img = document.createElement("img");
        img.src = imgSrc;
        img.alt = title;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "contain";
        img.style.filter = "drop-shadow(0 10px 22px rgba(0,0,0,0.75))";
        img.style.opacity = ".96";
        img.style.transition = "transform 120ms ease";
        btn.addEventListener("mouseenter", () => (img.style.transform = "scale(1.05)"));
        btn.addEventListener("mouseleave", () => (img.style.transform = "scale(1)"));

        btn.appendChild(img);
        document.body.appendChild(btn);
      } else {
        // make sure title is correct
        btn.title = title;
      }
      return btn;
    }

    // right positions:
    // quest: 14px
    // meter: 74px
    // inventory: 134px
    const questBtn = ensureIconButton("questBtn", QUEST_ICON_SRC, "Quests", 14);
    const meterBtn = ensureIconButton("meterBtn", METER_ICON_SRC, "Good / Evil Meter", 74);
    const inventoryBtn = ensureIconButton("inventoryBtn", INVENTORY_ICON_SRC, "Inventory", 134);

    // inventory hidden until unlocked
    function refreshInventoryButton() {
      const unlocked = localStorage.getItem(INVENTORY_UNLOCK_KEY) === "true";
      inventoryBtn.style.display = unlocked ? "block" : "none";
    }

    // =============================
    // QUEST OVERLAY (inject if missing)
    // =============================
    function ensureQuestOverlay() {
      let overlay = qs("questOverlay");
      if (overlay) return overlay;

      overlay = document.createElement("div");
      overlay.id = "questOverlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,.65)";
      overlay.style.zIndex = "70";
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");

      const panel = document.createElement("div");
      panel.id = "questPanel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Quest journal");
      panel.style.position = "absolute";
      panel.style.top = "70px";
      panel.style.right = "18px";
      panel.style.width = "min(520px, calc(100vw - 36px))";
      panel.style.maxHeight = "calc(100vh - 110px)";
      panel.style.overflow = "auto";
      panel.style.background = "rgba(0,0,0,.92)";
      panel.style.border = "1px solid rgba(255,255,255,.14)";
      panel.style.borderRadius = "16px";
      panel.style.padding = "14px";
      panel.style.boxShadow = "0 18px 60px rgba(0,0,0,0.7)";
      panel.style.textShadow = "0 1px 2px rgba(0,0,0,0.6)";
      panel.style.color = "rgba(245,240,230,.95)";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.gap = "12px";

      const title = document.createElement("div");
      title.textContent = "QUEST";
      title.style.fontWeight = "800";
      title.style.letterSpacing = ".06em";
      title.style.color = "rgba(255,215,140,1)";

      const close = document.createElement("button");
      close.id = "questClose";
      close.textContent = "✕";
      close.setAttribute("aria-label", "Close quest journal");
      close.style.width = "34px";
      close.style.height = "34px";
      close.style.borderRadius = "10px";
      close.style.fontSize = "20px";
      close.style.fontWeight = "900";
      close.style.cursor = "pointer";
      close.style.background = "rgba(0,0,0,.4)";
      close.style.border = "1px solid rgba(255,215,140,.6)";
      close.style.color = "rgba(255,215,140,1)";

      header.appendChild(title);
      header.appendChild(close);

      const content = document.createElement("div");
      content.id = "questContent";
      content.style.marginTop = "10px";
      content.style.fontSize = "16px";
      content.style.lineHeight = "1.35";
      content.style.opacity = ".96";

      panel.appendChild(header);
      panel.appendChild(content);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      return overlay;
    }

    // =============================
    // METER OVERLAY (inject if missing)
    // =============================
    let goodMeterImg;
    let evilMeterImg;

    function ensureMeterOverlay() {
      let overlay = qs("meterOverlay");
      if (overlay && qs("goodMeterImg") && qs("evilMeterImg")) {
        goodMeterImg = qs("goodMeterImg");
        evilMeterImg = qs("evilMeterImg");
        return overlay;
      }

      overlay = overlay || document.createElement("div");
      overlay.id = "meterOverlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,.65)";
      overlay.style.zIndex = "80";
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");

      const panel = document.createElement("div");
      panel.id = "meterPanel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Good and evil meter");
      panel.style.position = "absolute";
      panel.style.top = "70px";
      panel.style.right = "18px";
      panel.style.width = "min(360px, calc(100vw - 36px))";
      panel.style.maxHeight = "calc(100vh - 110px)";
      panel.style.overflow = "auto";
      panel.style.background = "rgba(0,0,0,.92)";
      panel.style.border = "1px solid rgba(255,255,255,.14)";
      panel.style.borderRadius = "16px";
      panel.style.padding = "14px";
      panel.style.boxShadow = "0 18px 60px rgba(0,0,0,0.7)";
      panel.style.textShadow = "0 1px 2px rgba(0,0,0,0.6)";
      panel.style.color = "rgba(245,240,230,.95)";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.gap = "12px";

      const title = document.createElement("div");
      title.textContent = "METER";
      title.style.fontWeight = "800";
      title.style.letterSpacing = ".06em";
      title.style.color = "rgba(255,215,140,1)";

      const close = document.createElement("button");
      close.id = "meterClose";
      close.textContent = "✕";
      close.setAttribute("aria-label", "Close meter");
      close.style.width = "34px";
      close.style.height = "34px";
      close.style.borderRadius = "10px";
      close.style.fontSize = "20px";
      close.style.fontWeight = "900";
      close.style.cursor = "pointer";
      close.style.background = "rgba(0,0,0,.4)";
      close.style.border = "1px solid rgba(255,215,140,.6)";
      close.style.color = "rgba(255,215,140,1)";

      header.appendChild(title);
      header.appendChild(close);

      const grid = document.createElement("div");
      grid.style.marginTop = "12px";
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "1fr";
      grid.style.gap = "14px";

      function meterCard(labelText, imgId) {
        const card = document.createElement("div");
        card.style.border = "1px solid rgba(255,255,255,.12)";
        card.style.background = "rgba(0,0,0,.35)";
        card.style.borderRadius = "14px";
        card.style.padding = "10px";

        const lab = document.createElement("div");
        lab.textContent = labelText;
        lab.style.fontWeight = "900";
        lab.style.letterSpacing = ".04em";
        lab.style.opacity = ".95";
        lab.style.marginBottom = "8px";

        const img = document.createElement("img");
        img.id = imgId;
        img.alt = `${labelText} meter`;
        img.style.width = "100%";
        img.style.height = "auto";
        img.style.display = "block";
        img.style.objectFit = "contain";
        img.style.filter = "drop-shadow(0 10px 22px rgba(0,0,0,0.75))";
        img.style.opacity = ".98";

        card.appendChild(lab);
        card.appendChild(img);
        return { card, img };
      }

      const goodCard = meterCard("GOOD", "goodMeterImg");
      const evilCard = meterCard("EVIL", "evilMeterImg");

      goodMeterImg = goodCard.img;
      evilMeterImg = evilCard.img;

      grid.appendChild(goodCard.card);
      grid.appendChild(evilCard.card);

      const note = document.createElement("div");
      note.style.marginTop = "10px";
      note.style.fontSize = "13px";
      note.style.lineHeight = "1.35";
      note.style.opacity = ".85";
      note.innerHTML =
        `<div><strong>Rule:</strong> If a meter is full (10) and you gain another point, it removes <strong>1</strong> from the opposite meter.</div>`;

      panel.appendChild(header);
      panel.appendChild(grid);
      panel.appendChild(note);

      overlay.innerHTML = "";
      overlay.appendChild(panel);

      document.body.appendChild(overlay);
      return overlay;
    }

    function refreshMeterUI() {
      if (!goodMeterImg || !evilMeterImg) return;
      const g = clamp(getNum(GOOD_KEY), 0, 10);
      const e = clamp(getNum(EVIL_KEY), 0, 10);
      goodMeterImg.src = `${GOOD_METER_BASE}${g}.png`;
      evilMeterImg.src = `${EVIL_METER_BASE}${e}.png`;
    }

    // =============================
    // INVENTORY OVERLAY (inject if missing)
    // =============================
    function ensureInventoryOverlay() {
      let overlay = qs("inventoryOverlay");
      if (overlay) return overlay;

      overlay = document.createElement("div");
      overlay.id = "inventoryOverlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,.70)";
      overlay.style.zIndex = "120";
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");

      const panel = document.createElement("div");
      panel.id = "inventoryPanel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Inventory");
      panel.style.position = "absolute";
      panel.style.left = "50%";
      panel.style.top = "50%";
      panel.style.transform = "translate(-50%,-50%)";
      panel.style.width = "min(520px, calc(100vw - 36px))";
      panel.style.background = "rgba(0,0,0,.92)";
      panel.style.border = "1px solid rgba(255,255,255,.14)";
      panel.style.borderRadius = "16px";
      panel.style.padding = "14px";
      panel.style.boxShadow = "0 18px 60px rgba(0,0,0,0.7)";
      panel.style.textShadow = "0 1px 2px rgba(0,0,0,0.6)";
      panel.style.color = "rgba(245,240,230,.95)";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.gap = "12px";

      const title = document.createElement("div");
      title.textContent = "INVENTORY";
      title.style.fontWeight = "800";
      title.style.letterSpacing = ".06em";
      title.style.color = "rgba(255,215,140,1)";

      const close = document.createElement("button");
      close.id = "inventoryClose";
      close.textContent = "✕";
      close.setAttribute("aria-label", "Close inventory");
      close.style.width = "34px";
      close.style.height = "34px";
      close.style.borderRadius = "10px";
      close.style.fontSize = "20px";
      close.style.fontWeight = "900";
      close.style.cursor = "pointer";
      close.style.background = "rgba(0,0,0,.4)";
      close.style.border = "1px solid rgba(255,215,140,.6)";
      close.style.color = "rgba(255,215,140,1)";

      header.appendChild(title);
      header.appendChild(close);

      const content = document.createElement("div");
      content.id = "inventoryContent";
      content.style.marginTop = "10px";
      content.style.opacity = ".95";
      content.innerHTML = `
        <div style="opacity:.85;">(Inventory UI coming next)</div>
        <div style="margin-top:10px; display:flex; gap:10px; align-items:center;">
          <img src="${HELS_AMULET_IMG}" alt="Hel's amulet" style="width:64px; height:auto; filter:drop-shadow(0 10px 18px rgba(0,0,0,.7));">
          <div><strong>Hel’s Amulet</strong><br><span style="opacity:.8;">A stolen relic.</span></div>
        </div>
      `;

      panel.appendChild(header);
      panel.appendChild(content);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // close behavior
      close.addEventListener("click", () => closeInventory());
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeInventory();
      });

      return overlay;
    }

    function openInventory() {
      const overlay = ensureInventoryOverlay();
      overlay.style.display = "block";
      overlay.setAttribute("aria-hidden", "false");
    }

    function closeInventory() {
      const overlay = qs("inventoryOverlay");
      if (!overlay) return;
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
    }

    inventoryBtn.addEventListener("click", () => openInventory());

    // =============================
    // AMULET POPUP → UNLOCK INVENTORY → OPEN INVENTORY
    // =============================
    function ensureAmuletPopups() {
      // Amulet overlay
      let amuletOverlay = qs("amuletOverlay");
      if (!amuletOverlay) {
        amuletOverlay = document.createElement("div");
        amuletOverlay.id = "amuletOverlay";
        amuletOverlay.style.position = "fixed";
        amuletOverlay.style.inset = "0";
        amuletOverlay.style.background = "rgba(0,0,0,.70)";
        amuletOverlay.style.zIndex = "130";
        amuletOverlay.style.display = "none";
        amuletOverlay.setAttribute("aria-hidden", "true");

        const panel = document.createElement("div");
        panel.id = "amuletPanel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Hel's amulet");
        panel.style.position = "absolute";
        panel.style.left = "50%";
        panel.style.top = "50%";
        panel.style.transform = "translate(-50%,-50%)";
        panel.style.width = "min(420px, calc(100vw - 36px))";
        panel.style.background = "rgba(0,0,0,.92)";
        panel.style.border = "1px solid rgba(255,255,255,.14)";
        panel.style.borderRadius = "16px";
        panel.style.padding = "14px";
        panel.style.boxShadow = "0 18px 60px rgba(0,0,0,0.7)";
        panel.style.textShadow = "0 1px 2px rgba(0,0,0,0.6)";
        panel.style.color = "rgba(245,240,230,.95)";

        const close = document.createElement("button");
        close.id = "amuletClose";
        close.textContent = "✕";
        close.setAttribute("aria-label", "Close");
        close.style.position = "absolute";
        close.style.right = "12px";
        close.style.top = "12px";
        close.style.width = "34px";
        close.style.height = "34px";
        close.style.borderRadius = "10px";
        close.style.fontSize = "20px";
        close.style.fontWeight = "900";
        close.style.cursor = "pointer";
        close.style.background = "rgba(0,0,0,.4)";
        close.style.border = "1px solid rgba(255,215,140,.6)";
        close.style.color = "rgba(255,215,140,1)";

        const img = document.createElement("img");
        img.id = "amuletImg";
        img.src = HELS_AMULET_IMG;
        img.alt = "Hel's amulet";
        img.style.width = "180px";
        img.style.height = "auto";
        img.style.display = "block";
        img.style.margin = "36px auto 10px";
        img.style.filter = "drop-shadow(0 16px 28px rgba(0,0,0,.8))";

        const msg = document.createElement("div");
        msg.id = "amuletMsg";
        msg.style.textAlign = "center";
        msg.style.fontSize = "18px";
        msg.style.lineHeight = "1.35";
        msg.style.marginTop = "8px";
        msg.innerHTML = `<strong>Stole Hel’s amulet successfully.</strong>`;

        panel.appendChild(close);
        panel.appendChild(img);
        panel.appendChild(msg);

        amuletOverlay.appendChild(panel);
        document.body.appendChild(amuletOverlay);
      }

      // Inventory unlock overlay
      let invUnlockOverlay = qs("invUnlockOverlay");
      if (!invUnlockOverlay) {
        invUnlockOverlay = document.createElement("div");
        invUnlockOverlay.id = "invUnlockOverlay";
        invUnlockOverlay.style.position = "fixed";
        invUnlockOverlay.style.inset = "0";
        invUnlockOverlay.style.background = "rgba(0,0,0,.70)";
        invUnlockOverlay.style.zIndex = "131";
        invUnlockOverlay.style.display = "none";
        invUnlockOverlay.setAttribute("aria-hidden", "true");

        const panel = document.createElement("div");
        panel.id = "invUnlockPanel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Inventory unlocked");
        panel.style.position = "absolute";
        panel.style.left = "50%";
        panel.style.top = "50%";
        panel.style.transform = "translate(-50%,-50%)";
        panel.style.width = "min(420px, calc(100vw - 36px))";
        panel.style.background = "rgba(0,0,0,.92)";
        panel.style.border = "1px solid rgba(255,255,255,.14)";
        panel.style.borderRadius = "16px";
        panel.style.padding = "14px";
        panel.style.boxShadow = "0 18px 60px rgba(0,0,0,0.7)";
        panel.style.textShadow = "0 1px 2px rgba(0,0,0,0.6)";
        panel.style.color = "rgba(245,240,230,.95)";

        const close = document.createElement("button");
        close.id = "invUnlockClose";
        close.textContent = "✕";
        close.setAttribute("aria-label", "Close");
        close.style.position = "absolute";
        close.style.right = "12px";
        close.style.top = "12px";
        close.style.width = "34px";
        close.style.height = "34px";
        close.style.borderRadius = "10px";
        close.style.fontSize = "20px";
        close.style.fontWeight = "900";
        close.style.cursor = "pointer";
        close.style.background = "rgba(0,0,0,.4)";
        close.style.border = "1px solid rgba(255,215,140,.6)";
        close.style.color = "rgba(255,215,140,1)";

        const msg = document.createElement("div");
        msg.id = "invUnlockMsg";
        msg.style.textAlign = "center";
        msg.style.fontSize = "18px";
        msg.style.lineHeight = "1.35";
        msg.style.marginTop = "30px";
        msg.innerHTML = `<strong>You have unlocked Inventory.</strong>`;

        panel.appendChild(close);
        panel.appendChild(msg);

        invUnlockOverlay.appendChild(panel);
        document.body.appendChild(invUnlockOverlay);
      }
    }

    function showAmuletThenUnlockInventory() {
      ensureAmuletPopups();

      const amuletOverlay = qs("amuletOverlay");
      const amuletClose = qs("amuletClose");
      const invUnlockOverlay = qs("invUnlockOverlay");
      const invUnlockClose = qs("invUnlockClose");

      // show amulet popup
      amuletOverlay.style.display = "block";
      amuletOverlay.setAttribute("aria-hidden", "false");

      const closeAmulet = () => {
        amuletOverlay.style.display = "none";
        amuletOverlay.setAttribute("aria-hidden", "true");
        amuletClose.removeEventListener("click", closeAmulet);

        // show inventory unlock popup
        invUnlockOverlay.style.display = "block";
        invUnlockOverlay.setAttribute("aria-hidden", "false");
      };

      const closeUnlock = () => {
        invUnlockOverlay.style.display = "none";
        invUnlockOverlay.setAttribute("aria-hidden", "true");
        invUnlockClose.removeEventListener("click", closeUnlock);

        // unlock + show icon + open inventory
        localStorage.setItem(INVENTORY_UNLOCK_KEY, "true");
        refreshInventoryButton();
        openInventory();
      };

      amuletClose.addEventListener("click", closeAmulet);
      invUnlockClose.addEventListener("click", closeUnlock);
    }

    // =============================
    // QUEST JOURNAL RENDER (✅/❌ per step)
    // =============================
    const questOverlay = ensureQuestOverlay();
    const questContent = qs("questContent");
    const questClose = qs("questClose");

    async function renderQuestJournal() {
      const activeId = (localStorage.getItem(QUEST_ID_KEY) || "").trim();
      const catalogUrl = (localStorage.getItem(QUEST_CAT_KEY) || DEFAULT_QUEST_CATALOG_URL).trim();

      if (!activeId) {
        questContent.innerHTML = `<div style="opacity:.9">No active quest.</div>`;
        return;
      }

      let catalog;
      try {
        catalog = await loadJSON(catalogUrl);
      } catch (err) {
        console.error(err);
        questContent.innerHTML = `
          <div style="opacity:.95; margin-bottom:8px;">Quest catalog failed to load.</div>
          <div style="opacity:.8; font-size:14px;">
            ActiveId: ${escapeHtml(activeId)}<br>
            Catalog: ${escapeHtml(catalogUrl)}
          </div>`;
        return;
      }

      const q = catalog?.quests?.[activeId];
      if (!q) {
        questContent.innerHTML = `
          <div style="opacity:.95; margin-bottom:8px;">Quest not found.</div>
          <div style="opacity:.8; font-size:14px;">
            ActiveId: ${escapeHtml(activeId)}<br>
            Catalog: ${escapeHtml(catalogUrl)}
          </div>`;
        return;
      }

      const steps = Array.isArray(q.steps) ? q.steps : [];
      const f = getFlags();

      // If quest is evil and has failAdds, we’ll use it on failure if not rewarded yet.
      // (Your default rule is +1 good, but this respects your quest JSON if present.)
      const failAddsGood = Number(q?.failAdds?.good ?? 1) || 1;
      const isEvil = (q.type || "").toLowerCase() === "evil";

      let anyFailed = false;

      const stepsHtml = steps
        .map((s, i) => {
          const key = `${activeId}_step${i}`;
          const st = f[key]; // "pass"|"fail"|undefined
          const cls = st === "pass" ? "pass" : st === "fail" ? "fail" : "pending";
          const mark = st === "pass" ? "✓" : st === "fail" ? "✕" : "•";
          if (st === "fail") anyFailed = true;

          return `
            <div style="display:grid; grid-template-columns:22px 1fr; gap:10px; align-items:start; margin:8px 0;">
              <div style="
                width:22px;height:22px;border-radius:8px;display:flex;align-items:center;justify-content:center;
                font-weight:900;font-size:14px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);
                ${cls === "pass" ? "color:rgba(165,255,190,.95);border-color:rgba(165,255,190,.45);background:rgba(40,120,65,.25);" : ""}
                ${cls === "fail" ? "color:rgba(255,140,140,.95);border-color:rgba(255,140,140,.45);background:rgba(120,35,35,.25);" : ""}
                ${cls === "pending" ? "color:rgba(255,255,255,.55);" : ""}
              ">${mark}</div>
              <div style="opacity:.92;">${escapeHtml(s)}</div>
            </div>
          `;
        })
        .join("");

      // apply evil-fail reward once per quest (if any step fail)
      if (isEvil && anyFailed) {
        const rewardedKey = `${activeId}_fail_rewarded`;
        if (!f[rewardedKey]) {
          f[rewardedKey] = true;
          setFlags(f);
          addAlignment("good", failAddsGood);
        }
      }

      questContent.innerHTML = `
        <div style="font-size:18px; font-weight:900; color:rgba(255,215,140,1); margin:6px 0 10px;">
          ${escapeHtml(q.title || "Quest")}
        </div>
        <div style="opacity:.95; margin-bottom:10px;">
          Giver: <strong style="color:rgba(255,210,160,0.95)">${escapeHtml(q.giver || "Unknown")}</strong>
        </div>
        ${q.summary ? `<div style="opacity:.92; margin-bottom:12px;">${escapeHtml(q.summary)}</div>` : ""}
        <div style="margin: 8px 0 6px; opacity:.95; font-weight:800;">Objectives</div>
        <div style="opacity:.92;">${stepsHtml || "<div>…</div>"}</div>
        ${q.reward ? `<div style="opacity:.95; margin-top:12px;"><strong>Reward:</strong> ${escapeHtml(q.reward)}</div>` : ""}
      `;
    }

    function openQuestJournal() {
      questOverlay.style.display = "block";
      questOverlay.setAttribute("aria-hidden", "false");
      renderQuestJournal().catch(console.error);
    }

    function closeQuestJournal() {
      questOverlay.style.display = "none";
      questOverlay.setAttribute("aria-hidden", "true");
    }

    questBtn.addEventListener("click", openQuestJournal);
    if (questClose) questClose.addEventListener("click", closeQuestJournal);
    questOverlay.addEventListener("click", (e) => {
      if (e.target === questOverlay) closeQuestJournal();
    });

    // ensure catalog key always has something
    if (!localStorage.getItem(QUEST_CAT_KEY)) {
      localStorage.setItem(QUEST_CAT_KEY, DEFAULT_QUEST_CATALOG_URL);
    }

    // =============================
    // METER OPEN/CLOSE
    // =============================
    const meterOverlay = ensureMeterOverlay();
    const meterClose = qs("meterClose");

    function openMeters() {
      refreshMeterUI();
      meterOverlay.style.display = "block";
      meterOverlay.setAttribute("aria-hidden", "false");
    }

    function closeMeters() {
      meterOverlay.style.display = "none";
      meterOverlay.setAttribute("aria-hidden", "true");
    }

    meterBtn.addEventListener("click", openMeters);
    if (meterClose) meterClose.addEventListener("click", closeMeters);
    meterOverlay.addEventListener("click", (e) => {
      if (e.target === meterOverlay) closeMeters();
    });

    // =============================
    // INVENTORY OPEN/CLOSE
    // =============================
    function openInventorySafe() {
      if (localStorage.getItem(INVENTORY_UNLOCK_KEY) !== "true") return;
      openInventory();
    }

    inventoryBtn.addEventListener("click", openInventorySafe);

    // =============================
    // INITIAL UI STATE
    // =============================
    questBtn.title = "Quests";
    meterBtn.title = "Good / Evil Meter";
    inventoryBtn.title = "Inventory";

    refreshInventoryButton();
    refreshMeterUI();

    // if Hel’s amulet was already stolen earlier but popup not shown yet:
    const flagsNow = getFlags();
    if (flagsNow.stoleHelsAmulet === true && localStorage.getItem(AMULET_POP_SEEN_KEY) !== "true") {
      localStorage.setItem(AMULET_POP_SEEN_KEY, "true");
      showAmuletThenUnlockInventory();
    }

    // global Loki check on load too
    checkGlobalLokiKickout().catch?.(() => {});

    // =============================
    // GLOBAL: expose helpers if you want to call from page scripts
    // (Optional but helpful)
    // =============================
    window.VA = window.VA || {};
    window.VA.addGood = (n = 1) => addAlignment("good", n);
    window.VA.addEvil = (n = 1) => addAlignment("evil", n);
    window.VA.runDialogue = (url) => runDialogueFromJson(url);
    window.VA.setQuestStep = (qid, idx, st) => setQuestStepStatus(qid, idx, st);

    // ESC closes everything
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideDialogue();
        closeQuestJournal();
        closeMeters();
        closeInventory();
        const ao = qs("amuletOverlay");
        const io = qs("invUnlockOverlay");
        if (ao) ao.style.display = "none";
        if (io) io.style.display = "none";
      }
    });
  });
})();



