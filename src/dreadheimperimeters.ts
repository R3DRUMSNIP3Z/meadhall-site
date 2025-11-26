// /src/dreadheimperimeters.ts
// --- Dreadheim • Perimeters (overworld transition) ---
// Requires: /src/global-game-setup.ts to be loaded BEFORE this script.

//////////////////////////////
// Canvas
//////////////////////////////
const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

//////////////////////////////
// Hero animation frame URLs (class-aware)
// Uses global getHeroAnimUrls helper, falls back to Shieldmaiden frames.
//////////////////////////////
const HERO_IDLE_URLS: string[] =
  (window as any).getHeroAnimUrls?.("idle") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/sm_${i.toString().padStart(3, "0")}.png`
  );

const HERO_LEFT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("walkLeft") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/leftwalk_${i.toString().padStart(3, "0")}.png`
  );

const HERO_RIGHT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("walkRight") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/rightwalk_${i.toString().padStart(3, "0")}.png`
  );

// Attack frames (fall back to walk if class has no dedicated attack yet)
const HERO_ATK_LEFT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("attackLeft") ?? HERO_LEFT_URLS;

const HERO_ATK_RIGHT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("attackRight") ?? HERO_RIGHT_URLS;

//////////////////////////////
// Rune projectile animation
//////////////////////////////
const RUNE_PROJECTILE_URLS = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/rune-mage/projectiles/frame_${i
    .toString()
    .padStart(3, "0")}.png`
);

//////////////////////////////
// Assets / config
//////////////////////////////
const ASSETS = {
  bg: "/guildbook/maps/dreadheimperimeters.png",
  house: "/guildbook/props/dreadheimhouse.png",
} as const;

// Edge exits
const LEFT_EXIT_URL  = "/dreadheimmap.html";       // back to Forest Entrance
const RIGHT_EXIT_URL = "/dreadheimoutskirts.html"; // next area
const EXIT_MARGIN = 4;

// Walkway / physics
const WALKWAY_TOP_RATIO = 0.83;
const SPEED = 4;
const GRAVITY = 0.8;
const JUMP_VELOCITY = -16;
const HERO_W = 96;
const HERO_H = 125;

//////////////////////////////
// DPR & resize
//////////////////////////////
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

//////////////////////////////
// Load helper
//////////////////////////////
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
let houseImg: HTMLImageElement | null = null;

// Hero frames
let heroIdleFrames: HTMLImageElement[] = [];
let heroLeftFrames: HTMLImageElement[] = [];
let heroRightFrames: HTMLImageElement[] = [];
let heroAtkLeftFrames: HTMLImageElement[] = [];
let heroAtkRightFrames: HTMLImageElement[] = [];
let heroFallbackImg: HTMLImageElement | null = null;

// Rune frames
let runeFrames: HTMLImageElement[] = [];

//////////////////////////////
// World state
//////////////////////////////
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.max(
    0,
    Math.min(window.innerWidth - HERO_W, window.innerWidth / 2 - HERO_W / 2)
  ),
  y: groundY - HERO_H,
  w: HERO_W,
  h: HERO_H,
  vx: 0,
  vy: 0,
  onGround: true,
  anim: "idle" as "idle" | "walk" | "attack",
  facing: "right" as "left" | "right",
  frameIndex: 0,
};

const HERO_FRAME_MS = 100;
let lastHeroFrameTime = performance.now();

// Attack timing
const HERO_ATTACK_TOTAL_MS = 600;
let heroAttackElapsed = 0;

// Rune projectiles
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

// Time step
let lastStepTime = performance.now();

// Simple clickable house (no blocking walls)
const house = {
  x: 0,
  y: 0,
  w: 360,
  h: 340,
  url: "/dreadheimhouse.html",
};

function layoutHouse() {
  // center the house horizontally; rest on the walkway
  house.x = Math.round(window.innerWidth / 2 - house.w / 2);
  house.y = Math.round(groundY - house.h + 20);
}

function refreshBounds() {
  groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);
  const floor = groundY - hero.h;
  if (hero.y > floor) {
    hero.y = floor;
    hero.vy = 0;
    hero.onGround = true;
  }
  layoutHouse();
}
window.addEventListener("resize", refreshBounds);

//////////////////////////////
// Input
//////////////////////////////
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.key);
  if (
    (e.key === " " || e.key === "w" || e.key === "W" || e.key === "ArrowUp") &&
    hero.onGround
  ) {
    hero.vy = JUMP_VELOCITY;
    hero.onGround = false;
    e.preventDefault(); // keep space/up from scrolling the page
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key));

// Mouse: attack + rune projectile
canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // only left click

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

// Click-to-enter house (keep separate from mousedown so both work)
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (
    mx >= house.x &&
    mx <= house.x + house.w &&
    my >= house.y &&
    my <= house.y + house.h
  ) {
    fadeTo(0.3, () => (window.location.href = house.url));
  }
});

// Cursor hint when hovering house
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const over =
    mx >= house.x &&
    mx <= house.x + house.w &&
    my >= house.y &&
    my <= house.y + house.h;
  canvas.style.cursor = over ? "pointer" : "default";
});

//////////////////////////////
// Rune helpers
//////////////////////////////
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

//////////////////////////////
// Fade + warp
//////////////////////////////
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

//////////////////////////////
// Hero frame picker
//////////////////////////////
function getHeroFrameList(): HTMLImageElement[] {
  if (hero.anim === "attack") {
    return hero.facing === "left" ? heroAtkLeftFrames : heroAtkRightFrames;
  }
  if (hero.anim === "walk") {
    return hero.facing === "left" ? heroLeftFrames : heroRightFrames;
  }
  return heroIdleFrames;
}

//////////////////////////////
// Update
//////////////////////////////
function step() {
  const nowStep = performance.now();
  const dt = nowStep - lastStepTime;
  lastStepTime = nowStep;

  // Movement intent
  let vx = 0;
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) {
    vx -= SPEED;
    if (hero.anim !== "attack") hero.anim = "walk";
    hero.facing = "left";
  }
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) {
    vx += SPEED;
    if (hero.anim !== "attack") hero.anim = "walk";
    hero.facing = "right";
  }
  if (vx === 0 && hero.anim !== "attack") hero.anim = "idle";
  hero.vx = vx;

  // Hero animation timing
  const frames = getHeroFrameList();
  if (frames.length && nowStep - lastHeroFrameTime >= HERO_FRAME_MS) {
    lastHeroFrameTime = nowStep;
    hero.frameIndex = (hero.frameIndex + 1) % frames.length;
  }

  // Attack duration
  if (hero.anim === "attack") {
    heroAttackElapsed += dt;
    const atkFrames =
      hero.facing === "left" ? heroAtkLeftFrames : heroAtkRightFrames;
    if (!atkFrames.length || heroAttackElapsed >= HERO_ATTACK_TOTAL_MS) {
      heroAttackElapsed = 0;
      hero.frameIndex = 0;
      hero.anim = vx !== 0 ? "walk" : "idle";
    }
  }

  // Edge exits (pressing into the wall)
  if (hero.x <= EXIT_MARGIN && vx < 0) {
    warpTo(LEFT_EXIT_URL);
    return;
  }
  if (hero.x + hero.w >= window.innerWidth - EXIT_MARGIN && vx > 0) {
    warpTo(RIGHT_EXIT_URL);
    return;
  }

  // Apply horizontal + clamp
  hero.x += hero.vx;
  if (hero.x < 0) hero.x = 0;
  const maxHX = window.innerWidth - hero.w;
  if (hero.x > maxHX) hero.x = maxHX;

  // Gravity + ground
  hero.vy += GRAVITY;
  hero.y += hero.vy;
  const floor = groundY - hero.h;
  if (hero.y >= floor) {
    hero.y = floor;
    hero.vy = 0;
    hero.onGround = true;
  }

  // Rune projectile frame animation
  if (runeProjectiles.length && nowStep - lastRuneFrameTime >= RUNE_FRAME_MS) {
    lastRuneFrameTime = nowStep;
    for (const p of runeProjectiles) {
      p.frame = (p.frame + 1) % Math.max(1, runeFrames.length);
    }
  }

  // Rune projectile movement & lifetime (no collisions here; purely cosmetic)
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

    if (p.life <= 0 || offscreen) {
      runeProjectiles.splice(i, 1);
    }
  }
}

//////////////////////////////
// Render
//////////////////////////////
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // House (behind hero)
  if (houseImg) ctx.drawImage(houseImg, house.x, house.y, house.w, house.h);

  // Hero
  const frames = getHeroFrameList();
  const img =
    frames.length ? frames[hero.frameIndex % frames.length] : heroFallbackImg;

  if (img) {
    ctx.drawImage(img, hero.x, hero.y, hero.w, hero.h);
  } else {
    ctx.fillStyle = "#333";
    ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  }

  // Rune projectiles
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

function loop() {
  step();
  render();
  requestAnimationFrame(loop);
}

//////////////////////////////
// Quest arrival hook (travel completion → wizard active)
//////////////////////////////
function handleArrivalQuestProgress() {
  // only complete travel if the previous page marked it
  let hadPending = false;
  try {
    if (localStorage.getItem("va_pending_travel") === "1") {
      localStorage.removeItem("va_pending_travel");
      hadPending = true;
    }
  } catch {}

  const VAQ = (window as any).VAQ;
  if (!VAQ) return;

  try {
    VAQ.ensureQuestState?.();

    const race = (localStorage.getItem("va_race") || "").toLowerCase();

    // If we arrived via Travel and we're on the Dreadheim path, finish travel now
    if (hadPending && race === "dreadheim") {
      VAQ.complete?.("q_travel_home");
    }

    // Ensure the wizard quest is active if not completed yet
    const qs = (VAQ.readQuests?.() as any[]) || [];
    const qWiz = qs.find((q) => q.id === "q_find_dreadheim_wizard");
    if (qWiz && qWiz.status !== "completed") {
      VAQ.setActive?.("q_find_dreadheim_wizard");
    }

    VAQ.renderHUD?.();
  } catch (e) {
    console.warn("Perimeters quest arrival hook failed:", e);
  }
}

//////////////////////////////
// Boot
//////////////////////////////
Promise.all(
  [
    ASSETS.bg,
    ASSETS.house,
    ...HERO_IDLE_URLS,
    ...HERO_LEFT_URLS,
    ...HERO_RIGHT_URLS,
    ...HERO_ATK_LEFT_URLS,
    ...HERO_ATK_RIGHT_URLS,
    ...RUNE_PROJECTILE_URLS,
  ].map(load)
)
  .then((imgs) => {
    let idx = 0;

    bg = imgs[idx++];
    houseImg = imgs[idx++];

    // Hero frames
    const idleCount = HERO_IDLE_URLS.length;
    const leftCount = HERO_LEFT_URLS.length;
    const rightCount = HERO_RIGHT_URLS.length;
    const atkLeftCount = HERO_ATK_LEFT_URLS.length;
    const atkRightCount = HERO_ATK_RIGHT_URLS.length;

    const heroTotal =
      idleCount + leftCount + rightCount + atkLeftCount + atkRightCount;

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

    // Rune frames
    runeFrames = imgs.slice(idx, idx + RUNE_PROJECTILE_URLS.length);
    idx += RUNE_PROJECTILE_URLS.length;

    heroFallbackImg = heroIdleFrames[0] || null;

    refreshBounds();
    layoutHouse();

    handleArrivalQuestProgress();

    loop();
  })
  .catch((err) => {
    console.warn("Perimeters asset load error:", err);
    try {
      handleArrivalQuestProgress();
    } catch {}
    refreshBounds();
    layoutHouse();
    loop();
  });





