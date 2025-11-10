// --- Dreadheim • Perimeters (overworld transition) ---
// Requires: /src/global-game-setup.ts to be loaded BEFORE this script.

const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

// ===== CONFIG =====
// ===== CONFIG =====
const ASSETS = {
  bg: "/guildbook/maps/dreadheimperimeters.png",
  house: "/guildbook/props/dreadheimhouse.png", // ⬅️ new
  hero: (() => {
    const pick = (window as any).getHeroSprite as undefined | (() => string);
    if (typeof pick === "function") return pick();
    const g = localStorage.getItem("va_gender");
    return g === "female"
      ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
      : "/guildbook/avatars/dreadheim-warrior.png";
  })(),
};


// Edge exits
const LEFT_EXIT_URL  = "/dreadheimmap.html";       // back to Forest Entrance
const RIGHT_EXIT_URL = "/dreadheimoutskirts.html"; // next area
const EXIT_MARGIN = 4;

// ----- House placement (relative to viewport) -----
// Tuned to your red mark: center-ish, slightly right, on the walkway.
const HOUSE_W_RATIO = 0.28;        // 28% of viewport width
const HOUSE_CENTER_X_RATIO = 0.52; // ~center-right
const HOUSE_FLOOR_OFFSET = 4;      // small sink into ground for realism
const HOUSE_URL = "/dreadheimhouse.html";

// Door rectangle as a fraction of the drawn house box (tuned by eye)
const DOOR_W_RATIO = 0.16;
const DOOR_H_RATIO = 0.32;
const DOOR_CENTER_X_RATIO = 0.50;


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
let houseImg: HTMLImageElement | null = null; // ⬅️ new
let heroImg: HTMLImageElement | null = null;


// ===== World state =====
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);
// Calculated each frame after resize + image loads
const houseRect = { x: 0, y: 0, w: 0, h: 0 };
const doorRect  = { x: 0, y: 0, w: 0, h: 0 };

function layoutHouse() {
  if (!houseImg) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ground = Math.round(vh * WALKWAY_TOP_RATIO);

  const houseW = Math.round(vw * HOUSE_W_RATIO);
  const houseH = Math.round(houseW * (houseImg.naturalHeight / houseImg.naturalWidth));
  const cx = Math.round(vw * HOUSE_CENTER_X_RATIO);

  houseRect.w = houseW;
  houseRect.h = houseH;
  houseRect.x = Math.round(cx - houseW / 2);
  houseRect.y = ground - houseH + HOUSE_FLOOR_OFFSET;

  // Door in local space of the house
  doorRect.w = Math.round(houseW * DOOR_W_RATIO);
  doorRect.h = Math.round(houseH * DOOR_H_RATIO);
  doorRect.x = Math.round(houseRect.x + houseW * DOOR_CENTER_X_RATIO - doorRect.w / 2);
  doorRect.y = Math.round(houseRect.y + houseH - doorRect.h - 2);
}


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
    layoutHouse();

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
// --- Step #7: Click/tap the door to enter ---
canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  // DoorRect was defined earlier; compare against CSS pixels
  if (
    x >= doorRect.x &&
    x <= doorRect.x + doorRect.w &&
    y >= doorRect.y &&
    y <= doorRect.y + doorRect.h
  ) {
    warpTo(HOUSE_URL);
  }
});


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
  if (hero.x <= EXIT_MARGIN && vx < 0) { warpTo(LEFT_EXIT_URL); return; }
  if (hero.x + hero.w >= window.innerWidth - EXIT_MARGIN && vx > 0) { warpTo(RIGHT_EXIT_URL); return; }

  // Apply horizontal + clamp
  hero.x += hero.vx;
  if (hero.x < 0) hero.x = 0;
  const maxHX = window.innerWidth - hero.w;
  if (hero.x > maxHX) hero.x = maxHX;
    // --- House collision (block walls; leave door open) ---
  // Axis-aligned rect helpers
  const intersects = (a:{x:number;y:number;w:number;h:number}, b:{x:number;y:number;w:number;h:number}) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const heroRect = { x: hero.x, y: hero.y, w: hero.w, h: hero.h };

  // "Solid" part of the house footprint (everything except a vertical door gap).
  const leftBlock  = { x: houseRect.x,               y: houseRect.y, w: Math.max(0, doorRect.x - houseRect.x),           h: houseRect.h };
  const rightBlock = { x: doorRect.x + doorRect.w,   y: houseRect.y, w: Math.max(0, (houseRect.x + houseRect.w) - (doorRect.x + doorRect.w)), h: houseRect.h };

  if (houseImg) {
    // Resolve horizontal penetration from left or right blocks
    if (intersects(heroRect, leftBlock)) {
      // Coming from right -> push to the right edge of the left block
      hero.x = leftBlock.x + leftBlock.w;
    } else if (intersects(heroRect, rightBlock)) {
      // Coming from left -> push to the left edge of the right block
      hero.x = rightBlock.x - hero.w;
    }

    // Re-sync heroRect after potential push
    heroRect.x = hero.x;
  }

  // --- Door interact ---
  const atDoor = intersects(heroRect, doorRect);
  if (atDoor && (keys.has("e") || keys.has("E"))) { warpTo(HOUSE_URL); return; }


  // Gravity + ground
  hero.vy += GRAVITY;
  hero.y += hero.vy;
  const floor = groundY - hero.h;
  if (hero.y >= floor) { hero.y = floor; hero.vy = 0; hero.onGround = true; }
}

// ===== Render =====
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // House (draw behind hero)
  if (houseImg) {
    ctx.drawImage(houseImg, houseRect.x, houseRect.y, houseRect.w, houseRect.h);
  }

  // Hero
  if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  else { ctx.fillStyle = "#333"; ctx.fillRect(hero.x, hero.y, hero.w, hero.h); }

  // // Debug: show door bounds (uncomment to see)
  // ctx.strokeStyle = "rgba(255,255,0,.85)";
  // ctx.lineWidth = 2;
  // ctx.strokeRect(doorRect.x, doorRect.y, doorRect.w, doorRect.h);
}



function loop() { step(); render(); requestAnimationFrame(loop); }

// ===== Live hero sprite updates when gender changes =====
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
Promise.all([load(ASSETS.bg), load(ASSETS.house), load(ASSETS.hero)])
  .then(([b, ho, h]) => {
    bg = b;
    houseImg = ho;
    heroImg = h;
    refreshBounds();
    layoutHouse();
    loop();
  })
  .catch(() => {
    refreshBounds();
    layoutHouse();
    loop();
  });


