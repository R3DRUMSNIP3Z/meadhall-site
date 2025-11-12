// /src/dreadheimmap.ts
// --- Dreadheim • Forest Entrance (boar encounter + animated bat flock) ---
// NOTE: Requires /src/global-game-setup.ts to be loaded first (for VAQ + Inventory + getHeroSprite)

//////////////////////////////
// Canvas
//////////////////////////////
const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

//////////////////////////////
// Assets / Config
//////////////////////////////
const ASSETS = {
  bg: "/guildbook/maps/dreadheimforest.png",
  hero:
    (window as any).getHeroSprite
      ? (window as any).getHeroSprite()
      : "/guildbook/avatars/dreadheim-warrior.png",
  boar: "/guildbook/avatars/enemies/diseasedboar.png",
  meat: "/guildbook/loot/infectedboarmeat.png",
  bat1: "/guildbook/avatars/enemies/dreadheimbat.png",
  bat2: "/guildbook/avatars/enemies/dreadheimbat2.png",
  bat3: "/guildbook/avatars/enemies/dreadheimbat3.png",
} as const;

// Edge exits
const LEFT_EXIT_URL = "/game.html";
const RIGHT_EXIT_URL = "/dreadheimperimeters.html";
const EXIT_MARGIN = 4;

// Battle target
const BATTLE_URL = "/dreadheimbattle.html";

//////////////////////////////
// Fade / Warp helpers
//////////////////////////////
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

let transitioning = false;
function warpTo(url: string) {
  if (transitioning) return;
  transitioning = true;
  fadeTo(0.25, () => (window.location.href = url));
}
function goToBattle() {
  warpTo(BATTLE_URL);
}

//////////////////////////////
// World constants
//////////////////////////////
const WALKWAY_TOP_RATIO = 0.86;
const SPEED = 4;
const GRAVITY = 0.8;
const JUMP_VELOCITY = -16;
const HERO_W = 96, HERO_H = 96;
const BOAR_W = 110, BOAR_H = 90;

const ENGAGE_DIST = 120;  // auto-start battle
const ALERT_DIST = 320;   // slow chase radius
const CHASE_SPEED = 1.2;
const PATROL_SPEED = 1.8;

//////////////////////////////
// DPI / Resize
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
// Image loading
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
let heroImg: HTMLImageElement | null = null;
let boarImg: HTMLImageElement | null = null;
let meatImg: HTMLImageElement | null = null;

// Bats
let batFrames: HTMLImageElement[] = [];

type Dir = 1 | -1;
type Bat = {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number; dir: Dir;
  frame: number; lastFrame: number; frameDelay: number;
  maxSpeed: number; wanderTheta: number; wanderJitter: number; wanderRadius: number;
};

const BAT_SIZE = 30;
const FLOCK_COUNT = 9;
const bats: Bat[] = [];

function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function randi(min: number, max: number) { return Math.floor(rand(min, max)); }

function spawnBat() {
  const W = window.innerWidth, H = window.innerHeight;
  const margin = 40;
  const x = rand(margin, W - margin);
  const y = rand(margin, H - margin);
  const angle = rand(0, Math.PI * 2);
  const speed = rand(0.7, 1.6);
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;

  bats.push({
    x, y, w: BAT_SIZE, h: BAT_SIZE,
    vx, vy,
    dir: vx >= 0 ? 1 : -1,
    frame: 0, lastFrame: 0, frameDelay: randi(90, 140),
    maxSpeed: 2.0,
    wanderTheta: rand(0, Math.PI * 2),
    wanderJitter: 0.12,
    wanderRadius: 0.28
  });
}
function spawnFlock(n = FLOCK_COUNT) { for (let i = 0; i < n; i++) spawnBat(); }

//////////////////////////////
// Entities
//////////////////////////////
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.max(0, Math.min(window.innerWidth - HERO_W, window.innerWidth / 2 - HERO_W / 2)),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
  vx: 0, vy: 0,
  onGround: true,
};

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

function refreshBounds() {
  groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

  hero.y = Math.min(hero.y, groundY - hero.h);
  if (hero.y >= groundY - hero.h) {
    hero.y = groundY - hero.h;
    hero.vy = 0;
    hero.onGround = true;
  }

  boar.y = groundY - boar.h;
  boar.minX = 80;
  boar.maxX = Math.max(boar.minX + 300, window.innerWidth - 260);

  loot.y = groundY - 48;
}
window.addEventListener("resize", refreshBounds);

//////////////////////////////
// Input
//////////////////////////////
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

//////////////////////////////
// Dev reset (testing)
//////////////////////////////
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
    localStorage.removeItem("va_bf_boar_defeated");
    localStorage.removeItem("va_loot_infectedboarmeat");
    boar.alive = true;
    loot.visible = false;
    toast("Dev Reset: Boar restored and loot cleared.");
  }
});

//////////////////////////////
// Click: engage boar or pick loot
//////////////////////////////
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (boar.alive) {
    if (
      mx >= boar.x - 10 &&
      mx <= boar.x + boar.w + 10 &&
      my >= boar.y - 10 &&
      my <= boar.y + boar.h + 10
    ) {
      goToBattle();
      return;
    }
  }
  if (loot.visible) {
    if (mx >= loot.x && mx <= loot.x + loot.w && my >= loot.y && my <= loot.y + loot.h) {
      (window as any).Inventory?.add?.("infectedboarmeat", "Infected Boar Meat", ASSETS.meat, 1);
      localStorage.setItem("va_loot_infectedboarmeat", "1");
      loot.visible = false;
      toast("You pick up: Infected Boar Meat");
    }
  }
});

//////////////////////////////
// Toast
//////////////////////////////
function toast(msg: string) {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed",
    left: "50%",
    top: "16px",
    transform: "translateX(-50%)",
    background: "rgba(20,20,20,.92)",
    color: "#e6d5a9",
    border: "1px solid #9b834d",
    padding: "10px 14px",
    borderRadius: "10px",
    zIndex: "999999",
    boxShadow: "0 6px 24px rgba(0,0,0,.45)",
    fontFamily: "Cinzel, serif",
  } as CSSStyleDeclaration);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

//////////////////////////////
// Update
//////////////////////////////
function step() {
  // horizontal intent
  let vx = 0;
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) vx -= SPEED;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) vx += SPEED;
  hero.vx = vx;

  // edge exits (before position update so hugging wall warps)
  if (hero.x <= EXIT_MARGIN) { warpTo(LEFT_EXIT_URL); return; }
  if (hero.x + hero.w >= window.innerWidth - EXIT_MARGIN) { warpTo(RIGHT_EXIT_URL); return; }

  // movement + clamp
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

  // boar death/loot visibility sync
  if (BOAR_DEAD() && boar.alive) {
    boar.alive = false;
    loot.visible = !LOOT_TAKEN();
  }

  // boar AI
  if (boar.alive) {
    const cxHero = hero.x + hero.w / 2;
    const cxBoar = boar.x + boar.w / 2;
    const dx = cxHero - cxBoar;
    const dist = Math.abs(dx);

    if (dist <= ENGAGE_DIST) {
      goToBattle();
    } else if (dist <= ALERT_DIST) {
      boar.dir = dx > 0 ? 1 : -1;
      boar.x += CHASE_SPEED * boar.dir;
    } else {
      boar.x += PATROL_SPEED * boar.dir;
      if (boar.x <= boar.minX) { boar.x = boar.minX; boar.dir = 1; }
      if (boar.x >= boar.maxX) { boar.x = boar.maxX; boar.dir = -1; }
    }
  }

  // bat flock: wander + separation + wrap
  const now = performance.now();
  const SEP_RADIUS = 80;
  const SEP_FORCE = 0.04;

  for (let i = 0; i < bats.length; i++) {
    const b = bats[i];

    if (batFrames.length === 3 && now - b.lastFrame > b.frameDelay) {
      b.frame = (b.frame + 1) % 3;
      b.lastFrame = now;
    }

    b.wanderTheta += rand(-b.wanderJitter, b.wanderJitter);
    const steerX = Math.cos(b.wanderTheta) * b.wanderRadius;
    const steerY = Math.sin(b.wanderTheta) * b.wanderRadius;
    b.vx += steerX * 0.02;
    b.vy += steerY * 0.02;

    let sepX = 0, sepY = 0;
    for (let j = 0; j < bats.length; j++) {
      if (i === j) continue;
      const o = bats[j];
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < SEP_RADIUS * SEP_RADIUS) {
        const d = Math.sqrt(d2);
        sepX += dx / d;
        sepY += dy / d;
      }
    }
    b.vx += sepX * SEP_FORCE;
    b.vy += sepY * SEP_FORCE;

    const sp = Math.hypot(b.vx, b.vy);
    if (sp > b.maxSpeed) {
      b.vx = (b.vx / sp) * b.maxSpeed;
      b.vy = (b.vy / sp) * b.maxSpeed;
    }

    b.x += b.vx;
    b.y += b.vy;
    b.dir = b.vx >= 0 ? 1 : -1;

    const pad = 40;
    const W = window.innerWidth, H = window.innerHeight;
    if (b.x > W + pad) b.x = -pad;
    if (b.x < -pad)    b.x = W + pad;
    if (b.y > H + pad) b.y = -pad;
    if (b.y < -pad)    b.y = H + pad;
  }
}

//////////////////////////////
// Render
//////////////////////////////
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // bats behind the hero
  if (batFrames.length === 3) {
    for (const b of bats) {
      const img = batFrames[b.frame];
      ctx.save();
      if (b.dir < 0) {
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -b.w / 2, -b.h / 2, b.w, b.h);
      } else {
        ctx.drawImage(img, b.x, b.y, b.w, b.h);
      }
      ctx.restore();
    }
  }

  // hero
  if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  else {
    ctx.fillStyle = "#333";
    ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  }

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

  // loot
  if (loot.visible && meatImg) {
    ctx.drawImage(meatImg, loot.x, loot.y, loot.w, loot.h);
  }
}

function loop() {
  step();
  render();
  requestAnimationFrame(loop);
}

//////////////////////////////
// QUEST HOOK on Arrival
//////////////////////////////
function handleArrivalQuestProgress() {
  // If game.ts set a pending travel marker, clear it and complete travel
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

    // Only progress this chain for Dreadheim path
    const race = (localStorage.getItem("va_race") || "").toLowerCase();

    // If we arrived via Travel, push the chain forward
    if (hadPending && race === "dreadheim") {
      VAQ.complete?.("q_travel_home"); // finish travel
    }

    // After ensuring/possibly completing travel, refresh readout
    const qs = (VAQ.readQuests?.() as any[]) || [];

    // Make wizard quest available/active if not done yet
    const qWiz = qs.find(q => q.id === "q_find_dreadheim_wizard");
    if (qWiz && qWiz.status !== "completed") {
      VAQ.setActive?.("q_find_dreadheim_wizard");
    }

    // Render HUD bottom-left
    VAQ.renderHUD?.();
  } catch (e) {
    console.warn("Quest arrival hook failed:", e);
  }
}

//////////////////////////////
// Boot
//////////////////////////////
Promise.all([
  load(ASSETS.bg),
  load(ASSETS.hero),
  load(ASSETS.boar),
  load(ASSETS.meat),
  load(ASSETS.bat1),
  load(ASSETS.bat2),
  load(ASSETS.bat3),
])
  .then(([b, h, bo, m, b1, b2, b3]) => {
    bg = b;
    heroImg = h;
    boarImg = bo;
    meatImg = m;
    batFrames = [b1, b2, b3];

    // Spawn ambience
    spawnFlock(FLOCK_COUNT);

    // Quest arrival progress + HUD
    handleArrivalQuestProgress();

    refreshBounds();
    loop();
  })
  .catch((err) => {
    console.warn("Dreadheim map: asset load fallback", err);
    // Even if images fail, still run the loop
    try { handleArrivalQuestProgress(); } catch {}
    refreshBounds();
    loop();
  });

//////////////////////////////
// (Optional) Badge cleanup — if a previous page left it visible
//////////////////////////////
(function cleanupBagBadge() {
  try { localStorage.setItem("va_bag_unread", "0"); } catch {}
  function nukeBadge() {
    const sel = "#vaBagBadge, .bag-badge, .inventory-badge";
    document.querySelectorAll(sel).forEach(el => {
      (el as HTMLElement).textContent = "";
      (el as HTMLElement).style.display = "none";
      (el as HTMLElement).removeAttribute("data-count");
    });
  }
  nukeBadge();
  addEventListener("pageshow", nukeBadge);
  addEventListener("focus", nukeBadge);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) nukeBadge(); });
})();











