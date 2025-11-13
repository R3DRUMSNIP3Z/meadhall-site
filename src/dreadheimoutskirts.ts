// /src/dreadheimoutskirts.ts
// Dreadheim • Outskirts (animated hero on witchy ground + solid witch hut)
// Requires /src/global-game-setup.ts to set va_gender BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context not available");

/* =========================================================
   GENDER + HERO PREFIX
   ========================================================= */

// Read gender from localStorage (default to male)
const g = localStorage.getItem("va_gender");
const HERO_PREFIX_ROOT = g === "female" ? "Warrior_01__" : "Viking_01__";

/* =========================================================
   ASSETS
   ========================================================= */

type HeroAnimName = "idle" | "walk" | "run" | "attack" | "hurt" | "die" | "jump";

const HERO_ANIM_SPECS: Record<HeroAnimName, { suffix: string; count: number }> = {
  idle:   { suffix: "IDLE_",   count: 10 },
  walk:   { suffix: "WALK_",   count: 10 },
  run:    { suffix: "RUN_",    count: 10 },
  attack: { suffix: "ATTACK_", count: 10 },
  hurt:   { suffix: "HURT_",   count: 10 },
  die:    { suffix: "DIE_",    count: 10 },
  jump:   { suffix: "JUMP_",   count: 10 },
};

// Witchy ground tile + hut
const ASSETS = {
  ground: "/guildbook/maps/witchy-ground.png",
  hut: "/guildbook/props/witch-hut.png",
};

/* =========================================================
   HELPERS
   ========================================================= */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// simple AABB overlap
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    ax < b.x + b.w &&
    ax + aw > b.x &&
    ay < b.y + b.h &&
    ay + ah > b.y
  );
}

/* =========================================================
   EXITS / WARP
   ========================================================= */

const LEFT_EXIT_URL = "/dreadheimperimeters.html";
const EXIT_MARGIN = 4;

let isWarping = false;

function fadeTo(seconds: number, after?: () => void) {
  const f = document.createElement("div");
  Object.assign(f.style, {
    position: "fixed",
    inset: "0",
    background: "#000",
    opacity: "0",
    pointerEvents: "none",
    transition: `opacity ${seconds}s ease-out`,
    zIndex: "9999",
  } as CSSStyleDeclaration);
  document.body.appendChild(f);
  requestAnimationFrame(() => {
    f.style.opacity = "1";
  });
  setTimeout(() => {
    after && after();
  }, seconds * 1000 + 50);
}

function warpTo(url: string) {
  if (isWarping) return;
  isWarping = true;
  fadeTo(0.35, () => {
    window.location.href = url;
  });
}

/* =========================================================
   HERO + MOVEMENT + ANIMATION
   ========================================================= */

const HERO_W = 150;
const HERO_H = 150;

const HERO_SPEED = 2.8;

let heroX = 100;
let heroY = 100;
let heroFacing: 1 | -1 = 1; // 1 = right, -1 = left

const keys: Record<string, boolean> = {};

window.addEventListener("keydown", (ev) => {
  keys[ev.key] = true;
});

window.addEventListener("keyup", (ev) => {
  keys[ev.key] = false;
});

type HeroAnimations = Record<HeroAnimName, HTMLImageElement[]>;
const heroAnims: HeroAnimations = {
  idle: [], walk: [], run: [], attack: [], hurt: [], die: [], jump: [],
};

type HeroAnimState = {
  action: HeroAnimName;
  frameIndex: number;
  frameTimeMs: number;
};

const heroAnimState: HeroAnimState = {
  action: "idle",
  frameIndex: 0,
  frameTimeMs: 0,
};

const FRAME_DURATION_MS = 90;

/* =========================================================
   RESIZE
   ========================================================= */

function resizeCanvas() {
  canvas!.width = window.innerWidth;
  canvas!.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* =========================================================
   GROUND + HUT
   ========================================================= */

let groundImg: HTMLImageElement | null = null;
let groundPattern: CanvasPattern | null = null;

let hutImg: HTMLImageElement | null = null;
const HUT_SCALE = 0.55;

// collision box for the WHOLE hut
const hutRect = { x: 0, y: 0, w: 0, h: 0 };

/* =========================================================
   ANIMATION HELPERS
   ========================================================= */

function pickHeroActionFromInput(): HeroAnimName {
  const moving =
    keys["ArrowLeft"] || keys["a"] || keys["A"] ||
    keys["ArrowRight"] || keys["d"] || keys["D"] ||
    keys["ArrowUp"] || keys["w"] || keys["W"] ||
    keys["ArrowDown"] || keys["s"] || keys["S"];

  // For now: idle vs walk (we can hook run/attack later)
  return moving ? "walk" : "idle";
}

function updateHeroAnimation(dtMs: number) {
  const desired = pickHeroActionFromInput();

  if (heroAnimState.action !== desired) {
    heroAnimState.action = desired;
    heroAnimState.frameIndex = 0;
    heroAnimState.frameTimeMs = 0;
  }

  const frames = heroAnims[heroAnimState.action];
  if (!frames || frames.length === 0) return;

  heroAnimState.frameTimeMs += dtMs;
  while (heroAnimState.frameTimeMs >= FRAME_DURATION_MS) {
    heroAnimState.frameTimeMs -= FRAME_DURATION_MS;
    heroAnimState.frameIndex =
      (heroAnimState.frameIndex + 1) % frames.length;
  }
}

function getCurrentHeroFrame(): HTMLImageElement | null {
  const frames = heroAnims[heroAnimState.action];
  if (!frames || frames.length === 0) return null;
  return frames[heroAnimState.frameIndex] || frames[0];
}

/* =========================================================
   MAIN LOOP
   ========================================================= */

let started = false;
let lastTs = 0;

function step(ts: number) {
  if (!groundPattern || heroAnims.idle.length === 0) {
    requestAnimationFrame(step);
    return;
  }

  const dt = lastTs ? ts - lastTs : 16;
  lastTs = ts;

  const cw = canvas!.width;
  const ch = canvas!.height;

  /* ---------- compute hut rect (center of screen) ---------- */
  if (hutImg) {
    const rawW = hutImg.width;
    const rawH = hutImg.height;
    const drawW = rawW * HUT_SCALE;
    const drawH = rawH * HUT_SCALE;

    hutRect.x = (cw - drawW) / 2;
    hutRect.y = (ch - drawH) / 2 + 40;
    hutRect.w = drawW;
    hutRect.h = drawH;
  } else {
    hutRect.x = hutRect.y = hutRect.w = hutRect.h = 0;
  }

  /* ---------- movement + collision ---------- */

  let dx = 0;
  let dy = 0;

  if (keys["ArrowLeft"] || keys["a"] || keys["A"]) dx -= 1;
  if (keys["ArrowRight"] || keys["d"] || keys["D"]) dx += 1;
  if (keys["ArrowUp"] || keys["w"] || keys["W"]) dy -= 1;
  if (keys["ArrowDown"] || keys["s"] || keys["S"]) dy += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    const stepX = (dx / len) * HERO_SPEED;
    const stepY = (dy / len) * HERO_SPEED;

    // try X movement
    let nextX = heroX + stepX;
    if (!rectsOverlap(nextX, heroY, HERO_W, HERO_H, hutRect)) {
      heroX = nextX;
    }

    // try Y movement
    let nextY = heroY + stepY;
    if (!rectsOverlap(heroX, nextY, HERO_W, HERO_H, hutRect)) {
      heroY = nextY;
    }

    if (stepX < 0) heroFacing = -1;
    if (stepX > 0) heroFacing = 1;
  }

  // Clamp hero inside screen AFTER collision
  if (heroX < 0) heroX = 0;
  if (heroX + HERO_W > cw) heroX = cw - HERO_W;
  if (heroY < 0) heroY = 0;
  if (heroY + HERO_H > ch) heroY = ch - HERO_H;

  // Exit on left edge
  if (heroX <= EXIT_MARGIN) {
    warpTo(LEFT_EXIT_URL);
  }

  // Update animation
  updateHeroAnimation(dt);

  /* ---------- draw ---------- */

  ctx!.clearRect(0, 0, cw, ch);
  ctx!.imageSmoothingEnabled = false;

  // tile ground
  ctx!.fillStyle = groundPattern!;
  ctx!.fillRect(0, 0, cw, ch);

  // hut
  if (hutImg && hutRect.w > 0 && hutRect.h > 0) {
    ctx!.drawImage(hutImg, hutRect.x, hutRect.y, hutRect.w, hutRect.h);
  }

  // hero
  const frame = getCurrentHeroFrame();
  if (frame) {
    ctx!.save();
    ctx!.translate(heroX + HERO_W / 2, heroY);

    if (heroFacing === -1) {
      ctx!.scale(-1, 1);
    }

    ctx!.drawImage(frame, -HERO_W / 2, 0, HERO_W, HERO_H);
    ctx!.restore();
  }

  requestAnimationFrame(step);
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */

async function loadHeroAnimations(): Promise<void> {
  const entries = Object.entries(HERO_ANIM_SPECS) as
    [HeroAnimName, { suffix: string; count: number }][];
  for (const [name, spec] of entries) {
    const frames: HTMLImageElement[] = [];
    for (let i = 0; i < spec.count; i++) {
      const indexStr = i.toString().padStart(3, "0");
      const path = `/guildbook/avatars/${HERO_PREFIX_ROOT}${spec.suffix}${indexStr}.png`;

      try {
        const img = await loadImage(path);
        frames.push(img);
      } catch {
        console.warn("Missing frame for", name, path);
      }
    }
    heroAnims[name] = frames;
  }
}

async function init() {
  if (started) return;
  started = true;

  try {
    const [ground, hut] = await Promise.all([
      loadImage(ASSETS.ground),
      loadImage(ASSETS.hut),
    ]);

    groundImg = ground;
    groundPattern = ctx!.createPattern(groundImg, "repeat");
    hutImg = hut;

    await loadHeroAnimations();

    // Start hero centered
    heroX = (canvas!.width - HERO_W) / 2;
    heroY = (canvas!.height - HERO_H) / 2;

    requestAnimationFrame(step);
  } catch (err) {
    console.error("Failed to load Dreadheim Outskirts assets:", err);
  }
}

init();

export {};





