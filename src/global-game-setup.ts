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
// reflect gender on <body> for optional CSS theming
document.body?.setAttribute("data-gender", localStorage.getItem("va_gender") || "male");

// Universal hero sprite (used by arena/game.ts and maps if needed)
(window as any).getHeroSprite = function (): string {
  const g = localStorage.getItem("va_gender");
  return g === "female"
    ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
    : "/guildbook/avatars/dreadheim-warrior.png";
};

/* =========================================================
   Global Quest Helpers (HUD + storage)
   ========================================================= */
const VAQ_KEY = "va_quests";
const RACE_KEY = "va_race"; // used to gate wizard quest

type QStatus = "available" | "active" | "completed" | "locked";
type Quest = { id: string; title: string; desc: string; status: QStatus; progress?: number };

function qRead(): Quest[] {
  try { return JSON.parse(localStorage.getItem(VAQ_KEY) || "[]"); } catch { return []; }
}
function qWrite(list: Quest[]) {
  try { localStorage.setItem(VAQ_KEY, JSON.stringify(list)); } catch {}
  window.dispatchEvent(new CustomEvent("va-quest-updated"));
}

// Boot defaults + race/travel-gated wizard quest
function qEnsure() {
  const list = qRead();
  const byId: Record<string, Quest> = Object.fromEntries(list.map(q => [q.id, q]));
  const race = (localStorage.getItem(RACE_KEY) || "").toLowerCase();

  // Seed main + travel if missing
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

  // Rebuild map after any pushes
  const map: Record<string, Quest> = Object.fromEntries(list.map(q => [q.id, q]));
  const qMain   = map["q_main_pick_race"];
  const qTravel = map["q_travel_home"];

  // If race is chosen, mark main as completed
  if (race && (qMain.status !== "completed" || (qMain.progress ?? 0) !== 100)) {
    qMain.status = "completed"; qMain.progress = 100;
  }

  // Wizard quest exists but starts LOCKED
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

  // Gate: ONLY when race === dreadheim AND travel is completed → unlock (available)
  const travelDone = qTravel.status === "completed";
  if (race === "dreadheim" && travelDone) {
    if (qWiz.status === "locked") qWiz.status = "available"; // don't auto-activate
  } else {
    if (qWiz.status !== "completed" && qWiz.status !== "locked") {
      qWiz.status = "locked";
      qWiz.progress = 0;
    }
  }

  // If race chosen and travel not completed yet, auto-activate Travel
  // (and make "active" exclusive)
  if (race && !travelDone) {
    for (const q of list) if (q.status === "active") q.status = "available";
    qTravel.status = "active";
  }

  qWrite(list);
}

// Utilities
function qSetActive(id: string) {
  // make "active" exclusive
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
  // complete prev if still not marked
  for (const q of list) if (q.id === prevId && q.status !== "completed") { q.status = "completed"; q.progress = 100; }
  // exclusive active
  for (const q of list) if (q.status === "active") q.status = "available";

  // add or replace next
  const i = list.findIndex(q => q.id === next.id);
  if (i >= 0) list[i] = { ...list[i], ...next, status: "active", progress: next.progress ?? 0 };
  else list.push({ ...next, status: "active", progress: next.progress ?? 0 });

  qWrite(list);
}

// HUD (bottom-left)
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

// keep HUD fresh
window.addEventListener("va-quest-updated", qHudRender);

// Initialize on every page
qEnsure();
qHudRender();

/* =========================================================
   ACTIVE QUEST WIDGETS (auto-bind across all pages)
   ========================================================= */
/*
  Markup this expects (any/all are optional):
  <div class="vaq-box" id="activeQuestBox">
    <div class="vaq-title"></div>
    <div class="vaq-desc"></div>
    <div class="vaq-status"></div>
    <div class="vaq-progress">
      <div class="vaq-progress-bar"></div>
      <span class="vaq-progress-val"></span>
    </div>
    <a class="vaq-travel" href="#" style="display:none">Travel</a>
  </div>
*/
function __vaq_findBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".vaq-box, #activeQuest, #activeQuestBox"));
}

function __vaq_renderBoxes() {
  const boxes = __vaq_findBoxes();
  if (!boxes.length) return;

  // ensure quest state before reading
  try { (window as any).VAQ?.ensureQuestState?.(); } catch {}

  const active = (window as any).VAQ?.active?.() || null;
  for (const box of boxes) {
    const title = box.querySelector<HTMLElement>(".vaq-title,#aqTitle");
    const desc  = box.querySelector<HTMLElement>(".vaq-desc,#aqDesc");
    const stat  = box.querySelector<HTMLElement>(".vaq-status,#aqStatus");
    const pv    = box.querySelector<HTMLElement>(".vaq-progress-val,#aqProgVal");
    const pb    = box.querySelector<HTMLElement>(".vaq-progress-bar,#aqProgBar");
    const travel= box.querySelector<HTMLAnchorElement>(".vaq-travel,#aqTravel");

    if (!active) {
      box.setAttribute("hidden","true");
      continue;
    }

    box.removeAttribute("hidden");
    if (title) title.textContent = active.title || "—";
    if (desc)  desc.textContent  = active.desc  || "—";

    const statusText = active.status ? active.status[0].toUpperCase()+active.status.slice(1) : "Available";
    if (stat)  stat.textContent  = `Status: ${statusText}`;

    const prog = Math.max(0, Math.min(100, Number(active.progress || 0)));
    if (pv)    pv.textContent = String(prog);
    if (pb)    (pb as HTMLElement).style.width = prog + "%";

    // Handle "Travel" button only for the travel quest
    if (travel) {
      const showTravel = active.id === "q_travel_home" && active.status !== "completed";
      travel.style.display = showTravel ? "inline-block" : "none";

      if (showTravel) {
        // pick destination from race
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

// Re-render on quest changes and lifecycle events
window.addEventListener("va-quest-updated", __vaq_renderBoxes);
document.addEventListener("visibilitychange", () => { if (!document.hidden) __vaq_renderBoxes(); });
window.addEventListener("pageshow", __vaq_renderBoxes);
window.addEventListener("storage", (e) => {
  if (e.key === "va_quests" || e.key === "va_race") __vaq_renderBoxes();
});

// First paint
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __vaq_renderBoxes, { once: true });
} else {
  __vaq_renderBoxes();
}

/* =========================================================
   GLOBAL QUEST DIALOGUE (placeholder system)
   ========================================================= */
(function setupDialogueSystem() {
  const DIALOG_ID = "vaDialogue";

  type DialogueChoice = {
    text: string;
    next?: string;
    reward?: { gold?: number; xp?: number; itemId?: string };
    onPick?: () => void;
    close?: boolean;
  };
  type DialogueNode = {
    id: string;
    title?: string;
    portrait?: string;
    lines: string[];
    choices?: DialogueChoice[];
    onStart?: () => void;
    onEnd?: () => void;
  };

  // --- minimal DOM shell ---
  function ensureDom(): HTMLElement {
    let el = document.getElementById(DIALOG_ID) as HTMLElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = DIALOG_ID;
      el.style.cssText = `
        position: fixed; inset: 0; z-index: 100000;
        display: none; align-items: center; justify-content: center;
        background: rgba(0,0,0,.6); backdrop-filter: blur(2px);
      `;
      el.innerHTML = `
        <div id="vaDialogueCard" style="
          width: min(720px, calc(100vw - 32px)); max-height: min(80vh, 640px);
          background: #0f1318; color: #e7d7ab; border:1px solid rgba(212,169,77,.35);
          border-radius: 16px; box-shadow: 0 30px 60px rgba(0,0,0,.55); overflow: hidden;
          display: grid; grid-template-columns: 140px 1fr; grid-template-rows: auto 1fr auto;
        ">
          <div id="vaDialoguePortrait" style="
            grid-row: 1 / span 3; background:#0b0f13; display:grid; place-items:center; border-right:1px solid rgba(212,169,77,.25);
          "></div>
          <div id="vaDialogueHeader" style="padding:12px 14px; font-weight:900; border-bottom:1px solid rgba(212,169,77,.25)">Dialogue</div>
          <div id="vaDialogueBody" style="padding:12px 14px; overflow:auto; line-height:1.45"></div>
          <div id="vaDialogueChoices" style="padding:10px 12px; display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid rgba(212,169,77,.25)"></div>
        </div>
      `;
      document.body.appendChild(el);
    }
    return el!;
  }

  function setPortrait(url?: string) {
    const box = document.getElementById("vaDialoguePortrait") as HTMLElement | null;
    if (!box) return;
    if (!url) { box.innerHTML = ""; return; }
    box.innerHTML = `<img src="${url}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">`;
  }
  function setHeader(title?: string) {
    const h = document.getElementById("vaDialogueHeader"); if (h) h.textContent = title || "Dialogue";
  }
  function setLines(lines: string[]) {
    const body = document.getElementById("vaDialogueBody"); if (!body) return;
    body.innerHTML = lines.map(l => `<p style="margin:.4em 0">${l}</p>`).join("");
    body.scrollTop = 0;
  }
  function setChoices(choices: DialogueChoice[] = [], nextLoader: (id?: string) => void, endCb?: () => void) {
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

    if (!choices.length) {
      mk("Continue", () => { endCb?.(); close(); });
      return;
    }

    for (const ch of choices) {
      mk(ch.text, () => {
        try { ch.onPick?.(); } catch {}
        if (ch.reward) {
          // Hook for backend later; for now you can process on the map or via window.dev helpers
          // Example: (window as any).dev.gold({ add: ch.reward.gold || 0 })
        }
        if (ch.close) { close(); return; }
        nextLoader(ch.next);
      });
    }
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

  // --- registry for quick quest→dialog mapping (you can expand freely) ---
  const NODES: Record<string, DialogueNode> = {
    // Placeholder wizard dialogue
    "q_find_dreadheim_wizard:intro": {
      id: "q_find_dreadheim_wizard:intro",
      title: "Mysterious Wizard",
      portrait: "/guildbook/avatars/npcs/dreadheim-wizard.png",
      lines: [
        "[placeholder] You found the lamplit hall.",
        "[placeholder] The wizard studies you in silence.",
        "[placeholder] 'We have much to discuss…'",
      ],
      choices: [
        { text: "Who are you?", next: "q_find_dreadheim_wizard:who" },
        { text: "I'm ready for a task.", next: "q_find_dreadheim_wizard:task" },
        { text: "Leave", close: true }
      ],
    },
    "q_find_dreadheim_wizard:who": {
      id: "q_find_dreadheim_wizard:who",
      title: "Mysterious Wizard",
      portrait: "/guildbook/avatars/npcs/dreadheim-wizard.png",
      lines: [
        "[placeholder] 'Names carry power. Mine is not for common speech.'",
        "[placeholder] 'But you may call me… Wizard.'",
      ],
      choices: [
        { text: "Back", next: "q_find_dreadheim_wizard:intro" },
        { text: "Got a job for me?", next: "q_find_dreadheim_wizard:task" },
        { text: "Done", close: true }
      ],
    },
    "q_find_dreadheim_wizard:task": {
      id: "q_find_dreadheim_wizard:task",
      title: "Mysterious Wizard",
      portrait: "/guildbook/avatars/npcs/dreadheim-wizard.png",
      lines: [
        "[placeholder] 'Bring me three wolf pelts from the Outskirts.'",
        "[placeholder] 'Prove you can survive the dark that hunts here.'",
      ],
      choices: [
        {
          text: "Accept",
          onPick: () => {
            // Example: activate a follow-up quest here when you add it
            // (window as any).VAQ?.setActive?.("q_hunt_wolves");
          },
          close: true
        },
        { text: "Maybe later", close: true }
      ],
      onEnd: () => { /* optional */ },
    },
  };

  function showDialogueNode(id?: string) {
    if (!id) { close(); return; }
    const node = NODES[id];
    if (!node) { close(); return; }
    ensureDom();
    open();
    try { node.onStart?.(); } catch {}
    setPortrait(node.portrait);
    setHeader(node.title || "Dialogue");
    setLines(node.lines || []);
    setChoices(node.choices || [], showDialogueNode, () => { try { node.onEnd?.(); } catch {} });
  }

  // Public API
  (window as any).VADialogue = {
    openNode: showDialogueNode,
    close,
    register(id: string, node: DialogueNode) { NODES[id] = node; },
  };

  // Convenience alias for quick calls
  (window as any).showQuestDialogue = showDialogueNode;
})();

/* =========================================================
   TRAVEL HANDOFF → complete Travel, activate Wizard (once)
   ========================================================= */
(() => {
  try {
    const pending = localStorage.getItem("va_pending_travel") === "1";
    if (!pending) return;

    // consume the flag
    localStorage.removeItem("va_pending_travel");

    // make sure quests exist
    (window as any).VAQ?.ensureQuestState?.();

    // complete Travel
    (window as any).VAQ?.complete?.("q_travel_home");

    // if Dreadheim, set Wizard as the active quest
    const race = (localStorage.getItem("va_race") || "").toLowerCase();
    if (race === "dreadheim") {
      (window as any).VAQ?.setActive?.("q_find_dreadheim_wizard");
    }

    // refresh HUD + notify listeners
    (window as any).VAQ?.renderHUD?.();
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
  } catch {}
})();

/* =========================================================
   GLOBAL SFX — Gender-aware hurt sounds
   ========================================================= */
// Preload once and reuse (no new Audio on every hit)
const __vaSFX = {
  femaleHurt: new Audio("/guildbook/sfx/femalehurt.mp3"),
  maleHurt:   new Audio("/guildbook/sfx/malehurt.mp3"),
};
__vaSFX.femaleHurt.preload = "auto";
__vaSFX.maleHurt.preload   = "auto";

function __playFemaleHurt(): void {
  const a = __vaSFX.femaleHurt; if (!a) return;
  a.currentTime = 0; a.volume = 0.9;
  a.play().catch(() => {});
}
function __playMaleHurt(): void {
  const a = __vaSFX.maleHurt; if (!a) return;
  a.currentTime = 0; a.volume = 0.9;
  a.play().catch(() => {});
}
/** Gender-aware wrapper (pick by va_gender) */
function __playHeroHurt(): void {
  const g = localStorage.getItem("va_gender");
  if (g === "female") __playFemaleHurt(); else __playMaleHurt();
}
// Expose to any page / script
(window as any).playFemaleHurt = __playFemaleHurt;
(window as any).playMaleHurt   = __playMaleHurt;
(window as any).playHeroHurt   = __playHeroHurt;

/* =========================================================
   GLOBAL SFX — Battle End Sounds (Victory / Defeat)
   ========================================================= */
const __vaBattleSFX = {
  victory: new Audio("/guildbook/sfx/battlevictory.mp3"),
  fail:    new Audio("/guildbook/sfx/fightfail.mp3"),
};
__vaBattleSFX.victory.preload = "auto";
__vaBattleSFX.fail.preload    = "auto";

function __playVictory(): void {
  const a = __vaBattleSFX.victory;
  a.currentTime = 0; a.volume = 0.9;
  a.play().catch(() => {});
}
function __playDefeat(): void {
  const a = __vaBattleSFX.fail;
  a.currentTime = 0; a.volume = 0.9;
  a.play().catch(() => {});
}
// expose globally
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

// Inject skill icons into any page that has #skillbar .skill
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

    // Don’t double-prefix; allow absolute or root-relative
    if (img.src !== want && !img.src.endsWith(want)) {
      img.style.display = "";
      img.src = want;
    }
  });
}

// Re-run icon injection when gender changes
window.addEventListener("va-gender-changed", (ev: any) => {
  const g = (ev?.detail as string) || localStorage.getItem("va_gender") || "male";
  document.body?.setAttribute("data-gender", g);
  ensureSkillIconsOnPage();
});

// Also try once on load (in case battle pages loaded first)
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

  // Ignore any key events that might slip through on the button
  btn.addEventListener("keydown", (e) => e.preventDefault());

  // Only this click path is allowed to toggle the bag
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
   INVENTORY INIT
   ========================================================= */
try { Inventory.init(); } catch { /* already inited is fine */ }

/* =========================================================
   SHARED MAP/BAG UTILITIES
   ========================================================= */

// 1) Fix stack number layering (qty bubbles should sit on top)
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

// 2) Mouse-only inventory: disable keyboard focus inside the bag
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

// 3) After-open hook: fix layers, observe changes, clear badge, and disable keyboard
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
   INVENTORY MONKEY-PATCH — Only open via mouse click
   ========================================================= */
(() => {
  const invAny = Inventory as any;
  let isOpen = false;

  // === Gate: allow open/show/toggle ONLY when explicitly set by our bag button click
  let __bagGate = false;
  (window as any).__va_openBagFromClick = () => {
    __bagGate = true;
    try {
      if (typeof invAny?.toggle === "function") invAny.toggle();
      else if (typeof invAny?.open === "function") invAny.open();
    } finally {
      __bagGate = false; // always reset
    }
  };

  // Wrap helper
  const wrap = (name: string, handler: (orig: Function, ...args: any[]) => any) => {
    if (typeof invAny?.[name] !== "function") return;
    const orig = invAny[name].bind(Inventory);
    invAny[name] = (...args: any[]) => handler(orig, ...args);
  };

  // Block ALL non-click attempts to open/show/toggle
  wrap("open", (orig, ...args) => {
    if (!__bagGate) return; // ignore non-click opens
    const r = orig(...args);
    isOpen = true;
    afterInventoryOpen();
    return r;
  });

  wrap("show", (orig, ...args) => {
    if (!__bagGate) return; // ignore non-click shows
    const r = orig(...args);
    isOpen = true;
    afterInventoryOpen();
    return r;
  });

  wrap("toggle", (orig, ...args) => {
    if (!__bagGate) return; // ignore non-click toggles
    const r = orig(...args);
    isOpen = !isOpen; // infer new state
    if (isOpen) afterInventoryOpen();
    else clearUnseenBadge();
    return r;
  });

  // Allow CLOSE from anywhere (UI close button, your own ESC handler, etc.)
  wrap("close", (orig, ...args) => {
    const r = orig(...args);
    isOpen = false;
    return r;
  });

  // When items get added and bag is closed, bump unseen badge counter
  if (typeof invAny?.add === "function") {
    const origAdd = invAny.add.bind(Inventory);
    invAny.add = (...args: any[]) => {
      const r = origAdd(...args);
      if (!isOpen) setUnseen(getUnseen() + 1);
      return r;
    };
  }

  // Also clear the badge if the floating bag button is clicked (redundant but safe)
  const bagBtn = document.querySelector<HTMLElement>("#vaBagBtn, .bag, .inventory-button");
  if (bagBtn) bagBtn.addEventListener("click", () => setTimeout(afterInventoryOpen, 0));
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
}); // note: no {capture:true}

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











