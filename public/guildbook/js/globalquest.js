/* /public/guildbook/js/globalquest.js */
(() => {
  "use strict";

  // ----------------------------
  // Canonical keys (match your system)
  // ----------------------------
  const FLAGS_KEY     = "va_flags";
  const QUEST_ID_KEY  = "vaq_activeQuestId";
  const QUEST_CAT_KEY = "vaq_activeQuestCatalog";

  // ----------------------------
  // Helpers
  // ----------------------------
  function getFlags(){
    try { return JSON.parse(localStorage.getItem(FLAGS_KEY) || "{}"); }
    catch { return {}; }
  }
  function setFlags(obj){
    localStorage.setItem(FLAGS_KEY, JSON.stringify(obj || {}));
  }
  function setFlag(name, val=true){
    const f = getFlags();
    f[name] = val;
    setFlags(f);
  }
  function hasFlag(name, expected=true){
    const f = getFlags();
    return f[name] === expected;
  }

  // Calls your existing toast if present
  function toast(msg){
    try {
      if (typeof window.showToast === "function") return window.showToast(msg);
      if (typeof window.__va_toast === "function") return window.__va_toast(msg);
    } catch {}
    console.log("TOAST:", msg);
  }

  function refreshUI(){
    try { window.__va_refresh_icons && window.__va_refresh_icons(); } catch {}
    try { window.__vaq_renderHud && window.__vaq_renderHud(); } catch {}
  }

  // ----------------------------
  // Quest completeness check (catalog-driven)
  // Reads active quest JSON, verifies all objectives pass.
  // ----------------------------
  async function isQuestFullyCompleteFromCatalog(catalogUrl, questId){
    if (!catalogUrl || !questId) return false;

    let cat;
    try{
      const res = await fetch(catalogUrl, { cache: "no-store" });
      if (!res.ok) return false;
      cat = await res.json();
    }catch{
      return false;
    }

    const q = cat?.quests?.[questId];
    if (!q) return false;

    const flags = getFlags();
    const order = Array.isArray(q.objectiveOrder) ? q.objectiveOrder : [];
    const objectives = q.objectives || {};

    if (!order.length) return false;

    // Each objective passes when flags[flagName] === passWhen
    for (const key of order){
      const o = objectives[key];
      if (!o) return false;
      const flagName = o.flag;
      const passWhen = o.passWhen;

      if (flags[flagName] !== passWhen) return false;
    }

    return true;
  }

  // ----------------------------
  // Set active quest (catalog + quest id)
  // ----------------------------
  function setActiveQuest(catalogUrl, questId){
    if (catalogUrl) localStorage.setItem(QUEST_CAT_KEY, catalogUrl);
    if (questId) localStorage.setItem(QUEST_ID_KEY, questId);
    refreshUI();
  }

  // ----------------------------
  // "Rules" list
  // Each rule: when() => boolean/async, then() => apply changes once
  // The "onceKey" prevents re-firing.
  // ----------------------------
  const RULES = [
    // 1) When dq_001 complete -> grant Loki’s mark + swap to Go To Fenrir quest
    {
      id: "rule_dq001_to_gotofenrir",
      onceKey: "__rule_dq001_to_gotofenrir_done",
      async when(){
        // If mark already granted, don't bother
        if (hasFlag("va_lokis_mark", true)) return false;

        const activeId  = localStorage.getItem(QUEST_ID_KEY)  || "";
        const activeCat = localStorage.getItem(QUEST_CAT_KEY) || "/guildbook/quests/dreadheim_quests.json";

        // Only trigger off dq_001 (or you can remove this check if you want it global)
        if (activeId !== "dq_001") return false;

        return await isQuestFullyCompleteFromCatalog(activeCat, "dq_001");
      },
      then(){
        // Grant mark + open forest lock + toast + switch quest
        setFlag("va_lokis_mark", true);
        setFlag("dreadheim_forest_open", true);

        toast("You have earned Loki’s Mark. Go see Fenrir.");

        setActiveQuest("/data/episodes/volume1_ep1/gotofenrir.json", "dq_go_fenrir");
      }
    },

    // 2) When entering Fenrir’s Forest page -> check the "enter" objective flag
    {
      id: "rule_enter_fenrirs_forest",
      onceKey: "__rule_enter_fenrirs_forest_done",
      async when(){
        // Only if we’re on the fenrir forest scene
        const path = (location.pathname || "").toLowerCase();
        if (!path.includes("fenrirsforest")) return false;

        // Only if this quest is active (optional guard)
        const activeId = localStorage.getItem(QUEST_ID_KEY) || "";
        if (activeId !== "dq_go_fenrir") return false;

        // Don’t refire if already set
        return !hasFlag("dq_go_fenrir_entered", true);
      },
      then(){
        setFlag("dq_go_fenrir_entered", true);
        refreshUI();
      }
    },

    // 3) After Fenrir dialogue completes -> check "see" and swap to next quest catalog
    // NOTE: You will call window.GQ.markFenrirSpoken() when the dialogue ends.
    {
      id: "rule_fenrir_spoken",
      onceKey: "__rule_fenrir_spoken_done",
      async when(){
        // must be explicitly set by the dialogue runner
        return hasFlag("__fenrir_dialogue_complete", true) && !hasFlag("dq_go_fenrir_seen", true);
      },
      then(){
        setFlag("dq_go_fenrir_seen", true);
        setFlag("__fenrir_dialogue_complete", false); // clear trigger
        refreshUI();

        // When ALL objectives of dq_go_fenrir are done, swap to Fenrir’s next quests:
        // (You said fenrirgivesquests.json)
        // We can just switch immediately here since mark+enter+see will now be true.
        setActiveQuest("/data/episodes/volume1_ep1/fenrirgivesquests.json", "dq_fenrir_001"); // change id to your real first Fenrir quest
        toast("Fenrir has new orders.");
      }
    }
  ];

  // ----------------------------
  // Runner (polling, lightweight)
  // Runs on load + every 800ms for a few seconds, then every 2s.
  // (So it catches changes even if flags are set by clicks)
  // ----------------------------
  let fastTicks = 0;

  async function runOnce(){
    const flags = getFlags();

    for (const r of RULES){
      if (flags[r.onceKey]) continue;

      let ok = false;
      try { ok = await r.when(); } catch { ok = false; }

      if (ok){
        try { r.then(); } catch (e) { console.warn("Quest rule error:", r.id, e); }
        // mark once
        const f2 = getFlags();
        f2[r.onceKey] = true;
        setFlags(f2);
      }
    }
  }

  function loop(){
    runOnce();

    fastTicks++;
    if (fastTicks < 10){
      setTimeout(loop, 800);
    }else{
      setTimeout(loop, 2000);
    }
  }

  // Expose a tiny API so your Fenrir dialogue runner can trigger the handoff
  window.GQ = window.GQ || {};
  window.GQ.markFenrirSpoken = function(){
    setFlag("__fenrir_dialogue_complete", true);
    // don’t set dq_go_fenrir_seen here — the rule does it (once)
    runOnce();
  };

  // Boot
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", loop);
  }else{
    loop();
  }
})();
