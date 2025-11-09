// --- Dreadheim Forest Entrance (Overworld with roaming boar + battle hook) ---
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// ====== CONFIG ======
const ASSETS = {
  bg: "/guildbook/maps/dreadheimforest.png",
  hero: "/guildbook/avatars/dreadheim-warrior.png",
  boar: "/guildbook/avatars/enemies/diseasedboar.png",
};
const WALKWAY_TOP_RATIO = 0.86;  // tweak to match top of the bricks
const SPEED = 4;
const GRAVITY = 0.8;
const JUMP_VELOCITY = -16;
const HERO_W = 96, HERO_H = 96;
const BOAR_W = 110, BOAR_H = 90;
const ENGAGE_DIST = 120;          // auto-aggro radius
const CLICK_HIT_PAD = 16;         // click tolerance around boar
const BATTLE_URL = "/dreadheimbattle.html"; // make sure vite.config has this input!

// ====== DPR / Resize ======
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

// ====== LOAD IMAGES ======
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
let boarImg: HTMLImageElement | null = null;

// ====== WORLD / ENTITIES ======
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.max(0, Math.min(window.innerWidth - HERO_W, window.innerWidth / 2 - HERO_W / 2)),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
  vx: 0, vy: 0,
  onGround: true,
};

const boar = {
  x: Math.min(window.innerWidth - BOAR_W - 160, hero.x + 240), // start somewhat to the right
  y: groundY - BOAR_H,
  w: BOAR_W, h: BOAR_H,
  vx: 1.8,                    // patrol speed
  dir: -1 as -1 | 1,          // -1 = left, 1 = right (we'll flip image when facing left)
  minX: 80,                   // patrol bounds (we’ll update on resize)
  maxX: Math.max(380, window.innerWidth - 260),
};

// recalc ground & patrol when viewport changes
function refreshBounds() {
  groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

  hero.y = Math.min(hero.y, groundY - hero.h);
  if (hero.y >= groundY - hero.h) { hero.y = groundY - hero.h; hero.vy = 0; hero.onGround = true; }

  boar.y = groundY - boar.h;
  boar.minX = 80;
  boar.maxX = Math.max(boar.minX + 300, window.innerWidth - 260);
}
window.addEventListener("resize", refreshBounds);

// ====== INPUT ======
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

// Click-to-engage
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  // simple hit test on boar sprite
  if (mx >= boar.x - CLICK_HIT_PAD && mx <= boar.x + boar.w + CLICK_HIT_PAD &&
      my >= boar.y - CLICK_HIT_PAD && my <= boar.y + boar.h + CLICK_HIT_PAD) {
    goToBattle();
  }
});

// ====== ENGAGE / TRANSITION ======
let transitioning = false;
function goToBattle() {
  if (transitioning) return;
  transitioning = true;

  // (Optional) small fade
  const fade = document.createElement("div");
  Object.assign(fade.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0)",
    transition: "background .25s ease", zIndex: "999999",
  } as CSSStyleDeclaration);
  document.body.appendChild(fade);
  requestAnimationFrame(() => (fade.style.background = "rgba(0,0,0,1)"));
  setTimeout(() => {
    window.location.href = BATTLE_URL;
  }, 250);
}

// ====== UPDATE ======
function step() {
  // hero horizontal intent
  let vx = 0;
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) vx -= SPEED;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) vx += SPEED;
  hero.vx = vx;

  // apply horizontal + clamp
  hero.x += hero.vx;
  if (hero.x < 0) hero.x = 0;
  const maxHX = window.innerWidth - hero.w;
  if (hero.x > maxHX) hero.x = maxHX;

  // gravity
  hero.vy += GRAVITY;
  hero.y += hero.vy;

  // ground collision
  const floor = groundY - hero.h;
  if (hero.y >= floor) {
    hero.y = floor;
    hero.vy = 0;
    hero.onGround = true;
  }

  // Boar patrol
  boar.x += boar.vx * boar.dir;
  if (boar.x <= boar.minX) { boar.x = boar.minX; boar.dir = 1; }
  if (boar.x >= boar.maxX) { boar.x = boar.maxX; boar.dir = -1; }

  // Auto-engage if near
  const cxHero = hero.x + hero.w / 2;
  const cyHero = hero.y + hero.h / 2;
  const cxBoar = boar.x + boar.w / 2;
  const cyBoar = boar.y + boar.h / 2;
  const dx = cxBoar - cxHero;
  const dy = cyBoar - cyHero;
  const dist = Math.hypot(dx, dy);
  if (dist <= ENGAGE_DIST) goToBattle();
}

// ====== RENDER ======
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // hero
  if (heroImg) {
    ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  } else {
    ctx.fillStyle = "#333";
    ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  }

  // boar (flip when moving left so it faces its direction)
  const bx = boar.x, by = boar.y;
  if (boarImg && boarImg.complete) {
    ctx.save();
    if (boar.dir < 0) {
      // facing left: flip around its center
      ctx.translate(bx + boar.w / 2, by + boar.h / 2);
      ctx.scale(-1, 1);
      ctx.drawImage(boarImg, -boar.w / 2, -boar.h / 2, boar.w, boar.h);
    } else {
      // facing right: normal draw
      ctx.translate(0, 0);
      ctx.drawImage(boarImg, bx, by, boar.w, boar.h);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(10,10,10,.85)";
    ctx.fillRect(bx, by, boar.w, boar.h);
  }

  requestAnimationFrame(loop);
}

function loop() {
  step();
  render();
}

// ====== BOOT ======
Promise.all([load(ASSETS.bg), load(ASSETS.hero), load(ASSETS.boar)])
  .then(([b, h, bo]) => { bg = b; heroImg = h; boarImg = bo; refreshBounds(); loop(); })
  .catch(() => { refreshBounds(); loop(); });



