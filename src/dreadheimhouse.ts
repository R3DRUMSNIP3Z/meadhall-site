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
  hero: (() => {
    const pick = (window as any).getHeroSprite as undefined | (() => string);
    if (typeof pick === "function") return pick();
    const g = localStorage.getItem("va_gender");
    return g === "female"
      ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
      : "/guildbook/avatars/dreadheim-warrior.png";
  })(),
};

const EXIT_URL = "/dreadheimperimeters.html";

/* =========================================================
   QUEST CATALOG LOADER (JSON-first, TS fallback)
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
// Only the floor is walkable: allow a thin vertical band near the floor
const WALK_BAND_PX = 48; // how much vertical movement above the floor

const WALKWAY_TOP_RATIO = 0.86;
const SPEED = 4;
const HERO_W = 96, HERO_H = 96;

// NPC (center-back between pillars, slightly farther back toward wall)
const NPC_W = 144, NPC_H = 252;
const NPC_X_RATIO = 0.5;
const NPC_BACK_OFFSET_RATIO = 0.06; // push up/back by ~6% of viewport height
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

  // NPC centered, pushed back toward the wall a bit
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
   SIMPLE STEP-DIALOGUE (fallback) • click to advance
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
   CLICK → NPC DIALOGUE
   ========================================================= */
canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  if (x >= npc.x && x <= npc.x + npc.w && y >= npc.y && y <= npc.y + npc.h) {
    startWizardDialogue();
  }
});

/* =========================================================
   PLAYER NAME HELPER
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
   INTERACTIVE WIZARD FLOW (catalog-first)
   ========================================================= */
let wizardLocked = false; // debounce so we don't stack interactions

async function startWizardDialogue() {
  if (wizardLocked) return;
  wizardLocked = true;

  // 1) Try catalog quest (preferred)
  const q = await getQuestFromCatalog("q_find_dreadheim_wizard");

  if (q && Array.isArray(q.dialogue) && q.dialogue.length) {
    // Use the global Dialogue engine from global-game-setup.ts if present
    const show = (window as any).showQuestDialogue as
      | ((questId: string, nodes: any[], onDone?: () => void) => void)
      | undefined;

    if (typeof show === "function") {
      show("q_find_dreadheim_wizard", q.dialogue, () => {
        // Engine may already award/complete. We just refresh HUD & unlock.
        try { (window as any).VAQ?.renderHUD?.(); } catch {}
        setTimeout(() => { wizardLocked = false; }, 300);
      });
      return;
    }
  }

  // 2) Fallback to inline text if catalog/engine missing
  const playerName = getPlayerName();
  const lines = [
    `Old Seer: "Ah... greetings, ${playerName}. I see you've been marked as a Dreadheimer."`,
    `Old Seer: "*tsk tsk tsk* ... a grim fate indeed. I feel sorry for you—why one would *choose* such a path baffles even me."`,
    `Old Seer: "Still, the winds whisper of your weakness. You look pale, worn from travel."`,
    `Old Seer: "Very well. I will help you, because you seem... *pathetic enough* to need it."`,
    `Old Seer: "Go now, to the Dreadheim Outskirts. There, you shall find the witch named Skarthra the Pale."`,
    `Old Seer: "She will grant you your path—if she doesn’t turn you into ash first."`,
  ];

  showDialogue(lines, 0);
  // After dialogue finishes (user closes), drop parchment signature:
  // Slight delay to avoid double overlays on immediate click.
  setTimeout(() => showParchmentSignature(), 400);
}

/* =========================================================
   PARCHMENT SIGNATURE → COMPLETE QUEST
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

  const name = getPlayerName();
  signZone.addEventListener("click", () => {
    signZone.textContent = name;
    setTimeout(() => {
      paper.remove();
      finishWizardQuest();
    }, 1200);
  }, { once: true });
}

function finishWizardQuest() {
  try {
    const VAQ = (window as any).VAQ;
    // Mark completed
    VAQ?.complete?.("q_find_dreadheim_wizard");
    // Optionally start next quest here (uncomment if you already defined it)
    // VAQ?.setActive?.("q_find_dreadheim_witch");
    VAQ?.renderHUD?.();
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
  } catch (err) {
    console.warn("Quest system not found:", err);
  }

  showDialogue([
    'Old Seer: "Your mark is sealed, and your path begins anew."',
    'Old Seer: "Now go — before the witch grows impatient."',
  ], 4500);

  setTimeout(() => { wizardLocked = false; }, 1200);
}

/* =========================================================
   SMALL BOTTOM HINT
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

  // Bounds
  const leftBound = 0;
  const rightBound = window.innerWidth - hero.w;
  const floorTop = groundY - hero.h;
  const ceiling = Math.max(0, floorTop - WALK_BAND_PX);

  if (hero.x < leftBound)  hero.x = leftBound;
  if (hero.x > rightBound) hero.x = rightBound;
  if (hero.y < ceiling)    hero.y = ceiling;
  if (hero.y > floorTop)   hero.y = floorTop;

  // --- Bottom-edge walk-out: if pushing down at the floor, exit ---
  if (down && hero.y >= floorTop - 0.5) {
    warpTo(EXIT_URL);
    return;
  }

  // E near NPC → interactive dialogue
  const heroCenterX = hero.x + hero.w / 2;
  const npcCenterX  = npc.x + npc.w / 2;
  const dxCenter = Math.abs(heroCenterX - npcCenterX);
  const touchingNPC =
    dxCenter < TALK_DISTANCE &&
    Math.abs((hero.y + hero.h) - (npc.y + npc.h)) < 80;

  if (touchingNPC && (keys.has("e") || keys.has("E"))) {
    startWizardDialogue();
  }
}

/* =========================================================
   RENDER
   ========================================================= */
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // simple depth: draw whichever "feet" are lower last
  const heroFeet = hero.y + hero.h;
  const npcFeet  = npc.y + npc.h;
  if (heroFeet < npcFeet) {
    if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
    if (npcImg)  ctx.drawImage(npcImg,  npc.x,  npc.y,  npc.w,  npc.h);
  } else {
    if (npcImg)  ctx.drawImage(npcImg,  npc.x,  npc.y,  npc.w,  npc.h);
    if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  }

  if (!heroImg) { ctx.fillStyle = "#333"; ctx.fillRect(hero.x, hero.y, hero.w, hero.h); }
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
   BOOT
   ========================================================= */
Promise.all([load(ASSETS.bg), load(ASSETS.npc), load(ASSETS.hero)])
  .then(([b, n, h]) => {
    bg = b; npcImg = n; heroImg = h;
    refreshBounds();
    showExitHint();
    loop();
  })
  .catch(() => { refreshBounds(); loop(); });





