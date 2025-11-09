// --- Dreadheim Forest Entrance (Overworld with slow-chasing boar + loot) ---
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// ====== CONFIG ======
const ASSETS = {
  bg: "/guildbook/maps/dreadheimforest.png",
  hero: "/guildbook/avatars/dreadheim-warrior.png",
  boar: "/guildbook/avatars/enemies/diseasedboar.png",
  meat: "/guildbook/loot/infectedboarmeat.png"   // place file here
};

const WALKWAY_TOP_RATIO = 0.86;
const SPEED = 4;
const GRAVITY = 0.8;
const JUMP_VELOCITY = -16;
const HERO_W = 96, HERO_H = 96;
const BOAR_W = 110, BOAR_H = 90;

const ENGAGE_DIST = 120;              // start battle
const ALERT_DIST = 320;               // start chasing
const CHASE_SPEED = 1.2;              // “a little more slow”
const PATROL_SPEED = 1.8;

const BATTLE_URL = "/dreadheimbattle.html";

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
let meatImg: HTMLImageElement | null = null;

// ====== WORLD / ENTITIES ======
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.max(0, Math.min(window.innerWidth - HERO_W, window.innerWidth / 2 - HERO_W / 2)),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
  vx: 0, vy: 0,
  onGround: true,
};

// State flags saved by battle
const BOAR_DEAD = () => localStorage.getItem("va_bf_boar_defeated") === "1";
const LOOT_TAKEN = () => localStorage.getItem("va_loot_infectedboarmeat") === "1";

const boar = {
  x: Math.min(window.innerWidth - BOAR_W - 160, hero.x + 240),
  y: groundY - BOAR_H,
  w: BOAR_W, h: BOAR_H,
  vx: PATROL_SPEED,
  dir: -1 as -1 | 1,
  minX: 80,
  maxX: Math.max(380, window.innerWidth - 260),
  alive: !BOAR_DEAD(),
};

const loot = {
  x: Math.min(window.innerWidth - 120, Math.max(120, hero.x + 200)),
  y: groundY - 48,
  w: 42, h: 42,
  visible: BOAR_DEAD() && !LOOT_TAKEN(),
};

// recalc ground & patrol when viewport changes
function refreshBounds() {
  groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

  hero.y = Math.min(hero.y, groundY - hero.h);
  if (hero.y >= groundY - hero.h) { hero.y = groundY - hero.h; hero.vy = 0; hero.onGround = true; }

  boar.y = groundY - boar.h;
  boar.minX = 80;
  boar.maxX = Math.max(boar.minX + 300, window.innerWidth - 260);

  loot.y = groundY - 48;
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

// Click: engage boar or pick loot
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (boar.alive) {
    if (mx >= boar.x-10 && mx <= boar.x + boar.w + 10 &&
        my >= boar.y-10 && my <= boar.y + boar.h + 10) {
      goToBattle();
      return;
    }
  }
  if (loot.visible) {
    if (mx >= loot.x && mx <= loot.x + loot.w &&
        my >= loot.y && my <= loot.y + loot.h) {
      localStorage.setItem("va_loot_infectedboarmeat", "1");
      loot.visible = false;
      toast("You pick up: Infected Boar Meat");
    }
  }
});

// ====== ENGAGE / TRANSITION ======
let transitioning = false;
function goToBattle() {
  if (transitioning || !boar.alive) return;
  transitioning = true;
  fadeTo(0.25, () => window.location.href = BATTLE_URL);
}

function fadeTo(timeSec: number, onEnd: () => void) {
  const fade = document.createElement("div");
  Object.assign(fade.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0)",
    transition: `background ${timeSec}s ease`, zIndex: "999999",
  } as CSSStyleDeclaration);
  document.body.appendChild(fade);
  requestAnimationFrame(() => (fade.style.background = "rgba(0,0,0,1)"));
  setTimeout(onEnd, timeSec * 1000);
}

function toast(msg:string) {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', left:'50%', top:'16px', transform:'translateX(-50%)',
    background:'rgba(20,20,20,.92)', color:'#e6d5a9', border:'1px solid #9b834d',
    padding:'10px 14px', borderRadius:'10px', zIndex:'999999',
    boxShadow:'0 6px 24px rgba(0,0,0,.45)', fontFamily:'Cinzel, serif'
  } as CSSStyleDeclaration);
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2000);
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

  // If boar died in battle, hide and show loot
  if (BOAR_DEAD() && boar.alive) {
    boar.alive = false;
    loot.visible = !LOOT_TAKEN();
  }

  // Boar AI
  if (boar.alive) {
    const cxHero = hero.x + hero.w / 2;
    const cyHero = hero.y + hero.h / 2;
    const cxBoar = boar.x + boar.w / 2;
    const cyBoar = boar.y + boar.h / 2;
    const dx = cxHero - cxBoar;
    const dy = cyHero - cyBoar;
    const dist = Math.hypot(dx, dy);

    if (dist <= ENGAGE_DIST) {
      goToBattle();
    } else if (dist <= ALERT_DIST) {
      // slow chase toward hero
      boar.dir = (dx > 0) ? 1 : -1;
      boar.x += CHASE_SPEED * boar.dir;
    } else {
      // patrol
      boar.x += PATROL_SPEED * boar.dir;
      if (boar.x <= boar.minX) { boar.x = boar.minX; boar.dir = 1; }
      if (boar.x >= boar.maxX) { boar.x = boar.maxX; boar.dir = -1; }
    }
  }
}

// ====== RENDER ======
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // hero
  if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  else { ctx.fillStyle = "#333"; ctx.fillRect(hero.x, hero.y, hero.w, hero.h); }

  // boar (flip when moving left)
  if (boar.alive) {
    const bx = boar.x, by = boar.y;
    if (boarImg && boarImg.complete) {
      ctx.save();
      if (boar.dir < 0) {
        ctx.translate(bx + boar.w / 2, by + boar.h / 2);
        ctx.scale(-1, 1);
        ctx.drawImage(boarImg, -boar.w / 2, -boar.h / 2, boar.w, boar.h);
      } else {
        ctx.drawImage(boarImg, bx, by, boar.w, boar.h);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(10,10,10,.85)";
      ctx.fillRect(bx, by, boar.w, boar.h);
    }
  }

  // loot drop
  if (loot.visible && meatImg) {
    ctx.drawImage(meatImg, loot.x, loot.y, loot.w, loot.h);
  }
}

function loop() { step(); render(); requestAnimationFrame(loop); }

// ====== BOOT ======
Promise.all([load(ASSETS.bg), load(ASSETS.hero), load(ASSETS.boar), load(ASSETS.meat)])
  .then(([b, h, bo, m]) => { bg = b; heroImg = h; boarImg = bo; meatImg = m; refreshBounds(); loop(); })
  .catch(() => { refreshBounds(); loop(); });




