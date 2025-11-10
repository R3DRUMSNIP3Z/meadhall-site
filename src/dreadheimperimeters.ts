// --- Dreadheim • Perimeters (overworld transition) ---
import { Inventory } from "./inventory";
Inventory.init();
// Auto-clear the bag badge after opening inventory
(() => {
  const invAny = Inventory as any;
  const origOpen = invAny.open?.bind(Inventory);
  if (origOpen) {
    invAny.open = (...args: any[]) => {
      const r = origOpen(...args);
      const badge = document.querySelector<HTMLElement>("#vaBagBadge, .bag-badge, .inventory-badge");
      if (badge) { badge.textContent = ""; badge.style.display = "none"; }
      return r;
    };
  }
})();


const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// ===== CONFIG =====
const ASSETS = {
  bg:   "/guildbook/maps/dreadheimperimeters.png", // <-- put the PNG here
  hero: "/guildbook/avatars/dreadheim-warrior.png",
};

// Edge exits
const LEFT_EXIT_URL  = "/dreadheimmap.html";        // back to Forest Entrance
const RIGHT_EXIT_URL = "/dreadheimoutskirts.html";  // next area (rename later if needed)
const EXIT_MARGIN = 4;

// Walkway / physics
const WALKWAY_TOP_RATIO = 0.83;
const SPEED = 4;
const GRAVITY = 0.8;
const JUMP_VELOCITY = -16;
const HERO_W = 96, HERO_H = 96;

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
let heroImg: HTMLImageElement | null = null;

// ===== World state =====
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.max(0, Math.min(window.innerWidth - HERO_W, window.innerWidth / 2 - HERO_W / 2)),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
  vx: 0, vy: 0,
  onGround: true,
};

function refreshBounds() {
  groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);
  const floor = groundY - hero.h;
  if (hero.y > floor) { hero.y = floor; hero.vy = 0; hero.onGround = true; }
}
window.addEventListener("resize", refreshBounds);

// ===== Input =====
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.key);
  if ((e.key === " " || e.key === "w" || e.key === "W" || e.key === "ArrowUp") && hero.onGround) {
    hero.vy = JUMP_VELOCITY;
    hero.onGround = false;
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key));

// ===== Fade + warp =====
let transitioning = false;
function fadeTo(seconds = 0.25, after?: () => void) {
  const f = document.createElement("div");
  Object.assign(f.style, {
    position: "fixed", inset: "0",
    background: "black", opacity: "0",
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

// ===== Update =====
function step() {
  // Movement intent
  let vx = 0;
  if (keys.has("ArrowLeft")  || keys.has("a") || keys.has("A")) vx -= SPEED;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) vx += SPEED;
  hero.vx = vx;

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
}

// ===== Render =====
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  else { ctx.fillStyle = "#333"; ctx.fillRect(hero.x, hero.y, hero.w, hero.h); }
}

function loop() { step(); render(); requestAnimationFrame(loop); }

// ===== Boot =====
Promise.all([load(ASSETS.bg), load(ASSETS.hero)])
  .then(([b, h]) => { bg = b; heroImg = h; refreshBounds(); loop(); })
  .catch(() => { refreshBounds(); loop(); });
