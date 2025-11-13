// /src/dreadheimhouse.ts
// --- Dreadheim • House Interior (free 4-direction movement + NPC + exit) ---
// Requires /src/global-game-setup.ts to be loaded BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

/* =========================================================
   ASSETS / TRAVEL
   ========================================================= */
const ASSETS = {
  bg: "/guildbook/props/dreadheimhouseinside.png",
  npc: "/guildbook/npcs/dreadheim-wizard.png",
  scroll: "/guildbook/loot/questscroll.png",

  hero: (() => {
    const pick = (window as any).getHeroSprite as undefined | (() => string);
    if (typeof pick === "function") return pick();
    const g = localStorage.getItem("va_gender");
    return g === "female"
      ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
      : "/guildbook/avatars/dreadheim-warrior.png";
  })(),
} as const;

const EXIT_URL = "/dreadheimperimeters.html";

// === Scroll loot (drops AFTER wizard quest is completed) ===
let scrollImg: HTMLImageElement | null = null;

const scrollLoot = {
  x: 420,
  y: 460,
  w: 48,
  h: 48,
  visible: false,
};


/* =========================================================
   QUEST CATALOG LOADER
   ========================================================= */
const QUESTS_CATALOG_PATH = "/guildbook/catalogquests.json";
let __questsCatalog: any | null = null;

async function loadQuestsCatalog(): Promise<any | null> {
  if (__questsCatalog) return __questsCatalog;
  try {
    const r = await fetch(QUESTS_CATALOG_PATH, { cache: "no-store" });
    if (!r.ok) throw new Error(r.statusText);
    __questsCatalog = await r.json();
    return __questsCatalog;
  } catch {
    __questsCatalog = null;
    return null;
  }
}
async function getQuestFromCatalog(qid: string): Promise<any | null> {
  const cat = await loadQuestsCatalog();
  if (!cat || !Array.isArray(cat.quests)) return null;
  return cat.quests.find((q: any) => q.id === qid) || null;
}

/* =========================================================
   WORLD CONFIG
   ========================================================= */
const WALK_BAND_PX = 48;
const WALKWAY_TOP_RATIO = 0.86;
const SPEED = 4;
const HERO_W = 96, HERO_H = 96;

// NPC (center-back)
const NPC_W = 144, NPC_H = 252;
const NPC_X_RATIO = 0.5;
const NPC_BACK_OFFSET_RATIO = 0.06;
const TALK_DISTANCE = 110;

/* =========================================================
   DPR & RESIZE
   ========================================================= */
function fitCanvas() {
  const dpr = Math.max(1, (window.devicePixelRatio || 1));
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener("resize", fitCanvas);

/* =========================================================
   LOAD HELPERS
   ========================================================= */
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Missing asset: " + src));
    img.src = src;
  });
}

let bg: HTMLImageElement | null = null;
let npcImg: HTMLImageElement | null = null;
let heroImg: HTMLImageElement | null = null;

/* =========================================================
   WORLD STATE
   ========================================================= */
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.round(window.innerWidth * 0.2),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
};

const npc = { x: 0, y: 0, w: NPC_W, h: NPC_H };

function layoutHouse() {
  const vw = window.innerWidth, vh = window.innerHeight;
  groundY = Math.round(vh * WALKWAY_TOP_RATIO);
  npc.x = Math.round(vw * NPC_X_RATIO) - Math.floor(npc.w / 2);
  npc.y = Math.round(groundY - npc.h - vh * NPC_BACK_OFFSET_RATIO);
}
function refreshBounds() { layoutHouse(); }
window.addEventListener("resize", refreshBounds);

/* =========================================================
   INPUT
   ========================================================= */
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));

/* =========================================================
   FADE + WARP
   ========================================================= */
let transitioning = false;
function fadeTo(seconds = 0.25, after?: () => void) {
  const f = document.createElement("div");
  Object.assign(f.style, {
    position: "fixed", inset: "0", background: "black", opacity: "0",
    transition: `opacity ${seconds}s ease`, zIndex: "999999",
  } as CSSStyleDeclaration);
  document.body.appendChild(f);
  requestAnimationFrame(() => (f.style.opacity = "1"));
  setTimeout(() => after && after(), seconds * 1000);
}
function warpTo(url: string) {
  if (transitioning) return;
  transitioning = true;
  fadeTo(0.25, () => (window.location.href = url));
}

/* =========================================================
   SIMPLE TEXT DIALOGUE (fallback)
   ========================================================= */
let dlg: HTMLDivElement | null = null;
function showDialogue(lines: string[], ms = 0) {
  if (dlg) dlg.remove();
  dlg = document.createElement("div");
  Object.assign(dlg.style, {
    position: "fixed",
    left: "50%", bottom: "10%", transform: "translateX(-50%)",
    maxWidth: "70ch", padding: "12px 16px",
    background: "rgba(0,0,0,.6)",
    border: "1px solid rgba(255,255,255,.15)",
    borderRadius: "12px", color: "#fff",
    font: "14px/1.4 ui-sans-serif,system-ui",
    backdropFilter: "blur(4px)", cursor: "pointer",
    zIndex: "999999"
  } as CSSStyleDeclaration);

  let idx = 0;
  const render = () => {
    dlg!.innerHTML = `<div>${lines[idx]}</div>
      <div style="opacity:.7;font-size:12px;margin-top:6px">Click to continue…</div>`;
  };
  dlg.addEventListener("click", () => {
    idx++;
    if (idx >= lines.length) { dlg?.remove(); dlg = null; return; }
    render();
  });
  render();
  document.body.appendChild(dlg);

  if (ms > 0) setTimeout(() => { dlg?.remove(); dlg = null; }, ms);
}

/* =========================================================
   CATALOG DIALOGUE RUNNER
   ========================================================= */
type CatalogNode = {
  id: string;
  speaker?: string;
  text: string;
  choices?: { text: string; next?: string }[];
  next?: string;
  action?: string;
};
type CatalogQuest = {
  id: string;
  title?: string;
  desc?: string;
  rewards?: {
    gold?: number;
    brisingr?: number;
    items?: { id: string; name?: string; image?: string; qty?: number }[];
  };
  dialogue: CatalogNode[];
};

let catDialogEl: HTMLDivElement | null = null;
function ensureCatDialogEl(): HTMLDivElement {
  if (catDialogEl) return catDialogEl;
  const el = document.createElement("div");
  el.id = "vaCatDialogue";
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 100000;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,.6); backdrop-filter: blur(2px);
  `;
  el.innerHTML = `
    <div style="
      width: min(720px, calc(100vw - 32px));
      background: #0f1318; color: #e7d7ab;
      border:1px solid rgba(212,169,77,.35);
      border-radius: 16px; box-shadow: 0 30px 60px rgba(0,0,0,.55);
      padding: 12px 14px; display:flex; flex-direction:column; gap:10px;
      max-height: min(80vh, 640px);
    ">
      <div id="vaCatHeader" style="font-weight:900; border-bottom:1px solid rgba(212,169,77,.25); padding-bottom:6px">
        Dialogue
      </div>
      <div id="vaCatBody" style="line-height:1.45; overflow:auto; min-height: 96px"></div>
      <div id="vaCatChoices" style="display:flex; gap:8px; flex-wrap:wrap"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px">
        <button id="vaCatClose" style="
          padding:8px 12px;border-radius:10px;border:1px solid rgba(212,169,77,.35);
          background:#12161a;color:#e7d7ab;cursor:pointer;">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  catDialogEl = el as HTMLDivElement;
  (el.querySelector("#vaCatClose") as HTMLButtonElement).onclick = () => closeCatDialogue();
  return catDialogEl!;
}
function openCatDialogue() { ensureCatDialogEl().style.display = "flex"; }
function closeCatDialogue() { if (catDialogEl) catDialogEl.style.display = "none"; }

function renderCatNode(q: CatalogQuest, nodeId: string, onDone?: () => void) {
  const el = ensureCatDialogEl();
  const body = el.querySelector("#vaCatBody") as HTMLElement;
  const choices = el.querySelector("#vaCatChoices") as HTMLElement;
  const header = el.querySelector("#vaCatHeader") as HTMLElement;

  const node = q.dialogue.find(n => n.id === nodeId);
  if (!node) { closeCatDialogue(); onDone?.(); return; }

  header.textContent = q.title || "Dialogue";
  body.innerHTML = `
    ${node.speaker ? `<div style="opacity:.9;font-weight:800;margin-bottom:4px">${node.speaker}</div>` : ""}
    <div>${node.text}</div>
  `;
  choices.innerHTML = "";

  // Action node
  if (node.action === "completeQuest") {
    try {
      const inv: any = (window as any).Inventory;
      for (const it of (q.rewards?.items || [])) {
        const qty = Math.max(1, Number(it?.qty ?? 1));
        const name = it?.name || it?.id || "item";
        const icon = (it as any).icon || (it as any).image || "";
        if (typeof inv?.add === "function" && it?.id) {
          inv.add(it.id, name, icon, qty);
        }
      }
    } catch {}

    closeCatDialogue();
    finishWizardQuest();
    onDone?.();
    return;
  }

  const goNext = (next?: string) => {
    if (!next) { closeCatDialogue(); onDone?.(); return; }
    renderCatNode(q, next, onDone);
  };

  if (node.choices && node.choices.length) {
    for (const ch of node.choices) {
      const b = document.createElement("button");
      b.textContent = ch.text;
      b.style.cssText = `
        padding:8px 12px;border-radius:10px;border:1px solid rgba(212,169,77,.35);
        background:#12161a;color:#e7d7ab;cursor:pointer;
      `;
      b.onclick = () => goNext(ch.next);
      choices.appendChild(b);
    }
  } else {
    const b = document.createElement("button");
    b.textContent = "Continue";
    b.style.cssText = `
      padding:8px 12px;border-radius:10px;border:1px solid rgba(212,169,77,.35);
      background:#12161a;color:#e7d7ab;cursor:pointer;
    `;
    b.onclick = () => goNext(node.next);
    choices.appendChild(b);
  }
}

function runCatalogDialogue(q: CatalogQuest, onDone?: () => void) {
  openCatDialogue();
  renderCatNode(q, "start", onDone);
}

/* =========================================================
   CLICK / HOVER → NPC DIALOGUE
   ========================================================= */
function cssPointFromEvent(ev: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  return { x, y };
}
function isOverNPC(x: number, y: number): boolean {
  const padX = 24, padY = 16;
  return (
    x >= npc.x - padX &&
    x <= npc.x + npc.w + padX &&
    y >= npc.y - padY &&
    y <= npc.y + npc.h + padY
  );
}
canvas.addEventListener("pointermove", (ev) => {
  const { x, y } = cssPointFromEvent(ev);
  canvas.style.cursor = isOverNPC(x, y) ? "pointer" : "default";
});
canvas.addEventListener("pointerdown", async (ev) => {
  const { x, y } = cssPointFromEvent(ev);
  if (isOverNPC(x, y)) startWizardDialogue();
});

/* =========================================================
   PLAYER NAME
   ========================================================= */
function getPlayerName(): string {
  try {
    const n = localStorage.getItem("va_name");
    if (n) return n;
    const raw = localStorage.getItem("mh_user");
    if (raw) {
      const o = JSON.parse(raw);
      return o?.name || o?.user?.name || "traveler";
    }
  } catch {}
  return "traveler";
}

/* =========================================================
   WIZARD FLOW
   ========================================================= */
let wizardLocked = false;

async function startWizardDialogue() {
  if (wizardLocked) return;
  wizardLocked = true;

  const q = await getQuestFromCatalog("q_find_dreadheim_wizard");

  if (q && Array.isArray(q.dialogue) && q.dialogue.length) {
    runCatalogDialogue(q as CatalogQuest, () => {
      try {
        if (typeof (window as any).showParchmentSignature === "function") {
          (window as any).showParchmentSignature("wizardscroll");
        }
        (window as any).VAQ?.renderHUD?.();
      } catch {}
      finally {
        setTimeout(() => { wizardLocked = false; }, 300);
      }
    });
    return;
  }

  (window as any).VADialogue?.openNode?.("q_find_dreadheim_wizard:intro");
  if (typeof (window as any).showParchmentSignature === "function") {
    (window as any).showParchmentSignature("wizardscroll");
  }
  setTimeout(() => { wizardLocked = false; }, 300);
}

/* =========================================================
   SIGN PARCHMENT
   ========================================================= */
function showParchmentSignature() {
  const paper = document.createElement("div");
  paper.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.7);
    display:flex; align-items:center; justify-content:center;
    z-index:999999;
  `;
  paper.innerHTML = `
    <div style="
      background:url('/guildbook/ui/parchment.png') center/contain no-repeat;
      width:600px; height:400px; position:relative; color:#222;
      display:flex; flex-direction:column; align-items:center; justify-content:flex-end;
      font-family:'Cinzel',serif; font-size:18px;
    ">
      <button id="closeParchment" style="
        position:absolute; top:10px; right:12px; border:none; border-radius:8px;
        padding:6px 10px; font:12px ui-sans-serif,system-ui; cursor:pointer;
        background:rgba(0,0,0,.5); color:#fff;
      ">×</button>
      <div id="signZone" style="
        width:320px; height:64px; margin-bottom:70px;
        border-bottom:2px solid #000; cursor:pointer;
        text-align:center; font-size:20px; color:#444; line-height:64px;
        background:rgba(255,255,255,.05);
      ">Click to sign your name</div>
    </div>
  `;

  document.body.appendChild(paper);
  const signZone = paper.querySelector("#signZone") as HTMLElement;
  const closeBtn = paper.querySelector("#closeParchment") as HTMLButtonElement;

  const name = getPlayerName();
  signZone.addEventListener("click", () => {
    signZone.textContent = name;
    setTimeout(() => {
      paper.remove();
      finishWizardQuest();
    }, 1200);
  }, { once: true });

  closeBtn.addEventListener("click", () => {
    paper.remove();
    setTimeout(() => { wizardLocked = false; }, 200);
  });
}
(window as any).showParchmentSignature = showParchmentSignature;

/* =========================================================
   FINISH WIZARD QUEST — ⭐ FIX HERE
   ========================================================= */
function finishWizardQuest() {
  try {
    const VAQ = (window as any).VAQ;
    VAQ?.complete?.("q_find_dreadheim_wizard");
    VAQ?.renderHUD?.();
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
  } catch {}

  //// ⭐ ADDED — MAKE SCROLL DROP
  scrollLoot.visible = true;

  showDialogue([
    'Old Seer: "Your mark is sealed, and your path begins anew."',
    'Old Seer: "Now go — before the witch grows impatient."',
  ], 4500);

  setTimeout(() => { wizardLocked = false; }, 1200);
}

/* =========================================================
   BOTTOM HINT
   ========================================================= */
function showExitHint() {
  const h = document.createElement("div");
  h.style.cssText = `
    position:fixed; left:50%; bottom:8px; transform:translateX(-50%);
    color:#fff; opacity:.85; font:12px ui-sans-serif,system-ui;
    background:rgba(0,0,0,.45); padding:6px 10px; border-radius:8px;
    border:1px solid rgba(255,255,255,.15); backdrop-filter:blur(4px); pointer-events:none;
    z-index:9999;
  `;
  h.textContent = "Walk ↓ to leave the house • Press E near the wizard to talk";
  document.body.appendChild(h);
  setTimeout(()=>h.remove(), 5000);
}

/* =========================================================
   STEP (MOVEMENT)
   ========================================================= */
function step() {
  let dx = 0, dy = 0;
  const left  = keys.has("ArrowLeft")  || keys.has("a") || keys.has("A");
  const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
  const up    = keys.has("ArrowUp")    || keys.has("w") || keys.has("W");
  const down  = keys.has("ArrowDown")  || keys.has("s") || keys.has("S");

  if (left)  dx -= 1;
  if (right) dx += 1;
  if (up)    dy -= 1;
  if (down)  dy += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx = (dx / len) * SPEED;
    dy = (dy / len) * SPEED;
  }

  hero.x += dx;
  hero.y += dy;

  const leftBound = 0;
  const rightBound = window.innerWidth - hero.w;
  const floorTop = Math.round(window.innerHeight * WALKWAY_TOP_RATIO) - hero.h;
  const ceiling = Math.max(0, floorTop - WALK_BAND_PX);

  if (hero.x < leftBound)  hero.x = leftBound;
  if (hero.x > rightBound) hero.x = rightBound;
  if (hero.y < ceiling)    hero.y = ceiling;
  if (hero.y > floorTop)   hero.y = floorTop;

  if (down && hero.y >= floorTop - 0.5) {
    warpTo(EXIT_URL);
    return;
  }

  const heroCenterX = hero.x + hero.w / 2;
  const npcCenterX  = npc.x + npc.w / 2;
  const dxCenter = Math.abs(heroCenterX - npcCenterX);
  const touchingNPC =
    dxCenter < TALK_DISTANCE &&
    Math.abs((hero.y + hero.h) - (npc.y + npc.h)) < 80;

  if (touchingNPC && !document.getElementById("eHint")) {
    const h = document.createElement("div");
    h.id = "eHint";
    h.style.cssText = `
      position:fixed; left:50%; bottom:36px; transform:translateX(-50%);
      color:#fff; opacity:.95; font:13px ui-sans-serif,system-ui;
      background:rgba(0,0,0,.55); padding:6px 10px; border-radius:8px;
      border:1px solid rgba(255,255,255,.15); backdrop-filter:blur(4px);
      z-index:9999; pointer-events:none;
    `;
    h.textContent = "Press E to talk to the Wizard";
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 1500);
  }

  if (touchingNPC && (keys.has("e") || keys.has("E"))) {
    startWizardDialogue();
  }
}

/* =========================================================
   ⭐ SCROLL PICKUP FIX
   ========================================================= */

canvas.addEventListener("pointerdown", (ev) => {
  if (!scrollLoot.visible) return;

  const { x, y } = cssPointFromEvent(ev);

  if (
    x >= scrollLoot.x &&
    x <= scrollLoot.x + scrollLoot.w &&
    y >= scrollLoot.y &&
    y <= scrollLoot.y + scrollLoot.h
  ) {
    try {
      const inv:any = (window as any).Inventory;
      inv?.add?.(
        "wizardscroll",
        "Wizard's Scroll",
        "/guildbook/loot/questscroll.png",
        1
      );
    } catch {}

    scrollLoot.visible = false;

    showDialogue(["You picked up the Wizard’s Scroll."], 2000);
  }
});


/* =========================================================
   RENDER
   ========================================================= */
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  if (scrollLoot.visible && scrollImg) {
    ctx.drawImage(
      scrollImg,
      scrollLoot.x,
      scrollLoot.y,
      scrollLoot.w,
      scrollLoot.h
    );
  }

  const heroFeet = hero.y + hero.h;
  const npcFeet  = npc.y + npc.h;

  if (heroFeet < npcFeet) {
    if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
    if (npcImg) ctx.drawImage(npcImg, npc.x, npc.y, npc.w, npc.h);
  } else {
    if (npcImg) ctx.drawImage(npcImg, npc.x, npc.y, npc.w, npc.h);
    if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  }

  if (!heroImg) {
    ctx.fillStyle = "#333";
    ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  }
}

/* =========================================================
   LOOP
   ========================================================= */
function loop() { step(); render(); requestAnimationFrame(loop); }

/* =========================================================
   LIVE HERO SPRITE UPDATES
   ========================================================= */
window.addEventListener("va-gender-changed", () => {
  try {
    const pick = (window as any).getHeroSprite as undefined | (() => string);
    const next = (typeof pick === "function")
      ? pick()
      : (localStorage.getItem("va_gender") === "female"
          ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
          : "/guildbook/avatars/dreadheim-warrior.png");
    const img = new Image();
    img.onload = () => { heroImg = img; };
    img.src = next;
  } catch {}
});

/* =========================================================
   Debug Helper
   ========================================================= */
(window as any).VAQdebug = {
  resetWizard() {
    try {
      const VAQ = (window as any).VAQ;
      VAQ?.reset?.("q_find_dreadheim_wizard");
      VAQ?.setActive?.("q_find_dreadheim_wizard");
      VAQ?.renderHUD?.();
      console.log("Wizard quest reset + set active");
    } catch {}
  }
};

/* =========================================================
   BOOT
   ========================================================= */
Promise.all([
  load(ASSETS.bg),
  load(ASSETS.npc),
  load(ASSETS.hero),
  load(ASSETS.scroll),
])
  .then(([b, n, h, s]) => {
    bg = b;
    npcImg = n;
    heroImg = h;
    scrollImg = s;

    refreshBounds();
    showExitHint();
    loop();
  })
  .catch((err) => {
    console.warn("House load fallback:", err);
    refreshBounds();
    loop();
  });











