// =============================
// DREADHEIM • MEAD HALL (JS ONLY)
// Drop-in script for your existing dreadheim_meadhall.html
// Keeps your HTML/CSS as-is and ADDS:
// - Meter icon beside quest icon (tooltip hover labels)
// - Meter overlay (smaller box) showing correct image automatically
// - Good/Evil meter logic with overflow rule (10+1 steals from opposite)
// - Dialogue engine supports choices + rewards + kickout (good >= 10)
// - Quest journal shows ✅ / ❌ per objective using flags from dialogue
// - Evil quest fail rule: if ANY objective failed, +1 GOOD (once) because evil quest
// =============================

document.addEventListener("DOMContentLoaded", async () => {
  // ----------------------------
  // QUEST STORAGE KEYS
  // ----------------------------
  const QUEST_ID_KEY  = "vaq_activeQuestId";
  const QUEST_CAT_KEY = "vaq_activeQuestCatalog";
  const QUEST_CATALOG_URL = "/guildbook/quests/dreadheim_quests.json";

  // ----------------------------
  // DIALOGUE JSONS
  // ----------------------------
  const HEL_DIALOGUE_JSON = "/data/episodes/volume1_ep1/hel_meadhall.json";
  const KICKED_JSON = "/data/episodes/volume1_ep1/kickedoutbyloki.json";

  // ----------------------------
  // GOOD/EVIL KEYS
  // ----------------------------
  const GOOD_KEY  = "va_good";
  const EVIL_KEY  = "va_evil";
  const NAME_KEY  = "va_player_name";
  const FLAGS_KEY = "va_flags";

  // ----------------------------
  // METER ASSETS
  // ----------------------------
  // Evil meter images: /guildbook/ui/evilmeter/0.png ... 10.png
  // Good meter images: /guildbook/ui/goodmeter/0.png ... 10.png
  const EVIL_METER_BASE = "/guildbook/ui/evilmeter/";
  const GOOD_METER_BASE = "/guildbook/ui/goodmeter/";
  const METER_ICON_SRC  = "/guildbook/ui/metericon.png";

  // ----------------------------
  // UI refs (must exist in your HTML)
  // ----------------------------
  const dlg = document.getElementById("dlg");
  const dlgName = document.getElementById("dlgName");
  const dlgText = document.getElementById("dlgText");
  const dlgBtns = document.getElementById("dlgBtns");
  const dlgPortrait = document.getElementById("dlgPortrait");
  const npcHel = document.getElementById("npcHel");

  const questBtn = document.getElementById("questBtn");
  const questOverlay = document.getElementById("questOverlay");
  const questClose = document.getElementById("questClose");
  const questContent = document.getElementById("questContent");

  // ----------------------------
  // Helpers
  // ----------------------------
  function escapeHtml(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  async function loadJSON(url){
    const res = await fetch(url, { cache:"no-store" });
    if (!res.ok) throw new Error("Failed to load " + url + " (" + res.status + ")");
    return await res.json();
  }

  function showDialogue({ speaker, text, portraitSrc, buttons = [] }){
    dlgName.textContent = speaker || "";
    dlgText.textContent = (typeof text === "string") ? text : String(text ?? "");
    dlgBtns.innerHTML = "";
    if (portraitSrc) dlgPortrait.src = portraitSrc;
    dlg.classList.remove("hidden");

    buttons.forEach(b => {
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

  function hideDialogue(){
    dlg.classList.add("hidden");
    dlgName.textContent = "";
    dlgText.textContent = "";
    dlgBtns.innerHTML = "";
  }

  hideDialogue();

  // ----------------------------
  // Flags helpers
  // ----------------------------
  function getFlags(){
    try{ return JSON.parse(localStorage.getItem(FLAGS_KEY) || "{}"); }
    catch{ return {}; }
  }
  function setFlags(obj){
    localStorage.setItem(FLAGS_KEY, JSON.stringify(obj || {}));
  }

  // ----------------------------
  // Name helpers
  // ----------------------------
  function getName(){
    return (localStorage.getItem(NAME_KEY) || "").trim() || "Traveler";
  }
  function txt(t){
    return String(t ?? "").replaceAll("{name}", getName());
  }

  // ----------------------------
  // Number helpers
  // ----------------------------
  function getNum(key){
    const v = Number(localStorage.getItem(key) || "0");
    return Number.isFinite(v) ? v : 0;
  }
  function setNum(key, n){
    localStorage.setItem(key, String(n));
  }

  // ----------------------------
  // Meter logic (cap 0..10 with overflow rule)
  // If adding to GOOD when GOOD==10 -> GOOD stays 10, EVIL -= 1
  // If adding to EVIL when EVIL==10 -> EVIL stays 10, GOOD -= 1
  // Also clamps both to 0..10.
  // ----------------------------
  function addGood(points=1){
    points = Number(points) || 0;
    for (let i=0; i<points; i++){
      let g = getNum(GOOD_KEY);
      let e = getNum(EVIL_KEY);
      if (g >= 10){
        // overflow steals from evil
        e = Math.max(0, e - 1);
        setNum(EVIL_KEY, e);
        setNum(GOOD_KEY, 10);
      } else {
        g = Math.min(10, g + 1);
        setNum(GOOD_KEY, g);
      }
    }
    refreshMeterUI();
  }

  function addEvil(points=1){
    points = Number(points) || 0;
    for (let i=0; i<points; i++){
      let e = getNum(EVIL_KEY);
      let g = getNum(GOOD_KEY);
      if (e >= 10){
        // overflow steals from good
        g = Math.max(0, g - 1);
        setNum(GOOD_KEY, g);
        setNum(EVIL_KEY, 10);
      } else {
        e = Math.min(10, e + 1);
        setNum(EVIL_KEY, e);
      }
    }
    refreshMeterUI();
  }

  // ----------------------------
  // Reward application (supports your JSON reward schema)
  // ----------------------------
  function applyReward(reward){
    if (!reward) return;

    if (reward.good) addGood(Number(reward.good));
    if (reward.evil) addEvil(Number(reward.evil));

    if (reward.set && typeof reward.set === "object"){
      for (const k of Object.keys(reward.set)){
        localStorage.setItem(k, String(reward.set[k]));
      }
    }

    if (reward.flags && typeof reward.flags === "object"){
      const f = getFlags();
      for (const k of Object.keys(reward.flags)) f[k] = reward.flags[k];
      setFlags(f);
    }

    if (reward.setQuest?.id){
      localStorage.setItem(QUEST_ID_KEY, reward.setQuest.id);
      if (reward.setQuest.catalog) localStorage.setItem(QUEST_CAT_KEY, reward.setQuest.catalog);
    }

    // coins/items left for future inventory system
  }

  // ----------------------------
  // Dialogue runner (choices + rewards + kickout)
  // ----------------------------
  async function runDialogueFromJson(url){
    const data = await loadJSON(url);
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const map = new Map(nodes.map(n => [n.id, n]));

    const portraitDefault = data?.meta?.portrait || "/guildbook/npcs/hel/hel.png";
    const speakerDefault = data?.meta?.speakerDefault || "…";
    const startId = data?.start || (nodes[0]?.id);

    function showNode(id){
      if (id === "__close"){
        hideDialogue();
        if (data?.meta?.gotoOnEnd) window.location.href = data.meta.gotoOnEnd;
        return;
      }

      const node = map.get(id);
      if (!node){
        showDialogue({
          speaker: speakerDefault,
          text: "…",
          portraitSrc: portraitDefault,
          buttons: [{ label: "Close", onClick: hideDialogue }]
        });
        return;
      }

      applyReward(node.reward);

      // Kickout: good >= threshold triggers Loki dialogue
      const threshold = Number(data?.meta?.goodKickThreshold || 10) || 10;
      const good = getNum(GOOD_KEY);
      if (good >= threshold && url !== KICKED_JSON){
        runDialogueFromJson(KICKED_JSON).catch(console.error);
        return;
      }

      const speaker = node.speaker || speakerDefault;
      const text = txt(node.text || "…");
      const portrait = node.portrait || portraitDefault;
      const choices = Array.isArray(node.choices) ? node.choices : [];

      const btns = choices.length
        ? choices.map(c => ({
            label: c.label || "Continue",
            onClick: () => showNode(c.to || "__close")
          }))
        : [{ label: "Close", onClick: hideDialogue }];

      showDialogue({ speaker, text, portraitSrc: portrait, buttons: btns });
    }

    showNode(startId || "__close");
  }

  // ----------------------------
  // HEL ANIMATION (frames 1-8) stays same
  // ----------------------------
  const helFrames = [
    "/guildbook/npcs/hel/frame_001.png",
    "/guildbook/npcs/hel/frame_002.png",
    "/guildbook/npcs/hel/frame_003.png",
    "/guildbook/npcs/hel/frame_004.png",
    "/guildbook/npcs/hel/frame_005.png",
    "/guildbook/npcs/hel/frame_006.png",
    "/guildbook/npcs/hel/frame_007.png",
    "/guildbook/npcs/hel/frame_008.png"
  ];
  let helIdx = 0;
  setInterval(() => {
    helIdx = (helIdx + 1) % helFrames.length;
    npcHel.src = helFrames[helIdx];
  }, 120);

  // Hel click opens dialogue (NO autoplay)
  npcHel.addEventListener("click", () => {
    runDialogueFromJson(HEL_DIALOGUE_JSON).catch(err => {
      console.error(err);
      showDialogue({
        speaker: "Hel",
        text: "…",
        portraitSrc: "/guildbook/npcs/hel/hel.png",
        buttons: [{ label: "Close", onClick: hideDialogue }]
      });
    });
  });

  // ----------------------------
  // QUEST JOURNAL (with ✅/❌ objective status)
  // Your evil quest dq_001 objectives map to flags:
  // - dq_001_bowed          (true/false)
  // - dq_001_demandedSeat   (true/false)
  // - dq_001_stole          (true/false)
  // If ANY are false (failed), addGood(1) ONCE (because evil quest).
  // ----------------------------
  function getObjectiveState(flags){
    // null = not decided yet, true = passed, false = failed
    // For bowed objective: dq_001_bowed === false means PASSED (since objective is "WITHOUT bowing")
    const bowedDecision = (typeof flags.dq_001_bowed === "boolean") ? flags.dq_001_bowed : null;
    const demandDecision = (typeof flags.dq_001_demandedSeat === "boolean") ? flags.dq_001_demandedSeat : null;
    const stoleDecision = (typeof flags.dq_001_stole === "boolean") ? flags.dq_001_stole : null;

    // Objective 1: Enter without bowing => PASS if bowedDecision === false
    const obj1 = (bowedDecision === null) ? null : (bowedDecision === false);

    // Objective 2: Demand a seat => PASS if demandDecision === true
    const obj2 = (demandDecision === null) ? null : (demandDecision === true);

    // Objective 3: Leave with something not offered => PASS if stoleDecision === true
    const obj3 = (stoleDecision === null) ? null : (stoleDecision === true);

    return { obj1, obj2, obj3 };
  }

  function iconForState(st){
    if (st === true) return "✅";
    if (st === false) return "❌";
    return "⬜"; // undecided
  }

  function maybeApplyEvilQuestFailGoodPoint(){
    const activeId = localStorage.getItem(QUEST_ID_KEY) || "";
    if (activeId !== "dq_001") return;

    const flags = getFlags();
    // only apply once
    if (flags.dq_001_failAwardedGoodPoint) return;

    const { obj1, obj2, obj3 } = getObjectiveState(flags);
    // Only decide "failed" if all three are decided OR at least one is explicitly failed.
    const decided = [obj1,obj2,obj3].filter(v => v !== null);
    if (!decided.length) return;

    const anyFailed = (obj1 === false) || (obj2 === false) || (obj3 === false);
    if (!anyFailed) return;

    // award +1 good once because these are EVIL quests
    addGood(1);
    flags.dq_001_failAwardedGoodPoint = true;
    setFlags(flags);
  }

  async function renderQuestJournal(){
    const activeId = localStorage.getItem(QUEST_ID_KEY) || "";
    const catalogUrl = localStorage.getItem(QUEST_CAT_KEY) || QUEST_CATALOG_URL;

    if (!activeId){
      questContent.innerHTML = `<div style="opacity:.9">No active quest.</div>`;
      return;
    }

    let catalog;
    try{
      catalog = await loadJSON(catalogUrl);
    }catch(err){
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
    const flags = getFlags();

    let decoratedSteps = steps.map((s, idx) => {
      let state = null;

      if (activeId === "dq_001"){
        const st = getObjectiveState(flags);
        if (idx === 0) state = st.obj1;
        if (idx === 1) state = st.obj2;
        if (idx === 2) state = st.obj3;
      }

      const badge = iconForState(state);
      return `<li style="margin:6px 0;">${badge} ${escapeHtml(s)}</li>`;
    }).join("");

    // after rendering logic: apply evil-quest fail award if needed
    maybeApplyEvilQuestFailGoodPoint();

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
        ${decoratedSteps || "<li>…</li>"}
      </ol>
      ${q.reward ? `<div style="opacity:.95;"><strong>Reward:</strong> ${escapeHtml(q.reward)}</div>` : ""}
    `;
  }

  function openQuestJournal(){
    questOverlay.style.display = "block";
    questOverlay.setAttribute("aria-hidden","false");
    renderQuestJournal().catch(err => {
      console.error(err);
      questContent.innerHTML = `<div style="opacity:.9">Quest journal failed.</div>`;
    });
  }

  function closeQuestJournal(){
    questOverlay.style.display = "none";
    questOverlay.setAttribute("aria-hidden","true");
  }

  questBtn.addEventListener("click", openQuestJournal);
  questClose.addEventListener("click", closeQuestJournal);
  questOverlay.addEventListener("click", (e) => {
    if (e.target === questOverlay) closeQuestJournal();
  });

  // Force set quest catalog each time
  localStorage.setItem(QUEST_CAT_KEY, QUEST_CATALOG_URL);

  // ----------------------------
  // TOOLTIP hover labels (quest + meter)
  // ----------------------------
  questBtn.title = "Quests";

  // ----------------------------
  // METER ICON + OVERLAY (smaller)
  // Injects UI without changing your HTML
  // ----------------------------
  const meterBtn = document.createElement("button");
  meterBtn.id = "meterBtn";
  meterBtn.type = "button";
  meterBtn.setAttribute("aria-label", "Open good/evil meter");
  meterBtn.title = "Good/Evil Meter";
  meterBtn.style.position = "fixed";
  meterBtn.style.top = "14px";
  meterBtn.style.right = "72px"; // beside quest icon
  meterBtn.style.width = "52px";
  meterBtn.style.height = "52px";
  meterBtn.style.background = "transparent";
  meterBtn.style.border = "none";
  meterBtn.style.cursor = "pointer";
  meterBtn.style.zIndex = "60";
  meterBtn.style.padding = "0";

  const meterImg = document.createElement("img");
  meterImg.src = METER_ICON_SRC;
  meterImg.alt = "Meter";
  meterImg.style.width = "100%";
  meterImg.style.height = "100%";
  meterImg.style.objectFit = "contain";
  meterImg.style.filter = "drop-shadow(0 10px 22px rgba(0,0,0,0.75))";
  meterImg.style.opacity = ".96";
  meterImg.style.transition = "transform 120ms ease";
  meterBtn.addEventListener("mouseenter", () => (meterImg.style.transform = "scale(1.05)"));
  meterBtn.addEventListener("mouseleave", () => (meterImg.style.transform = "scale(1)"));

  meterBtn.appendChild(meterImg);
  document.body.appendChild(meterBtn);

  const meterOverlay = document.createElement("div");
  meterOverlay.id = "meterOverlay";
  meterOverlay.style.position = "fixed";
  meterOverlay.style.inset = "0";
  meterOverlay.style.background = "rgba(0,0,0,.65)";
  meterOverlay.style.zIndex = "80";
  meterOverlay.style.display = "none";

  const meterPanel = document.createElement("div");
  meterPanel.id = "meterPanel";
  meterPanel.setAttribute("role", "dialog");
  meterPanel.setAttribute("aria-label", "Good/Evil meter");
  meterPanel.style.position = "absolute";
  meterPanel.style.top = "72px";
  meterPanel.style.right = "18px";
  meterPanel.style.width = "min(420px, calc(100vw - 36px))"; // smaller
  meterPanel.style.borderRadius = "16px";
  meterPanel.style.overflow = "hidden";
  meterPanel.style.background = "rgba(0,0,0,.92)";
  meterPanel.style.border = "1px solid rgba(255,255,255,.14)";
  meterPanel.style.boxShadow = "0 18px 60px rgba(0,0,0,0.7)";
  meterPanel.style.padding = "12px";

  const meterHeader = document.createElement("div");
  meterHeader.style.display = "flex";
  meterHeader.style.justifyContent = "space-between";
  meterHeader.style.alignItems = "center";
  meterHeader.style.gap = "12px";

  const meterTitle = document.createElement("div");
  meterTitle.textContent = "GOOD / EVIL";
  meterTitle.style.fontWeight = "900";
  meterTitle.style.letterSpacing = ".08em";
  meterTitle.style.color = "rgba(255,215,140,1)";

  const meterClose = document.createElement("button");
  meterClose.type = "button";
  meterClose.textContent = "✕";
  meterClose.setAttribute("aria-label", "Close meter");
  meterClose.style.width = "34px";
  meterClose.style.height = "34px";
  meterClose.style.borderRadius = "10px";
  meterClose.style.fontSize = "20px";
  meterClose.style.fontWeight = "900";
  meterClose.style.cursor = "pointer";
  meterClose.style.background = "rgba(0,0,0,.4)";
  meterClose.style.border = "1px solid rgba(255,215,140,.6)";
  meterClose.style.color = "rgba(255,215,140,1)";

  meterHeader.appendChild(meterTitle);
  meterHeader.appendChild(meterClose);

  const meterBody = document.createElement("div");
  meterBody.style.marginTop = "10px";
  meterBody.style.display = "grid";
  meterBody.style.gridTemplateColumns = "1fr 1fr";
  meterBody.style.gap = "10px";

  const goodWrap = document.createElement("div");
  const evilWrap = document.createElement("div");

  const goodLabel = document.createElement("div");
  goodLabel.textContent = "GOOD";
  goodLabel.style.fontWeight = "900";
  goodLabel.style.opacity = ".95";
  goodLabel.style.marginBottom = "6px";

  const evilLabel = document.createElement("div");
  evilLabel.textContent = "EVIL";
  evilLabel.style.fontWeight = "900";
  evilLabel.style.opacity = ".95";
  evilLabel.style.marginBottom = "6px";

  const goodImg = document.createElement("img");
  goodImg.alt = "Good meter";
  goodImg.style.width = "100%";
  goodImg.style.height = "auto";
  goodImg.style.display = "block";
  goodImg.style.borderRadius = "12px";
  goodImg.style.border = "1px solid rgba(255,255,255,.10)";

  const evilImg2 = document.createElement("img");
  evilImg2.alt = "Evil meter";
  evilImg2.style.width = "100%";
  evilImg2.style.height = "auto";
  evilImg2.style.display = "block";
  evilImg2.style.borderRadius = "12px";
  evilImg2.style.border = "1px solid rgba(255,255,255,.10)";

  const meterNote = document.createElement("div");
  meterNote.style.marginTop = "10px";
  meterNote.style.fontSize = "13px";
  meterNote.style.lineHeight = "1.35";
  meterNote.style.opacity = ".85";
  meterNote.style.color = "rgba(245,240,230,.95)";
  meterNote.innerHTML = `
    <div><strong>Rule:</strong> If a meter is full (10) and you gain another point, it removes <strong>1</strong> from the opposite meter.</div>
  `;

  goodWrap.appendChild(goodLabel);
  goodWrap.appendChild(goodImg);
  evilWrap.appendChild(evilLabel);
  evilWrap.appendChild(evilImg2);

  meterBody.appendChild(goodWrap);
  meterBody.appendChild(evilWrap);

  meterPanel.appendChild(meterHeader);
  meterPanel.appendChild(meterBody);
  meterPanel.appendChild(meterNote);

  meterOverlay.appendChild(meterPanel);
  document.body.appendChild(meterOverlay);

  function openMeter(){
    meterOverlay.style.display = "block";
    meterOverlay.setAttribute("aria-hidden","false");
    refreshMeterUI();
  }
  function closeMeter(){
    meterOverlay.style.display = "none";
    meterOverlay.setAttribute("aria-hidden","true");
  }

  meterBtn.addEventListener("click", openMeter);
  meterClose.addEventListener("click", closeMeter);
  meterOverlay.addEventListener("click", (e) => {
    if (e.target === meterOverlay) closeMeter();
  });

  function clamp0to10(n){
    n = Number(n) || 0;
    if (n < 0) return 0;
    if (n > 10) return 10;
    return n;
  }

  function refreshMeterUI(){
    const g = clamp0to10(getNum(GOOD_KEY));
    const e = clamp0to10(getNum(EVIL_KEY));

    goodImg.src = `${GOOD_METER_BASE}${g}.png`;
    evilImg2.src = `${EVIL_METER_BASE}${e}.png`;
  }

  // initial refresh
  refreshMeterUI();

  // ----------------------------
  // ESC closes dialogue/journal/meter
  // ----------------------------
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){
      hideDialogue();
      closeQuestJournal();
      closeMeter();
    }
  });
});

