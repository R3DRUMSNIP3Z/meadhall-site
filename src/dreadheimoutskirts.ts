// /src/dreadheimoutskirts.ts
// --- Dreadheim • Outskirts (witchy tiled ground only) ---
// Requires /src/global-game-setup.ts to be loaded BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context not available");

/* =========================================================
   ASSETS
   ========================================================= */
const ASSETS = {
  // Mossy cobblestone ground tile (seamless)
  ground: "/guildbook/maps/witchy-ground.png",

  // Universal hero sprite (comes from global-game-setup.ts)
  hero: (() => {
    const pick = (window as any).getHeroSprite as undefined | (() => string);
    if (typeof pick === "function") return pick();
    const g = localStorage.getItem("va_gender");
    return g === "female"
      ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
      : "/guildbook/avatars/dreadheim-warrior.png";
  })(),
};

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
const EXIT_MARGIN = 4; // pixels from screen edge to trigger warp

let isWarping = false;

function fadeTo(seconds = 0.35, after?: () => void) {
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
   HERO + MOVEMENT
   ========================================================= */
const HERO_W = 48;
const HERO_H = 64;
const HERO_SPEED = 2.4;

let heroX = 100;
let heroY = 100;

const keys: Record<string, boolean> = {};

window.addEventListener("keydown", (ev) => {
  keys[ev.key] = true;
});

window.addEventListener("keyup", (ev) => {
  keys[ev.key] = false;
});

/* =========================================================
   RESIZE HANDLING
   ========================================================= */
function resizeCanvas() {
  canvas!.width = window.innerWidth;
  canvas!.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* =========================================================
   IMAGES / PATTERN
   ========================================================= */
let heroImg: HTMLImageElement | null = null;
let groundImg: HTMLImageElement | null = null;
let groundPattern: CanvasPattern | null = null;

// Height of the walkable strip at the bottom
const GROUND_HEIGHT = 200;

/* =========================================================
   MAIN LOOP
   ========================================================= */
let started = false;

function step() {
  if (!heroImg || !groundPattern) {
    requestAnimationFrame(step);
    return;
  }

  const cw = canvas!.width;
  const ch = canvas!.height;

  // Movement
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
  }

  // Clamp hero inside screen and on top of ground
  const groundTop = ch - GROUND_HEIGHT;

  if (heroX < 0) heroX = 0;
  if (heroX + HERO_W > cw) heroX = cw - HERO_W;

  if (heroY < groundTop - 40) heroY = groundTop - 40; // don’t float too high
  if (heroY + HERO_H > ch) heroY = ch - HERO_H;

  // Exits
  if (heroX <= EXIT_MARGIN) {
    warpTo(LEFT_EXIT_URL);
  }

  // Draw
  ctx!.clearRect(0, 0, cw, ch);
  ctx!.imageSmoothingEnabled = false;

  // Simple black background for now
  ctx!.fillStyle = "#000000";
  ctx!.fillRect(0, 0, cw, ch);

  // Ground at bottom using repeating pattern
  ctx!.fillStyle = groundPattern;
  ctx!.fillRect(0, ch - GROUND_HEIGHT, cw, GROUND_HEIGHT);

  // Hero
  ctx!.drawImage(heroImg, heroX, heroY, HERO_W, HERO_H);

  requestAnimationFrame(step);
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */
async function init() {
  if (started) return;
  started = true;

  try {
    const [hero, ground] = await Promise.all([
      loadImage(ASSETS.hero),
      loadImage(ASSETS.ground),
    ]);

    heroImg = hero;
    groundImg = ground;

    groundPattern = ctx!.createPattern(groundImg, "repeat");

    // Start hero roughly above the ground, centered
    heroX = (canvas!.width - HERO_W) / 2;
    heroY = canvas!.height - GROUND_HEIGHT - HERO_H + 20;

    requestAnimationFrame(step);
  } catch (err) {
    console.error("Failed to load Dreadheim Outskirts assets:", err);
  }
}

init();

// Treat file as a module
export {};

