// /src/dreadheimoutskirts.ts
// Dreadheim • Outskirts (animated hero + witch hut, clickable door → interior)
// Requires /src/global-game-setup.ts to set va_gender BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context not available");

/* =========================================================
   GENDER + HERO PREFIX
   ========================================================= */

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

// only need idle + walk here (faster load)
const ANIMS_FOR_THIS_MAP: HeroAnimName[] = ["idle", "walk"];

const ASSETS = {
  ground: "/guildbook/maps/witchy-ground.png",
  hut: "/guildbook/props/witch-hut.png",
};

const HOUSE_URL = "/dreadheimhouse.html";

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

const HERO_W = 150;
const HERO_H = 150;
const HERO_SPEED = 2.8;

let heroX = 100;
let heroY = 100;
let heroFacing: 1 | -1 = 1;

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

function pickHeroActionFromInput(): HeroAnimName {
  const moving =
    keys["ArrowLeft"] || keys["a"] || keys["A"] ||
    keys["ArrowRight"] || keys["d"] || keys["D"] ||
    keys["ArrowUp"] || keys["w"] || keys["W"] ||
    keys["ArrowDown"] || keys["s"] || keys["S"];

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
   RESIZE
   ========================================================= */

function resizeCanvas() {
  canvas!.width = window.innerWidth;
  canvas!.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* =========================================================
   GROUND + HUT + DOOR RECT
   ========================================================= */

let groundImg: HTMLImageElement | null = null;
let groundPattern: CanvasPattern | null = null;

let hutImg: HTMLImageElement | null = null;
const HUT_SCALE = 0.55;

// full hut rect (for drawing & depth)
const hutRectFull = { x: 0, y: 0, w: 0, h: 0 };

// clickable door rect (inside the hut)
const doorRect = { x: 0, y: 0, w: 0, h: 0 };

/* =========================================================
   CLICK HANDLER FOR DOOR
   ========================================================= */

canvas!.addEventListener("click", (ev) => {
  const rect = canvas!.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;

  if (
    mx >= doorRect.x &&
    mx <= doorRect.x + doorRect.w &&
    my >= doorRect.y &&
    my <= doorRect.y + doorRect.h
  ) {
    warpTo(HOUSE_URL);
  }
});

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

  // --- compute hut rect (centered) ---
  if (hutImg) {
    const rawW = hutImg.width;
    const rawH = hutImg.height;
    const drawW = rawW * HUT_SCALE;
    const drawH = rawH * HUT_SCALE;

    hutRectFull.x = (cw - drawW) / 2;
    hutRectFull.y = (ch - drawH) / 2 + 40;
    hutRectFull.w = drawW;
    hutRectFull.h = drawH;

    // --- compute door rect inside hut ---
    // tuned for your hut: centered, bottom half-ish
    const DOOR_WIDTH_RATIO  = 0.18; // fraction of hut width
    const DOOR_HEIGHT_RATIO = 0.45; // fraction of hut height
    const DOOR_CENTER_X_RATIO = 0.5; // middle of hut
    const DOOR_TOP_RATIO = 0.55;     // start a bit above the base

    const doorW = drawW * DOOR_WIDTH_RATIO;
    const doorH = drawH * DOOR_HEIGHT_RATIO;
    const doorCenterX = hutRectFull.x + drawW * DOOR_CENTER_X_RATIO;

    doorRect.x = doorCenterX - doorW / 2;
    doorRect.y = hutRectFull.y + drawH * DOOR_TOP_RATIO;
    doorRect.w = doorW;
    doorRect.h = doorH;
  } else {
    hutRectFull.x = hutRectFull.y = hutRectFull.w = hutRectFull.h = 0;
    doorRect.x = doorRect.y = doorRect.w = doorRect.h = 0;
  }

  // --- movement (no collision walls) ---
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

    heroX += stepX;
    heroY += stepY;

    if (stepX < 0) heroFacing = -1;
    if (stepX > 0) heroFacing = 1;
  }

  // clamp inside screen
  if (heroX < 0) heroX = 0;
  if (heroX + HERO_W > cw) heroX = cw - HERO_W;
  if (heroY < 0) heroY = 0;
  if (heroY + HERO_H > ch) heroY = ch - HERO_H;

  // exit on left edge
  if (heroX <= EXIT_MARGIN) {
    warpTo(LEFT_EXIT_URL);
  }

  // update anim
  updateHeroAnimation(dt);

  // --- draw ---
  ctx!.clearRect(0, 0, cw, ch);
  ctx!.imageSmoothingEnabled = false;

  // ground
  ctx!.fillStyle = groundPattern!;
  ctx!.fillRect(0, 0, cw, ch);

  const frame = getCurrentHeroFrame();

  if (hutImg && hutRectFull.w > 0 && hutRectFull.h > 0 && frame) {
    const heroFeetY = heroY + HERO_H;
    const hutMidY = hutRectFull.y + hutRectFull.h * 0.5;

    if (heroFeetY < hutMidY) {
      // hero "behind" hut → draw hero, then hut
      ctx!.save();
      ctx!.translate(heroX + HERO_W / 2, heroY);
      if (heroFacing === -1) ctx!.scale(-1, 1);
      ctx!.drawImage(frame, -HERO_W / 2, 0, HERO_W, HERO_H);
      ctx!.restore();

      ctx!.drawImage(
        hutImg,
        hutRectFull.x,
        hutRectFull.y,
        hutRectFull.w,
        hutRectFull.h
      );
    } else {
      // hero in front → draw hut, then hero
      ctx!.drawImage(
        hutImg,
        hutRectFull.x,
        hutRectFull.y,
        hutRectFull.w,
        hutRectFull.h
      );

      ctx!.save();
      ctx!.translate(heroX + HERO_W / 2, heroY);
      if (heroFacing === -1) ctx!.scale(-1, 1);
      ctx!.drawImage(frame, -HERO_W / 2, 0, HERO_W, HERO_H);
      ctx!.restore();
    }

    // OPTIONAL: door debug box — uncomment if you want to see the hotspot
    /*
    ctx!.strokeStyle = "rgba(0, 200, 255, 0.9)";
    ctx!.lineWidth = 2;
    ctx!.strokeRect(doorRect.x, doorRect.y, doorRect.w, doorRect.h);
    */
  } else {
    // fallback: just hero if hut missing
    if (frame) {
      ctx!.save();
      ctx!.translate(heroX + HERO_W / 2, heroY);
      if (heroFacing === -1) ctx!.scale(-1, 1);
      ctx!.drawImage(frame, -HERO_W / 2, 0, HERO_W, HERO_H);
      ctx!.restore();
    }
  }

  requestAnimationFrame(step);
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */

async function loadHeroAnimations(): Promise<void> {
  const entries = ANIMS_FOR_THIS_MAP.map(
    (name) => [name, HERO_ANIM_SPECS[name]] as [HeroAnimName, { suffix: string; count: number }]
  );

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

    // Start hero in bottom-left corner
    const MARGIN_X = 40;
    const MARGIN_Y = 40;
    heroX = MARGIN_X;
    heroY = canvas!.height - HERO_H - MARGIN_Y;

    requestAnimationFrame(step);
  } catch (err) {
    console.error("Failed to load Dreadheim Outskirts assets:", err);
  }
}

init();

export {};









