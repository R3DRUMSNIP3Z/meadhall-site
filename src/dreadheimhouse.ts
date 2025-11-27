// /src/dreadheimhouse.ts
// --- Dreadheim • House Interior (free 4-direction movement + NPC + cauldron + rune projectiles) ---
// Requires /src/global-game-setup.ts to be loaded BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

/* =========================================================
   HERO ANIM + RUNE PROJECTILE + NPC/CAULDRON ASSETS
   ========================================================= */

// Hero animation frame URLs (class-aware)
const HERO_IDLE_URLS: string[] =
  (window as any).getHeroAnimUrls?.("idle") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/sm_${i.toString().padStart(3, "0")}.png`
  );

const HERO_LEFT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("walkLeft") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/leftwalk_${i
      .toString()
      .padStart(3, "0")}.png`
  );

const HERO_RIGHT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("walkRight") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/rightwalk_${i
      .toString()
      .padStart(3, "0")}.png`
  );

// Attack frames (falls back to walk if class has no attack yet)
const HERO_ATK_LEFT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("attackLeft") ?? HERO_LEFT_URLS;

const HERO_ATK_RIGHT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("attackRight") ?? HERO_RIGHT_URLS;

// Rune mage projectile (9-frame animation)
const RUNE_PROJECTILE_URLS = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/rune-mage/projectiles/frame_${i
    .toString()
    .padStart(3, "0")}.png`
);

// Animated wizard NPC frames
const WIZARD_FRAME_URLS = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/npcs/dreadheim-wizard/frame_${i
    .toString()
    .padStart(3, "0")}.png`
);

// Animated cauldron frames (16 frames)
const CAULDRON_FRAME_URLS = Array.from({ length: 16 }, (_, i) =>
  `/guildbook/props/wizardshouseprops/frame_${i
    .toString()
    .padStart(3, "0")}.png`
);

/* =========================================================
   ASSETS / TRAVEL
   ========================================================= */
const ASSETS = {
  bg: "/guildbook/props/dreadheimhouseinside.png",
  scroll: "/guildbook/loot/questscroll.png",
} as const;

const EXIT_URL = "/dreadheimperimeters.html";

// === Scroll loot (drops AFTER wizard quest is completed) ===
let scrollImg: HTMLImageElement | null = null;

const scrollLoot = {
  x: 620,
  y: 760,
  w: 48,
  h: 48,
  visible: false,
};

/* =========================================================
   QUEST CATALOG LOADER (Wizard quest)
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
   POTION CATALOG LOADER (Cauldron crafting)
   ========================================================= */
const POTIONS_CATALOG_PATH = "/guildbook/catalogpotions.json";

type PotionIngredient = {
  id: string;
  name: string;
  qty: number;
};

type PotionDef = {
  id: string;
  name: string;
  desc: string;
  brewable: boolean;
  resultId?: string;
  resultName?: string;
  resultIcon?: string;
  ingredients: PotionIngredient[];
};

// always an array; empty means "not loaded / no potions"
let __potionsCatalog: PotionDef[] = [];
let __lastPotionList: PotionDef[] = [];

async function loadPotionsCatalog(): Promise<PotionDef[]> {
  // if already loaded (or at least attempted), just return it
  if (__potionsCatalog.length > 0) return __potionsCatalog;

  try {
    const r = await fetch(POTIONS_CATALOG_PATH, { cache: "no-store" });
    if (!r.ok) throw new Error(r.statusText);
    const data = await r.json();
    __potionsCatalog = Array.isArray(data?.potions)
      ? (data.potions as PotionDef[])
      : [];
    return __potionsCatalog;
  } catch {
    __potionsCatalog = [];
    return __potionsCatalog;
  }
}


/* =========================================================
   WORLD CONFIG
   ========================================================= */
const WALK_BAND_PX = 48;
const WALKWAY_TOP_RATIO = 0.86;
const SPEED = 4;
const HERO_W = 96,
  HERO_H = 200;

// NPC (center-back)
const NPC_W = 144,
  NPC_H = 252;
const NPC_X_RATIO = 0.5;
const NPC_BACK_OFFSET_RATIO = 0.06;
const TALK_DISTANCE = 110;

// Cauldron
const CAULDRON_W = 180;
const CAULDRON_H = 180;

/* =========================================================
   DPR & RESIZE
   ========================================================= */
function fitCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = window.innerWidth,
    h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();

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

// hero animation frames
let heroIdleFrames: HTMLImageElement[] = [];
let heroLeftFrames: HTMLImageElement[] = [];
let heroRightFrames: HTMLImageElement[] = [];
let heroAtkLeftFrames: HTMLImageElement[] = [];
let heroAtkRightFrames: HTMLImageElement[] = [];
let heroFallbackImg: HTMLImageElement | null = null;

// rune projectile frames
let runeFrames: HTMLImageElement[] = [];

// wizard anim frames
let wizardFrames: HTMLImageElement[] = [];
let wizardFrameIndex = 0;
const WIZARD_FRAME_MS = 400;
let lastWizardFrameTime = performance.now();

// cauldron anim frames
let cauldronFrames: HTMLImageElement[] = [];
let cauldronFrameIndex = 0;
const CAULDRON_FRAME_MS = 120;
let lastCauldronFrameTime = performance.now();

/* =========================================================
   WORLD STATE
   ========================================================= */
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.round(window.innerWidth * 0.2),
  y: groundY - HERO_H,
  w: HERO_W,
  h: HERO_H,
  vx: 0,
  vy: 0,
  anim: "idle" as "idle" | "walk" | "attack",
  facing: "right" as "left" | "right",
  frameIndex: 0,
};

const npc = { x: 0, y: 0, w: NPC_W, h: NPC_H };
const cauldron = { x: 0, y: 0, w: CAULDRON_W, h: CAULDRON_H };

type RectTarget = { x: number; y: number; w: number; h: number };

function applyDevLayoutFromHandle(handleId: string, target: RectTarget) {
  const el = document.getElementById(handleId) as HTMLElement | null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  target.x = r.left;
  target.y = r.top;
  target.w = r.width;
  target.h = r.height;
}

function layoutHouse() {
  const vw = window.innerWidth,
    vh = window.innerHeight;
  groundY = Math.round(vh * WALKWAY_TOP_RATIO);

  npc.x = Math.round(vw * NPC_X_RATIO) - Math.floor(npc.w / 2);
  npc.y = Math.round(groundY - npc.h - vh * NPC_BACK_OFFSET_RATIO);

  // default cauldron placement
  cauldron.w = CAULDRON_W;
  cauldron.h = CAULDRON_H;
  cauldron.x = Math.round(vw * 0.80) - Math.floor(cauldron.w / 2);
  cauldron.y = groundY - cauldron.h - 100;

  scrollLoot.x = 620;
  scrollLoot.y = 760;
}

function refreshBounds() {
  layoutHouse();

  // if dev handles exist, they win
  applyDevLayoutFromHandle("devWizard", npc);
  applyDevLayoutFromHandle("devCauldron", cauldron);
  applyDevLayoutFromHandle("devScroll", scrollLoot as any);
}

window.addEventListener("resize", () => {
  fitCanvas();
  refreshBounds();
});

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
    position: "fixed",
    inset: "0",
    background: "black",
    opacity: "0",
    transition: `opacity ${seconds}s ease`,
    zIndex: "999999",
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
    left: "50%",
    bottom: "10%",
    transform: "translateX(-50%)",
    maxWidth: "70ch",
    padding: "12px 16px",
    background: "rgba(0,0,0,.6)",
    border: "1px solid rgba(255,255,255,.15)",
    borderRadius: "12px",
    color: "#fff",
    font: "14px/1.4 ui-sans-serif,system-ui",
    backdropFilter: "blur(4px)",
    cursor: "pointer",
    zIndex: "999999",
  } as CSSStyleDeclaration);

  let idx = 0;
  const render = () => {
    dlg!.innerHTML = `<div>${lines[idx]}</div>
      <div style="opacity:.7;font-size:12px;margin-top:6px">Click to continue…</div>`;
  };
  dlg.addEventListener("click", () => {
    idx++;
    if (idx >= lines.length) {
      dlg?.remove();
      dlg = null;
      return;
    }
    render();
  });
  render();
  document.body.appendChild(dlg);

  if (ms > 0)
    setTimeout(() => {
      dlg?.remove();
      dlg = null;
    }, ms);
}

/* =========================================================
   CATALOG DIALOGUE RUNNER (Wizard)
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
  (el.querySelector("#vaCatClose") as HTMLButtonElement).onclick = () =>
    closeCatDialogue();
  return catDialogEl!;
}
function openCatDialogue() {
  ensureCatDialogEl().style.display = "flex";
}
function closeCatDialogue() {
  if (catDialogEl) catDialogEl.style.display = "none";
}

function renderCatNode(q: CatalogQuest, nodeId: string, onDone?: () => void) {
  const el = ensureCatDialogEl();
  const body = el.querySelector("#vaCatBody") as HTMLElement;
  const choices = el.querySelector("#vaCatChoices") as HTMLElement;
  const header = el.querySelector("#vaCatHeader") as HTMLElement;

  const node = q.dialogue.find((n) => n.id === nodeId);
  if (!node) {
    closeCatDialogue();
    onDone?.();
    return;
  }

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
      for (const it of q.rewards?.items || []) {
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
    if (!next) {
      closeCatDialogue();
      onDone?.();
      return;
    }
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
   CLICK / HOVER → NPC + CAULDRON
   ========================================================= */
function cssPointFromEvent(ev: MouseEvent | PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  return { x, y };
}
function isOverNPC(x: number, y: number): boolean {
  const padX = 24,
    padY = 16;
  return (
    x >= npc.x - padX &&
    x <= npc.x + npc.w + padX &&
    y >= npc.y - padY &&
    y <= npc.y + npc.h + padY
  );
}
function isOverCauldron(x: number, y: number): boolean {
  const padX = 16,
    padY = 16;
  return (
    x >= cauldron.x - padX &&
    x <= cauldron.x + cauldron.w + padX &&
    y >= cauldron.y - padY &&
    y <= cauldron.y + cauldron.h + padY
  );
}

canvas.addEventListener("pointermove", (ev) => {
  const { x, y } = cssPointFromEvent(ev);
  if (isOverNPC(x, y) || isOverCauldron(x, y)) {
    canvas.style.cursor = "pointer";
  } else {
    canvas.style.cursor = "default";
  }
});

canvas.addEventListener("pointerdown", async (ev) => {
  const { x, y } = cssPointFromEvent(ev);

  // Wizard click
  if (isOverNPC(x, y)) {
    startWizardDialogue();
    return;
  }

  // Cauldron click → open potion UI
  if (isOverCauldron(x, y)) {
    openCauldronUI();
    return;
  }
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
        setTimeout(() => {
          wizardLocked = false;
        }, 300);
      }
    });
    return;
  }

  (window as any).VADialogue?.openNode?.("q_find_dreadheim_wizard:intro");
  if (typeof (window as any).showParchmentSignature === "function") {
    (window as any).showParchmentSignature("wizardscroll");
  }
  setTimeout(() => {
    wizardLocked = false;
  }, 300);
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
  const closeBtn = paper.querySelector(
    "#closeParchment"
  ) as HTMLButtonElement;

  const name = getPlayerName();
  signZone.addEventListener(
    "click",
    () => {
      signZone.textContent = name;
      setTimeout(() => {
        paper.remove();
        finishWizardQuest();
      }, 1200);
    },
    { once: true }
  );

  closeBtn.addEventListener("click", () => {
    paper.remove();
    setTimeout(() => {
      wizardLocked = false;
    }, 200);
  });
}
(window as any).showParchmentSignature = showParchmentSignature;

/* =========================================================
   FINISH WIZARD QUEST
   ========================================================= */
function finishWizardQuest() {
  try {
    const VAQ = (window as any).VAQ;
    VAQ?.complete?.("q_find_dreadheim_wizard");
    VAQ?.renderHUD?.();
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
  } catch {}

  // Make scroll appear
  scrollLoot.visible = true;

  showDialogue(
    [
      'Old Seer: "Your mark is sealed, and your path begins anew."',
      'Old Seer: "Now go — before the witch grows impatient."',
    ],
    4500
  );

  setTimeout(() => {
    wizardLocked = false;
  }, 1200);
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
  h.textContent =
    "Walk ↓ to leave the house • Press E near the Wizard • Click the cauldron to brew potions";
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 7000);
}

/* =========================================================
   RUNE PROJECTILES
   ========================================================= */
type RuneProjectile = {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  life: number;
  frame: number;
};

const RUNE_W = 25;
const RUNE_H = 25;
const RUNE_SPEED = 12;
const RUNE_LIFETIME_MS = 900;
const RUNE_FRAME_MS = 70;
const RUNE_COOLDOWN_MS = 600;
let lastRuneCastTime = 0;

const runeProjectiles: RuneProjectile[] = [];
let lastRuneFrameTime = performance.now();

function spawnRuneProjectile(targetX: number, targetY: number) {
  if (!runeFrames.length) return;

  const startX = hero.x + hero.w / 2;
  const startY = hero.y + hero.h * 0.45;

  let dx = targetX - startX;
  let dy = targetY - startY;
  const dist = Math.hypot(dx, dy) || 1;
  dx /= dist;
  dy /= dist;

  const vx = dx * RUNE_SPEED;
  const vy = dy * RUNE_SPEED;

  runeProjectiles.push({
    x: startX,
    y: startY,
    w: RUNE_W,
    h: RUNE_H,
    vx,
    vy,
    life: RUNE_LIFETIME_MS,
    frame: 0,
  });
}

/* =========================================================
   HERO ANIM TIMERS
   ========================================================= */
const HERO_FRAME_MS = 100;
let lastHeroFrameTime = performance.now();
const HERO_ATTACK_TOTAL_MS = 600;
let heroAttackElapsed = 0;

// for dt
let lastStepTime = performance.now();

/* =========================================================
   ATTACK INPUT (left mouse button)
   ========================================================= */
canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;

  const now = performance.now();
  if (now - lastRuneCastTime < RUNE_COOLDOWN_MS) return;
  lastRuneCastTime = now;

  // start attack animation
  hero.anim = "attack";
  hero.frameIndex = 0;
  heroAttackElapsed = 0;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  spawnRuneProjectile(mx, my);
});

/* =========================================================
   HERO ANIM HELPERS
   ========================================================= */
function getHeroFrameList(): HTMLImageElement[] {
  if (hero.anim === "attack") {
    return hero.facing === "left" ? heroAtkLeftFrames : heroAtkRightFrames;
  }
  if (hero.anim === "walk") {
    return hero.facing === "left" ? heroLeftFrames : heroRightFrames;
  }
  return heroIdleFrames;
}

/* =========================================================
   CAULDRON POTION UI + INVENTORY HELPERS
   ========================================================= */

// helper to count items in inventory by id
function invCount(id: string): number {
  try {
    const Inv: any = (window as any).Inventory;
    if (!Inv) return 0;
    if (typeof Inv.count === "function") {
      return Inv.count(id);
    }
    if (typeof Inv.get === "function") {
      const items = Inv.get() as { id: string; qty: number }[];
      return items
        .filter((it) => it.id === id)
        .reduce((s, it) => s + (it.qty || 0), 0);
    }
  } catch {}
  return 0;
}

let cauldronOpen = false;

async function openCauldronUI() {
  if (cauldronOpen) return;
  cauldronOpen = true;

  const potions = await loadPotionsCatalog();
  __lastPotionList = potions;

  const overlayId = "vaCauldronOverlay";
  let overlay = document.getElementById(overlayId) as HTMLDivElement | null;
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.id = overlayId;
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.6);
    display:flex; align-items:center; justify-content:center;
    z-index:100001;
  `;
  overlay.innerHTML = `
    <div style="
      width:min(720px,94vw);
      max-height:min(80vh,640px);
      background:#0f1318; color:#e7d7ab;
      border-radius:18px; border:1px solid rgba(212,169,77,.4);
      box-shadow:0 26px 60px rgba(0,0,0,.7);
      padding:14px; display:flex; flex-direction:column; gap:10px;
      font-family:Cinzel,serif;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:900;font-size:18px;">Cauldron of Dreadheim</div>
        <button id="vaCaldClose" style="
          background:#151a1f;border-radius:10px;border:1px solid rgba(212,169,77,.45);
          color:#e7d7ab;padding:6px 10px;cursor:pointer;font-size:12px;">✖</button>
      </div>
      <div style="font-size:13px;opacity:.85">
        Choose a recipe. Ingredients in <span style="color:#7fd37f;">green</span> you have enough of;
        in <span style="color:#d47a7a;">red</span> you are missing.
      </div>
      <div id="vaCaldList" style="
        margin-top:4px;
        display:flex; flex-direction:column; gap:10px;
        overflow:auto;
      "></div>
    </div>
  `;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCauldronUI();
  });
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector("#vaCaldClose") as HTMLButtonElement;
  closeBtn.onclick = () => closeCauldronUI();

  renderCauldronUI(potions);
}

function closeCauldronUI() {
  const overlay = document.getElementById(
    "vaCauldronOverlay"
  ) as HTMLDivElement | null;
  if (overlay) overlay.remove();
  cauldronOpen = false;
}

function renderCauldronUI(potions: PotionDef[]) {
  const list = document.getElementById("vaCaldList") as HTMLDivElement | null;
  if (!list) return;
  list.innerHTML = "";

  for (const p of potions) {
    const card = document.createElement("div");
    card.style.cssText = `
      border-radius:12px;
      border:1px solid rgba(212,169,77,.25);
      background:radial-gradient(circle at top,#191f26,#070a0d);
      padding:10px 12px;
      display:flex; flex-direction:column; gap:8px;
    `;

    const haveAllIngredients =
      p.brewable &&
      p.ingredients.length > 0 &&
      p.ingredients.every((ing) => invCount(ing.id) >= ing.qty);

    const titleRow = document.createElement("div");
    titleRow.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    titleRow.innerHTML = `
      <div>
        <div style="font-weight:800;font-size:14px;">${p.name}</div>
        <div style="font-size:12px;opacity:.85;">${p.desc}</div>
      </div>
      <div style="font-size:11px;opacity:.8;text-align:right;">
        ${p.brewable ? "Recipe known" : "Unknown recipe"}
      </div>
    `;
    card.appendChild(titleRow);

    const ingWrap = document.createElement("div");
    ingWrap.style.cssText =
      "margin-top:4px;font-size:12px;display:flex;flex-direction:column;gap:3px;";

    if (p.ingredients.length) {
      for (const ing of p.ingredients) {
        const have = invCount(ing.id);
        const ok = have >= ing.qty;
        const line = document.createElement("div");
        line.innerHTML = `
          <span style="color:${ok ? "#7fd37f" : "#d47a7a"};">
            ${have}/${ing.qty}
          </span>
          <span style="opacity:.9;">${ing.name}</span>
        `;
        ingWrap.appendChild(line);
      }
    } else {
      const line = document.createElement("div");
      line.style.opacity = ".7";
      line.textContent = "No known ingredients yet.";
      ingWrap.appendChild(line);
    }

    card.appendChild(ingWrap);

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "margin-top:6px;display:flex;justify-content:flex-end;gap:8px;";

    const brewBtn = document.createElement("button");
    brewBtn.textContent = p.brewable ? "Brew" : "???";
    brewBtn.style.cssText = `
      padding:6px 12px;
      border-radius:10px;
      border:1px solid rgba(212,169,77,.45);
      background:${haveAllIngredients ? "#1c242d" : "#191919"};
      color:#e7d7ab;
      cursor:${p.brewable && haveAllIngredients ? "pointer" : "not-allowed"};
      font-size:12px;
      opacity:${p.brewable && haveAllIngredients ? "1" : ".55"};
    `;

    if (p.brewable && haveAllIngredients) {
      brewBtn.onclick = () => {
        brewPotion(p);
      };
    }

    btnRow.appendChild(brewBtn);
    card.appendChild(btnRow);

    list.appendChild(card);
  }
}

function brewPotion(potion: PotionDef) {
  const Inv: any = (window as any).Inventory;
  if (!Inv) {
    console.warn("Inventory not found");
    return;
  }

  const missing: string[] = [];
  for (const ing of potion.ingredients || []) {
    const have = invCount(ing.id);
    if (have < ing.qty) {
      missing.push(`${ing.name} (${have}/${ing.qty})`);
    }
  }

  if (missing.length > 0) {
    showDialogue(
      [
        "You don't have the right materials for this potion.",
        "",
        "Missing:",
        ...missing.map((m) => `• ${m}`),
      ],
      2600
    );
    // refresh counts (in case bag changed while UI open)
    renderCauldronUI(__lastPotionList);
    return;
  }

  // consume materials
  for (const ing of potion.ingredients || []) {
    try {
      if (typeof Inv.consume === "function") {
        const leftover = Inv.consume(ing.id, ing.qty);
        if (typeof leftover === "number" && leftover > 0) {
          console.warn("Leftover after consume for", ing.id, "→", leftover);
        }
      } else if (
        typeof Inv.get === "function" &&
        typeof Inv.removeAt === "function"
      ) {
        // fallback: manual remove from stacks using get/removeAt
        let remaining = ing.qty;
        const items = Inv.get() as { id: string; qty: number }[];
        for (let i = items.length - 1; i >= 0 && remaining > 0; i--) {
          const it = items[i];
          if (it.id !== ing.id) continue;
          const use = Math.min(it.qty, remaining);
          Inv.removeAt(i, use);
          remaining -= use;
        }
      }
    } catch (e) {
      console.warn("Error consuming", ing.id, e);
    }
  }

  // add resulting potion
  if (potion.resultId && potion.resultName && potion.resultIcon) {
    Inv.add?.(potion.resultId, potion.resultName, potion.resultIcon, 1);
  }

  showDialogue(
    [
      `You brew a ${potion.resultName || potion.name}.`,
      "The ingredients vanish into the cauldron's fumes.",
    ],
    2200
  );

  // re-render cauldron UI so counts update
  renderCauldronUI(__lastPotionList);
}

/* =========================================================
   STEP (MOVEMENT + ANIM + RUNES + WIZARD + CAULDRON)
   ========================================================= */
function step() {
  const nowStep = performance.now();
  const dt = nowStep - lastStepTime;
  lastStepTime = nowStep;

  // movement intent
  let dx = 0,
    dy = 0;
  const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
  const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
  const up = keys.has("ArrowUp") || keys.has("w") || keys.has("W");
  const down = keys.has("ArrowDown") || keys.has("s") || keys.has("S");

  if (left) dx -= 1;
  if (right) dx += 1;
  if (up) dy -= 1;
  if (down) dy += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx = (dx / len) * SPEED;
    dy = (dy / len) * SPEED;

    if (hero.anim !== "attack") hero.anim = "walk";
    if (dx < 0) hero.facing = "left";
    else if (dx > 0) hero.facing = "right";
  } else if (hero.anim !== "attack") {
    hero.anim = "idle";
  }

  hero.vx = dx;
  hero.vy = dy;

  hero.x += dx;
  hero.y += dy;

  const leftBound = 0;
  const rightBound = window.innerWidth - hero.w;
  const floorTop =
    Math.round(window.innerHeight * WALKWAY_TOP_RATIO) - hero.h;
  const ceiling = Math.max(0, floorTop - WALK_BAND_PX);

  if (hero.x < leftBound) hero.x = leftBound;
  if (hero.x > rightBound) hero.x = rightBound;
  if (hero.y < ceiling) hero.y = ceiling;
  if (hero.y > floorTop) hero.y = floorTop;

  // walk down out of house
  if (down && hero.y >= floorTop - 0.5) {
    warpTo(EXIT_URL);
    return;
  }

  // hero animation timing
  const nowAnim = nowStep;
  const frames = getHeroFrameList();
  if (frames.length && nowAnim - lastHeroFrameTime >= HERO_FRAME_MS) {
    lastHeroFrameTime = nowAnim;
    hero.frameIndex = (hero.frameIndex + 1) % frames.length;
  }

  // attack duration
  if (hero.anim === "attack") {
    heroAttackElapsed += dt;
    const atkFrames =
      hero.facing === "left" ? heroAtkLeftFrames : heroAtkRightFrames;
    if (!atkFrames.length || heroAttackElapsed >= HERO_ATTACK_TOTAL_MS) {
      heroAttackElapsed = 0;
      hero.frameIndex = 0;
      hero.anim = hero.vx !== 0 || hero.vy !== 0 ? "walk" : "idle";
    }
  }

  // near-NPC "Press E" hint + talk
  const heroCenterX = hero.x + hero.w / 2;
  const npcCenterX = npc.x + npc.w / 2;
  const dxCenter = Math.abs(heroCenterX - npcCenterX);
  const touchingNPC =
    dxCenter < TALK_DISTANCE &&
    Math.abs(hero.y + hero.h - (npc.y + npc.h)) < 80;

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

  // near-cauldron hint
  const cauldronCenterX = cauldron.x + cauldron.w / 2;
  const cauldronCenterY = cauldron.y + cauldron.h / 2;
  const heroCenterY = hero.y + hero.h / 2;
  const distToCauldron = Math.hypot(
    heroCenterX - cauldronCenterX,
    heroCenterY - cauldronCenterY
  );
  const nearCauldron = distToCauldron < 180;

  if (nearCauldron && !document.getElementById("cauldHint")) {
    const h = document.createElement("div");
    h.id = "cauldHint";
    h.style.cssText = `
      position:fixed; left:50%; bottom:54px; transform:translateX(-50%);
      color:#fff; opacity:.95; font:13px ui-sans-serif,system-ui;
      background:rgba(0,0,0,.55); padding:6px 10px; border-radius:8px;
      border:1px solid rgba(255,255,255,.15); backdrop-filter:blur(4px);
      z-index:9999; pointer-events:none;
    `;
    h.textContent = "Click the cauldron to brew potions";
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 1800);
  }

  // rune frame animation
  if (runeProjectiles.length && nowStep - lastRuneFrameTime >= RUNE_FRAME_MS) {
    lastRuneFrameTime = nowStep;
    for (const p of runeProjectiles) {
      p.frame = (p.frame + 1) % Math.max(1, runeFrames.length);
    }
  }

  // rune motion + lifetime
  for (let i = runeProjectiles.length - 1; i >= 0; i--) {
    const p = runeProjectiles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= dt;

    const offscreen =
      p.x + p.w < 0 ||
      p.x > window.innerWidth ||
      p.y + p.h < 0 ||
      p.y > window.innerHeight;

    if (offscreen || p.life <= 0) {
      runeProjectiles.splice(i, 1);
    }
  }

  // wizard animation timer
  if (wizardFrames.length && nowStep - lastWizardFrameTime >= WIZARD_FRAME_MS) {
    lastWizardFrameTime = nowStep;
    wizardFrameIndex =
      (wizardFrameIndex + 1) % Math.max(1, wizardFrames.length);
  }

  // cauldron animation timer
  if (cauldronFrames.length && nowStep - lastCauldronFrameTime >= CAULDRON_FRAME_MS) {
    lastCauldronFrameTime = nowStep;
    cauldronFrameIndex =
      (cauldronFrameIndex + 1) % Math.max(1, cauldronFrames.length);
  }
}

/* =========================================================
   SCROLL PICKUP
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
      const inv: any = (window as any).Inventory;
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

  if (bg)
    ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

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
  const npcFeet = npc.y + npc.h;
  const cauldronFeet = cauldron.y + cauldron.h;

  const frames = getHeroFrameList();
  const heroImg =
    frames.length && hero.frameIndex < frames.length
      ? frames[hero.frameIndex]
      : heroFallbackImg;

  const wizardImg =
    wizardFrames.length && wizardFrameIndex < wizardFrames.length
      ? wizardFrames[wizardFrameIndex]
      : null;

  const cauldronImg =
    cauldronFrames.length && cauldronFrameIndex < cauldronFrames.length
      ? cauldronFrames[cauldronFrameIndex]
      : null;

  type DrawEnt = {
    z: number;
    img: HTMLImageElement | null;
    x: number;
    y: number;
    w: number;
    h: number;
  };
  const ents: DrawEnt[] = [];

  if (heroImg)
    ents.push({
      z: heroFeet,
      img: heroImg,
      x: hero.x,
      y: hero.y,
      w: hero.w,
      h: hero.h,
    });
  if (wizardImg)
    ents.push({
      z: npcFeet,
      img: wizardImg,
      x: npc.x,
      y: npc.y,
      w: npc.w,
      h: npc.h,
    });
  if (cauldronImg)
    ents.push({
      z: cauldronFeet,
      img: cauldronImg,
      x: cauldron.x,
      y: cauldron.y,
      w: cauldron.w,
      h: cauldron.h,
    });

  ents.sort((a, b) => a.z - b.z);
  for (const e of ents) {
    if (e.img) ctx.drawImage(e.img, e.x, e.y, e.w, e.h);
  }

  if (!heroImg) {
    ctx.fillStyle = "#333";
    ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  }

  // rune projectiles (draw on top)
  for (const p of runeProjectiles) {
    const frameImg =
      runeFrames.length > 0
        ? runeFrames[p.frame % runeFrames.length]
        : null;

    if (frameImg) {
      ctx.save();
      if (p.vx < 0) {
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
        ctx.scale(-1, 1);
        ctx.drawImage(frameImg, -p.w / 2, -p.h / 2, p.w, p.h);
      } else {
        ctx.drawImage(frameImg, p.x, p.y, p.w, p.h);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = "#4cf";
      ctx.beginPath();
      ctx.arc(
        p.x + p.w / 2,
        p.y + p.h / 2,
        Math.min(p.w, p.h) / 2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }
}

/* =========================================================
   LOOP
   ========================================================= */
function loop() {
  step();
  render();
  requestAnimationFrame(loop);
}

/* =========================================================
   LIVE HERO SPRITE UPDATES
   ========================================================= */
window.addEventListener("va-gender-changed", () => {
  try {
    const pick = (window as any).getHeroSprite as
      | undefined
      | (() => string);
    const next =
      typeof pick === "function"
        ? pick()
        : localStorage.getItem("va_gender") === "female"
        ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
        : "/guildbook/avatars/dreadheim-warrior.png";

    const img = new Image();
    img.onload = () => {
      heroFallbackImg = img;
    };
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
  },
};

/* =========================================================
   BOOT
   ========================================================= */
Promise.all(
  [
    ASSETS.bg,
    ASSETS.scroll,
    ...HERO_IDLE_URLS,
    ...HERO_LEFT_URLS,
    ...HERO_RIGHT_URLS,
    ...HERO_ATK_LEFT_URLS,
    ...HERO_ATK_RIGHT_URLS,
    ...RUNE_PROJECTILE_URLS,
    ...WIZARD_FRAME_URLS,
    ...CAULDRON_FRAME_URLS,
  ].map(load)
)
  .then((imgs) => {
    let idx = 0;

    bg = imgs[idx++];
    scrollImg = imgs[idx++];

    // hero anim frames
    const idleCount = HERO_IDLE_URLS.length;
    const leftCount = HERO_LEFT_URLS.length;
    const rightCount = HERO_RIGHT_URLS.length;
    const atkLeftCount = HERO_ATK_LEFT_URLS.length;
    const atkRightCount = HERO_ATK_RIGHT_URLS.length;

    const heroTotal =
      idleCount +
      leftCount +
      rightCount +
      atkLeftCount +
      atkRightCount;

    const heroImgs = imgs.slice(idx, idx + heroTotal);
    idx += heroTotal;

    heroIdleFrames = heroImgs.slice(0, idleCount);
    heroLeftFrames = heroImgs.slice(idleCount, idleCount + leftCount);
    heroRightFrames = heroImgs.slice(
      idleCount + leftCount,
      idleCount + leftCount + rightCount
    );
    heroAtkLeftFrames = heroImgs.slice(
      idleCount + leftCount + rightCount,
      idleCount + leftCount + rightCount + atkLeftCount
    );
    heroAtkRightFrames = heroImgs.slice(
      idleCount + leftCount + rightCount + atkLeftCount,
      idleCount + leftCount + rightCount + atkLeftCount + atkRightCount
    );

    // rune frames
    runeFrames = imgs.slice(idx, idx + RUNE_PROJECTILE_URLS.length);
    idx += RUNE_PROJECTILE_URLS.length;

    // wizard frames
    wizardFrames = imgs.slice(idx, idx + WIZARD_FRAME_URLS.length);
    idx += WIZARD_FRAME_URLS.length;

    heroFallbackImg = heroIdleFrames[0] || null;

    // cauldron frames
    cauldronFrames = imgs.slice(idx, idx + CAULDRON_FRAME_URLS.length);
    idx += CAULDRON_FRAME_URLS.length;

    refreshBounds();
    showExitHint();
    loop();
  })
  .catch((err) => {
    console.warn("House load fallback:", err);
    refreshBounds();
    showExitHint();
    loop();
  });




















