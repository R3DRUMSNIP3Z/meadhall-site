// /src/dreadheimoutskirts.ts
// Dreadheim • Outskirts (animated viking on swamp ground)
// Requires /src/global-game-setup.ts to be loaded BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context not available");

/* =========================================================
   ASSETS
   ========================================================= */

// Base URL for all viking frames
const HERO_SPRITE_BASE = "/guildbook/avatars/";

// Every anim = 10 frames: 000–009
type HeroAnimName = "idle" | "walk" | "run" | "attack" | "hurt" | "die" | "jump";

const HERO_ANIM_SPECS: Record<HeroAnimName, { prefix: string; count: number }> = {
  idle:   { prefix: "Viking_01__IDLE_",   count: 10 },
  walk:   { prefix: "Viking_01__WALK_",   count: 10 },
  run:    { prefix: "Viking_01__RUN_",    count: 10 },
  attack: { prefix: "Viking_01__ATTACK_", count: 10 },
  hurt:   { prefix: "Viking_01__HURT_",   count: 10 },
  die:    { prefix: "Viking_01__DIE_",    count: 10 },
  jump:   { prefix: "Viking_01__JUMP_",   count: 10 },
};

// Swamp ground tile
const ASSETS = {
  ground: "/guildbook/maps/witchy-swamp-ground.png",
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

const HERO_W = 64;
const HERO_H = 80;
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
   GROUND
   ========================================================= */

let groundImg: HTMLImageElement | null = null;
let groundPattern: CanvasPattern | null = null;

/* =========================================================
   ANIM HELPERS
   ========================================================= */

function pickHeroActionFromInput(): HeroAnimName {
  const moving =
    keys["ArrowLeft"] || keys["a"] || keys["A"] ||
    keys["ArrowRight"] || keys["d"] || keys["D"] ||
    keys["ArrowUp"] || keys["w"] || keys["W"] ||
    keys["ArrowDown"] || keys["s"] || keys["S"];

  // For now: idle vs walk. We can switch to run/attack later.
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

  let dx = 0;
  let dy = 0;

  if (keys["ArrowLeft"] || keys["a"] || keys["A"]) dx -= 1;
  if (keys["ArrowRight"] || keys["d"] || keys["D"]) dx += 1;
  if (keys["ArrowUp"] || keys["w"] || keys["W"]) dy -= 1;
  if (keys["ArrowDown"] || keys["s"] || keys["S"]) dy += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    heroX += dx * HERO_SPEED;
    heroY += dy * HERO_SPEED;

    if (dx < 0) heroFacing = -1;
    if (dx > 0) heroFacing = 1;
  }

  // Clamp hero inside screen
  if (heroX < 0) heroX = 0;
  if (heroX + HERO_W > cw) heroX = cw - HERO_W;
  if (heroY < 0) heroY = 0;
  if (heroY + HERO_H > ch) heroY = ch - HERO_H;

  // Exit to perimeters
  if (heroX <= EXIT_MARGIN) {
    warpTo(LEFT_EXIT_URL);
  }

  // Update animation state
  updateHeroAnimation(dt);

  // Draw
  ctx!.clearRect(0, 0, cw, ch);
  ctx!.imageSmoothingEnabled = false;

  // Tile swamp ground over full screen
  ctx!.fillStyle = groundPattern!;
  ctx!.fillRect(0, 0, cw, ch);

  const frame = getCurrentHeroFrame();
  if (frame) {
    ctx!.save();
    ctx!.translate(heroX + HERO_W / 2, heroY); // pivot for flip

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
    [HeroAnimName, { prefix: string; count: number }][];
  for (const [name, spec] of entries) {
    const frames: HTMLImageElement[] = [];
    for (let i = 0; i < spec.count; i++) {
      const indexStr = i.toString().padStart(3, "0"); // 000–009
      const path = `${HERO_SPRITE_BASE}${spec.prefix}${indexStr}.png`;
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
    const [ground] = await Promise.all([
      loadImage(ASSETS.ground),
    ]);

    groundImg = ground;
    groundPattern = ctx!.createPattern(groundImg, "repeat");

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


