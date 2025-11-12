// /src/global-game-setup.ts
// Unified global bootstrap for VA (quests, catalog, HUD, inventory, SFX, etc.)

import { Inventory } from "./inventory";
(window as any).Inventory = Inventory;

/* =========================================================
   GENDER + UNIVERSAL HERO SPRITE
   ========================================================= */
if (!localStorage.getItem("va_gender")) {
  localStorage.setItem("va_gender", "male");
}
document.body?.setAttribute("data-gender", localStorage.getItem("va_gender") || "male");

(window as any).getHeroSprite = function (): string {
  const g = localStorage.getItem("va_gender");
  return g === "female"
    ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
    : "/guildbook/avatars/dreadheim-warrior.png";
};

/* =========================================================
   KEYS / TYPES
   ========================================================= */
const VAQ_KEY   = "va_quests";
const RACE_KEY  = "va_race";
const VARS_KEY  = "va_vars";

type QStatus = "available" | "active" | "completed" | "locked";
type Quest = { id: string; title: string; desc: string; status: QStatus; progress?: number };

/* Hard order + rules (prevents skipping ahead) */
const VAQ_RULES = [
  { id: "q_main_pick_race",         next: "q_travel_home" },
  { id: "q_travel_home",            next: "q_find_dreadheim_wizard", requires: ["q_main_pick_race"], race: "dreadheim" },
  { id: "q_find_dreadheim_wizard",  next: "q_find_dreadheim_witch",  requires: ["q_travel_home"],    race: "dreadheim" },
  { id: "q_find_dreadheim_witch",   next: null,                      requires: ["q_find_dreadheim_wizard"], race: "dreadheim" },
] as const;
function getRule(id: string) { return VAQ_RULES.find(r => r.id === id) || null; }
function getNextQuestId(id: string): string | null { return getRule(id)?.next || null; }

/* =========================================================
   QUEST STORAGE (safe write + debounced event)
   ========================================================= */
function qRead(): Quest[] {
  try { return JSON.parse(localStorage.getItem(VAQ_KEY) || "[]"); }
  catch { return []; }
}

let __qWriteBusy = false;
let __emitQueued = false;
function qWrite(list: Quest[], forceEmit = false) {
  const prev = localStorage.getItem(VAQ_KEY) || "[]";
  const next = JSON.stringify(list);
  if (prev === next && !forceEmit) return;

  if (__qWriteBusy) {
    try { localStorage.setItem(VAQ_KEY, next); } catch {}
    return;
  }
  __qWriteBusy = true;
  try { localStorage.setItem(VAQ_KEY, next); } catch (e) { console.warn("qWrite failed:", e); }
  __qWriteBusy = false;

  if (!__emitQueued) {
    __emitQueued = true;
    setTimeout(() => {
      __emitQueued = false;
      try { window.dispatchEvent(new CustomEvent("va-quest-updated")); } catch {}
    }, 0);
  }
}

/* =========================================================
   VARS ENGINE (catalog-driven autoprogress)
   ========================================================= */
type Vars = {
  race?: string;                   // "dreadheim"|"myriador"|"wildwood"
  travelCompleted?: boolean;       // set after travel
  wizardParchmentSigned?: boolean; // set after parchment signature or scroll in bag
  [k: string]: any;
};
function readVars(): Vars {
  try { return JSON.parse(localStorage.getItem(VARS_KEY) || "{}"); }
  catch { return {}; }
}
function writeVars(v: Vars) {
  localStorage.setItem(VARS_KEY, JSON.stringify(v));
}

/* =========================================================
   SANITIZE (hard gates to enforce order)
   ========================================================= */
function sanitizeQuestOrder(): void {
  const v = readVars();
  const race = (v.race || localStorage.getItem(RACE_KEY) || "").toLowerCase();
  const list = qRead();
  const byId = new Map<string, Quest>(list.map(q => [q.id, q]));

  const pick  = byId.get("q_main_pick_race");
  const travel= byId.get("q_travel_home");
  const wiz   = byId.get("q_find_dreadheim_wizard");
  const witch = byId.get("q_find_dreadheim_witch");

  const isDone = (q?: Quest) => q?.status === "completed";
  const relock = (q?: Quest) => { if (q && q.status !== "completed") { q.status = "locked"; q.progress = 0; } };

  // Witch cannot be before wizard complete
  if (witch && (witch.status === "active" || witch.status === "available") && !isDone(wiz)) {
    relock(witch);
  }
  // Wizard cannot be before travel complete (when Dreadheim)
  if (race === "dreadheim" && wiz && (wiz.status === "active" || wiz.status === "available") && !(travel && travel.status === "completed")) {
    relock(wiz);
  }
  // Travel cannot be before pick complete
  if (travel && (travel.status === "active" || travel.status === "available") && !(pick && pick.status === "completed")) {
    relock(travel);
  }

  // Only one active at a time
  const actives = list.filter(q => q.status === "active");
  if (actives.length > 1) {
    const order = ["q_main_pick_race", "q_travel_home", "q_find_dreadheim_wizard", "q_find_dreadheim_witch"];
    const keep = actives.sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
    for (const q of actives) if (q !== keep) q.status = "available";
  }

  qWrite(list);
}

/** Helper: ensure only one active; if none active, pick a preferred one */
function ensureSingleActiveAndAutoPick(map: Record<string, Quest>, v: Vars) {
  // Keep only one active
  let activeCount = 0;
  for (const q of Object.values(map)) if (q.status === "active") activeCount++;
  if (activeCount > 1) {
    let kept = false;
    for (const q of Object.values(map)) {
      if (q.status === "active") {
        if (!kept) { kept = true; }
        else q.status = "available";
      }
    }
  }

  const currentActive = Object.values(map).find(q => q.status === "active");
  if (currentActive) return;

  const race = (v.race || localStorage.getItem(RACE_KEY) || "").toLowerCase();

  // Priority order (forced):
  if (race && map["q_travel_home"]?.status !== "completed") {
    map["q_travel_home"].status = "active";
    return;
  }
  if (race === "dreadheim"
    && (v.travelCompleted || map["q_travel_home"]?.status === "completed")
    && map["q_find_dreadheim_wizard"]
    && map["q_find_dreadheim_wizard"].status !== "completed") {
    map["q_find_dreadheim_wizard"].status = "active";
    return;
  }
  if ((v.wizardParchmentSigned || map["q_find_dreadheim_wizard"]?.status === "completed")
    && map["q_find_dreadheim_witch"]
    && map["q_find_dreadheim_witch"].status !== "completed") {
    map["q_find_dreadheim_witch"].status = "active";
    return;
  }
}

/**
 * Apply global rules to quests based on vars.
 * Keeps things “automatic” so catalog actions can just set flags.
 */
function applyRulesOnce(): void {
  const v = readVars();
  const list = qRead();
  const map: Record<string, Quest> = Object.fromEntries(list.map(q => [q.id, q]));

  // seed baseline quests if missing
  if (!map["q_main_pick_race"])
    map["q_main_pick_race"] = { id:"q_main_pick_race", title:"Choose Your Path", desc:"Pick your homeland.", status:"available", progress:0 };
  if (!map["q_travel_home"])
    map["q_travel_home"] = { id:"q_travel_home", title:"Travel to Dreadheim", desc:"Return to your homeland.", status:"available", progress:0 };
  if (!map["q_find_dreadheim_wizard"])
    map["q_find_dreadheim_wizard"] = { id:"q_find_dreadheim_wizard", title:"Find the Dreadheim Wizard", desc:"They say he waits in a lamplit hall.", status:"locked", progress:0 };
  if (!map["q_find_dreadheim_witch"])
    map["q_find_dreadheim_witch"] = { id:"q_find_dreadheim_witch", title:"Find the Witch", desc:"Seek Skarthra the Pale in the Outskirts.", status:"locked", progress:0 };

  const qMain   = map["q_main_pick_race"];
  const qTravel = map["q_travel_home"];
  const qWiz    = map["q_find_dreadheim_wizard"];
  const qWitch  = map["q_find_dreadheim_witch"];

  const race = (v.race || localStorage.getItem(RACE_KEY) || "").toLowerCase();

  // 1) Choosing a race completes main
  if (race && qMain.status !== "completed") {
    qMain.status = "completed"; qMain.progress = 100;
  }

  // 2) Travel chain: if race picked but travel not done, prefer Travel as active
  if (race && qTravel.status !== "completed") {
    for (const q of Object.values(map)) if (q.status === "active") q.status = "available";
    qTravel.status = "active";
  }

  // 3) Wizard unlocks only after travel completed (for dreadheim path)
  if (race === "dreadheim" && (v.travelCompleted || qTravel.status === "completed")) {
    if (qWiz.status === "locked") qWiz.status = "available";
  } else {
    if (qWiz.status !== "completed" && qWiz.status !== "locked") {
      qWiz.status = "locked"; qWiz.progress = 0;
    }
  }

  // 4) Witch unlocks after wizard parchment is signed / wizard completed
  if (v.wizardParchmentSigned || qWiz.status === "completed") {
    if (qWitch.status === "locked") qWitch.status = "available";
  }

  // First write intermediate state, then sanitize + auto-pick fallback
  qWrite(Object.values(map));
  sanitizeQuestOrder();

  // Re-read after sanitize to compute a safe fallback active
  const list2 = qRead();
  const map2: Record<string, Quest> = Object.fromEntries(list2.map(q => [q.id, q]));
  ensureSingleActiveAndAutoPick(map2, v);
  qWrite(Object.values(map2));
}

/* =========================================================
   BASIC QUEST HELPERS (with guards)
   ========================================================= */
function qSetActive(id: string) {
  const list = qRead();
  let changed = false;
  for (const q of list) {
    if (q.id === id) {
      if (q.status !== "active") { q.status = "active"; changed = true; }
    } else if (q.status === "active") {
      q.status = "available"; changed = true;
    }
  }
  if (changed) {
    qWrite(list);
    sanitizeQuestOrder();
    qWrite(qRead());
  }
}
function qComplete(id: string) {
  const list = qRead();
  let did = false;
  for (const q of list) if (q.id === id) { q.status = "completed"; q.progress = 100; did = true; }
  if (!did) return;
  qWrite(list);

  sanitizeQuestOrder();

  const nextId = getNextQuestId(id);
  if (nextId) {
    const qs = qRead();
    const nq = qs.find(q => q.id === nextId);
    if (nq) {
      if (nq.status === "locked") nq.status = "available";
      qWrite(qs);
      sanitizeQuestOrder();
    }
  }
}
function qActive(): Quest | null {
  const list = qRead();
  return list.find(q => q.status === "active") || null;
}
function qStartNext(prevId: string, next: Quest) {
  const list = qRead();
  for (const q of list) if (q.id === prevId) { q.status = "completed"; q.progress = 100; }
  for (const q of list) if (q.status === "active") q.status = "available";
  const i = list.findIndex(q => q.id === next.id);
  if (i >= 0) list[i] = { ...list[i], ...next, status:"active", progress: next.progress ?? 0 };
  else list.push({ ...next, status:"active", progress: next.progress ?? 0 });
  qWrite(list);
  sanitizeQuestOrder();
  qWrite(qRead());
}

/* === Progress helpers for game.ts === */
function qProgressSet(id: string, value: number) {
  const v = Math.max(0, Math.min(100, Math.floor(value)));
  const list = qRead();
  let changed = false;
  for (const q of list) if (q.id === id) { if ((q.progress||0) !== v) { q.progress = v; changed = true; } }
  if (changed) { qWrite(list); window.dispatchEvent(new CustomEvent("va-quest-updated")); }
}
function qProgressAdd(id: string, delta: number) {
  const list = qRead();
  let changed = false;
  for (const q of list) if (q.id === id) { const n = Math.max(0, Math.min(100, Math.floor((q.progress||0)+delta))); if (n !== q.progress) { q.progress = n; changed = true; } }
  if (changed) { qWrite(list); window.dispatchEvent(new CustomEvent("va-quest-updated")); }
}

/* =========================================================
   CATALOG LOADER (expects /guildbook/catalogquests.json)
   ========================================================= */
type CatalogAction =
  | { type: "setVars"; set: Record<string, any> }
  | { type: "completeQuest"; nextId?: string };

type CatalogNode = {
  id: string;
  speaker?: string;
  text?: string;
  choices?: { text: string; next?: string }[];
  next?: string;
  action?: CatalogAction;
};

type CatalogQuest = {
  id: string;
  title: string;
  desc: string;
  rewards?: {
    gold?: number;
    brisingr?: number;
    items?: { id: string; name: string; image: string; qty?: number }[];
  };
  dialogue?: CatalogNode[];
};

type Catalog = { quests: CatalogQuest[] };

let CATALOG: Catalog | null = null;

async function loadCatalog(): Promise<Catalog> {
  if (CATALOG) return CATALOG;
  const res = await fetch("/guildbook/catalogquests.json", { cache: "no-cache" });
  const json = (await res.json()) as Catalog;
  CATALOG = json;
  return json;
}
function getQuestFromCatalog(id: string): CatalogQuest | null {
  if (!CATALOG) return null;
  return CATALOG.quests.find(q => q.id === id) || null;
}
(window as any).getQuestFromCatalog = getQuestFromCatalog;

/* =========================================================
   DIALOGUE UI + ACTIONS (uses catalog)
   ========================================================= */
(function setupCatalogueDialogue() {
  const DIALOG_ID = "vaDialogue";

  function ensureDom(): HTMLElement {
    let el = document.getElementById(DIALOG_ID) as HTMLElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = DIALOG_ID;
      el.style.cssText = `
        position:fixed; inset:0; z-index:100000; display:none;
        align-items:center; justify-content:center;
        background:rgba(0,0,0,.6); backdrop-filter: blur(2px);
      `;
      el.innerHTML = `
        <div id="vaDialogueCard" style="
          width:min(720px, calc(100vw - 32px)); max-height:min(80vh, 640px);
          background:#0f1318; color:#e7d7ab; border:1px solid rgba(212,169,77,.35);
          border-radius:16px; box-shadow:0 30px 60px rgba(0,0,0,.55); overflow:hidden;
          display:grid; grid-template-rows:auto 1fr auto;
        ">
          <div id="vaDialogueHeader" style="padding:12px 14px; font-weight:900; border-bottom:1px solid rgba(212,169,77,.25)">Dialogue</div>
          <div id="vaDialogueBody" style="padding:12px 14px; overflow:auto; line-height:1.45"></div>
          <div id="vaDialogueChoices" style="padding:10px 12px; display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid rgba(212,169,77,.25)"></div>
        </div>
      `;
      document.body.appendChild(el);
    }
    return el!;
  }

  function setHeader(title?: string) {
    const h = document.getElementById("vaDialogueHeader");
    if (h) h.textContent = title || "Dialogue";
  }
  function setLines(text?: string) {
    const body = document.getElementById("vaDialogueBody");
    if (!body) return;
    const lines = (text || "").split("\n").filter(Boolean);
    body.innerHTML = lines.map(l => `<p style="margin:.4em 0">${l}</p>`).join("");
    (body as HTMLElement).scrollTop = 0;
  }
  function setChoices(choices: {text:string; next?:string}[] | undefined, nextLoader: (id?: string)=>void, onClose: ()=>void) {
    const bar = document.getElementById("vaDialogueChoices") as HTMLElement | null;
    if (!bar) return;
    bar.innerHTML = "";
    const mk = (label: string, click: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `
        padding:8px 12px;border-radius:10px;border:1px solid rgba(212,169,77,.35);
        background:#12161a;color:#e7d7ab;cursor:pointer;
      `;
      b.onclick = click;
      bar.appendChild(b);
    };

    if (!choices || choices.length === 0) {
      mk("Continue", () => { onClose(); close(); });
      return;
    }
    for (const ch of choices) mk(ch.text, () => nextLoader(ch.next));
  }

  function open() {
    ensureDom();
    const el = document.getElementById(DIALOG_ID) as HTMLElement;
    el.style.display = "flex";
  }
  function close() {
    const el = document.getElementById(DIALOG_ID) as HTMLElement | null;
    if (el) el.style.display = "none";
  }

  /** Parchment signature overlay (calls cb after finish) */
  function showParchmentSignature(cb?: () => void) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.75);
      display:flex; align-items:center; justify-content:center; z-index:100001;
    `;
    overlay.innerHTML = `
      <div style="position:relative">
        <img src="/guildbook/loot/unsheathedscroll.png"
             style="max-width:90vw; max-height:90vh; object-fit:contain; border-radius:8px;"
             alt="Parchment">
        <button id="sigBtn" style="
          position:absolute; left:50%; bottom:18px; transform:translateX(-50%);
          border:1px solid rgba(212,169,77,.5); background:#12161a; color:#e7d7ab;
          font:600 14px ui-sans-serif,system-ui; padding:8px 12px; border-radius:10px; cursor:pointer;
        ">Sign</button>
        <button id="xBtn" style="
          position:absolute; top:10px; right:10px;
          border:none; background:rgba(0,0,0,.6); color:#fff;
          font:18px; padding:6px 10px; border-radius:8px; cursor:pointer;
        ">×</button>
      </div>
    `;
    const finish = () => { overlay.remove(); cb?.(); };
    overlay.querySelector<HTMLButtonElement>("#sigBtn")!.onclick = finish;
    overlay.querySelector<HTMLButtonElement>("#xBtn")!.onclick   = finish;
    document.body.appendChild(overlay);

    // flag var for rules
    const v = readVars();
    v.wizardParchmentSigned = true;
    writeVars(v);
    applyRulesOnce();
    qHudRender();
    __vaq_renderBoxes();
  }
  (window as any).showParchmentSignature = showParchmentSignature;

  function grantRewards(r?: CatalogQuest["rewards"]) {
    if (!r) return;
    try {
      if (r.items && r.items.length) {
        for (const it of r.items) {
          (window as any).Inventory?.add?.(it.id, it.name, it.image, it.qty ?? 1);
        }
      }
      // gold/brisingr hooks can be added if your backend/game.ts supports them
    } catch {}
  }

  function applyAction(a?: CatalogAction, parentQuest?: CatalogQuest) {
    if (!a) return;

    if (a.type === "setVars") {
      const v = readVars();
      Object.assign(v, a.set || {});
      writeVars(v);
      applyRulesOnce();
      qHudRender();
      __vaq_renderBoxes();
      return;
    }

    if (a.type === "completeQuest") {
      const cur = (window as any).VAQ?.active?.();
      const proceed = () => {
        if (cur) (window as any).VAQ?.complete?.(cur.id);
        // Unlock/advance via rules
        applyRulesOnce();

        // Rewards from the parent quest (if any)
        try { grantRewards(parentQuest?.rewards); } catch {}

        if (a.nextId) (window as any).VAQ?.setActive?.(a.nextId);
        (window as any).VAQ?.renderHUD?.();
        window.dispatchEvent(new CustomEvent("va-quest-updated"));
      };

      if (cur?.id === "q_find_dreadheim_wizard") {
        showParchmentSignature(proceed);
      } else {
        proceed();
      }
    }
  }

  function runCatalogDialogue(q: CatalogQuest, after?: () => void) {
    const nodes: Record<string, CatalogNode> =
      Object.fromEntries((q.dialogue || []).map(n => [n.id, n]));

    function show(id?: string) {
      if (!id) { after?.(); close(); return; }
      const node = nodes[id];
      if (!node) { after?.(); close(); return; }

      open();
      setHeader(node.speaker || q.title);
      setLines(node.text);

      const onClose = () => {
        try { applyAction(node.action, q); } catch {}
        if (node.next && (!node.choices || node.choices.length === 0)) {
          show(node.next);
        } else if (!node.choices || node.choices.length === 0) {
          after?.(); close();
        }
      };
      setChoices(node.choices, show, onClose);
    }

    const startNodeId = q.dialogue?.find(n => n.id === "start")?.id || q.dialogue?.[0]?.id || "start";
    show(startNodeId);
  }

  (window as any).runCatalogDialogue = runCatalogDialogue;
  (window as any).VADialogue = { openNode: (_id:string)=>{}, close };
})();

/* =========================================================
   HUD (bottom-left)
   ========================================================= */
let hud: HTMLDivElement | null = null;
function qHudEnsure() {
  if (hud) return;
  hud = document.createElement("div");
  hud.id = "vaQuestHUD";
  hud.style.cssText = `
    position:fixed; left:16px; bottom:16px; z-index:99998;
    max-width:360px; padding:10px 12px; border-radius:12px;
    background:rgba(0,0,0,.55); color:#fff;
    border:1px solid rgba(255,255,255,.15); backdrop-filter: blur(4px);
    font:13px/1.35 ui-sans-serif,system-ui; box-shadow:0 8px 24px rgba(0,0,0,.35);
    pointer-events:none;
  `;
  document.body.appendChild(hud);
}
function qHudRender() {
  qHudEnsure();
  const q = qActive();
  if (!hud) return;
  if (!q) { hud.style.display = "none"; return; }
  hud.style.display = "block";
  hud.innerHTML = `
    <div style="opacity:.85; font-weight:700; margin-bottom:2px;">Active Quest</div>
    <div style="font-weight:700;">${q.title}</div>
    <div style="opacity:.9;">${q.desc}</div>
    <div style="opacity:.6; font-size:12px; margin-top:4px;">Tip: Press <b>E</b> when prompted</div>
  `;
}

/* =========================================================
   ACTIVE QUEST WIDGETS (auto-bind)
   ========================================================= */
function __vaq_findBoxes(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ".vaq-box, #activeQuest, #activeQuestBox, #arenaQuest, #arenaActiveQuest"
    )
  );
}
let __renderingBoxes = false;
function __vaq_renderBoxes() {
  if (__renderingBoxes) return;
  __renderingBoxes = true;
  requestAnimationFrame(() => { __renderingBoxes = false; });

  const boxes = __vaq_findBoxes();
  if (!boxes.length) return;

  const active = (window as any).VAQ?.active?.() || null;
  for (const box of boxes) {
    const title = box.querySelector<HTMLElement>(".vaq-title,#aqTitle,.aq-title");
    const desc  = box.querySelector<HTMLElement>(".vaq-desc,#aqDesc,.aq-desc");
    const stat  = box.querySelector<HTMLElement>(".vaq-status,#aqStatus,.aq-status");
    const pv    = box.querySelector<HTMLElement>(".vaq-progress-val,#aqProgVal,.aq-progress-val");
    const pb    = box.querySelector<HTMLElement>(".vaq-progress-bar,#aqProgBar,.aq-progress-bar");
    const travel= box.querySelector<HTMLAnchorElement>(".vaq-travel,#aqTravel,.aq-travel");

    if (!active) { box.setAttribute("hidden","true"); continue; }
    box.removeAttribute("hidden");

    if (title) title.textContent = active.title || "—";
    if (desc)  desc.textContent  = active.desc  || "—";
    if (stat)  stat.textContent  = `Status: ${active.status[0].toUpperCase()}${active.status.slice(1)}`;

    const prog = Math.max(0, Math.min(100, Number(active.progress || 0)));
    if (pv) pv.textContent = String(prog);
    if (pb) (pb as HTMLElement).style.width = prog + "%";

    if (travel) {
      const showTravel = active.id === "q_travel_home" && active.status !== "completed";
      travel.style.display = showTravel ? "inline-block" : "none";
      if (showTravel) {
        const race = (localStorage.getItem(RACE_KEY) || readVars().race || "").toLowerCase();
        const dest =
          race === "myriador" ? "/myriadormap.html" :
          race === "wildwood" ? "/wildwoodmap.html" :
                                 "/dreadheimmap.html";
        travel.href = dest;
        travel.onclick = (ev) => {
          ev.preventDefault();
          try { localStorage.setItem("va_pending_travel","1"); } catch {}
          location.assign(dest);
        };
      }
    }
  }
}
window.addEventListener("va-quest-updated", __vaq_renderBoxes);
document.addEventListener("visibilitychange", () => { if (!document.hidden) __vaq_renderBoxes(); });
window.addEventListener("pageshow", __vaq_renderBoxes);
window.addEventListener("storage", (e) => {
  if (e.key === VAQ_KEY || e.key === RACE_KEY || e.key === VARS_KEY) __vaq_renderBoxes();
});
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __vaq_renderBoxes, { once: true });
} else {
  __vaq_renderBoxes();
}

/* =========================================================
   TRAVEL HANDOFF (on arrival page)
   ========================================================= */
(() => {
  try {
    const pending = localStorage.getItem("va_pending_travel") === "1";
    if (!pending) return;
    localStorage.removeItem("va_pending_travel");

    (window as any).VAQ?.ensureQuestState?.();
    (window as any).VAQ?.complete?.("q_travel_home");

    // also set var for rules
    const v = readVars(); v.travelCompleted = true; writeVars(v);

    const race = (localStorage.getItem(RACE_KEY) || v.race || "").toLowerCase();
    if (race === "dreadheim") (window as any).VAQ?.setActive?.("q_find_dreadheim_wizard");

    applyRulesOnce();
    (window as any).VAQ?.renderHUD?.();
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
  } catch {}
})();

/* =========================================================
   SFX
   ========================================================= */
const __vaSFX = {
  femaleHurt: new Audio("/guildbook/sfx/femalehurt.mp3"),
  maleHurt:   new Audio("/guildbook/sfx/malehurt.mp3"),
};
__vaSFX.femaleHurt.preload = "auto";
__vaSFX.maleHurt.preload   = "auto";
function __playFemaleHurt(): void { const a = __vaSFX.femaleHurt; a.currentTime = 0; a.volume = 0.9; a.play().catch(()=>{}); }
function __playMaleHurt(): void   { const a = __vaSFX.maleHurt;   a.currentTime = 0; a.volume = 0.9; a.play().catch(()=>{}); }
function __playHeroHurt(): void   { const g = localStorage.getItem("va_gender"); g === "female" ? __playFemaleHurt() : __playMaleHurt(); }
(window as any).playFemaleHurt = __playFemaleHurt;
(window as any).playMaleHurt   = __playMaleHurt;
(window as any).playHeroHurt   = __playHeroHurt;

const __vaBattleSFX = {
  victory: new Audio("/guildbook/sfx/battlevictory.mp3"),
  fail:    new Audio("/guildbook/sfx/fightfail.mp3"),
};
__vaBattleSFX.victory.preload = "auto";
__vaBattleSFX.fail.preload    = "auto";
function __playVictory(): void { const a = __vaBattleSFX.victory; a.currentTime = 0; a.volume = 0.9; a.play().catch(()=>{}); }
function __playDefeat(): void  { const a = __vaBattleSFX.fail;    a.currentTime = 0; a.volume = 0.9; a.play().catch(()=>{}); }
(window as any).playVictory = __playVictory;
(window as any).playDefeat  = __playDefeat;

/* =========================================================
   GENDER-AWARE SKILL ICONS
   ========================================================= */
function currentSkillIconMap() {
  const g = localStorage.getItem("va_gender") || "male";
  const maleIcons: Record<string, string> = {
    basic:  "/guildbook/skillicons/drengrstrike.png",
    aoe:    "/guildbook/skillicons/whirlwinddance.png",
    buff:   "/guildbook/skillicons/odinsblessing.png",
    debuff: "/guildbook/skillicons/helsgrasp.png",
  };
  const femaleIcons: Record<string, string> = {
    basic:  "/guildbook/skillicons/valkyrieslash.png",
    aoe:    "/guildbook/skillicons/ragnarokshowl.png",
    buff:   "/guildbook/skillicons/aegisoffreyja.png",
    debuff: "/guildbook/skillicons/cursebreaker.png",
  };
  return g === "female" ? femaleIcons : maleIcons;
}
(window as any).getSkillIcon = function (key: string): string {
  const map = currentSkillIconMap();
  return map[key] || "";
};
function ensureSkillIconsOnPage() {
  const skillEls = Array.from(document.querySelectorAll<HTMLDivElement>("#skillbar .skill"));
  if (!skillEls.length) return;
  const map = currentSkillIconMap();

  skillEls.forEach(div => {
    const key = (div.dataset.skill || "").toLowerCase();
    if (!key) return;

    let img = div.querySelector<HTMLImageElement>("img.icon");
    const want = map[key] || "";

    if (!img) {
      img = document.createElement("img");
      img.className = "icon";
      img.alt = key;
      img.loading = "lazy";
      img.onerror = () => (img!.style.display = "none");
      const label = div.querySelector(":scope > .name");
      if (label) div.insertBefore(img, label);
      else div.prepend(img);
    }

    if (img.src !== want && !img.src.endsWith(want)) {
      img.style.display = "";
      img.src = want;
    }
  });
}
// Run icon ensure on load + whenever skillbar appears
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureSkillIconsOnPage, { once: true });
} else {
  ensureSkillIconsOnPage();
}
new MutationObserver(() => ensureSkillIconsOnPage())
  .observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("va-gender-changed", (ev: any) => {
  const g = (ev?.detail as string) || localStorage.getItem("va_gender") || "male";
  document.body?.setAttribute("data-gender", g);
  ensureSkillIconsOnPage();
});

/* =========================================================
   INVENTORY + BAG + BADGE
   ========================================================= */
try { Inventory.init(); } catch {}

/* Poll inventory → set wizardParchmentSigned when scroll is present */
function scanInventoryForQuestVars() {
  try {
    const items = (window as any).Inventory?.get?.() || [];
    const hasScroll = items.some((it: any) => it?.id === "wizardscroll" && (it.qty ?? 0) > 0);
    const v = readVars();
    if (hasScroll && !v.wizardParchmentSigned) {
      v.wizardParchmentSigned = true;
      writeVars(v);
      applyRulesOnce();
      qHudRender();
      __vaq_renderBoxes();
      window.dispatchEvent(new CustomEvent("va-quest-updated"));
    }
  } catch {}
}

(window as any).__va_onItemClick = function (itemId: string) {
  if (itemId === "wizardscroll") {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,.7);
      display:flex; align-items:center; justify-content:center; z-index: 999999;
    `;
    overlay.innerHTML = `
      <div style="position:relative">
        <img src="/guildbook/loot/unsheathedscroll.png"
             style="max-width:90vw; max-height:90vh; object-fit:contain; border-radius:8px;"
             alt="Quest Scroll">
        <button id="closeScroll" style="
          position:absolute; top:10px; right:10px;
          border:none; background:rgba(0,0,0,.6);
          color:#fff; font:18px; padding:6px 10px; border-radius:8px;
          cursor:pointer;
        ">×</button>
      </div>
    `;
    overlay.querySelector("#closeScroll")!.addEventListener("click", () => overlay.remove());
    document.body.appendChild(overlay);
  }
};

(function injectBagStyles() {
  if (document.getElementById("vaGlobalStyle")) return;
  const css = `
  #vaBagBtn {
    position: fixed; right: 16px; top: 16px; z-index: 100000;
    width: 56px; height: 56px; border-radius: 14px;
    display: grid; place-items: center;
    border: 1px solid rgba(200,169,107,.35);
    background: linear-gradient(180deg, #171a1f, #0e1013);
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    cursor: pointer;
  }
  #vaBagBtn img { width: 34px; height: 34px; object-fit: contain; }
  #vaBagBadge {
    position: absolute; right: -6px; top: -6px;
    min-width: 20px; height: 20px; border-radius: 999px;
    padding: 0 6px;
    background: #b02a2a; color: #fff; font: 12px/20px ui-sans-serif,system-ui;
    text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,.35); display: none;
  }`;
  const s = document.createElement("style");
  s.id = "vaGlobalStyle";
  s.textContent = css;
  document.head.appendChild(s);
})();

function ensureBagButton() {
  if (document.getElementById("vaBagBtn")) return;
  const btn = document.createElement("button");
  btn.id = "vaBagBtn";
  btn.title = "Inventory";
  btn.setAttribute("tabindex", "-1");
  btn.setAttribute("aria-hidden", "true");
  btn.innerHTML = `
    <img src="/guildbook/ui/inventorybag.png" alt="Bag" onerror="this.style.display='none'">
    <span id="vaBagBadge"></span>
  `;
  document.body.appendChild(btn);
  btn.addEventListener("keydown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    try { (window as any).__va_openBagFromClick?.(); } catch {}
    clearUnseenBadge();
  });
}
ensureBagButton();

const UID_KEY = "mh_user";
function currentUserId(): string {
  try {
    const raw = localStorage.getItem(UID_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return obj?.id || obj?._id || obj?.user?.id || "guest";
    }
  } catch {}
  return "guest";
}
function unseenKey() { return `va_bag_unseen__${currentUserId()}`; }
function getUnseen(): number {
  return Math.max(0, parseInt(localStorage.getItem(unseenKey()) || "0", 10) || 0);
}
function setUnseen(n: number) {
  const v = Math.max(0, Math.floor(n));
  localStorage.setItem(unseenKey(), String(v));
  renderBadge();
}
function renderBadge() {
  const badge = document.getElementById("vaBagBadge") as HTMLElement | null;
  if (!badge) return;
  const n = getUnseen();
  if (n > 0) { badge.textContent = String(n); badge.style.display = "inline-block"; }
  else { badge.textContent = ""; badge.style.display = "none"; }
}
function clearUnseenBadge() { setUnseen(0); }
window.addEventListener("pageshow", renderBadge);
window.addEventListener("focus", renderBadge);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderBadge(); });

/* Open/close only via mouse click; add unseen counter */
(() => {
  const invAny = Inventory as any;
  let isOpen = false;

  let __bagGate = false;
  (window as any).__va_openBagFromClick = () => {
    __bagGate = true;
    try {
      if (typeof invAny?.toggle === "function") invAny.toggle();
      else if (typeof invAny?.open === "function") invAny.open();
    } finally {
      __bagGate = false;
    }
  };

  const wrap = (name: string, handler: (orig: Function, ...args: any[]) => any) => {
    if (typeof invAny?.[name] !== "function") return;
    const orig = invAny[name].bind(Inventory);
    invAny[name] = (...args: any[]) => handler(orig, ...args);
  };

  wrap("open", (orig, ...args) => { if (!__bagGate) return; const r = orig(...args); isOpen = true;  afterInventoryOpen(); return r; });
  wrap("show", (orig, ...args) => { if (!__bagGate) return; const r = orig(...args); isOpen = true;  afterInventoryOpen(); return r; });
  wrap("toggle",(orig,...args)=>{ if (!__bagGate) return; const r = orig(...args); isOpen=!isOpen; if(isOpen) afterInventoryOpen(); else clearUnseenBadge(); return r; });
  wrap("close", (orig, ...args) => { const r = orig(...args); isOpen = false; return r; });

  if (typeof invAny?.add === "function") {
    const origAdd = invAny.add.bind(Inventory);
    invAny.add = (...args: any[]) => { const r = origAdd(...args); if (!isOpen) setUnseen(getUnseen() + 1); return r; };
  }

  const bagBtn = document.querySelector<HTMLElement>("#vaBagBtn, .bag, .inventory-button");
  if (bagBtn) bagBtn.addEventListener("click", () => setTimeout(afterInventoryOpen, 0));
})();

function fixQtyLayers() {
  document
    .querySelectorAll(
      ".inv-name .inv-qty, .va-name .inv-qty, .inv-name .stack, .va-name .stack, .inv-name .va-qty, .va-name .va-qty, .va-stack, .item-qty"
    )
    .forEach((el) => {
      const bubble = el as HTMLElement;
      const cell = bubble.closest(".inv-cell, .va-item") as HTMLElement | null;
      if (cell) cell.appendChild(bubble);
    });

  document.querySelectorAll(".inv-qty, .va-qty, .item-qty, .va-stack, .stack").forEach((el) => {
    const b = el as HTMLElement;
    b.classList.add("inv-qty");
    Object.assign(b.style, {
      position: "absolute",
      top: "6px",
      right: "6px",
      left: "auto",
      bottom: "auto",
      zIndex: "999",
    } as CSSStyleDeclaration);
  });
}
function disableInventoryKeyboard() {
  const root =
    (document.querySelector("#inventory, .inventory, .inventory-panel, #bag, .bag-panel") as HTMLElement | null)
    || null;
  if (!root) return;

  const focusables = root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  focusables.forEach((el) => {
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-disabled", "true");
  });

  if (root.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur?.();
  }
}
function afterInventoryOpen() {
  setTimeout(() => {
    fixQtyLayers();
    disableInventoryKeyboard();

    const root =
      document.querySelector("#inventory, .inventory, .inventory-panel, #bag, .bag-panel") || document.body;
    try {
      const mo = new MutationObserver(() => {
        fixQtyLayers();
        disableInventoryKeyboard();
      });
      mo.observe(root as Node, { childList: true, subtree: true });
    } catch {}
  }, 0);

  clearUnseenBadge();
}

/* Arrow keys suppressed only inside inventory UI */
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const inInventory = !!target?.closest("#inventory, .inventory, .inventory-panel, #bag, .bag-panel");
  if (inInventory && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.stopPropagation(); e.preventDefault();
  }
});

/* Small tweaks: bag button position + battle log spacing */
(() => { const s = document.createElement("style"); s.textContent = `#vaBagBtn{ top:auto !important; bottom:16px !important; }`; document.head.appendChild(s); })();
(() => { const s = document.createElement("style"); s.textContent = `#log { bottom: 150px !important; }`; document.head.appendChild(s); })();

/* =========================================================
   PUBLIC BRIDGE + INIT ORDER
   ========================================================= */
(window as any).VAQ = {
  ensureQuestState: () => { applyRulesOnce(); },
  readQuests: qRead,
  writeQuests: qWrite,
  setActive: qSetActive,
  complete: qComplete,
  active: qActive,
  startNext: qStartNext,
  sanitizeQuestOrder,       // external pages may call after events
  getNextQuestId,           // helper
  list: () => qRead(),
  get: (id: string) => qRead().find(q => q.id === id) || null,
  progressSet: qProgressSet,
  progressAdd: qProgressAdd,
};

// Game.ts quick bridge (zero-import convenience)
(window as any).getActiveQuest = () => qActive();
(window as any).getActiveQuestId = () => qActive()?.id || null;
(window as any).isActiveQuest = (id: string) => (qActive()?.id === id);

// Boot: apply rules → sanitize → HUD → widgets → preload catalog
applyRulesOnce();
sanitizeQuestOrder();
qHudRender();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __vaq_renderBoxes, { once: true });
} else {
  __vaq_renderBoxes();
}
loadCatalog().catch(()=>{});

/* Gentle quest tick (inventory → vars → rules → HUD) */
setInterval(() => {
  scanInventoryForQuestVars();   // sets wizardParchmentSigned if scroll exists
  applyRulesOnce();              // updates quest states
  sanitizeQuestOrder();          // enforce order
  qHudRender();                  // refresh HUD
  __vaq_renderBoxes();           // refresh widgets (including game HUD)
}, 1500);






















