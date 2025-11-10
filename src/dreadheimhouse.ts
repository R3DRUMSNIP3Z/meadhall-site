// --- Dreadheim • House Interior (walkable empty floor + NPC + exit) ---
// Requires /src/global-game-setup.ts to be loaded BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

// ===== ASSETS =====
const ASSETS = {
  bg: "/guildbook/maps/dreadheimhouse.png",            // <- your interior image
  npc: "/guildbook/npcs/dreadheim-wizard.png",         // <- tall wizard PNG (transparent)
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

// World layout
const WALKWAY_TOP_RATIO = 0.86; // keeps a big, clean empty floor for movement
const SPEED = 4;
const GRAVITY = 0.8;
const JUMP_VELOCITY = -16;
const HERO_W = 96, HERO_H = 96;

// NPC sizing/placement (right side, on the floor)
const NPC_W = 128, NPC_H = 224;
const NPC_X_RATIO = 0.72; // 72% from left
const TALK_DISTANCE = 110;

// Back-wall door (center arch); press E or click to exit
const DOOR_CENTER_X_RATIO = 0.50;
const DOOR_W_RATIO = 0.15;  // ~15% of viewport width
const DOOR_H_RATIO = 0.25;  // height portion of the wall area

// ===== DPR & resize =====
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

// ===== Load helper =====
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

// ===== World state & layout rects =====
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.round(window.innerWidth * 0.2),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
  vx: 0, vy: 0,
  onGround: true,
};

const npc = { x: 0, y: 0, w: NPC_W, h: NPC_H }; // will be laid out after resize
const doorRect = { x: 0, y: 0, w: 0, h: 0 };    // clickable/enterable area

function layoutHouse() {
  const vw = window.innerWidth, vh = window.innerHeight;

  groundY = Math.round(vh * WALKWAY_TOP_RATIO);

  // Place NPC on the floor, right side
  npc.x = Math.round(vw * NPC_X_RATIO) - Math.floor(npc.w / 2);
  npc.y = groundY - npc.h;

  // Back wall door roughly in the center of the back wall (not on the floor)
  const doorW = Math.round(vw * DOOR_W_RATIO);
  const doorH = Math.round(vh * DOOR_H_RATIO);
  const cx = Math.round(vw * DOOR_CENTER_X_RATIO);

  doorRect.w = doorW;
  doorRect.h = doorH;
  doorRect.x = cx - Math.floor(doorW / 2);
  // place vertically somewhere above the floor, around mid-wall
  doorRect.y = Math.round(vh * 0.45);
}

function refreshBounds() {
  layoutHouse();
  // keep hero on the floor if needed
  const floor = groundY - hero.h;
  if (hero.y > floor) { hero.y = floor; hero.vy = 0; hero.onGround = true; }
}
window.addEventListener("resize", refreshBounds);

// ===== Input =====
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.key);
  // jump
  if ((e.key === " " || e.key.toLowerCase() === "w" || e.key === "ArrowUp") && hero.onGround) {
    hero.vy = JUMP_VELOCITY;
    hero.onGround = false;
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key));

// Click to interact (door or NPC)
canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  // door click -> leave
  if (x >= doorRect.x && x <= doorRect.x + doorRect.w && y >= doorRect.y && y <= doorRect.y + doorRect.h) {
    warpTo(EXIT_URL);
    return;
  }

  // npc click -> talk
  if (x >= npc.x && x <= npc.x + npc.w && y >= npc.y && y <= npc.y + npc.h) {
    showDialogue([
      "Old Seer: \"You found warmth, but answers grow cold in the wind.\"",
      "Old Seer: \"Return when your pack is heavier than your doubts.\"",
    ]);
  }
});

// ===== Fade + warp =====
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

// ===== Minimal dialogue bubble =====
let dlg: HTMLDivElement | null = null;
function showDialogue(lines: string[]) {
  if (dlg) dlg.remove();
  dlg = document.createElement("div");
  dlg.style.position = "fixed";
  dlg.style.left = "50%";
  dlg.style.bottom = "10%";
  dlg.style.transform = "translateX(-50%)";
  dlg.style.maxWidth = "70ch";
  dlg.style.padding = "12px 16px";
  dlg.style.background = "rgba(0,0,0,.6)";
  dlg.style.border = "1px solid rgba(255,255,255,.15)";
  dlg.style.borderRadius = "12px";
  dlg.style.color = "#fff";
  dlg.style.font = "14px/1.4 ui-sans-serif,system-ui";
  dlg.style.backdropFilter = "blur(4px)";
  dlg.style.cursor = "pointer";
  dlg.innerHTML = lines.map(l => `<div>${l}</div>`).join("");
  dlg.title = "Click to close";
  dlg.addEventListener("click", () => dlg?.remove());
  document.body.appendChild(dlg);
}

// ===== Update =====
function step() {
  // Movement intent
  let vx = 0;
  if (keys.has("ArrowLeft")  || keys.has("a") || keys.has("A")) vx -= SPEED;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) vx += SPEED;
  hero.vx = vx;

  // Apply horizontal + clamp
  hero.x += hero.vx;
  if (hero.x < 0) hero.x = 0;
  const maxHX = window.innerWidth - hero.w;
  if (hero.x > maxHX) hero.x = maxHX;

  // Gravity + ground
  hero.vy += GRAVITY;
  hero.y += hero.vy;
  const floor = groundY - hero.h;
  if (hero.y >= floor) { hero.y = floor; hero.vy = 0; hero.onGround = true; }

  // Interactions
  const heroRect = { x: hero.x, y: hero.y, w: hero.w, h: hero.h };
  const atDoor = heroRect.x < doorRect.x + doorRect.w &&
                 heroRect.x + heroRect.w > doorRect.x &&
                 heroRect.y < doorRect.y + doorRect.h &&
                 heroRect.y + heroRect.h > doorRect.y;

  // E to exit when overlapping the door
  if (atDoor && (keys.has("e") || keys.has("E"))) { warpTo(EXIT_URL); return; }

  // E near NPC to talk
  const heroCenterX = hero.x + hero.w / 2;
  const npcCenterX = npc.x + npc.w / 2;
  const dx = Math.abs(heroCenterX - npcCenterX);
  const touchingNPC = dx < TALK_DISTANCE && Math.abs((hero.y + hero.h) - (npc.y + npc.h)) < 80;
  if (touchingNPC && (keys.has("e") || keys.has("E"))) {
    showDialogue([
      "Old Seer: \"Even empty rooms hold echoes.\"",
      "Old Seer: \"Seek the bat-shadow by the trees; it fears neither steel nor sun.\"",
    ]);
  }
}

// ===== Render =====
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background stretched to viewport (cinematic)
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // NPC (behind hero or in front? Place behind slightly for depth)
  if (npcImg) ctx.drawImage(npcImg, npc.x, npc.y, npc.w, npc.h);

  // Hero
  if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  else { ctx.fillStyle = "#333"; ctx.fillRect(hero.x, hero.y, hero.w, hero.h); }

  // // Debug bounds (uncomment if needed)
  // ctx.strokeStyle = "rgba(255,255,0,.8)";
  // ctx.strokeRect(doorRect.x, doorRect.y, doorRect.w, doorRect.h);
  // ctx.strokeStyle = "rgba(0,255,255,.8)";
  // ctx.strokeRect(npc.x, npc.y, npc.w, npc.h);
}

function loop() { step(); render(); requestAnimationFrame(loop); }

// Live hero sprite updates when gender changes
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

// ===== Boot =====
Promise.all([load(ASSETS.bg), load(ASSETS.npc), load(ASSETS.hero)])
  .then(([b, n, h]) => {
    bg = b; npcImg = n; heroImg = h;
    refreshBounds();
    loop();
  })
  .catch(() => { refreshBounds(); loop(); });

