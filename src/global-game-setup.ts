// /src/global-game-setup.ts
// Runs on every game page that includes it

import { Inventory } from "./inventory";

// Make Inventory accessible to plain <script> pages
(window as any).Inventory = Inventory;

/* =========================================================
   GENDER + GLOBAL SPRITES
   ========================================================= */
if (!localStorage.getItem("va_gender")) {
  localStorage.setItem("va_gender", "male");
}
document.body?.setAttribute("data-gender", localStorage.getItem("va_gender") || "male");

// Universal hero sprite (used by arena/game.ts and maps if needed)
(window as any).getHeroSprite = function (): string {
  const g = localStorage.getItem("va_gender");
  return g === "female"
    ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
    : "/guildbook/avatars/dreadheim-warrior.png";
};

/* =========================================================
   CATALOG TYPES + LOADER
   ========================================================= */
type CatalogDialogueChoice = {
  text: string;
  /** id of next dialogue node within the same quest */
  next?: string;
};

type CatalogDialogueNode = {
  id: string;
  speaker?: string;
  text?: string;
  choices?: CatalogDialogueChoice[];
  /** inline step to execute when this node is shown */
  action?:
    | { type: "setVars"; set: Record<string, string | number | boolean> }
    | { type: "completeQuest" }
    | { type: "startNext"; nextId: string };
  /** convenience: go to this node after showing current */
  next?: string;
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
  dialogue?: CatalogDialogueNode[];
};

type Catalog = { quests: CatalogQuest[] };

let CATALOG: Catalog | null = null;

// NOTE: your file lives at: C:\Users\Lisa\meadhall-site\public\guildbook\catalogquests.json
async function loadCatalog(): Promise<Catalog> {
  if (CATALOG) return CATALOG;
  const res = await fetch("/guildbook/catalogquests.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Catalog fetch failed: " + res.status);
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
   Global Quest Helpers (HUD + storage)
   ========================================================= */
const VAQ_KEY = "va_quests";
const RACE_KEY = "va_race"; // used to gate wizard quest

type QStatus = "available" | "active" | "completed" | "locked";
type Quest = { id: string; title: string; desc: string; status: QStatus; progress?: number };

let __qWriteBusy = false; // re-entrancy guard
function qRead(): Quest[] {
  try { return JSON.parse(localStorage.getItem(VAQ_KEY) || "[]"); } catch { return []; }
}
function qWrite(list: Quest[]) {
  if (__qWriteBusy) {
    try { localStorage.setItem(VAQ_KEY, JSON.stringify(list)); } catch {}
    return;
  }
  __qWriteBusy = true;
  try {
    localStorage.setItem(VAQ_KEY, JSON.stringify(list));
  } catch {}
  __qWriteBusy = false;
  window.dispatchEvent(new CustomEvent("va-quest-updated"));
}

// Boot defaults + race/travel-gated wizard/witch quests
function qEnsure() {
  const list = qRead();
  const byId: Record<string, Quest> = Object.fromEntries(list.map(q => [q.id, q]));
  const race = (localStorage.getItem(RACE_KEY) || "").toLowerCase();

  if (!byId["q_main_pick_race"]) {
    list.push({
      id: "q_main_pick_race",
      title: "Choose Your Path",
      desc: "Pick your homeland.",
      status: "available",
      progress: 0,
    });
  }
  if (!byId["q_travel_home"]) {
    list.push({
      id: "q_travel_home",
      title: "Travel to Dreadheim",
      desc: "Return to your homeland.",
      status: "available",
      progress: 0,
    });
  }

  const map: Record<string, Quest> = Object.fromEntries(list.map(q => [q.id, q]));
  const qMain   = map["q_main_pick_race"];
  const qTravel = map["q_travel_home"];

  if (race && (qMain.status !== "completed" || (qMain.progress ?? 0) !== 100)) {
    qMain.status = "completed"; qMain.progress = 100;
  }

  // Ensure Wizard quest
  let qWiz = map["q_find_dreadheim_wizard"];
  if (!qWiz) {
    qWiz = {
      id: "q_find_dreadheim_wizard",
      title: "Find the Dreadheim Wizard",
      desc: "They say he waits in a lamplit hall.",
      status: "locked",
      progress: 0,
    };
    list.push(qWiz);
  }

  // Ensure Witch quest (Skarthra)
  let qWitch = map["q_find_dreadheim_witch"];
  if (!qWitch) {
    qWitch = {
      id: "q_find_dreadheim_witch",
      title: "Find the Witch",
      desc: "Seek Skarthra the Pale in the Outskirts.",
      status: "available",
      progress: 0,
    };
    list.push(qWitch);
  }

  const travelDone = qTravel.status === "completed";
  if (race === "dreadheim" && travelDone) {
    if (qWiz.status === "locked") qWiz.status = "available";
  } else {
    if (qWiz.status !== "completed" && qWiz.status !== "locked") {
      qWiz.status = "locked";
      qWiz.progress = 0;
    }
  }

  // If race chosen and travel not completed yet, auto-activate Travel
  if (race && !travelDone) {
    for (const q of list) if (q.status === "active") q.status = "available";
    qTravel.status = "active";
  }

  qWrite(list);
}

// Utilities
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
/** Start a "next" quest by object (commonly used after completing current) */
function qStartNext(prevId: string, next: Quest) {
  const list = qRead();
  for (const q of list) if (q.id === prevId && q.status !== "completed") { q.status = "completed"; q.progress = 100; }
  for (const q of list) if (q.status === "active") q.status = "available";

  const i = list.findIndex(q => q.id === next.id);
  if (i >= 0) list[i] = { ...list[i], ...next, status: "active", progress: next.progress ?? 0 };
  else list.push({ ...next, status: "active", progress: next.progress ?? 0 });

  qWrite(list);
}

/* =========================================================
   AUTO-RULES (catalog-friendly): Wizard → Witch
   ========================================================= */
function applyRulesOnce() {
  const list = qRead();
  const byId: Record<string, Quest> = Object.fromEntries(list.map(q => [q.id, q]));
  const wiz = byId["q_find_dreadheim_wizard"];
  const witch = byId["q_find_dreadheim_witch"];

  if (wiz?.status === "completed" && witch && witch.status !== "completed") {
    // If nothing active or the active is not meaningful anymore, switch to Witch
    for (const q of list) if (q.status === "active") q.status = "available";
    witch.status = "active";
    qWrite(list);
  }
}

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
    max-width: 360px; padding:10px 12px; border-radius:12px;
    background: rgba(0,0,0,.55); color:#fff;
    border:1px solid rgba(255,255,255,.15); backdrop-filter: blur(4px);
    font: 13px/1.35 ui-sans-serif,system-ui;
    box-shadow:0 8px 24px rgba(0,0,0,.35);
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

// Public global bridge
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

// keep HUD fresh + auto-rules
window.addEventListener("va-quest-updated", () => { applyRulesOnce(); qHudRender(); });

// Initialize on every page
qEnsure();
applyRulesOnce();
qHudRender();

/* =========================================================
   ACTIVE QUEST WIDGETS (auto-bind across all pages)
   ========================================================= */
function __vaq_findBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".vaq-box, #activeQuest, #activeQuestBox"));
}
let __rendering = false;
function __vaq_renderBoxes() {
  if (__rendering) return;
  __rendering = true;
  requestAnimationFrame(() => { __rendering = false; });

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

    const statusText = active.status ? active.status[0].toUpperCase()+active.status.slice(1) : "Available";
    if (stat)  stat.textContent  = `Status: ${statusText}`;

    const prog = Math.max(0, Math.min(100, Number(active.progress || 0)));
    if (pv)    pv.textContent = String(prog);
    if (pb)    (pb as HTMLElement).style.width = prog + "%";

    if (travel) {
      const showTravel = active.id === "q_travel_home" && active.status !== "completed";
      travel.style.display = showTravel ? "inline-block" : "none";

      if (showTravel) {
        const race = (localStorage.getItem("va_race") || "").toLowerCase();
        const dest =
          race === "myriador"  ? "/myriadormap.html"  :
          race === "wildwood"  ? "/wildwoodmap.html"  :
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
  if (e.key === "va_quests" || e.key === "va_race") __vaq_renderBoxes();
});
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __vaq_renderBoxes, { once: true });
} else {
  __vaq_renderBoxes();
}

/* =========================================================
   GLOBAL QUEST DIALOGUE (minimal runner for catalog)
   ========================================================= */
function readVars(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem("va_vars") || "{}"); } catch { return {}; }
}
function writeVars(v: Record<string, any>) {
  try { localStorage.setItem("va_vars", JSON.stringify(v)); } catch {}
}

/** Execute a single catalog action */
function applyAction(a?: CatalogDialogueNode["action"]) {
  if (!a) return;
  if (a.type === "setVars") {
    const vars = readVars();
    Object.assign(vars, a.set || {});
    writeVars(vars);
    applyRulesOnce(); qHudRender(); __vaq_renderBoxes();
    return;
  }
  if (a.type === "completeQuest") {
    try {
      (window as any).VAQ?.complete?.("q_find_dreadheim_wizard");
      // Auto-rule will switch to Witch; run now to reflect immediately
      applyRulesOnce();
      (window as any).VAQ?.renderHUD?.();
    } catch {}
    return;
  }
  if (a.type === "startNext") {
    try { (window as any).VAQ?.setActive?.(a.nextId); } catch {}
    return;
  }
}

/** Very small in-page dialogue using alert/prompt-style DOM (no external UI) */
async function runCatalogDialogue(q: CatalogQuest, onDone?: () => void) {
  // Build a simple overlay UI
  const shell = document.createElement("div");
  Object.assign(shell.style, {
    position: "fixed", inset: "0", zIndex: "100000",
    background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center"
  } as CSSStyleDeclaration);
  shell.innerHTML = `
    <div style="
      width:min(720px, calc(100vw - 32px)); max-height:min(80vh,640px);
      background:#0f1318; color:#e7d7ab; border:1px solid rgba(212,169,77,.35);
      border-radius:16px; box-shadow:0 30px 60px rgba(0,0,0,.55); overflow:hidden;
      display:grid; grid-template-rows:auto 1fr auto;
    ">
      <div id="dlgHeader" style="padding:12px 14px; font-weight:900; border-bottom:1px solid rgba(212,169,77,.25)">${q.title}</div>
      <div id="dlgBody"   style="padding:12px 14px; overflow:auto; line-height:1.45"></div>
      <div id="dlgChoices"style="padding:10px 12px; display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid rgba(212,169,77,.25)"></div>
    </div>
  `;
  document.body.appendChild(shell);

  const body = shell.querySelector("#dlgBody") as HTMLElement;
  const bar  = shell.querySelector("#dlgChoices") as HTMLElement;

  const byId: Record<string, CatalogDialogueNode> = Object.fromEntries(
    (q.dialogue || []).map(n => [n.id, n])
  );

  function renderNode(id?: string) {
    if (!id) { close(); return; }
    const node = byId[id];
    if (!node) { close(); return; }

    // body text
    body.innerHTML = `
      ${node.speaker ? `<div style="opacity:.8; font-weight:700; margin-bottom:4px">${node.speaker}</div>` : ""}
      <div>${(node.text || "").replace(/\n/g, "<br>")}</div>
    `;

    // run action immediately when node shows
    try { applyAction(node.action); } catch {}

    // choices
    bar.innerHTML = "";
    const addBtn = (label: string, cb: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      Object.assign(b.style, {
        padding:"8px 12px", borderRadius:"10px", border:"1px solid rgba(212,169,77,.35)",
        background:"#12161a", color:"#e7d7ab", cursor:"pointer"
      } as CSSStyleDeclaration);
      b.onclick = cb;
      bar.appendChild(b);
    };

    const choices = node.choices || [];
    if (choices.length) {
      choices.forEach(c => addBtn(c.text, () => renderNode(c.next)));
    } else if (node.next) {
      addBtn("Continue", () => renderNode(node.next));
    } else {
      addBtn("Done", close);
    }
  }

  function close() {
    shell.remove();
    try { onDone?.(); } catch {}
  }

  // Start at first dialogue node (id "start") if present, else first
  const startId = q.dialogue?.find(n => n.id === "start")?.id || q.dialogue?.[0]?.id;
  renderNode(startId);
}
(window as any).runCatalogDialogue = runCatalogDialogue;
(window as any).applyCatalogAction = applyAction;

/* =========================================================
   TRAVEL HANDOFF → complete Travel, activate Wizard (once)
   ========================================================= */
(() => {
  try {
    const pending = localStorage.getItem("va_pending_travel") === "1";
    if (!pending) return;

    localStorage.removeItem("va_pending_travel");

    (window as any).VAQ?.ensureQuestState?.();

    (window as any).VAQ?.complete?.("q_travel_home");

    const race = (localStorage.getItem("va_race") || "").toLowerCase();
    if (race === "dreadheim") {
      (window as any).VAQ?.setActive?.("q_find_dreadheim_wizard");
    }

    applyRulesOnce();
    (window as any).VAQ?.renderHUD?.();
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
  } catch {}
})();

/* =========================================================
   GLOBAL SFX — Gender-aware hurt & battle sounds
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
   GLOBAL, GENDER-AWARE SKILL ICONS
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
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureSkillIconsOnPage, { once: true });
} else {
  ensureSkillIconsOnPage();
}

/* =========================================================
   BAG BUTTON + BADGE (minimal styles)
   ========================================================= */
(function injectStyles() {
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

/* =========================================================
   BADGE STORAGE (per-user)
   ========================================================= */
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
  if (n > 0) {
    badge.textContent = String(n);
    badge.style.display = "inline-block";
  } else {
    badge.textContent = "";
    badge.style.display = "none";
  }
}
function clearUnseenBadge() { setUnseen(0); }
window.addEventListener("pageshow", renderBadge);
window.addEventListener("focus", renderBadge);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderBadge(); });

/* =========================================================
   INVENTORY INIT + Click hook example (optional)
   ========================================================= */
try { Inventory.init(); } catch { /* already inited is fine */ }
// Example: clicking an item opens a quest scroll
(window as any).__va_onItemClick = function (itemId: string) {
  if (itemId === "wizardscroll") showQuestScrollOverlay();
};
function showQuestScrollOverlay() {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 999999;
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
    setTimeout(() => { clearUnseenBadge(); }, 0);
    return r;
  });

  wrap("show", (orig, ...args) => {
    if (!__bagGate) return;
    const r = orig(...args);
    isOpen = true;
    setTimeout(() => { clearUnseenBadge(); }, 0);
    return r;
  });

  wrap("toggle", (orig, ...args) => {
    if (!__bagGate) return;
    const r = orig(...args);
    isOpen = !isOpen;
    if (isOpen) setTimeout(() => { clearUnseenBadge(); }, 0);
    return r;
  });

  wrap("close", (orig, ...args) => {
    const r = orig(...args);
    isOpen = false;
    return r;
  });

  if (typeof invAny?.add === "function") {
    const origAdd = invAny.add.bind(Inventory);
    invAny.add = (...args: any[]) => {
      const r = origAdd(...args);
      if (!isOpen) {
        const n = getUnseen();
        setUnseen(n + 1);
      }
      return r;
    };
  }
})();

/* =========================================================
   Arrow keys: only suppress inside inventory UI (do NOT block the game)
   ========================================================= */
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const inInventory = !!target?.closest("#inventory, .inventory, .inventory-panel, #bag, .bag-panel");
  if (inInventory && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.stopPropagation();
    e.preventDefault();
  }
});

/* =========================================================
   SMALL TWEAKS: Button position & log spacing for battle HUD
   ========================================================= */
(() => {
  const style = document.createElement("style");
  style.textContent = `#vaBagBtn{ top:auto !important; bottom:16px !important; }`;
  document.head.appendChild(style);
})();
(() => {
  const style = document.createElement("style");
  style.textContent = `#log { bottom: 150px !important; }`;
  document.head.appendChild(style);
})();

/* =========================================================
   On first load, make sure catalog is in memory (no-op if cached)
   ========================================================= */
loadCatalog().catch(() => { /* non-fatal for pages without dialogue */ });
















