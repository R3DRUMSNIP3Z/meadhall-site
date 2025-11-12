// /src/global-game-setup.ts
// Runs on every game page that includes it

import { Inventory } from "./inventory";
(window as any).Inventory = Inventory;

/* =========================================================
   GENDER + GLOBAL SPRITES
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
   QUEST STORAGE (localStorage) + SAFE WRITE
   ========================================================= */
const VAQ_KEY = "va_quests";
const RACE_KEY = "va_race";

type QStatus = "available" | "active" | "completed" | "locked";
type Quest = { id: string; title: string; desc: string; status: QStatus; progress?: number };

function qRead(): Quest[] {
  try { return JSON.parse(localStorage.getItem(VAQ_KEY) || "[]"); }
  catch { return []; }
}

// Guard re-entrancy + debounce the event to avoid recursion
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
   CATALOG (dialogue + rules) — /guildbook/catalogquests.json
   ========================================================= */
type CatalogAction =
  | { type: "setVars"; set: Record<string, any> }
  | { type: "completeQuest"; nextId?: string };

type CatalogNode = {
  id: string;
  speaker?: string;
  text?: string;
  // choices win over next; if no choices and a "next" exists, auto-advance with Continue
  choices?: { text: string; next?: string }[];
  next?: string;
  action?: CatalogAction;
};

type CatalogQuest = {
  id: string;
  title: string;
  desc: string;
  dialogue?: CatalogNode[];
  rewards?: any; // future: gold, brisingr, items, etc
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

/* =========================================================
   QUEST ENSURE + BASIC GRAPH (Main → Travel → Wizard → Witch)
   ========================================================= */
function qEnsure() {
  const list = qRead();
  const map: Record<string, Quest> = Object.fromEntries(list.map(q => [q.id, q]));
  const race = (localStorage.getItem(RACE_KEY) || "").toLowerCase();

  // seed
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

  // race selection completes main
  if (race && qMain.status !== "completed") { qMain.status = "completed"; qMain.progress = 100; }

  // wizard unlocked only after travel completed for dreadheim
  if (race === "dreadheim" && qTravel.status === "completed" && qWiz.status === "locked") {
    qWiz.status = "available";
  }

  // witch becomes available after wizard completed
  if (qWiz.status === "completed" && qWitch.status === "locked") {
    qWitch.status = "available";
  }

  // if race chosen but travel not completed, auto-activate travel
  if (race && qTravel.status !== "completed") {
    for (const q of Object.values(map)) if (q.status === "active") q.status = "available";
    qTravel.status = "active";
  }

  qWrite(Object.values(map));
}

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
  if (changed) qWrite(list);
}

function qComplete(id: string) {
  const list = qRead();
  for (const q of list) if (q.id === id) { q.status = "completed"; q.progress = 100; }
  qWrite(list);
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
}

/* =========================================================
   HUD (bottom-left) — tiny overlay
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
   ACTIVE QUEST WIDGETS (auto-bind on any page)
   ========================================================= */
function __vaq_findBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".vaq-box, #activeQuest, #activeQuestBox"));
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
    const title = box.querySelector<HTMLElement>(".vaq-title,#aqTitle");
    const desc  = box.querySelector<HTMLElement>(".vaq-desc,#aqDesc");
    const stat  = box.querySelector<HTMLElement>(".vaq-status,#aqStatus");
    const pv    = box.querySelector<HTMLElement>(".vaq-progress-val,#aqProgVal");
    const pb    = box.querySelector<HTMLElement>(".vaq-progress-bar,#aqProgBar");
    const travel= box.querySelector<HTMLAnchorElement>(".vaq-travel,#aqTravel");

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
        const race = (localStorage.getItem("va_race") || "").toLowerCase();
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
  if (e.key === VAQ_KEY || e.key === RACE_KEY) __vaq_renderBoxes();
});

/* =========================================================
   SIMPLE DIALOGUE UI (for catalog nodes)
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

  function applyAction(a?: CatalogAction) {
    if (!a) return;
    if (a.type === "setVars") {
      const vars = JSON.parse(localStorage.getItem("va_vars") || "{}");
      Object.assign(vars, a.set || {});
      localStorage.setItem("va_vars", JSON.stringify(vars));
      (window as any).VAQ?.renderHUD?.();
      return;
    }
    if (a.type === "completeQuest") {
      const cur = (window as any).VAQ?.active?.();
      if (cur) (window as any).VAQ?.complete?.(cur.id);
      if (a.nextId) (window as any).VAQ?.setActive?.(a.nextId);
      (window as any).VAQ?.renderHUD?.();
      window.dispatchEvent(new CustomEvent("va-quest-updated"));
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
        try { applyAction(node.action); } catch {}
        if (node.next && (!node.choices || node.choices.length === 0)) {
          show(node.next);
        } else if (!node.choices || node.choices.length === 0) {
          after?.(); close();
        }
      };
      setChoices(node.choices, show, onClose);
    }

    // Default entry is "start" else first node
    const startNodeId = (q.dialogue && q.dialogue[0]?.id) || "start";
    show(startNodeId);
  }

  (window as any).runCatalogDialogue = runCatalogDialogue;
  (window as any).VADialogue = { openNode: (_id:string)=>{}, close };
})();

/* =========================================================
   TRAVEL HANDOFF: complete travel, activate wizard once
   ========================================================= */
(() => {
  try {
    const pending = localStorage.getItem("va_pending_travel") === "1";
    if (!pending) return;
    localStorage.removeItem("va_pending_travel");

    (window as any).VAQ?.ensureQuestState?.();
    (window as any).VAQ?.complete?.("q_travel_home");

    const race = (localStorage.getItem("va_race") || "").toLowerCase();
    if (race === "dreadheim") (window as any).VAQ?.setActive?.("q_find_dreadheim_wizard");

    (window as any).VAQ?.renderHUD?.();
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
  } catch {}
})();

/* =========================================================
   GLOBAL SFX — hurt + battle
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
window.addEventListener("va-gender-changed", (ev: any) => {
  const g = (ev?.detail as string) || localStorage.getItem("va_gender") || "male";
  document.body?.setAttribute("data-gender", g);
  ensureSkillIconsOnPage();
});

/* =========================================================
   INVENTORY INIT + ITEM CLICK HOOKS
   ========================================================= */
try { Inventory.init(); } catch {}
(window as any).__va_onItemClick = function (itemId: string) {
  if (itemId === "wizardscroll") showQuestScrollOverlay();
};

function showQuestScrollOverlay() {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,.7);
    display:flex; align-items:center; justify-content:center; z-index:999999;
  `;
  overlay.innerHTML = `
    <div style="position:relative">
      <img src="/guildbook/loot/unsheathedscroll.png"
           style="max-width:90vw; max-height:90vh; object-fit:contain; border-radius:8px;"
           alt="Quest Scroll">
      <button id="closeScroll" style="
        position:absolute; top:10px; right:10px;
        border:none; background:rgba(0,0,0,.6); color:#fff; font:18px;
        padding:6px 10px; border-radius:8px; cursor:pointer;
      ">×</button>
    </div>
  `;
  overlay.querySelector("#closeScroll")!.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

/* =========================================================
   BAG BUTTON + BADGE, UNSEEN COUNTS PER-USER
   ========================================================= */
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

/* =========================================================
   INVENTORY MONKEY-PATCH — Only open via mouse click
   ========================================================= */
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

  wrap("open", (orig, ...args) => {
    if (!__bagGate) return;
    const r = orig(...args);
    isOpen = true;
    afterInventoryOpen();
    return r;
  });
  wrap("show", (orig, ...args) => {
    if (!__bagGate) return;
    const r = orig(...args);
    isOpen = true; afterInventoryOpen(); return r;
  });
  wrap("toggle", (orig, ...args) => {
    if (!__bagGate) return;
    const r = orig(...args);
    isOpen = !isOpen; if (isOpen) afterInventoryOpen(); else clearUnseenBadge(); return r;
  });
  wrap("close", (orig, ...args) => { const r = orig(...args); isOpen = false; return r; });

  if (typeof invAny?.add === "function") {
    const origAdd = invAny.add.bind(Inventory);
    invAny.add = (...args: any[]) => {
      const r = origAdd(...args);
      if (!isOpen) setUnseen(getUnseen() + 1);
      return r;
    };
  }

  const bagBtn = document.querySelector<HTMLElement>("#vaBagBtn, .bag, .inventory-button");
  if (bagBtn) bagBtn.addEventListener("click", () => setTimeout(afterInventoryOpen, 0));
})();

// Inventory UI polish
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

/* =========================================================
   ARROWS: suppress only inside inventory
   ========================================================= */
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const inInventory = !!target?.closest("#inventory, .inventory, .inventory-panel, #bag, .bag-panel");
  if (inInventory && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.stopPropagation(); e.preventDefault();
  }
});

/* =========================================================
   SMALL TWEAKS (bag position + battle log spacing)
   ========================================================= */
(() => { const s = document.createElement("style"); s.textContent = `#vaBagBtn{ top:auto !important; bottom:16px !important; }`; document.head.appendChild(s); })();
(() => { const s = document.createElement("style"); s.textContent = `#log { bottom: 150px !important; }`; document.head.appendChild(s); })();

/* =========================================================
   PUBLIC BRIDGE + INIT
   ========================================================= */
(window as any).VAQ = {
  ensureQuestState: qEnsure,
  readQuests: qRead,
  writeQuests: qWrite,
  setActive: qSetActive,
  complete: qComplete,
  active: qActive,
  startNext: qStartNext,
  renderHUD: qHudRender,
};

// Init order matters: ensure quests → render HUD → bind boxes → load catalog (lazy)
qEnsure();
qHudRender();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __vaq_renderBoxes, { once: true });
} else {
  __vaq_renderBoxes();
}
// preload catalog in background (non-blocking)
loadCatalog().catch(()=>{});


















