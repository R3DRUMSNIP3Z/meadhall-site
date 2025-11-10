// --- Dreadheim • House Interior (free 4-direction movement + NPC + exit) ---
// Requires /src/global-game-setup.ts to be loaded BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

// ===== ASSETS =====
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

// Travel
const EXIT_URL = "/dreadheimperimeters.html";

// ===== WORLD CONFIG =====
// Only the floor is walkable: allow a thin vertical band near the floor
const WALK_BAND_PX = 48;  // how much vertical movement above the floor

const WALKWAY_TOP_RATIO = 0.86;
const SPEED = 4;
const HERO_W = 96, HERO_H = 96;

// NPC (center-back between pillars, slightly farther back toward wall)
const NPC_W = 144, NPC_H = 252;
const NPC_X_RATIO = 0.5;
const NPC_BACK_OFFSET_RATIO = 0.06; // push up/back by ~6% of viewport height
const TALK_DISTANCE = 110;


// Back-wall exit (center door)
const DOOR_CENTER_X_RATIO = 0.5;
const DOOR_W_RATIO = 0.15;
const DOOR_H_RATIO = 0.25;

// ===== DPR & RESIZE =====
function fitCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener("resize", fitCanvas);

// ===== LOAD HELPER =====
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

// ===== WORLD STATE =====
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.round(window.innerWidth * 0.2),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
};

const npc = { x: 0, y: 0, w: NPC_W, h: NPC_H };
const doorRect = { x: 0, y: 0, w: 0, h: 0 };

function layoutHouse() {
  const vw = window.innerWidth, vh = window.innerHeight;
  groundY = Math.round(vh * WALKWAY_TOP_RATIO);

  // NPC centered, pushed back toward the wall a bit
npc.x = Math.round(vw * NPC_X_RATIO) - Math.floor(npc.w / 2);
npc.y = Math.round(groundY - npc.h - vh * NPC_BACK_OFFSET_RATIO);


  // Exit door region
  const doorW = Math.round(vw * DOOR_W_RATIO);
  const doorH = Math.round(vh * DOOR_H_RATIO);
  const cx = Math.round(vw * DOOR_CENTER_X_RATIO);
  doorRect.w = doorW;
  doorRect.h = doorH;
  doorRect.x = cx - doorW / 2;
  doorRect.y = Math.round(vh * 0.45);
}
function refreshBounds() { layoutHouse(); }
window.addEventListener("resize", refreshBounds);

// ===== INPUT =====
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));

// ===== CLICK INTERACTIONS =====
canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  

  // NPC click
  if (x >= npc.x && x <= npc.x + npc.w && y >= npc.y && y <= npc.y + npc.h) {
    showDialogue([
      "Old Seer: \"You found warmth, but answers grow cold in the wind.\"",
      "Old Seer: \"Return when your pack is heavier than your doubts.\"",
    ]);
  }
});

// ===== FADE + WARP =====
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

// ===== DIALOGUE BUBBLE =====
let dlg: HTMLDivElement | null = null;
function showDialogue(lines: string[]) {
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
  });
  dlg.innerHTML = lines.map(l => `<div>${l}</div>`).join("");
  dlg.title = "Click to close";
  dlg.addEventListener("click", () => dlg?.remove());
  document.body.appendChild(dlg);
}

function step() {
  // 4-direction movement (WASD/Arrows)
  let dx = 0, dy = 0;
  const left  = keys.has("ArrowLeft")  || keys.has("a") || keys.has("A");
  const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
  const up    = keys.has("ArrowUp")    || keys.has("w") || keys.has("W");
  const down  = keys.has("ArrowDown")  || keys.has("s") || keys.has("S");

  if (left)  dx -= 1;
  if (right) dx += 1;
  if (up)    dy -= 1;
  if (down)  dy += 1;

  // Normalize diagonal
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx = (dx / len) * SPEED;
    dy = (dy / len) * SPEED;
  }

  hero.x += dx;
  hero.y += dy;

  // Room bounds
  const leftBound = 0;
  const rightBound = window.innerWidth - hero.w;
  const floorTop = groundY - hero.h;                   // hero's top at floor
  const ceiling = Math.max(0, floorTop - WALK_BAND_PX); // only floor strip

  if (hero.x < leftBound)  hero.x = leftBound;
  if (hero.x > rightBound) hero.x = rightBound;
  if (hero.y < ceiling)    hero.y = ceiling;
  if (hero.y > floorTop)   hero.y = floorTop;

  // --- Bottom-edge walk-out: if pushing down at the floor, exit ---
  if (down && hero.y >= floorTop - 0.5) {
    warpTo(EXIT_URL);
    return;
  }

  // Interactions (talk to NPC when close)
  const heroCenterX = hero.x + hero.w / 2;
  const npcCenterX  = npc.x + npc.w / 2;
  const dxCenter = Math.abs(heroCenterX - npcCenterX);
  const touchingNPC =
    dxCenter < TALK_DISTANCE &&
    Math.abs((hero.y + hero.h) - (npc.y + npc.h)) < 80;

  if (touchingNPC && (keys.has("e") || keys.has("E"))) {
    showDialogue([
      "Old Seer: \"Even empty rooms hold echoes.\"",
      "Old Seer: \"Seek the bat-shadow by the trees; it fears neither steel nor sun.\"",
    ]);
  }
}


// ===== RENDER =====
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);
  if (npcImg) ctx.drawImage(npcImg, npc.x, npc.y, npc.w, npc.h);
  if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  else { ctx.fillStyle = "#333"; ctx.fillRect(hero.x, hero.y, hero.w, hero.h); }
}

function loop() { step(); render(); requestAnimationFrame(loop); }

// Live hero sprite updates
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

// ===== BOOT =====
Promise.all([load(ASSETS.bg), load(ASSETS.npc), load(ASSETS.hero)])
  .then(([b, n, h]) => {
    bg = b; npcImg = n; heroImg = h;
    refreshBounds();
    loop();
  })
  .catch(() => { refreshBounds(); loop(); });


